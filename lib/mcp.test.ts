import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSkillsMcpServer } from "@/lib/mcp";
import type { SkillDetail, SkillSummary } from "@/lib/skills";

// `vi.mock` factories are hoisted above imports, so the mocks they return
// must come from `vi.hoisted` rather than plain module-scope `const`s.
const { searchSkills, getSkill } = vi.hoisted(() => ({
  searchSkills: vi.fn(),
  getSkill: vi.fn(),
}));

vi.mock("@/lib/skills", () => ({ searchSkills, getSkill }));

/** Connect a fresh MCP client to a fresh server over a linked in-memory transport pair. */
async function connect(): Promise<Client> {
  const server = createSkillsMcpServer();
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function textOf(content: { type: string }[]): string {
  const block = content.find((c): c is { type: "text"; text: string } => c.type === "text");
  if (!block) throw new Error("expected a text content block");
  return block.text;
}

const SAMPLE_SKILL: SkillSummary = {
  id: "acme/skills/foo",
  source: "acme/skills",
  name: "foo",
  description: "does foo",
  url: "https://example.com/foo",
};

const SAMPLE_DETAIL: SkillDetail = {
  ...SAMPLE_SKILL,
  metadata: { internal: false },
  updated_at: "2026-01-01T00:00:00.000Z",
  files: [{ path: "SKILL.md", size_bytes: 42 }],
  install: "npx skills add acme/skills --skill foo -y",
  use_once: "npx skills use acme/skills@foo",
};

describe("skills MCP server", () => {
  beforeEach(() => {
    searchSkills.mockReset();
    getSkill.mockReset();
  });

  it("exposes exactly search_skills and get_skill", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["get_skill", "search_skills"]);
  });

  it("search_skills forwards query and limit and returns structured content", async () => {
    searchSkills.mockResolvedValue([SAMPLE_SKILL]);

    const client = await connect();
    const result = await client.callTool({ name: "search_skills", arguments: { query: "foo", limit: 5 } });

    expect(searchSkills).toHaveBeenCalledWith("foo", 5);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ skills: [SAMPLE_SKILL] });
    expect(JSON.parse(textOf(result.content))).toEqual({ skills: [SAMPLE_SKILL] });
  });

  it("get_skill returns the full record on a hit", async () => {
    getSkill.mockResolvedValue({ kind: "found", skill: SAMPLE_DETAIL });

    const client = await connect();
    const result = await client.callTool({ name: "get_skill", arguments: { id: "acme/skills/foo" } });

    expect(getSkill).toHaveBeenCalledWith("acme/skills/foo");
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(SAMPLE_DETAIL);
  });

  it("reports an unknown id as a tool error instead of throwing", async () => {
    getSkill.mockResolvedValue({ kind: "not_found" });

    const client = await connect();
    const result = await client.callTool({ name: "get_skill", arguments: { id: "nope" } });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.parse(textOf(result.content)).error).toMatch(/Unknown skill 'nope'/);
  });

  it("lists every candidate when a bare name is ambiguous across sources", async () => {
    getSkill.mockResolvedValue({ kind: "ambiguous", candidates: ["acme/skills/foo", "other/skills/foo"] });

    const client = await connect();
    const result = await client.callTool({ name: "get_skill", arguments: { id: "foo" } });

    expect(result.isError).toBe(true);
    const message = JSON.parse(textOf(result.content)).error as string;
    expect(message).toContain("acme/skills/foo");
    expect(message).toContain("other/skills/foo");
  });
});
