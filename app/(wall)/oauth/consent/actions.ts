"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/viewer";

/**
 * Consent decisions for Supabase's OAuth server. Both re-check the viewer
 * server-side (server actions are public endpoints), and the Auth server
 * itself verifies the authorization belongs to the signed-in user before
 * acting on it.
 */
export async function approve(authorizationId: string): Promise<{ error: string } | undefined> {
  const viewer = await getViewer();
  if (!viewer) return { error: "Sign in first." };
  if (viewer.status !== "allowed") return { error: "Your account is on the waitlist." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.oauth.approveAuthorization(authorizationId);
  if (error || !data?.redirect_url) {
    console.error("[oauth] approveAuthorization failed:", error?.message);
    return { error: "Couldn't approve the request. It may have expired — try again from your MCP client." };
  }
  redirect(data.redirect_url);
}

export async function deny(authorizationId: string): Promise<{ error: string } | undefined> {
  const viewer = await getViewer();
  if (!viewer) return { error: "Sign in first." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.oauth.denyAuthorization(authorizationId);
  if (error || !data?.redirect_url) {
    console.error("[oauth] denyAuthorization failed:", error?.message);
    return { error: "Couldn't cancel the request. You can close this tab." };
  }
  redirect(data.redirect_url);
}
