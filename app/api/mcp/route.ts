import { createMcpHandler } from "@modelcontextprotocol/server";
import { createSkillsMcpServer } from "@/lib/mcp";

// One handler for the module's lifetime; `createMcpHandler` serves each
// request statelessly (fresh McpServer per request, no session), which is
// what `sessionIdGenerator: undefined` meant in the old streamableHttp API.
const handler = createMcpHandler(() => createSkillsMcpServer());

/**
 * Placeholder for request-level checks (API keys, allow-listed origins, ...).
 * Everything is allowed today; the catalog is public and read-only. Kept as
 * its own function so auth has one obvious place to land later.
 */
function authorize(_request: Request): Response | null {
  return null;
}

export async function POST(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  return handler.fetch(request);
}

// GET and DELETE (session operations) are intentionally not exported: Next.js
// answers unsupported methods on this route with its own 405.
