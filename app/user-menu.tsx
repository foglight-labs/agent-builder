"use client";

import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/auth/actions";
import type { Viewer } from "@/lib/viewer";

/**
 * The signed-in user's avatar at the top right of the builder. Opens a small
 * menu with their email and Sign out. Avatar is the Google profile photo
 * when present, initials otherwise.
 */
export default function UserMenu({ viewer }: { viewer: Viewer }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const initial = (viewer.fullName || viewer.email || "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="avatar"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((o) => !o)}
      >
        {viewer.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- third-party avatar url; no next/image remote config wanted
          <img src={viewer.avatarUrl} alt="" width={32} height={32} referrerPolicy="no-referrer" />
        ) : (
          <span aria-hidden="true">{initial}</span>
        )}
      </button>
      {open && (
        <div className="menu" role="menu">
          <p className="menu-email">{viewer.email}</p>
          <form action={signOut}>
            <button type="submit" className="menu-item" role="menuitem">
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
