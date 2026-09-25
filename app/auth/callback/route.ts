import { redirect } from "next/navigation";
import { safeNext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { joinWaitlist } from "@/lib/viewer";

// Landing route for Google sign-in: exchanges the PKCE code for a session,
// records the user on the access list, and sends them where they were going.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      await joinWaitlist(supabase);
      redirect(next);
    }
    console.error("[auth] code exchange failed:", error.message);
  }

  redirect("/login?error=auth");
}
