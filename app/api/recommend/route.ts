import catalog from "@/data/skills.json";
import { systemPrompt, type CatalogSkill, type Recommendation } from "@/lib/prompt";

const SOURCE = "mattpocock/skills";
const MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5";

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "OPENROUTER_API_KEY is not set" }, { status: 500 });
  }

  const { task } = (await request.json().catch(() => ({}))) as { task?: string };
  if (!task || !task.trim()) {
    return Response.json({ error: "task is required" }, { status: 400 });
  }

  const skills = catalog as CatalogSkill[];

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt(skills) },
        { role: "user", content: task.trim() },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return Response.json({ error: `OpenRouter ${res.status}: ${text}` }, { status: 502 });
  }

  const data = await res.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";

  let parsed: { skills?: Recommendation[] };
  try {
    parsed = JSON.parse(extractJson(content));
  } catch {
    return Response.json({ error: "Model returned invalid JSON", raw: content }, { status: 502 });
  }

  const byName = new Map(skills.map((s) => [s.name, s]));
  const seen = new Set<string>();
  const picked = (parsed.skills ?? [])
    .filter((r) => byName.has(r.name) && !seen.has(r.name) && seen.add(r.name))
    .map((r) => ({
      name: r.name,
      reason: r.reason ?? "",
      setup: r.setup ?? "",
      url: byName.get(r.name)!.url,
    }));

  if (picked.length === 0) {
    return Response.json({ error: "No matching skills recommended", raw: content }, { status: 502 });
  }

  const script = [
    "#!/usr/bin/env bash",
    `# Skill pack for: ${task.trim().replace(/\s+/g, " ")}`,
    `# Source: https://github.com/${SOURCE}`,
    "set -e",
    "",
    ...picked.flatMap((s) => [
      `# ${s.name}: ${s.reason}`,
      `npx skills add ${SOURCE} --skill ${s.name} -y`,
      "",
    ]),
  ].join("\n");

  return Response.json({ skills: picked, script });
}

function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start === -1 || end === -1 ? text : text.slice(start, end + 1);
}
