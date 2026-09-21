import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { systemPrompt, type Recommendation } from "@/lib/prompt";
import { createSkillsMcpServer } from "@/lib/mcp";
import { buildInstallScript } from "@/lib/script";
import { getSkillsByIds, type SkillSummary } from "@/lib/skills";
import { promptHash, truncate, type RoundTrace, type RunRecord, type ToolCallTrace } from "@/lib/run-log";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5";
const MAX_TOOL_ROUNDS = 8;

export { MODEL, MAX_TOOL_ROUNDS };

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type OpenAiTool = { type: "function"; function: { name: string; description?: string; parameters: unknown } };

/**
 * Basic JSON mode. Deliberately not `json_schema`: OpenRouter resolves
 * structured-output support per *endpoint*, and strict schema mode is
 * supported by materially fewer providers than `json_object` for what is a
 * single trivial payload shape we validate by hand anyway.
 */
type ResponseFormat = { type: "json_object" };

const JSON_OBJECT: ResponseFormat = { type: "json_object" };

const REPAIR_INSTRUCTION =
  "That reply was not valid JSON. Respond again with only a JSON object — no prose, no code fences — " +
  'in exactly this shape: {"skills":[{"id":"...","reason":"...","setup":"..."}]}. ' +
  'Use only skill ids returned by the tools. If nothing in the catalog fits the task, return {"skills":[]}.';

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
 * Connect an MCP client to a fresh in-process skills server over a linked
 * in-memory transport pair. This is the same server `/api/mcp` serves over
 * HTTP; using it here (rather than a separate tool registry) means the
 * recommender can never see a different tool surface than any other agent.
 */
async function connectInProcessMcpClient(): Promise<Client> {
  const server = createSkillsMcpServer();
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "agent-builder-recommender", version: "0.1.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

/** Call one MCP tool and flatten its result to the JSON string the chat loop expects. */
async function callMcpTool(client: Client, name: string, rawArgs: string): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return JSON.stringify({ error: "Arguments were not valid JSON" });
  }

  const result = await client.callTool({ name, arguments: args });
  if (result.structuredContent !== undefined) return JSON.stringify(result.structuredContent);
  const text = result.content.find((c): c is { type: "text"; text: string } => c.type === "text")?.text;
  return text ?? JSON.stringify(result);
}

/**
 * Describe a tool call in human terms for `onProgress`, e.g. for a status
 * line shown to the user while the agent is working.
 */
function describeToolCall(name: string, rawArgs: string): string {
  let args: Record<string, unknown> = {};
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    // fall through with empty args
  }
  if (name === "search_skills") {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    return query ? `Searching for "${query}"\u2026` : "Listing the full catalog\u2026";
  }
  if (name === "get_skill") {
    const id = typeof args.id === "string" ? args.id : "";
    return id ? `Reading ${id}\u2026` : "Reading skill details\u2026";
  }
  return `Running ${name}\u2026`;
}

/**
 * Run the OpenRouter tool-calling loop for `task` against the skills MCP
 * server, appending every round and tool call to `run.trace` as it happens,
 * and return the final recommendation. Throws `RecommendError` on any
 * failure; `run.trace` still reflects progress made before the failure so
 * the caller can log it. `onProgress`, if given, is called with a short
 * human-readable status line before each model call and each tool call.
 */
export async function recommend(
  task: string,
  apiKey: string,
  run: RunRecord,
  onProgress?: (message: string) => void
): Promise<RecommendResult> {
  const mcpClient = await connectInProcessMcpClient();
  const { tools: mcpTools } = await mcpClient.listTools();
  const openAiTools: OpenAiTool[] = mcpTools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
  run.version.prompt_hash = await promptHash(systemPrompt, openAiTools);

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

    onProgress?.("Thinking\u2026");
    const roundStarted = Date.now();
    let reply: AssistantReply;
    try {
      // JSON mode only on rounds that cannot emit tool calls. Mixing
      // `response_format` with live `tools` is handled inconsistently across
      // providers, so the search path is left exactly as it was and the
      // repair round below carries the enforcement instead.
      reply = await chat(apiKey, messages, openAiTools, toolChoice, forceAnswer ? JSON_OBJECT : undefined);
    } catch (err) {
      throw new RecommendError("model", describeError(err), 502);
    }
    const roundLatency = Date.now() - roundStarted;

    accumulateUsage(usageTotal, reply.usage);

    const calls = reply.tool_calls ?? [];
    run.trace.tool_call_count += calls.length;
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

    calls.forEach((c) => onProgress?.(describeToolCall(c.function.name, c.function.arguments)));

    let results: string[];
    try {
      results = await Promise.all(
        calls.map(async (c) => {
          const started = Date.now();
          const result = await callMcpTool(mcpClient, c.function.name, c.function.arguments);
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
    } catch (err) {
      const names = [...new Set(calls.map((c) => c.function.name))].join(", ");
      throw new RecommendError("tool", `Tool execution failed (${names}): ${describeError(err)}`, 502);
    }
    calls.forEach((c, i) => messages.push({ role: "tool", tool_call_id: c.id, content: results[i] }));
  }

  run.trace.final_content = content;
  run.usage_total = usageTotal;

  let parsed = tryParseRecommendations(content);

  // One repair round. Format drift on the last message would otherwise throw
  // away a run that searched the catalog correctly, so re-ask once with tools
  // disabled and JSON mode on before giving up.
  if (!parsed) {
    messages.push({ role: "assistant", content });
    messages.push({ role: "user", content: REPAIR_INSTRUCTION });

    onProgress?.("Thinking\u2026");
    const repairStarted = Date.now();
    let reply: AssistantReply;
    try {
      reply = await chat(apiKey, messages, openAiTools, "none", JSON_OBJECT);
    } catch (err) {
      throw new RecommendError("model", describeError(err), 502);
    }

    accumulateUsage(usageTotal, reply.usage);
    content = reply.content ?? "";
    run.trace.final_content = content;
    run.trace.rounds.push({
      index: run.trace.rounds.length,
      tool_choice: "none",
      repair: true,
      latency_ms: Date.now() - repairStarted,
      generation_id: reply.generation_id,
      usage: reply.usage,
      assistant: { content, tool_calls: [] },
      tool_results: [],
    });

    parsed = tryParseRecommendations(content);
  }

  if (!parsed) {
    throw new RecommendError("parse", "Model returned invalid JSON", 502, content);
  }

  const recommendations = (Array.isArray(parsed.skills) ? parsed.skills : []).filter((r) => r && typeof r.id === "string");

  let byId: Map<string, SkillSummary>;
  try {
    const rows = await getSkillsByIds(recommendations.map((r) => r.id));
    byId = new Map(rows.map((s) => [s.id, s]));
  } catch (err) {
    throw new RecommendError("validate", describeError(err), 502);
  }

  const seen = new Set<string>();
  const picked = recommendations
    .filter((r) => byId.has(r.id) && !seen.has(r.id) && seen.add(r.id))
    .map((r) => {
      const row = byId.get(r.id)!;
      return { name: row.name, source: row.source, reason: r.reason ?? "", setup: r.setup ?? "", url: row.url };
    });

  run.trace.recommended_ids = recommendations.map((r) => r.id);
  run.trace.dropped_ids = recommendations.map((r) => r.id).filter((id) => !byId.has(id));

  // An empty result set is a normal outcome for a search over a finite
  // catalog, not a server error. `trace.tool_call_count` distinguishes
  // "nothing matched" from "the agent never searched".
  if (picked.length === 0) {
    return { skills: [], script: "" };
  }

  const script = buildInstallScript(picked);

  return { skills: picked, script };
}

async function chat(
  apiKey: string,
  messages: Message[],
  tools: OpenAiTool[],
  toolChoice: "auto" | "none",
  responseFormat?: ResponseFormat
): Promise<AssistantReply> {
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
      ...(responseFormat ? { response_format: responseFormat } : {}),
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

/**
 * Flatten an unknown throwable into a message worth logging. Node wraps
 * multi-address connection failures in an `AggregateError` whose own `message`
 * is empty, so the sub-errors and any `cause` chain have to be unwrapped
 * explicitly or the log just reads "AggregateError".
 */
export function describeError(err: unknown): string {
  if (err instanceof AggregateError) {
    const parts = err.errors.map(describeError).filter(Boolean);
    const detail = [...new Set(parts)].join("; ");
    return err.message ? `${err.message}: ${detail}` : detail || "AggregateError with no sub-errors";
  }
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    const base = err.message || err.name;
    const withCode = code && !base.includes(code) ? `${base} (${code})` : base;
    return err.cause ? `${withCode} <- ${describeError(err.cause)}` : withCode;
  }
  return String(err);
}

function parseArgsForTrace(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function accumulateUsage(total: { prompt_tokens: number; completion_tokens: number; cost: number }, usage: AssistantReply["usage"]): void {
  if (!usage) return;
  total.prompt_tokens += usage.prompt_tokens ?? 0;
  total.completion_tokens += usage.completion_tokens ?? 0;
  total.cost += usage.cost ?? 0;
}

/**
 * Parse a final assistant message into the recommendation envelope, or return
 * `null` if it isn't a JSON object. A bare scalar (`"123"`) parses cleanly but
 * carries no `skills`, so it counts as a failure and earns a repair round.
 */
function tryParseRecommendations(content: string): { skills?: Recommendation[] } | null {
  try {
    const parsed: unknown = JSON.parse(extractJson(content));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as { skills?: Recommendation[] };
  } catch {
    return null;
  }
}

function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start === -1 || end === -1 ? text : text.slice(start, end + 1);
}
