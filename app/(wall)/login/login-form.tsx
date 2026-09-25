"use client";

import { useEffect, useState, useTransition } from "react";
import { signInWithEmail, signInWithGoogle, verifyEmailCode } from "./actions";
import styles from "../wall.module.css";

const RESEND_COOLDOWN_SECONDS = 30;

const ERROR_MESSAGES: Record<string, string> = {
  auth: "Google sign-in didn't complete. Try again.",
  link: "That sign-in link didn't work or has expired. Enter your email to get a new one.",
};

/**
 * The sign-in form: Google, or email with a magic link + 6-digit code. After
 * the email goes out the form switches to code entry on the same screen; the
 * link in the email is the cross-device path.
 */
export default function LoginForm({ next, initialError }: { next: string; initialError: string | null }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(
    initialError ? (ERROR_MESSAGES[initialError] ?? "Something went wrong. Try again.") : null
  );
  const [pending, startTransition] = useTransition();
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  function onGoogle() {
    setError(null);
    startTransition(async () => {
      const result = await signInWithGoogle(next);
      if (result && "error" in result) setError(result.error);
    });
  }

  function sendCode() {
    setError(null);
    startTransition(async () => {
      const result = await signInWithEmail(email, next);
      if ("error" in result) {
        setError(result.error);
      } else {
        setStep("code");
        setCode("");
        setCooldown(RESEND_COOLDOWN_SECONDS);
      }
    });
  }

  function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await verifyEmailCode(email, code, next);
      if (result && "error" in result) setError(result.error);
    });
  }

  if (step === "code") {
    return (
      <>
        <p className={styles.muted}>
          We sent a sign-in link and a 6-digit code to <strong>{email}</strong>. The link works on any device; the
          code goes below.
        </p>
        <form className={styles.form} onSubmit={onVerify}>
          <input
            className={styles.codeInput}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            placeholder="123456"
            aria-label="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            required
            autoFocus
          />
          <button className={`${styles.button} ${styles.buttonPrimary}`} type="submit" disabled={pending || code.length !== 6}>
            {pending ? "Verifying…" : "Verify"}
          </button>
        </form>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <p className={styles.muted}>
          <button className={styles.linkButton} type="button" onClick={sendCode} disabled={pending || cooldown > 0}>
            {cooldown > 0 ? `Resend code (${cooldown}s)` : "Resend code"}
          </button>{" "}
          ·{" "}
          <button
            className={styles.linkButton}
            type="button"
            onClick={() => {
              setStep("email");
              setError(null);
              setCode("");
            }}
            disabled={pending}
          >
            Use a different email
          </button>
        </p>
      </>
    );
  }

  return (
    <>
      <div className={styles.form}>
        <button className={`${styles.button} ${styles.buttonSecondary}`} type="button" onClick={onGoogle} disabled={pending}>
          <GoogleIcon />
          Continue with Google
        </button>
        <div className={styles.divider}>or</div>
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            sendCode();
          }}
        >
          <input
            className={styles.input}
            type="email"
            placeholder="you@company.com"
            aria-label="Email address"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <button className={`${styles.button} ${styles.buttonPrimary}`} type="submit" disabled={pending || !email.trim()}>
            {pending ? "Sending…" : "Continue with email"}
          </button>
        </form>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M15.68 8.18c0-.57-.05-1.11-.15-1.64H8v3.1h4.31a3.68 3.68 0 0 1-1.6 2.42v2.01h2.59c1.51-1.39 2.38-3.45 2.38-5.89Z"
      />
      <path
        fill="#34A853"
        d="M8 16c2.16 0 3.97-.72 5.3-1.94l-2.59-2.01c-.72.48-1.64.77-2.71.77-2.08 0-3.85-1.41-4.48-3.3H.84v2.07A8 8 0 0 0 8 16Z"
      />
      <path fill="#FBBC05" d="M3.52 9.52a4.8 4.8 0 0 1 0-3.04V4.41H.84a8 8 0 0 0 0 7.18l2.68-2.07Z" />
      <path
        fill="#EA4335"
        d="M8 3.18c1.18 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 .84 4.41l2.68 2.07C4.15 4.59 5.92 3.18 8 3.18Z"
      />
    </svg>
  );
}
