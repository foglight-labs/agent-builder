import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeMcpRequest, bearerToken, resourceMetadata, resourceMetadataUrl } from "@/lib/mcp-auth";

// `vi.mock` factories are hoisted above imports, so the mock client comes
// from `vi.hoisted` rather than a plain module-scope `const`.
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

const ORIGINAL_ENV = { ...process.env };

function requestWith(auth?: string): Request {
  return new Request("https://app.test/api/mcp", {
    method: "POST",
    headers: auth ? { Authorization: auth } : {},
  });
}

type MockOptions = {
  claims?: Record<string, unknown> | null;
  claimsError?: { message: string } | null;
  rpcData?: string | null;
  rpcError?: { message: string } | null;
};

function mockSupabase({ claims = null, claimsError = null, rpcData = null, rpcError = null }: MockOptions) {
  const getClaims = vi
    .fn()
    .mockResolvedValue(claimsError ? { data: null, error: claimsError } : { data: claims ? { claims } : null, error: null });
  const rpc = vi.fn().mockResolvedValue({ data: rpcData, error: rpcError });
  createClient.mockReturnValue({ auth: { getClaims }, rpc });
  return { getClaims, rpc };
}

beforeEach(() => {
  process.env.SITE_URL = "https://app.test";
  process.env.SUPABASE_URL = "http://supabase.test";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  createClient.mockReset();
  vi.restoreAllMocks();
});

describe("bearerToken", () => {
  it("extracts the token case-insensitively", () => {
    expect(bearerToken(requestWith("Bearer abc123"))).toBe("abc123");
    expect(bearerToken(requestWith("bearer abc123"))).toBe("abc123");
  });

  it("rejects missing, malformed, and empty headers", () => {
    expect(bearerToken(requestWith())).toBeNull();
    expect(bearerToken(requestWith("Basic abc"))).toBeNull();
    expect(bearerToken(requestWith("Bearer"))).toBeNull();
    expect(bearerToken(requestWith("Bearer   "))).toBeNull();
  });
});

describe("resourceMetadata", () => {
  it("points at the MCP resource and the Supabase authorization server", () => {
    expect(resourceMetadataUrl()).toBe("https://app.test/.well-known/oauth-protected-resource/api/mcp");
    expect(resourceMetadata()).toEqual({
      resource: "https://app.test/api/mcp",
      authorization_servers: ["http://supabase.test/auth/v1"],
      scopes_supported: [],
      bearer_methods_supported: ["header"],
      resource_name: "Foglight skills catalog",
    });
  });
});

describe("authorizeMcpRequest", () => {
  it("answers 500 when invite mode is missing config", async () => {
    delete process.env.SUPABASE_URL;
    const result = await authorizeMcpRequest(requestWith("Bearer x"));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(500);
  });

  it("answers 401 with a resource_metadata pointer when the token is missing", async () => {
    const result = await authorizeMcpRequest(requestWith());
    expect(result).toBeInstanceOf(Response);
    const res = result as Response;
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(
      'Bearer resource_metadata="https://app.test/.well-known/oauth-protected-resource/api/mcp"'
    );
  });

  it("answers 401 with invalid_token when verification fails", async () => {
    mockSupabase({ claimsError: { message: "bad token" } });
    const result = await authorizeMcpRequest(requestWith("Bearer nope"));
    const res = result as Response;
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain('error="invalid_token"');
  });

  it("answers 403 for a waitlisted user", async () => {
    mockSupabase({ claims: { sub: "user-1", client_id: "client-1" }, rpcData: "waitlisted" });
    const result = await authorizeMcpRequest(requestWith("Bearer ok"));
    const res = result as Response;
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/waitlist/i) });
  });

  it("answers 500 when the allowlist check itself fails", async () => {
    mockSupabase({ claims: { sub: "user-1" }, rpcError: { message: "db down" } });
    const result = await authorizeMcpRequest(requestWith("Bearer ok"));
    expect((result as Response).status).toBe(500);
  });

  it("returns AuthInfo for an allowed user", async () => {
    const { getClaims, rpc } = mockSupabase({
      claims: { sub: "user-1", client_id: "client-1", scope: "openid email", exp: 2000000000, email: "a@b.c" },
      rpcData: "allowed",
    });
    const result = await authorizeMcpRequest(requestWith("Bearer good-token"));
    expect(result).not.toBeInstanceOf(Response);
    expect(result).toEqual({
      token: "good-token",
      clientId: "client-1",
      scopes: ["openid", "email"],
      expiresAt: 2000000000,
      extra: { userId: "user-1", email: "a@b.c" },
    });
    expect(getClaims).toHaveBeenCalledWith("good-token");
    expect(rpc).toHaveBeenCalledWith("get_my_access");
  });

  it("treats an unknown allowlist answer as closed", async () => {
    mockSupabase({ claims: { sub: "user-1" }, rpcData: "something-unexpected" });
    const result = await authorizeMcpRequest(requestWith("Bearer ok"));
    expect((result as Response).status).toBe(403);
  });
});
