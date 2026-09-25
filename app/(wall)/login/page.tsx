import { connection } from "next/server";
import { redirect } from "next/navigation";
import { accessMode, safeNext } from "@/lib/access";
import { getViewer } from "@/lib/viewer";
import LoginForm from "./login-form";
import styles from "../wall.module.css";

export const metadata = { title: "Sign in — Foglight" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  await connection();
  if (accessMode() !== "invite") redirect("/");

  const { next, error } = await searchParams;
  const target = safeNext(typeof next === "string" ? next : undefined);

  // The proxy usually gets here first; this is the same check at the data
  // layer so the page never depends on the proxy alone.
  const viewer = await getViewer();
  if (viewer) redirect(viewer.status === "allowed" ? target : "/waitlist");

  return (
    <>
      <h1 className={styles.heading}>Welcome to Foglight</h1>
      <p className={styles.sub}>Turn a task into a skill pack for your coding agent.</p>
      <LoginForm next={target} initialError={typeof error === "string" ? error : null} />
    </>
  );
}
