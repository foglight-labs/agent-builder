import type { AuthInfo } from "@modelcontextprotocol/server";
import { createClient } from "@supabase/supabase-js";
import { siteUrl, supabaseEnv } from "@/lib/access";

/**
 * Bearer-token auth for the MCP endpoint in invite mode. MCP clients
 * (Claude Code, Cursor, …) discover the authorization server from the
 * 401's `resource_metadata` pointer, register dynamically, and sign the user
 * in through Supabase's OAuth 2.1 server. This module verifies the resulting
 * access tokens and applies the same allowlist as the web UI.
 */

/** URL of this server's protected resource metadata document (RFC 9728). */
export function resourceMetadataUrl(): string {
  return `${siteUrl()}/.well-known/oauth-protected-resource/api/mcp`;
}

/**
 * The protected resource metadata document. Served at the path-suffixed
 * well-known location; also answers the bare well-known path, since this
 * site protects exactly one resource.
 */
export function resourceMetadata() {
  const env = supabaseEnv();
  if (!env) throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required when ACCESS_MODE=invite");
  return {
    resource: `${siteUrl()}/api/mcp`,
    authorization_servers: [`${env.url}/auth/v1`],
    scopes_supported: [],
    bearer_methods_supported: ["header"],
    resource_name: "Foglight skills catalog",
  };
}

/** Extracts the bearer token from the Authorization header, or null. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
  return match ? match[1] : null;
}

/**
 * Checks an MCP request's bearer token and returns the `AuthInfo` to hand to
 * the MCP handler, or the denial response to send back. Only called in
 * invite mode.
 */
export async function authorizeMcpRequest(request: Request): Promise<AuthInfo | Response> {
  if (!supabaseEnv() || !process.env.SITE_URL) {
    console.error("[mcp] ACCESS_MODE=invite but SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY/SITE_URL are not set");
    return Response.json({ error: "Access checks are not configured" }, { status: 500 });
  }

  const token = bearerToken(request);
  if (!token) return unauthorized();

  const supabase = createClient(supabaseEnv()!.url, supabaseEnv()!.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    return unauthorized("invalid_token", "The access token is invalid or expired");
  }
  const claims = data.claims;

  // Supabase's OAuth server doesn't bind tokens to this resource yet (no
  // RFC 8707 support), so any token from the project verifies here. What
  // actually gates access is the allowlist check, run as the token's user.
  const { data: status, error: rpcError } = await supabase.rpc("get_my_access");
  if (rpcError) {
    console.error("[mcp] get_my_access failed:", rpcError.message);
    return Response.json({ error: "Access check failed" }, { status: 500 });
  }
  if (status !== "allowed") {
    return Response.json({ error: "Your account is on the waitlist for Foglight" }, { status: 403 });
  }

  return {
    token,
    clientId: typeof claims.client_id === "string" ? claims.client_id : "",
    scopes: typeof claims.scope === "string" ? claims.scope.split(" ").filter(Boolean) : [],
    expiresAt: typeof claims.exp === "number" ? claims.exp : undefined,
    extra: { userId: claims.sub, email: typeof claims.email === "string" ? claims.email : undefined },
  };
}

/**
 * The 401 an MCP client turns into an OAuth flow: it follows the
 * `resource_metadata` parameter to the metadata document, which names
 * Supabase as the authorization server.
 */
function unauthorized(error?: string, description?: string): Response {
  const quote = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const parts = [`resource_metadata=${quote(resourceMetadataUrl())}`];
  if (error) parts.push(`error=${quote(error)}`);
  if (description) parts.push(`error_description=${quote(description)}`);

  return Response.json(
    { error: description || "Sign in required" },
    { status: 401, headers: { "WWW-Authenticate": `Bearer ${parts.join(", ")}` } }
  );
}
