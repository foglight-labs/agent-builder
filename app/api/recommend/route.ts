import { systemPrompt } from "@/lib/prompt";
import { describeError, MAX_TOOL_ROUNDS, MODEL, recommend, RecommendError, type RecommendResult } from "@/lib/recommend";
import { logRun, newRunId, type RunRecord } from "@/lib/run-log";
import { requireApiAccess } from "@/lib/viewer";

/**
 * One line of the newline-delimited JSON stream this route returns. `status`
 * lines carry live progress (model/tool-call activity) so the client can
 * show something better than a static "Thinking…" label; `result`/`error`
 * are always the last line.
 */
type StreamEvent =
  | { type: "status"; message: string }
  | ({ type: "result"; run_id: string } & RecommendResult)
  | { type: "error"; message: string; raw?: string; run_id: string };

export async function POST(request: Request) {
  // Invite-mode wall (no-op in open mode). Before everything else: deny
  // cheaply rather than leaking config errors or burning model tokens.
  const denied = await requireApiAccess();
  if (denied) return denied;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "OPENROUTER_API_KEY is not set" }, { status: 500 });
  }
  if (!process.env.MEILISEARCH_HOST || !process.env.MEILISEARCH_API_KEY) {
    return Response.json({ error: "MEILISEARCH_HOST/MEILISEARCH_API_KEY are not set" }, { status: 500 });
  }

  const { task } = (await request.json().catch(() => ({}))) as { task?: string };
  if (!task || !task.trim()) {
    return Response.json({ error: "task is required" }, { status: 400 });
  }
  const trimmedTask = task.trim();

  const run: RunRecord = {
    event: "run",
    id: newRunId(),
    started_at: new Date().toISOString(),
    status: "ok",
    version: {
      git_commit: process.env.GIT_COMMIT || "unknown",
      git_dirty: process.env.GIT_DIRTY || "unknown",
      app_version: "0.1.0",
      // Set by recommend() once it lists the live MCP tool schemas, so the
      // hash always reflects what the model actually saw, not a static copy.
      prompt_hash: "",
      model_requested: MODEL,
      max_tool_rounds: MAX_TOOL_ROUNDS,
    },
    input: { task: trimmedTask },
    trace: { system_prompt: systemPrompt, rounds: [], tool_call_count: 0, trimmed: false },
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));

      try {
        const result = await recommend(trimmedTask, apiKey, run, (message) => send({ type: "status", message }));
        run.output = result;
        send({ type: "result", run_id: run.id, ...result });
      } catch (err) {
        const recErr = err instanceof RecommendError ? err : new RecommendError("unknown", describeError(err), 502);
        run.status = "error";
        run.error = { stage: recErr.stage, message: recErr.message };
        send({ type: "error", message: recErr.message, raw: recErr.raw, run_id: run.id });
      } finally {
        run.finished_at = new Date().toISOString();
        run.duration_ms = Date.parse(run.finished_at) - Date.parse(run.started_at);
        await logRun(run);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
