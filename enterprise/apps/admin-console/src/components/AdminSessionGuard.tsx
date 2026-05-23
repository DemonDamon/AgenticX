"use client";

import { useEffect } from "react";
import { redirectToAdminLogin } from "../lib/admin-client-auth";

const SESSION_CHECK_MS = 60_000;

/** Session probe on mount / focus / interval only — not on every client route change. */
export function AdminSessionGuard() {
  useEffect(() => {
    let cancelled = false;

    const verify = async () => {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 401) {
          redirectToAdminLogin();
        }
      } catch {
        /* network blip — next focus/interval will retry */
      }
    };

    void verify();
    const timer = window.setInterval(() => void verify(), SESSION_CHECK_MS);
    const onFocus = () => void verify();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return null;
}
