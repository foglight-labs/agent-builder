export type AccessMode = "open" | "invite";

export type AccessStatus = "waitlisted" | "allowed";

/**
 * Short-lived httpOnly cookie carrying the post-sign-in redirect target for
 * the email flow. The 6-digit code path passes `next` through the form; the
 * magic-link path can't (the link is opened later, possibly on another
 * device), so the link's target rides in this cookie instead.
 */
export const NEXT_COOKIE = "foglight_next";

let warnedUnknownMode = false;

/**
 * How the app gates access, from the ACCESS_MODE env var. "open" (the
 * default) keeps the app fully public and needs no Supabase. "invite" walls
 * the UI and APIs behind sign-in plus the allowlist. An unknown value fails
 * closed as "invite", which denies everything when Supabase isn't configured.
 */
export function accessMode(): AccessMode {
  const raw = (process.env.ACCESS_MODE || "open").trim().toLowerCase();
  if (raw === "open" || raw === "invite") return raw;
  if (!warnedUnknownMode) {
    warnedUnknownMode = true;
    console.warn(`[access] Unknown ACCESS_MODE "${process.env.ACCESS_MODE}"; failing closed as "invite".`);
  }
  return "invite";
}

export type SupabaseEnv = { url: string; publishableKey: string };

/**
 * Supabase connection settings, or null when either is missing. Invite-mode
 * callers treat null as misconfiguration and fail closed.
 */
export function supabaseEnv(): SupabaseEnv | null {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return null;
  return { url: url.replace(/\/+$/, ""), publishableKey };
}

/**
 * Public origin of this deployment (no trailing slash). OAuth redirect URLs
 * and links in emails are built from it. Throws when missing: anything that
 * needs it cannot work without it, so failing loudly here fails closed
 * everywhere downstream.
 */
export function siteUrl(): string {
  const url = process.env.SITE_URL;
  if (!url) throw new Error("SITE_URL is not set (required when ACCESS_MODE=invite)");
  return url.replace(/\/+$/, "");
}

const MAX_NEXT_LENGTH = 512;

/**
 * Limits post-sign-in redirects to relative paths on this site. Rejects
 * absolute URLs, protocol-relative "//host", and "/\host" (WHATWG URL parsing
 * treats a backslash after the leading slash as a host separator). "/login"
 * is rejected so a redirect can never loop back into the wall.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value || value.length > MAX_NEXT_LENGTH) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.length > 1 && (value[1] === "/" || value[1] === "\\")) return "/";
  if (value === "/login" || value.startsWith("/login?") || value.startsWith("/login/")) return "/";
  return value;
}
