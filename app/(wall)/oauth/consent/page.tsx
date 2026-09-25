import { connection } from "next/server";
import { redirect } from "next/navigation";
import { accessMode, safeNext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/viewer";
import ConsentForm from "./consent-form";
import styles from "../../wall.module.css";

export const metadata = { title: "Connect to Foglight" };

function hostOf(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return uri;
  }
}

/**
 * The consent screen Supabase's OAuth server sends MCP clients' users to
 * (authorization_url_path in supabase/config.toml). Signed-out users bounce
 * through /login and come straight back here.
 */
export default async function ConsentPage({ searchParams }: PageProps<"/oauth/consent">) {
  await connection();
  if (accessMode() !== "invite") redirect("/");

  const { authorization_id: authorizationId } = await searchParams;
  const id = typeof authorizationId === "string" ? authorizationId : "";

  const viewer = await getViewer();
  if (!viewer) {
    redirect(`/login?next=${encodeURIComponent(safeNext(`/oauth/consent?authorization_id=${id}`))}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);
  if (error || !data) {
    console.error("[oauth] getAuthorizationDetails failed:", error?.message);
    return (
      <>
        <h1 className={styles.heading}>That didn&rsquo;t work</h1>
        <p className={styles.sub}>
          This authorization request is invalid or has expired. Go back to your MCP client and try connecting again.
        </p>
      </>
    );
  }

  // Already consented to these scopes: Supabase answers with the client's
  // redirect URL directly, so there's nothing to ask.
  if ("redirect_url" in data) redirect(data.redirect_url);

  if (viewer.status !== "allowed") {
    return (
      <>
        <h1 className={styles.heading}>You&rsquo;re on the list</h1>
        <p className={styles.sub}>
          Your account ({viewer.email}) hasn&rsquo;t been granted access yet, so <strong>{data.client.name}</strong> can&rsquo;t
          connect to Foglight. We&rsquo;ll email you when you&rsquo;re in.
        </p>
        <ConsentForm authorizationId={id} decide={false} />
      </>
    );
  }

  return (
    <>
      <h1 className={styles.heading}>Connect {data.client.name} to Foglight</h1>
      <p className={styles.sub}>
        Signed in as <strong>{viewer.email}</strong>. <strong>{data.client.name}</strong> will be able to search the skills
        catalog for you, and sends you back to <code>{hostOf(data.redirect_uri)}</code> afterwards.
      </p>
      <ConsentForm authorizationId={id} decide />
    </>
  );
}
