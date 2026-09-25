"use client";

import { useState } from "react";
import { presets } from "@/lib/presets";
import type { Viewer } from "@/lib/viewer";
import UserMenu from "@/app/user-menu";

type Mode = "agent" | "search";

type AgentSkill = { name: string; reason: string; setup: string; url: string };
type SearchSkill = { name: string; source: string; description: string; url: string; install: string };

type Result = { mode: "agent"; skills: AgentSkill[]; script: string } | { mode: "search"; skills: SearchSkill[]; script: string };

type StreamEvent =
  | { type: "status"; message: string }
  | { type: "result"; skills: AgentSkill[]; script: string }
  | { type: "error"; message: string };

/** POST /api/recommend and consume its newline-delimited JSON stream, reporting progress via `onStatus`. */
async function runAgent(task: string, onStatus: (message: string) => void): Promise<Result> {
  const res = await fetch("/api/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task }),
  });

  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: Result | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineAt;
    while ((newlineAt = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineAt);
      buffer = buffer.slice(newlineAt + 1);
      if (!line.trim()) continue;

      const event = JSON.parse(line) as StreamEvent;
      if (event.type === "status") onStatus(event.message);
      else if (event.type === "result") result = { mode: "agent", skills: event.skills, script: event.script };
      else if (event.type === "error") throw new Error(event.message);
    }
  }

  if (!result) throw new Error("Stream ended without a result");
  return result;
}

async function runSearch(query: string): Promise<Result> {
  const res = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return { mode: "search", skills: data.skills, script: data.script };
}

/**
 * The builder itself. `viewer` is the signed-in, allowed user in invite mode
 * and null in open mode; the account menu only exists when there's someone
 * signed in.
 */
export default function Builder({ viewer }: { viewer: Viewer | null }) {
  const [mode, setMode] = useState<Mode>("agent");
  const [task, setTask] = useState("");
  const [loading, setLoading] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [stackOpen, setStackOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setResult(null);
    setSteps([]);
    setStackOpen(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setSteps([]);
    setStackOpen(true);
    const trimmedTask = task.trim();
    try {
      const onStep = (message: string) => setSteps((prev) => [...prev, message]);
      const next = mode === "agent" ? await runAgent(trimmedTask, onStep) : await runSearch(trimmedTask);
      setResult(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      // Minimize the step-by-step trace once the run finishes; still
      // expandable by clicking the summary.
      setStackOpen(false);
    }
  }

  async function copy() {
    if (!result) return;
    await navigator.clipboard.writeText(result.script);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="https://foglight.co" target="_blank" rel="noopener noreferrer">
          <img src="/foglight.svg" alt="" width={32} height={32} />
          <span>Foglight Agent Builder</span>
        </a>
        {viewer && <UserMenu viewer={viewer} />}
      </header>

      <p>Describe a task. Get a skill pack for your coding agent.</p>

      <div className="mode-toggle" role="tablist">
        <button type="button" role="tab" aria-selected={mode === "agent"} className={mode === "agent" ? "active" : ""} onClick={() => switchMode("agent")}>
          Agent
        </button>
        <button type="button" role="tab" aria-selected={mode === "search"} className={mode === "search" ? "active" : ""} onClick={() => switchMode("search")}>
          Search
        </button>
      </div>

      <div className="presets">
        {presets.map((p) => (
          <button key={p.label} type="button" onClick={() => setTask(p.text)}>
            {p.label}
          </button>
        ))}
      </div>

      <form onSubmit={submit}>
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder={
            mode === "agent"
              ? "e.g. Add Stripe billing to my Next.js SaaS without breaking existing signups"
              : "e.g. stripe billing"
          }
          rows={5}
          required
        />
        <button type="submit" disabled={loading || !task.trim()}>
          {loading ? (mode === "agent" ? "Working…" : "Searching…") : mode === "agent" ? "Recommend skills" : "Search skills"}
        </button>
      </form>

      {mode === "agent" && steps.length > 0 && (
        <details className="thinking" open={stackOpen} onToggle={(e) => setStackOpen(e.currentTarget.open)}>
          <summary>{loading ? steps[steps.length - 1] : `Thought through ${steps.length} step${steps.length === 1 ? "" : "s"}`}</summary>
          <ol>
            {steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </details>
      )}

      {error && <p className="error">{error}</p>}

      {result && result.skills.length === 0 && (
        <section>
          <h2>No matches</h2>
          <p>Nothing in the catalog matched that query. Try different keywords.</p>
        </section>
      )}

      {result && result.mode === "agent" && result.skills.length > 0 && (
        <section>
          <h2>Recommended pack</h2>
          <ul>
            {result.skills.map((s) => (
              <li key={s.name}>
                <strong>
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.name}
                  </a>
                </strong>
                <p>{s.reason}</p>
                <p className="setup">Setup: {s.setup}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result && result.mode === "search" && result.skills.length > 0 && (
        <section>
          <h2>Matching skills</h2>
          <ul>
            {result.skills.map((s) => (
              <li key={`${s.source}/${s.name}`}>
                <strong>
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.name}
                  </a>
                </strong>
                <p>{s.description}</p>
                <p className="setup">{s.install}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result && result.skills.length > 0 && (
        <section>
          <h2>Install script</h2>
          <button type="button" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
          <pre>{result.script}</pre>
        </section>
      )}
    </main>
  );
}
