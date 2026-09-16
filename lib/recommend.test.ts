import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_TOOL_ROUNDS, MODEL, recommend, RecommendError } from "@/lib/recommend";
import type { RunRecord } from "@/lib/run-log";
import type { SkillSummary } from "@/lib/skills";

// `vi.mock` factories are hoisted above imports, so the mocks they return must
// come from `vi.hoisted`. The MCP server pulls `searchSkills`/`getSkill` from
// the same module, so all three have to be stubbed to keep the catalog (and
// therefore the database) out of these tests.
const { searchSkills, getSkill, getSkillsByIds } = vi.hoisted(() => ({
  searchSkills: vi.fn(),
  getSkill: vi.fn(),
  getSkillsByIds: vi.fn(),
}));

vi.mock("@/lib/skills", () => ({ searchSkills, getSkill, getSkillsByIds }));

const SAMPLE_SKILL: SkillSummary = {
  id: "acme/skills/foo",
  source: "acme/skills",
  name: "foo",
  description: "does foo",
  url: "https://example.com/foo",
};

type ChatBody = {
  tool_choice: "auto" | "none";
  response_format?: { type: string };
  messages: { role: string; content: string }[];
};

type Reply = {
  content?: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  usage?: { prompt_tokens: number; completion_tokens: number; cost: number };
};

/** Bodies of every OpenRouter request made during the test, in order. */
let sentBodies: ChatBody[] = [];

/** Queue scripted OpenRouter replies, consumed one per `chat()` call. */
function scriptReplies(...replies: Reply[]): void {
  const queue = [...replies];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      sentBodies.push(JSON.parse(init.body) as ChatBody);
      const next = queue.shift();
      if (!next) throw new Error("fetch called more times than the test scripted replies");
      const payload = {
        id: `gen-${sentBodies.length}`,
        choices: [{ message: { content: next.content ?? null, tool_calls: next.tool_calls } }],
        usage: next.usage,
      };
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    })
  );
}

function makeRun(): RunRecord {
  return {
    event: "run",
    id: "test-run",
    started_at: new Date().toISOString(),
    status: "ok",
    version: {
      git_commit: "test",
      git_dirty: "false",
      app_version: "0.1.0",
      prompt_hash: "",
      model_requested: MODEL,
      max_tool_rounds: MAX_TOOL_ROUNDS,
    },
    input: { task: "find me billing skills" },
    trace: { system_prompt: "", rounds: [], tool_call_count: 0, trimmed: false },
  };
}

const VALID_ANSWER = JSON.stringify({
  skills: [{ id: "acme/skills/foo", reason: "does the thing", setup: "No extra setup" }],
});

describe("recommend", () => {
  beforeEach(() => {
    sentBodies = [];
    searchSkills.mockReset().mockResolvedValue([SAMPLE_SKILL]);
    getSkill.mockReset();
    getSkillsByIds.mockReset().mockResolvedValue([SAMPLE_SKILL]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("recovers from a prose reply with a single repair round", async () => {
    scriptReplies(
      { content: "Doing well, thanks! What are you working on?", usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.001 } },
      { content: VALID_ANSWER, usage: { prompt_tokens: 150, completion_tokens: 30, cost: 0.002 } }
    );

    const run = makeRun();
    const result = await recommend("find me billing skills", "key", run);

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].name).toBe("foo");
    expect(result.script).toContain("npx skills add acme/skills --skill foo -y");

    expect(run.trace.rounds).toHaveLength(2);
    expect(run.trace.rounds[0].repair).toBeUndefined();
    expect(run.trace.rounds[1].repair).toBe(true);
    expect(run.trace.final_content).toBe(VALID_ANSWER);
    expect(run.usage_total).toEqual({ prompt_tokens: 250, completion_tokens: 50, cost: 0.003 });
  });

  it("throws a parse error when the repair round also fails", async () => {
    scriptReplies({ content: "still chatting" }, { content: "nope, more prose" });

    const run = makeRun();
    const err = await recommend("find me billing skills", "key", run).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RecommendError);
    // `raw` carries the repair round's output, not the original prose, so the
    // log shows what the model said when it was asked directly for JSON.
    expect(err).toMatchObject({ stage: "parse", status: 502, raw: "nope, more prose" });
    expect(run.trace.rounds).toHaveLength(2);
  });

  it("does not attempt a repair round when the first answer already parses", async () => {
    scriptReplies({ content: VALID_ANSWER });

    const run = makeRun();
    await recommend("find me billing skills", "key", run);

    expect(sentBodies).toHaveLength(1);
    expect(run.trace.rounds).toHaveLength(1);
  });

  it("returns an empty result set instead of erroring when nothing resolves", async () => {
    getSkillsByIds.mockResolvedValue([]);
    scriptReplies({ content: JSON.stringify({ skills: [{ id: "ghost/skills/bar", reason: "r", setup: "s" }] }) });

    const run = makeRun();
    const result = await recommend("how are you doing?", "key", run);

    expect(result).toEqual({ skills: [], script: "" });
    expect(run.trace.dropped_ids).toEqual(["ghost/skills/bar"]);
  });

  it("returns an empty result set when the model recommends nothing", async () => {
    scriptReplies({ content: JSON.stringify({ skills: [] }) });

    const result = await recommend("how are you doing?", "key", makeRun());

    expect(result).toEqual({ skills: [], script: "" });
    expect(getSkillsByIds).toHaveBeenCalledWith([]);
  });

  it("counts executed tool calls across rounds", async () => {
    scriptReplies(
      {
        content: "",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "search_skills", arguments: '{"query":"billing"}' } },
          { id: "c2", type: "function", function: { name: "search_skills", arguments: '{"query":"stripe"}' } },
        ],
      },
      { content: VALID_ANSWER }
    );

    const run = makeRun();
    await recommend("find me billing skills", "key", run);

    expect(run.trace.tool_call_count).toBe(2);
    expect(searchSkills).toHaveBeenCalledTimes(2);
  });

  it("records tool_call_count 0 when the agent answers without searching", async () => {
    scriptReplies({ content: VALID_ANSWER });

    const run = makeRun();
    await recommend("find me billing skills", "key", run);

    expect(run.trace.tool_call_count).toBe(0);
  });

  it("omits response_format on tool-bearing rounds and sets it on the repair round", async () => {
    scriptReplies({ content: "prose" }, { content: VALID_ANSWER });

    await recommend("find me billing skills", "key", makeRun());

    expect(sentBodies).toHaveLength(2);
    expect(sentBodies[0].tool_choice).toBe("auto");
    expect(sentBodies[0].response_format).toBeUndefined();
    expect(sentBodies[1].tool_choice).toBe("none");
    expect(sentBodies[1].response_format).toEqual({ type: "json_object" });
    expect(sentBodies[1].messages.at(-1)?.content).toContain('{"skills":[]}');
  });
});
