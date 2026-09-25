import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NEXT_COOKIE, safeNext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { joinWaitlist } from "@/lib/viewer";

// The button in the sign-in email points here (built from the token hash, so
// the link works from any device, not just the browser that asked for it).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  if (tokenHash && type === "email") {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
    if (!error) {
      await joinWaitlist(supabase);

      // The link can't carry `next` (the email is a fixed template), so the
      // target rides in a short-lived cookie set when the email was
      // requested. Another device has no cookie and lands on "/".
      const cookieStore = await cookies();
      const next = safeNext(cookieStore.get(NEXT_COOKIE)?.value);
      cookieStore.delete(NEXT_COOKIE);
      redirect(next);
    }
    console.error("[auth] magic link verification failed:", error.message);
  }

  redirect("/login?error=link");
}
