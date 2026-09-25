"use client";

import { useState, useTransition } from "react";
import { approve, deny } from "./actions";
import styles from "../../wall.module.css";

/**
 * Allow/Deny for an OAuth authorization request. With `decide` off (the
 * waitlisted case) only Cancel is offered, which still denies the request so
 * the waiting MCP client gets a clean access_denied instead of a dangling
 * browser tab.
 */
export default function ConsentForm({ authorizationId, decide }: { authorizationId: string; decide: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function act(fn: (id: string) => Promise<{ error: string } | undefined>) {
    setError(null);
    startTransition(async () => {
      const result = await fn(authorizationId);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className={styles.form}>
      {decide && (
        <button
          className={`${styles.button} ${styles.buttonPrimary}`}
          type="button"
          onClick={() => act(approve)}
          disabled={pending}
        >
          {pending ? "One moment…" : "Allow"}
        </button>
      )}
      <button
        className={`${styles.button} ${styles.buttonSecondary}`}
        type="button"
        onClick={() => act(deny)}
        disabled={pending}
      >
        {decide ? "Deny" : "Cancel"}
      </button>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
