import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSkill, getSkillsByIds, searchSkills } from "@/lib/skills";

type MeiliRequest = { url: string; body: Record<string, unknown> };

/** Bodies of every Meilisearch request made during a test, in order. */
let sentRequests: MeiliRequest[] = [];

/** Stub `fetch` to return `hits` for every `/search` call, regardless of body. */
function stubHits(hits: Record<string, unknown>[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      sentRequests.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ hits }), { status: 200, headers: { "content-type": "application/json" } });
    })
  );
}

function stubFailure(status: number, body = "boom"): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status }))
  );
}

const BRAINSTORMING = {
  repo: "obra/superpowers",
  name: "brainstorming",
  description: "Explores user intent before implementation.",
  url: "https://github.com/obra/superpowers/tree/main/skills/brainstorming",
  frontmatter: { description: "Explores user intent before implementation." },
  files: [{ path: "SKILL.md", size: 1234 }],
  indexed_at: 1790003476,
};

describe("lib/skills (Meilisearch-backed)", () => {
  beforeEach(() => {
    sentRequests = [];
    process.env.MEILISEARCH_HOST = "https://search.foglight.co";
    process.env.MEILISEARCH_API_KEY = "test-key";
    delete process.env.MEILISEARCH_INDEX;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MEILISEARCH_HOST;
    delete process.env.MEILISEARCH_API_KEY;
    delete process.env.MEILISEARCH_INDEX;
  });

  describe("searchSkills", () => {
    it("forwards the trimmed query and limit, and maps hits to SkillSummary", async () => {
      stubHits([BRAINSTORMING]);

      const results = await searchSkills("  brainstorming  ", 5);

      expect(sentRequests).toHaveLength(1);
      expect(sentRequests[0].url).toBe("https://search.foglight.co/indexes/skills/search");
      expect(sentRequests[0].body).toMatchObject({ q: "brainstorming", limit: 5 });
      expect(sentRequests[0].body.sort).toBeUndefined();
      expect(results).toEqual([
        {
          id: "obra/superpowers/brainstorming",
          source: "obra/superpowers",
          name: "brainstorming",
          description: BRAINSTORMING.description,
          url: BRAINSTORMING.url,
        },
      ]);
    });

    it("sorts alphabetically by name when the query is empty", async () => {
      stubHits([]);

      await searchSkills("");

      expect(sentRequests[0].body).toMatchObject({ q: "", sort: ["name:asc"] });
    });

    it("clamps limit to the [1, 50] range and defaults when invalid", async () => {
      stubHits([]);
      await searchSkills("x", 0);
      expect(sentRequests[0].body.limit).toBe(20);

      await searchSkills("x", 999);
      expect(sentRequests[1].body.limit).toBe(50);
    });

    it("propagates a Meilisearch error instead of falling back to anything else", async () => {
      stubFailure(403, '{"message":"invalid key"}');
      await expect(searchSkills("foo")).rejects.toThrow(/Meilisearch 403/);
    });
  });

  describe("getSkill", () => {
    it("looks up an exact source/name via a repo filter and returns full detail", async () => {
      stubHits([BRAINSTORMING, { ...BRAINSTORMING, name: "other-skill" }]);

      const result = await getSkill("obra/superpowers/brainstorming");

      expect(sentRequests[0].body.filter).toBe('repo = "obra/superpowers"');
      expect(result).toEqual({
        kind: "found",
        skill: {
          id: "obra/superpowers/brainstorming",
          source: "obra/superpowers",
          name: "brainstorming",
          description: BRAINSTORMING.description,
          url: BRAINSTORMING.url,
          metadata: BRAINSTORMING.frontmatter,
          updated_at: new Date(BRAINSTORMING.indexed_at * 1000).toISOString(),
          files: [{ path: "SKILL.md", size_bytes: 1234 }],
          install: "npx skills add obra/superpowers --skill brainstorming -y",
          use_once: "npx skills use obra/superpowers@brainstorming",
        },
      });
    });

    it("returns not_found when the repo filter yields no exact name match", async () => {
      stubHits([{ ...BRAINSTORMING, name: "something-else" }]);
      const result = await getSkill("obra/superpowers/brainstorming");
      expect(result).toEqual({ kind: "not_found" });
    });

    it("resolves a bare name uniquely found in one repo", async () => {
      stubHits([BRAINSTORMING]);

      const result = await getSkill("brainstorming");

      expect(sentRequests[0].body).toMatchObject({ q: "brainstorming" });
      expect(sentRequests[0].body.filter).toBeUndefined();
      expect(result.kind).toBe("found");
    });

    it("reports ambiguity when a bare name exists under multiple repos", async () => {
      stubHits([BRAINSTORMING, { ...BRAINSTORMING, repo: "other/repo" }]);

      const result = await getSkill("brainstorming");

      expect(result).toEqual({
        kind: "ambiguous",
        candidates: ["obra/superpowers/brainstorming", "other/repo/brainstorming"],
      });
    });

    it("drops typo-tolerant near-matches that aren't exact", async () => {
      stubHits([{ ...BRAINSTORMING, name: "brainstormingish" }]);
      const result = await getSkill("brainstorming");
      expect(result).toEqual({ kind: "not_found" });
    });
  });

  describe("getSkillsByIds", () => {
    it("returns [] without calling Meilisearch when given no ids", async () => {
      stubHits([]);
      const result = await getSkillsByIds([]);
      expect(result).toEqual([]);
      expect(sentRequests).toHaveLength(0);
    });

    it("resolves known ids via a repo IN filter and silently drops unknown ones", async () => {
      stubHits([BRAINSTORMING]);

      const result = await getSkillsByIds(["obra/superpowers/brainstorming", "ghost/repo/nope"]);

      expect(sentRequests[0].body.filter).toBe('repo IN ["obra/superpowers", "ghost/repo"]');
      expect(result).toEqual([
        {
          id: "obra/superpowers/brainstorming",
          source: "obra/superpowers",
          name: "brainstorming",
          description: BRAINSTORMING.description,
          url: BRAINSTORMING.url,
        },
      ]);
    });
  });
});
