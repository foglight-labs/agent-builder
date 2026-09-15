import { systemPrompt, type Recommendation } from "@/lib/prompt";
import { getSkillsByNames, type SkillSummary } from "@/lib/skills";
import { runTool, tools } from "@/lib/tools";
import { truncate, type RoundTrace, type RunRecord, type ToolCallTrace } from "@/lib/run-log";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5";
const MAX_TOOL_ROUNDS = 8;

export { MODEL, MAX_TOOL_ROUNDS };

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type AssistantReply = {
  content?: string | null;
  tool_calls?: ToolCall[];
  generation_id?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
};

export type RecommendResult = {
  skills: { name: string; source: string; reason: string; setup: string; url: string }[];
  script: string;
};

/** A failure with enough context to pick an HTTP status and a log stage. */
export class RecommendError extends Error {
  stage: string;
  status: number;
  raw?: string;

  constructor(stage: string, message: string, status: number, raw?: string) {
    super(message);
    this.stage = stage;
    this.status = status;
    this.raw = raw;
  }
}

/**
 * Run the OpenRouter tool-calling loop for `task`, appending every round and
 * tool call to `run.trace` as it happens, and return the final recommendation.
 * Throws `RecommendError` on any failure; `run.trace` still reflects progress
 * made before the failure so the caller can log it.
 */
export async function recommend(task: string, apiKey: string, run: RunRecord): Promise<RecommendResult> {
  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: task },
  ];

  let content = "";
  const usageTotal = { prompt_tokens: 0, completion_tokens: 0, cost: 0 };

  for (let round = 0; ; round++) {
    // After MAX_TOOL_ROUNDS, force a final answer instead of more tool calls.
    const forceAnswer = round >= MAX_TOOL_ROUNDS;
    const toolChoice: "auto" | "none" = forceAnswer ? "none" : "auto";

    const roundStarted = Date.now();
    let reply: AssistantReply;
    try {
      reply = await chat(apiKey, messages, toolChoice);
    } catch (err) {
      throw new RecommendError("model", err instanceof Error ? err.message : String(err), 502);
    }
    const roundLatency = Date.now() - roundStarted;

    if (reply.usage) {
      usageTotal.prompt_tokens += reply.usage.prompt_tokens ?? 0;
      usageTotal.completion_tokens += reply.usage.completion_tokens ?? 0;
      usageTotal.cost += reply.usage.cost ?? 0;
    }

    const calls = reply.tool_calls ?? [];
    const toolCallTraces: ToolCallTrace[] = calls.map((c) => ({
      id: c.id,
      name: c.function.name,
      arguments: parseArgsForTrace(c.function.arguments),
    }));

    const roundTrace: RoundTrace = {
      index: round,
      tool_choice: toolChoice,
      latency_ms: roundLatency,
      generation_id: reply.generation_id,
      usage: reply.usage,
      assistant: { content: reply.content ?? "", tool_calls: toolCallTraces },
      tool_results: [],
    };
    run.trace.rounds.push(roundTrace);

    if (forceAnswer || calls.length === 0) {
      content = reply.content ?? "";
      break;
    }

    messages.push({ role: "assistant", content: reply.content ?? "", tool_calls: calls });

    const results = await Promise.all(
      calls.map(async (c) => {
        const started = Date.now();
        const result = await runTool(c.function.name, c.function.arguments);
        const latency_ms = Date.now() - started;
        const { text, truncated, chars } = truncate(result);
        roundTrace.tool_results.push({
          tool_call_id: c.id,
          name: c.function.name,
          latency_ms,
          chars,
          truncated,
          result: text,
        });
        return result;
      })
    );
    calls.forEach((c, i) => messages.push({ role: "tool", tool_call_id: c.id, content: results[i] }));
  }

  run.trace.final_content = content;
  run.usage_total = usageTotal;

  let parsed: { skills?: Recommendation[] };
  try {
    parsed = JSON.parse(extractJson(content));
  } catch {
    throw new RecommendError("parse", "Model returned invalid JSON", 502, content);
  }

  const recommendations = (parsed.skills ?? []).filter((r) => r && typeof r.name === "string");

  let byName: Map<string, SkillSummary>;
  try {
    const rows = await getSkillsByNames(recommendations.map((r) => r.name));
    byName = new Map(rows.map((s) => [s.name, s]));
  } catch (err) {
    throw new RecommendError("validate", err instanceof Error ? err.message : String(err), 502);
  }

  const seen = new Set<string>();
  const picked = recommendations
    .filter((r) => byName.has(r.name) && !seen.has(r.name) && seen.add(r.name))
    .map((r) => {
      const row = byName.get(r.name)!;
      return { name: row.name, source: row.source, reason: r.reason ?? "", setup: r.setup ?? "", url: row.url };
    });

  run.trace.recommended_names = recommendations.map((r) => r.name);
  run.trace.dropped_names = recommendations.map((r) => r.name).filter((n) => !byName.has(n));

  if (picked.length === 0) {
    throw new RecommendError("no_matches", "No matching skills recommended", 502, content);
  }

  const sources = [...new Set(picked.map((s) => s.source))];
  const script = [
    "#!/usr/bin/env bash",
    `# Skill pack for: ${task.replace(/\s+/g, " ")}`,
    `# Sources: ${sources.join(", ")}`,
    "set -e",
    "",
    ...picked.flatMap((s) => [`# ${s.name}: ${s.reason}`, `npx skills add ${s.source} --skill ${s.name} -y`, ""]),
  ].join("\n");

  return { skills: picked, script };
}

async function chat(apiKey: string, messages: Message[], toolChoice: "auto" | "none"): Promise<AssistantReply> {
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools,
      tool_choice: toolChoice,
      usage: { include: true },
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const message = data?.choices?.[0]?.message;
  if (!message) throw new Error("OpenRouter returned no message");
  return {
    content: message.content,
    tool_calls: message.tool_calls,
    generation_id: data?.id,
    usage: data?.usage
      ? {
          prompt_tokens: data.usage.prompt_tokens,
          completion_tokens: data.usage.completion_tokens,
          cost: data.usage.cost,
        }
      : undefined,
  };
}

function parseArgsForTrace(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start === -1 || end === -1 ? text : text.slice(start, end + 1);
}
