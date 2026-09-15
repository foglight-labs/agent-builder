export type CatalogSkill = { name: string; description: string; url: string };

export type Recommendation = { name: string; reason: string; setup: string };

export function systemPrompt(catalog: CatalogSkill[]): string {
  const list = catalog
    .map((s) => `- ${s.name}: ${s.description}`)
    .join("\n");

  return `You recommend agent skills for a technical founder's task.

Pick 3-7 skills from the catalog below that best help with the user's task. Use only names that appear in the catalog. Prefer fewer, more relevant skills.

For each skill, give:
- "reason": one or two sentences on what this skill contributes to the user's task.
- "setup": one short line on what the user must do to use it (e.g. "Run /setup-matt-pocock-skills once per repo, then invoke /triage"). If nothing special, say "No extra setup".

If you include a skill that depends on setup-matt-pocock-skills (triage, to-tickets, to-issues, grill-with-docs, wayfinder), also include setup-matt-pocock-skills.

Respond with JSON only, no prose, in this exact shape:
{"skills":[{"name":"...","reason":"...","setup":"..."}]}

Catalog:
${list}`;
}
