"use client";

import { useState } from "react";

type Skill = { name: string; reason: string; setup: string; url: string };
type Result = { skills: Skill[]; script: string };

export default function Home() {
  const [task, setTask] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
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
      <h1>Foglight</h1>
      <p>Describe a task. Get a skill pack for your coding agent.</p>

      <form onSubmit={submit}>
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="e.g. Add Stripe billing to my Next.js SaaS without breaking existing signups"
          rows={5}
          required
        />
        <button type="submit" disabled={loading || !task.trim()}>
          {loading ? "Thinking…" : "Recommend skills"}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {result && (
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
