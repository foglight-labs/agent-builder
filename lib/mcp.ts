import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { getSkill, searchSkills } from "@/lib/skills";

const SKILL_SUMMARY_SCHEMA = z.object({
  id: z.string().describe("Skill id (source/name); pass this to get_skill."),
  source: z.string().describe("Where the skill comes from, e.g. a GitHub repo like 'owner/repo'."),
  name: z.string(),
  description: z.string(),
  url: z.string().describe("Human-facing link to the skill."),
});

const SEARCH_SKILLS_OUTPUT = z.object({ skills: z.array(SKILL_SUMMARY_SCHEMA) });

const GET_SKILL_OUTPUT = SKILL_SUMMARY_SCHEMA.extend({
  metadata: z.record(z.string(), z.unknown()).describe("Raw frontmatter and any other catalog metadata."),
  updated_at: z.string().describe("ISO timestamp of the last catalog update."),
  files: z.array(z.object({ path: z.string(), size_bytes: z.number() })).describe("Files the skill ships, e.g. SKILL.md."),
  install: z.string().describe("Shell command that installs this skill for the current agent."),
  use_once: z.string().describe("Shell command that runs this skill once without installing it."),
});

/**
 * Builds a fresh MCP server exposing the skills catalog as two read-only
 * tools. This is the single source of truth for the tool surface: the
 * `/api/mcp` route and the in-process recommender both connect to an
 * instance of this server, so they can never drift apart.
 */
export function createSkillsMcpServer(): McpServer {
  const server = new McpServer({ name: "foglight-skills", version: "0.1.0" });

  server.registerTool(
    "search_skills",
    {
      title: "Search skills",
      description:
        "Full-text search over the skills catalog's name and description, ranked by relevance. " +
        "Pass an empty query to list the whole catalog alphabetically instead.",
      inputSchema: z.object({
        query: z.string().describe("Keywords, e.g. 'stripe billing payments'. Empty string lists all skills."),
        limit: z.number().int().min(1).max(50).optional().describe("Maximum number of results (default 20)."),
      }),
      outputSchema: SEARCH_SKILLS_OUTPUT,
    },
    async ({ query, limit }) => {
      const skills = await searchSkills(query, limit);
      return jsonResult({ skills });
    }
  );

  server.registerTool(
    "get_skill",
    {
      title: "Get skill",
      description:
        "Full record for one skill: metadata, the files it ships, and ready-to-run install commands. " +
        "Call this before installing a skill you found with search_skills.",
      inputSchema: z.object({
        id: z.string().describe("Skill id as returned by search_skills ('source/name'). A bare name also works if it is unique."),
      }),
      outputSchema: GET_SKILL_OUTPUT,
    },
    async ({ id }) => {
      const result = await getSkill(id);
      switch (result.kind) {
        case "not_found":
          return errorResult(`Unknown skill '${id}'. Use search_skills to find valid ids.`);
        case "ambiguous":
          return errorResult(`'${id}' matches more than one source: ${result.candidates.join(", ")}. Call get_skill again with one of these ids.`);
        case "found":
          return jsonResult(result.skill);
      }
    }
  );

  return server;
}

function jsonResult(output: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(output) }],
    structuredContent: output,
  };
}

function errorResult(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
  };
}
