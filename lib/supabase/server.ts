import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseEnv } from "@/lib/access";

/**
 * A Supabase client bound to the current request's cookies, for server
 * components, server actions, and route handlers. Throws when Supabase isn't
 * configured: this is only called in invite mode, where a missing config must
 * fail closed rather than fall back to some unauthenticated behavior.
 *
 * Cookie writes can throw in server components (they can't mutate the
 * response). That's fine: the proxy refreshes sessions on every navigation,
 * so the refresh simply lands on the next request instead.
 */
export async function createClient() {
  const env = supabaseEnv();
  if (!env) {
    throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required when ACCESS_MODE=invite");
  }

  const cookieStore = await cookies();

  return createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server component: response cookies can't be set from here.
        }
      },
    },
  });
}
