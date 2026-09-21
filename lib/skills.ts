import { meiliSearch, type MeiliDoc } from "@/lib/meilisearch";

/**
 * Skills are addressed as `source/name` (e.g. `vercel-labs/agent-skills/web-design-guidelines`).
 * `source` is itself often `owner/repo`, so only the *last* slash separates it from `name`;
 * skill names are slugs and never contain one.
 */
export type SkillId = string;

export type SkillSummary = {
  id: SkillId;
  source: string;
  name: string;
  description: string;
  url: string;
};

export type SkillDetail = SkillSummary & {
  metadata: Record<string, unknown>;
  updated_at: string;
  files: { path: string; size_bytes: number }[];
  /** Ready-to-run `npx skills` commands, so a caller never has to build them. */
  install: string;
  use_once: string;
};

export type GetSkillResult =
  | { kind: "found"; skill: SkillDetail }
  | { kind: "not_found" }
  | { kind: "ambiguous"; candidates: SkillId[] };

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Generous enough to fetch every skill in one repo, or every same-named skill across repos. */
const LOOKUP_LIMIT = 200;

type Doc = Partial<MeiliDoc>;

function toSummary(doc: Doc): SkillSummary {
  return {
    id: `${doc.repo}/${doc.name}`,
    source: doc.repo!,
    name: doc.name!,
    description: doc.description ?? "",
    url: doc.url!,
  };
}

function toDetail(doc: Doc): SkillDetail {
  const source = doc.repo!;
  const name = doc.name!;
  return {
    ...toSummary(doc),
    metadata: doc.frontmatter ?? {},
    updated_at: new Date((doc.indexed_at ?? 0) * 1000).toISOString(),
    files: (doc.files ?? []).map((f) => ({ path: f.path, size_bytes: f.size })),
    install: `npx skills add ${source} --skill ${name} -y`,
    use_once: `npx skills use ${source}@${name}`,
  };
}

/**
 * Split a `source/name` id at its *last* slash. A bare name (no slash) comes
 * back with `source: undefined`, which callers resolve across all sources.
 */
function parseSkillId(id: string): { source?: string; name: string } {
  const trimmed = id.trim();
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0 || idx === trimmed.length - 1) return { name: trimmed };
  return { source: trimmed.slice(0, idx), name: trimmed.slice(idx + 1) };
}

/** Escape a value for embedding in a Meilisearch filter string literal. */
function filterLiteral(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Full-text search over name + description, ranked by relevance, backed by
 * the hosted Meilisearch index (the sole source for the catalog — there is
 * no fallback if it's unreachable). An empty query lists the catalog
 * alphabetically, since Meilisearch's default order for `q: ""` isn't
 * alphabetical on its own.
 */
export async function searchSkills(query: string, limit = DEFAULT_LIMIT): Promise<SkillSummary[]> {
  const n = Math.min(Math.max(Math.trunc(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const q = query.trim();

  const hits = await meiliSearch({
    q,
    limit: n,
    attributesToRetrieve: ["repo", "name", "description", "url"],
    ...(q ? {} : { sort: ["name:asc"] }),
  });

  return hits.map(toSummary);
}

/**
 * Full record for one skill: metadata, the files it ships, and ready-to-run
 * install commands. `id` may be a bare name if the caller doesn't know the
 * source yet; if that name exists under several sources, every matching id
 * comes back in `candidates` instead of a skill.
 */
export async function getSkill(id: string): Promise<GetSkillResult> {
  const { source, name } = parseSkillId(id);
  const attributesToRetrieve: (keyof MeiliDoc)[] = ["repo", "name", "description", "url", "frontmatter", "files", "indexed_at"];

  if (source) {
    const hits = await meiliSearch({
      q: "",
      filter: `repo = ${filterLiteral(source)}`,
      limit: LOOKUP_LIMIT,
      attributesToRetrieve,
    });
    const match = hits.find((h) => h.name === name);
    return match ? { kind: "found", skill: toDetail(match) } : { kind: "not_found" };
  }

  // Bare name: search isn't filterable on `name`, so cast a wide net and
  // keep only exact matches (typo-tolerant hits aren't reliable here), then
  // group by repo to detect cross-source ambiguity.
  const hits = await meiliSearch({
    q: name,
    limit: LOOKUP_LIMIT,
    attributesToRetrieve,
  });
  const matches = hits.filter((h) => h.name === name);

  if (matches.length === 0) return { kind: "not_found" };
  const byRepo = new Map<string, Doc>(matches.map((m) => [m.repo!, m]));
  if (byRepo.size > 1) {
    return { kind: "ambiguous", candidates: [...byRepo.keys()].sort().map((repo) => `${repo}/${name}`) };
  }
  return { kind: "found", skill: toDetail(matches[0]) };
}

/** Resolve model-picked ids back to catalog rows (one row per id, silently dropping unknown ones). */
export async function getSkillsByIds(ids: string[]): Promise<SkillSummary[]> {
  if (ids.length === 0) return [];

  const parsed = ids.map((id) => ({ id, ...parseSkillId(id) })).filter((p): p is { id: string; source: string; name: string } => !!p.source);
  const repos = [...new Set(parsed.map((p) => p.source))];
  if (repos.length === 0) return [];

  const hits = await meiliSearch({
    q: "",
    filter: `repo IN [${repos.map(filterLiteral).join(", ")}]`,
    limit: LOOKUP_LIMIT,
    attributesToRetrieve: ["repo", "name", "description", "url"],
  });
  const byKey = new Map(hits.map((h) => [`${h.repo}/${h.name}`, h]));

  const results: SkillSummary[] = [];
  for (const { id } of parsed) {
    const doc = byKey.get(id);
    if (doc) results.push(toSummary(doc));
  }
  return results;
}
