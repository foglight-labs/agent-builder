import { getSql } from "@/lib/db";

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

function toSummary(row: { source: string; name: string; description: string; url: string }): SkillSummary {
  return { id: `${row.source}/${row.name}`, ...row };
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

/**
 * Full-text search over name + description, ranked by relevance. Terms are
 * parsed with `websearch_to_tsquery` (the same syntax as a search engine box:
 * quotes, `-exclude`, `or`). An empty query lists the catalog alphabetically.
 */
export async function searchSkills(query: string, limit = DEFAULT_LIMIT): Promise<SkillSummary[]> {
  const sql = getSql();
  const n = Math.min(Math.max(Math.trunc(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const q = query.trim();

  const rows = q
    ? await sql<{ source: string; name: string; description: string; url: string }[]>`
        select source, name, description, url
        from skills
        where to_tsvector('english', name || ' ' || description) @@ websearch_to_tsquery('english', ${q})
        order by
          ts_rank(to_tsvector('english', name || ' ' || description), websearch_to_tsquery('english', ${q})) desc,
          name, source
        limit ${n}
      `
    : await sql<{ source: string; name: string; description: string; url: string }[]>`
        select source, name, description, url
        from skills
        order by name, source
        limit ${n}
      `;

  return rows.map(toSummary);
}

/**
 * Full record for one skill: metadata, the files it ships, and ready-to-run
 * install commands. `id` may be a bare name if the caller doesn't know the
 * source yet; if that name exists under several sources, every matching id
 * comes back in `candidates` instead of a skill.
 */
export async function getSkill(id: string): Promise<GetSkillResult> {
  const { source, name } = parseSkillId(id);
  const sql = getSql();

  const rows = source
    ? await sql<
        { db_id: string; source: string; name: string; description: string; url: string; metadata: Record<string, unknown>; updated_at: Date }[]
      >`
        select id as db_id, source, name, description, url, metadata, updated_at
        from skills
        where source = ${source} and name = ${name}
        limit 1
      `
    : await sql<
        { db_id: string; source: string; name: string; description: string; url: string; metadata: Record<string, unknown>; updated_at: Date }[]
      >`
        select id as db_id, source, name, description, url, metadata, updated_at
        from skills
        where name = ${name}
        order by source
      `;

  if (rows.length === 0) return { kind: "not_found" };
  if (rows.length > 1) return { kind: "ambiguous", candidates: rows.map((r) => `${r.source}/${r.name}`) };

  const row = rows[0];
  const files = await sql<{ path: string; size_bytes: number }[]>`
    select path, octet_length(content) as size_bytes
    from skill_files
    where skill_id = ${row.db_id}
    order by path
  `;

  return {
    kind: "found",
    skill: {
      id: `${row.source}/${row.name}`,
      source: row.source,
      name: row.name,
      description: row.description,
      url: row.url,
      metadata: row.metadata,
      updated_at: row.updated_at.toISOString(),
      files,
      install: `npx skills add ${row.source} --skill ${row.name} -y`,
      use_once: `npx skills use ${row.source}@${row.name}`,
    },
  };
}

/** Resolve model-picked ids back to catalog rows (one row per id, silently dropping unknown ones). */
export async function getSkillsByIds(ids: string[]): Promise<SkillSummary[]> {
  if (ids.length === 0) return [];
  const sql = getSql();
  const rows = await sql<{ source: string; name: string; description: string; url: string }[]>`
    select source, name, description, url
    from skills
    where (source || '/' || name) = any (${ids}::text[])
  `;
  return rows.map(toSummary);
}
