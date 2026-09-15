import { getSql } from "@/lib/db";

export type SkillSummary = {
  id: string;
  source: string;
  name: string;
  description: string;
  url: string;
};

export type SkillDetail = SkillSummary & {
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  files: { path: string; size_bytes: number }[];
};

export type SkillFile = {
  skill: string;
  path: string;
  size_bytes: number;
  content: string;
  truncated: boolean;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_FILE_CHARS = 16_000;

/** Turn free text into ILIKE patterns, one per whitespace-separated term. */
function likePatterns(query: string): string[] {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
}

/**
 * Keyword search on name/description. Terms are OR-ed; rows are ranked by how
 * many terms matched. An empty query lists the catalog alphabetically.
 */
export async function searchSkills(query: string, limit = DEFAULT_LIMIT): Promise<SkillSummary[]> {
  const sql = getSql();
  const n = Math.min(Math.max(Math.trunc(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const patterns = likePatterns(query);

  if (patterns.length === 0) {
    return sql<SkillSummary[]>`
      select id, source, name, description, url
      from skills
      order by name, source
      limit ${n}
    `;
  }

  return sql<SkillSummary[]>`
    select id, source, name, description, url
    from skills
    where name ilike any (${patterns}::text[])
       or description ilike any (${patterns}::text[])
    order by (
      select count(*)
      from unnest(${patterns}::text[]) as p
      where skills.name ilike p or skills.description ilike p
    ) desc, name, source
    limit ${n}
  `;
}

/** Full record for one skill, including the list of files it ships. */
export async function getSkill(name: string): Promise<SkillDetail | null> {
  const sql = getSql();
  const rows = await sql<SkillDetail[]>`
    select
      s.id, s.source, s.name, s.description, s.url, s.metadata, s.created_at, s.updated_at,
      coalesce(
        (
          select json_agg(json_build_object('path', f.path, 'size_bytes', octet_length(f.content)) order by f.path)
          from skill_files f
          where f.skill_id = s.id
        ),
        '[]'::json
      ) as files
    from skills s
    where s.name = ${name}
    order by s.source
    limit 1
  `;
  return rows[0] ?? null;
}

/** One file of a skill decoded as UTF-8 text (truncated if very long). */
export async function getSkillFile(name: string, path = "SKILL.md"): Promise<SkillFile | null> {
  const sql = getSql();
  const rows = await sql<{ content: Uint8Array; size_bytes: number }[]>`
    select f.content, octet_length(f.content) as size_bytes
    from skill_files f
    join skills s on s.id = f.skill_id
    where s.name = ${name} and f.path = ${path}
    order by s.source
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;

  const text = Buffer.from(row.content).toString("utf8");
  const truncated = text.length > MAX_FILE_CHARS;
  return {
    skill: name,
    path,
    size_bytes: row.size_bytes,
    content: truncated
      ? `${text.slice(0, MAX_FILE_CHARS)}\n…[truncated ${text.length - MAX_FILE_CHARS} more characters]`
      : text,
    truncated,
  };
}

/** Resolve model-picked names back to catalog rows (one row per name). */
export async function getSkillsByNames(names: string[]): Promise<SkillSummary[]> {
  if (names.length === 0) return [];
  const sql = getSql();
  return sql<SkillSummary[]>`
    select distinct on (name) id, source, name, description, url
    from skills
    where name = any (${names}::text[])
    order by name, source
  `;
}
