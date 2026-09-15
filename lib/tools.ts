import { getSkill, getSkillFile, searchSkills } from "@/lib/skills";

/** OpenAI/OpenRouter function-calling definitions. */
export const tools = [
  {
    type: "function",
    function: {
      name: "search_skills",
      description:
        "Keyword search over the skills catalog. Case-insensitive match on name and description; " +
        "terms are OR-ed and results are ranked by how many terms matched. " +
        "Pass an empty query to list the whole catalog.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Space-separated keywords, e.g. 'stripe billing payments'. Empty string lists all skills.",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            description: "Maximum number of results (default 20).",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_skill",
      description:
        "Full record for one skill: source, description, url, metadata, timestamps and the list of files " +
        "it ships (path + size in bytes). Call this before reading files.",
      parameters: {
        type: "object",
        properties: {
          skill: { type: "string", description: "Exact skill name as returned by search_skills." },
        },
        required: ["skill"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_skill_file",
      description:
        "Read one file of a skill as UTF-8 text. Defaults to SKILL.md, which holds the skill's " +
        "instructions. Very long files are truncated.",
      parameters: {
        type: "object",
        properties: {
          skill: { type: "string", description: "Exact skill name." },
          path: {
            type: "string",
            description: "File path relative to the skill directory (see get_skill). Defaults to 'SKILL.md'.",
          },
        },
        required: ["skill"],
      },
    },
  },
];

/**
 * Execute a tool call and return the JSON string to hand back to the model.
 * Bad input / misses become `{ error }` so the model can self-correct;
 * infrastructure failures (e.g. DB down) are thrown to the caller.
 */
export async function runTool(name: string, rawArgs: string): Promise<string> {
  let args: Record<string, unknown>;
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return fail("Arguments were not valid JSON");
  }

  switch (name) {
    case "search_skills": {
      const query = typeof args.query === "string" ? args.query : "";
      const limit = typeof args.limit === "number" ? args.limit : undefined;
      return JSON.stringify({ skills: await searchSkills(query, limit) });
    }

    case "get_skill": {
      const skill = str(args.skill);
      if (!skill) return fail("'skill' is required");
      const detail = await getSkill(skill);
      return detail
        ? JSON.stringify(detail)
        : fail(`Unknown skill '${skill}'. Use search_skills to find valid names.`);
    }

    case "get_skill_file": {
      const skill = str(args.skill);
      if (!skill) return fail("'skill' is required");
      const path = str(args.path) || "SKILL.md";
      const file = await getSkillFile(skill, path);
      return file
        ? JSON.stringify(file)
        : fail(`No file '${path}' for skill '${skill}' (or the skill does not exist). Call get_skill to list its files.`);
    }

    default:
      return fail(`Unknown tool '${name}'`);
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function fail(error: string): string {
  return JSON.stringify({ error });
}
