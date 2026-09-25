import { createMcpHandler } from "@modelcontextprotocol/server";
import { accessMode } from "@/lib/access";
import { authorizeMcpRequest } from "@/lib/mcp-auth";
import { createSkillsMcpServer } from "@/lib/mcp";

// One handler for the module's lifetime; `createMcpHandler` serves each
// request statelessly (fresh McpServer per request, no session), which is
// what `sessionIdGenerator: undefined` meant in the old streamableHttp API.
const handler = createMcpHandler(() => createSkillsMcpServer());

export async function POST(request: Request) {
  if (accessMode() === "invite") {
    // Bearer tokens from Supabase's OAuth 2.1 server, plus the allowlist.
    // The handler does no token verification of its own; the AuthInfo it
    // receives here is strictly pass-through for tools that want it.
    const result = await authorizeMcpRequest(request);
    if (result instanceof Response) return result;
    return handler.fetch(request, { authInfo: result });
  }
  return handler.fetch(request);
}

// GET and DELETE (session operations) are intentionally not exported: Next.js
// answers unsupported methods on this route with its own 405.
