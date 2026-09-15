import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// One JSON line per /api/recommend call, tagged `"event":"run"` so it can be
// grepped out of other log output. No database: stdout is captured by
// Railway/Cloudflare (Workers Logs) and by the local dev terminal.

export type ToolCallTrace = {
  id: string;
  name: string;
  arguments: unknown;
};

export type ToolResultTrace = {
  tool_call_id: string;
  name: string;
  latency_ms: number;
  chars: number;
  truncated: boolean;
  result: string;
};

export type RoundTrace = {
  index: number;
  tool_choice: "auto" | "none";
  latency_ms: number;
  generation_id?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  assistant: { content: string; tool_calls: ToolCallTrace[] };
  tool_results: ToolResultTrace[];
};

export type RunError = { stage: string; message: string };

export type RunRecord = {
  event: "run";
  id: string;
  started_at: string;
  finished_at?: string;
  duration_ms?: number;
  status: "ok" | "error";
  error?: RunError;
  version: {
    git_commit: string;
    git_dirty: string;
    app_version: string;
    prompt_hash: string;
    model_requested: string;
    model_served?: string;
    provider?: string;
    max_tool_rounds: number;
  };
  input: { task: string };
  output?: { skills: unknown; script: string };
  trace: {
    system_prompt: string;
    rounds: RoundTrace[];
    final_content?: string;
    recommended_names?: string[];
    dropped_names?: string[];
    trimmed: boolean;
  };
  usage_total?: { prompt_tokens: number; completion_tokens: number; cost: number };
};

const TOOL_RESULT_PREVIEW_CHARS = 2_000;
// Conservative headroom under common platform per-log-line caps (e.g. Cloudflare's 256KB).
const MAX_RECORD_BYTES = 100_000;

export function newRunId(): string {
  return crypto.randomUUID();
}

export function truncate(text: string, max = TOOL_RESULT_PREVIEW_CHARS): { text: string; truncated: boolean; chars: number } {
  const chars = text.length;
  if (chars <= max) return { text, truncated: false, chars };
  return { text: text.slice(0, max), truncated: true, chars };
}

/** SHA-256 over the system prompt + tool schemas, so runs can be grouped by prompt version between commits. */
export async function promptHash(systemPrompt: string, tools: unknown): Promise<string> {
  const data = new TextEncoder().encode(systemPrompt + JSON.stringify(tools));
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

/**
 * Emit the run record as a single stdout JSON line, with an optional local
 * file mirror. Never throws: a logging bug must not fail the request.
 */
export async function logRun(record: RunRecord): Promise<void> {
  try {
    const bounded = boundRecordSize(record);
    console.log(JSON.stringify(bounded));

    const dir = process.env.RUN_LOG_DIR;
    if (dir) {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `${record.id}.json`), JSON.stringify(bounded, null, 2));
    }
  } catch (err) {
    console.error("Failed to log run", err instanceof Error ? err.message : err);
  }
}

/** If the serialized record is still too large, drop tool-result previews and mark it trimmed. */
function boundRecordSize(record: RunRecord): RunRecord {
  const size = Buffer.byteLength(JSON.stringify(record), "utf8");
  if (size <= MAX_RECORD_BYTES) return record;

  return {
    ...record,
    trace: {
      ...record.trace,
      trimmed: true,
      rounds: record.trace.rounds.map((r) => ({
        ...r,
        tool_results: r.tool_results.map((t) => ({ ...t, result: "" })),
      })),
    },
  };
}
