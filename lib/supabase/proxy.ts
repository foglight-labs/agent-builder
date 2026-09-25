import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "@/lib/access";

export type ProxySession = {
  response: NextResponse;
  /** Verified JWT claims, or null when signed out. */
  claims: Record<string, unknown> | null;
};

/**
 * Refreshes the Supabase session cookies for the request and returns the
 * caller's verified claims. Never touches the database: the allowlist check
 * lives in lib/viewer.ts, next to the pages and routes that need it.
 */
export async function updateSession(request: NextRequest): Promise<ProxySession> {
  const env = supabaseEnv();
  if (!env) {
    // Misconfigured invite mode: no session is possible. Fail closed by
    // treating everyone as signed out; the page and API guards deny from here.
    return { response: NextResponse.next({ request: { headers: request.headers } }), claims: null };
  }

  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: request.headers } });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        // Token refreshes write Set-Cookie headers, so the library also emits
        // no-store cache headers: a shared cache must never serve one user's
        // session response to another.
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // getClaims() verifies the token's signature on every call: locally via a
  // cached JWKS for asymmetric signing keys, or against the Auth server for
  // legacy symmetric ones. It also refreshes the session (writing cookies via
  // setAll above) when the access token is near expiry. Never use
  // getSession() here: it trusts the cookie without verifying it.
  const { data } = await supabase.auth.getClaims();

  return { response, claims: (data?.claims as Record<string, unknown> | undefined) ?? null };
}

/**
 * Copies refreshed session cookies onto a redirect response, so a request
 * that gets bounced doesn't lose the rotation performed during this pass.
 */
export function redirectWithCookies(session: ProxySession, url: URL): NextResponse {
  const redirect = NextResponse.redirect(url);
  session.response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}
