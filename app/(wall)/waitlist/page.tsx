import { connection } from "next/server";
import { redirect } from "next/navigation";
import { accessMode } from "@/lib/access";
import { signOut } from "@/app/auth/actions";
import { getViewer } from "@/lib/viewer";
import styles from "../wall.module.css";

export const metadata = { title: "You're on the list — Foglight" };

export default async function WaitlistPage() {
  await connection();
  if (accessMode() !== "invite") redirect("/");

  const viewer = await getViewer();
  if (!viewer) redirect("/login?next=%2Fwaitlist");
  if (viewer.status === "allowed") redirect("/");

  return (
    <>
      <h1 className={styles.heading}>You&rsquo;re on the list</h1>
      <p className={styles.sub}>
        We&rsquo;ll email <strong>{viewer.email}</strong> when you&rsquo;re in.
      </p>
      <form action={signOut}>
        <button className={`${styles.button} ${styles.buttonSecondary}`} type="submit">
          Sign out
        </button>
      </form>
    </>
  );
}
