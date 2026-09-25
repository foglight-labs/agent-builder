import { cache } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { accessMode, safeNext, type AccessStatus } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";

export type Viewer = {
  userId: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  status: AccessStatus;
};

export type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Records the caller on the access list: inserts a waitlisted row when
 * missing, and links their account to a pre-approved row when one exists.
 * Safe to call on every sign-in. A failure only delays the row's creation
 * (the next sign-in retries), so it logs and never blocks the redirect.
 */
export async function joinWaitlist(supabase: ServerClient): Promise<void> {
  const { error } = await supabase.rpc("join_waitlist");
  if (error) console.error("[access] join_waitlist failed:", error.message);
}

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value ? value : null;
}

/**
 * The signed-in user plus their allowlist status, or null when signed out
 * (and in open mode, where there is no sign-in at all). Memoized per request
 * so a page and the components it renders can all ask without repeating the
 * verification. Throws when Supabase is unconfigured in invite mode: callers
 * fail closed via a 500 rather than rendering anything gated.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  if (accessMode() !== "invite") return null;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;

  const claims = data.claims;
  const metadata = (claims.user_metadata ?? {}) as Record<string, unknown>;

  return {
    userId: claims.sub,
    email: typeof claims.email === "string" ? claims.email : "",
    fullName: metadataString(metadata, "full_name") ?? metadataString(metadata, "name"),
    avatarUrl: metadataString(metadata, "avatar_url") ?? metadataString(metadata, "picture"),
    status: await myAccessStatus(supabase),
  };
});

/**
 * The caller's row in the allowlist. Anything unexpected (RPC error, unknown
 * value) collapses to "waitlisted": the safe answer is always the closed one.
 */
async function myAccessStatus(supabase: ServerClient): Promise<AccessStatus> {
  const { data, error } = await supabase.rpc("get_my_access");
  if (error) {
    console.error("[access] get_my_access failed:", error.message);
    return "waitlisted";
  }
  return data === "allowed" ? "allowed" : "waitlisted";
}

/**
 * Gate for pages that require an allowed, signed-in user. `connection()`
 * comes first — unconditionally — so the page is never prerendered at build
 * time: the build runs in open mode (no env), and a prerendered gate would
 * be served forever to invite-mode visitors without ever running.
 * In open mode this is a pass-through that returns null.
 */
export async function requirePageAccess(nextPath: string): Promise<Viewer | null> {
  await connection();
  if (accessMode() !== "invite") return null;

  const viewer = await getViewer();
  if (!viewer) {
    redirect(`/login?next=${encodeURIComponent(safeNext(nextPath))}`);
  }
  if (viewer.status !== "allowed") {
    redirect("/waitlist");
  }
  return viewer;
}

/**
 * Gate for the browser-facing API routes (the MCP endpoint has its own
 * bearer-token flow in lib/mcp-auth.ts). Returns null when the request may
 * proceed, or the denial response to send back.
 */
export async function requireApiAccess(): Promise<Response | null> {
  if (accessMode() !== "invite") return null;

  let viewer: Viewer | null;
  try {
    viewer = await getViewer();
  } catch (error) {
    console.error("[access] viewer check failed:", error);
    return Response.json({ error: "Access checks are not configured" }, { status: 500 });
  }
  if (!viewer) {
    return Response.json({ error: "Sign in required" }, { status: 401 });
  }
  if (viewer.status !== "allowed") {
    return Response.json({ error: "Your account is on the waitlist" }, { status: 403 });
  }
  return null;
}
