import { NextResponse, type NextRequest } from "next/server";
import { accessMode, safeNext } from "@/lib/access";
import { redirectWithCookies, updateSession } from "@/lib/supabase/proxy";

/**
 * Invite-mode wall. Refreshes Supabase session cookies on every request,
 * bounces signed-out page requests to /login, and keeps signed-in users out
 * of /login. It never queries the database: allowlist checks happen in
 * lib/viewer.ts, next to the pages and routes that need them.
 *
 * In open mode this does nothing at all.
 */
export async function proxy(request: NextRequest) {
  if (accessMode() !== "invite") return NextResponse.next();

  const session = await updateSession(request);

  const { pathname, search } = request.nextUrl;
  // APIs deny with 401/403 themselves, and the auth callback/confirm and
  // OAuth discovery routes are how signed-out users get in: none of them may
  // be redirected to the login page.
  const isPage =
    !pathname.startsWith("/api/") && !pathname.startsWith("/auth/") && !pathname.startsWith("/.well-known/");
  if (!isPage) return session.response;

  if (!session.claims && pathname !== "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", safeNext(pathname + search));
    return redirectWithCookies(session, url);
  }

  if (session.claims && pathname === "/login") {
    return redirectWithCookies(session, new URL(safeNext(request.nextUrl.searchParams.get("next")), request.url));
  }

  return session.response;
}

export const config = {
  // Everything except build output, images, and static asset files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
