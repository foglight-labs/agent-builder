import { systemPrompt } from "@/lib/prompt";
import { tools } from "@/lib/tools";
import { MAX_TOOL_ROUNDS, MODEL, recommend, RecommendError } from "@/lib/recommend";
import { logRun, newRunId, promptHash, type RunRecord } from "@/lib/run-log";

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
      prompt_hash: await promptHash(systemPrompt, tools),
      model_requested: MODEL,
      max_tool_rounds: MAX_TOOL_ROUNDS,
    },
    input: { task: trimmedTask },
    trace: { system_prompt: systemPrompt, rounds: [], trimmed: false },
  };

  try {
    const result = await recommend(trimmedTask, apiKey, run);
    run.output = result;
    return Response.json({ skills: result.skills, script: result.script, run_id: run.id });
  } catch (err) {
    const recErr = err instanceof RecommendError ? err : new RecommendError("unknown", String(err), 502);
    run.status = "error";
    run.error = { stage: recErr.stage, message: recErr.message };
    const body: { error: string; raw?: string; run_id: string } = { error: recErr.message, run_id: run.id };
    if (recErr.raw) body.raw = recErr.raw;
    return Response.json(body, { status: recErr.status });
  } finally {
    run.finished_at = new Date().toISOString();
    run.duration_ms = Date.parse(run.finished_at) - Date.parse(run.started_at);
    await logRun(run);
  }
}
