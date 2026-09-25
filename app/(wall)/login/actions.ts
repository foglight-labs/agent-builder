"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NEXT_COOKIE, safeNext, siteUrl } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { joinWaitlist } from "@/lib/viewer";

export type LoginResult = { error: string } | { ok: true };

export async function signInWithGoogle(next: string): Promise<LoginResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(safeNext(next))}` },
  });
  if (error || !data.url) {
    console.error("[auth] signInWithOAuth failed:", error?.message);
    return { error: "Google sign-in is unavailable right now. Try email instead." };
  }
  redirect(data.url);
}

export async function signInWithEmail(email: string, next: string): Promise<LoginResult> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return { error: "Enter your email address." };

  const supabase = await createClient();

  // Where to land after the magic link is clicked. The link can be opened on
  // another device, where this cookie won't exist; /auth/confirm falls back
  // to "/" then.
  const cookieStore = await cookies();
  cookieStore.set(NEXT_COOKIE, safeNext(next), { httpOnly: true, sameSite: "lax", maxAge: 10 * 60, path: "/" });

  const { error } = await supabase.auth.signInWithOtp({ email: trimmed, options: { shouldCreateUser: true } });
  if (error) {
    console.error("[auth] signInWithOtp failed:", error.status, error.message);
    if (error.status === 429) return { error: "Too many emails requested. Wait a bit and try again." };
    return { error: "Couldn't send the sign-in email. Check the address and try again." };
  }
  return { ok: true };
}

export async function verifyEmailCode(email: string, code: string, next: string): Promise<LoginResult> {
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: "email" });
  if (error) {
    console.error("[auth] verifyOtp failed:", error.status, error.message);
    return { error: "That code didn't work. Check it and try again, or resend." };
  }
  await joinWaitlist(supabase);
  redirect(safeNext(next));
}
