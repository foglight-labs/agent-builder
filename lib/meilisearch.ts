// Thin fetch-based client for the hosted Meilisearch instance that now backs
// the entire skills catalog (search.foglight.co). No SDK dependency, no
// fallback: if Meilisearch errors, callers throw and the caller's caller
// (the MCP tool / recommend loop) turns that into a normal tool/HTTP error.
// The index itself is populated and maintained by a separate system; this
// repo only ever reads via /search.

export type MeiliDoc = {
  id: string;
  repo: string;
  owner: string;
  repo_name: string;
  name: string;
  description: string;
  path: string;
  url: string;
  skill_md_url: string;
  install: string;
  content: string;
  content_truncated: boolean;
  frontmatter: Record<string, unknown>;
  files: { path: string; size: number }[];
  file_count: number;
  stars: number;
  archived: boolean;
  commit_sha: string;
  default_branch: string;
  indexed_at: number;
};

export type MeiliSearchParams = {
  q: string;
  filter?: string;
  sort?: string[];
  limit: number;
  attributesToRetrieve: (keyof MeiliDoc)[];
};

function config(): { host: string; apiKey: string; index: string } {
  const host = process.env.MEILISEARCH_HOST;
  const apiKey = process.env.MEILISEARCH_API_KEY;
  if (!host) throw new Error("MEILISEARCH_HOST is not set");
  if (!apiKey) throw new Error("MEILISEARCH_API_KEY is not set");
  const index = process.env.MEILISEARCH_INDEX || "skills";
  return { host: host.replace(/\/+$/, ""), apiKey, index };
}

/** Run one search against the skills index. Throws on any non-2xx response or network failure. */
export async function meiliSearch(params: MeiliSearchParams): Promise<Partial<MeiliDoc>[]> {
  const { host, apiKey, index } = config();

  let res: Response;
  try {
    res = await fetch(`${host}/indexes/${index}/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });
  } catch (err) {
    throw new Error(`Meilisearch request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Meilisearch ${res.status}: ${body || res.statusText}`);
  }

  const data = (await res.json()) as { hits?: Partial<MeiliDoc>[] };
  return data.hits ?? [];
}
