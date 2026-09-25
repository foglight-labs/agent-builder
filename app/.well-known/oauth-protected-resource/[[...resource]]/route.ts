import { accessMode, supabaseEnv } from "@/lib/access";
import { resourceMetadata } from "@/lib/mcp-auth";

// OAuth 2.0 Protected Resource Metadata (RFC 9728) for the MCP endpoint.
// Matches both /.well-known/oauth-protected-resource and the path-suffixed
// variant (…/api/mcp) that the 401's resource_metadata parameter points to.
// Must stay reachable without auth, so proxy.ts excludes /.well-known/*.
export function GET() {
  if (accessMode() !== "invite" || !supabaseEnv() || !process.env.SITE_URL) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(resourceMetadata(), {
    headers: { "Cache-Control": "public, max-age=60" },
  });
}
