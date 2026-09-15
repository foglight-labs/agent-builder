import { systemPrompt, type Recommendation } from "@/lib/prompt";
import { getSkillsByNames, type SkillSummary } from "@/lib/skills";
import { runTool, tools } from "@/lib/tools";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5";
const MAX_TOOL_ROUNDS = 8;

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type AssistantReply = { content?: string | null; tool_calls?: ToolCall[] };

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "OPENROUTER_API_KEY is not set" }, { status: 500 });
  }
  if (!process.env.DATABASE_URL) {
    return Response.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }

  const { task } = (await request.json().catch(() => ({}))) as { task?: string };
  if (!task || !task.trim()) {
    return Response.json({ error: "task is required" }, { status: 400 });
  }

  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: task.trim() },
  ];

  let content = "";
  try {
    for (let round = 0; ; round++) {
      // After MAX_TOOL_ROUNDS, force a final answer instead of more tool calls.
      const forceAnswer = round >= MAX_TOOL_ROUNDS;
      const reply = await chat(apiKey, messages, forceAnswer);
      const calls = reply.tool_calls ?? [];

      if (forceAnswer || calls.length === 0) {
        content = reply.content ?? "";
        break;
      }

      messages.push({ role: "assistant", content: reply.content ?? "", tool_calls: calls });
      const results = await Promise.all(calls.map((c) => runTool(c.function.name, c.function.arguments)));
      calls.forEach((c, i) => messages.push({ role: "tool", tool_call_id: c.id, content: results[i] }));
    }
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }

  let parsed: { skills?: Recommendation[] };
  try {
    parsed = JSON.parse(extractJson(content));
  } catch {
    return Response.json({ error: "Model returned invalid JSON", raw: content }, { status: 502 });
  }

  const recommendations = (parsed.skills ?? []).filter((r) => r && typeof r.name === "string");
  let byName: Map<string, SkillSummary>;
  try {
    const rows = await getSkillsByNames(recommendations.map((r) => r.name));
    byName = new Map(rows.map((s) => [s.name, s]));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }

  const seen = new Set<string>();
  const picked = recommendations
    .filter((r) => byName.has(r.name) && !seen.has(r.name) && seen.add(r.name))
    .map((r) => {
      const row = byName.get(r.name)!;
      return {
        name: row.name,
        source: row.source,
        reason: r.reason ?? "",
        setup: r.setup ?? "",
        url: row.url,
      };
    });

  if (picked.length === 0) {
    return Response.json({ error: "No matching skills recommended", raw: content }, { status: 502 });
  }

  const sources = [...new Set(picked.map((s) => s.source))];
  const script = [
    "#!/usr/bin/env bash",
    `# Skill pack for: ${task.trim().replace(/\s+/g, " ")}`,
    `# Sources: ${sources.join(", ")}`,
    "set -e",
    "",
    ...picked.flatMap((s) => [
      `# ${s.name}: ${s.reason}`,
      `npx skills add ${s.source} --skill ${s.name} -y`,
      "",
    ]),
  ].join("\n");

  return Response.json({ skills: picked, script });
}

async function chat(apiKey: string, messages: Message[], forceAnswer: boolean): Promise<AssistantReply> {
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
      tool_choice: forceAnswer ? "none" : "auto",
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const reply = data?.choices?.[0]?.message as AssistantReply | undefined;
  if (!reply) throw new Error("OpenRouter returned no message");
  return reply;
}

function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start === -1 || end === -1 ? text : text.slice(start, end + 1);
}
