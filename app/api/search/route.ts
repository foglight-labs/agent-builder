import { buildInstallScript } from "@/lib/script";
import { searchSkills } from "@/lib/skills";

const RESULT_LIMIT = 10;

/**
 * Plain keyword search over the skills catalog, no LLM involved. This is the
 * "Search" mode counterpart to `/api/recommend`'s "Agent" mode: it never
 * calls a model, so there's no cost/tool trace worth logging as a run.
 */
export async function POST(request: Request) {
  if (!process.env.MEILISEARCH_HOST || !process.env.MEILISEARCH_API_KEY) {
    return Response.json({ error: "MEILISEARCH_HOST/MEILISEARCH_API_KEY are not set" }, { status: 500 });
  }

  const { query } = (await request.json().catch(() => ({}))) as { query?: string };
  if (!query || !query.trim()) {
    return Response.json({ error: "query is required" }, { status: 400 });
  }

  const hits = await searchSkills(query.trim(), RESULT_LIMIT);
  const skills = hits.map((s) => ({
    name: s.name,
    source: s.source,
    description: s.description,
    url: s.url,
    install: `npx skills add ${s.source} --skill ${s.name} -y`,
  }));
  const script = buildInstallScript(hits);

  return Response.json({ skills, script });
}
