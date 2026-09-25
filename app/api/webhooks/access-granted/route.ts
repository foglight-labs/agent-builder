import { timingSafeEqual } from "node:crypto";
import { sendAccessGrantedEmail } from "@/lib/email";

/**
 * Called by the database (pg_net) when an admin flips an access_list row
 * from waitlisted to allowed. The trigger reads the URL and secret from
 * Supabase Vault; see supabase/README.md. The response is only ever read
 * from pg_net's response table for debugging, so failures are reported in
 * the body rather than retried.
 */
export async function POST(request: Request) {
  const secret = process.env.ACCESS_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ error: "ACCESS_WEBHOOK_SECRET is not set" }, { status: 500 });
  }
  if (!bearerMatches(request, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { email?: unknown; full_name?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!email) {
    return Response.json({ error: "email is required" }, { status: 400 });
  }
  const fullName = typeof body?.full_name === "string" ? body.full_name : null;

  const result = await sendAccessGrantedEmail(email, fullName);
  return Response.json(result.ok ? { ok: true } : { ok: false, reason: result.reason });
}

function bearerMatches(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}
