"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

type Props = {
  sessionMissing: boolean;
  hasNotaryAccess: boolean;
  children: React.ReactNode;
};

/**
 * Supabase implicit-flow invites return #access_token=… — the server never sees the fragment.
 * We establish the session in the browser, then reload so Server Components see cookies.
 */
export function SessionFromHashRecovery({
  sessionMissing,
  hasNotaryAccess,
  children,
}: Props) {
  const router = useRouter();
  const [clientResolved, setClientResolved] = useState(false);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const hash = window.location.hash.slice(1);
    if (!hash.includes("access_token")) {
      setClientResolved(true);
      return;
    }

    const params = new URLSearchParams(hash);
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    if (!access_token || !refresh_token) {
      setClientResolved(true);
      return;
    }

    const supabase = createClient();
    void supabase.auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      const path = window.location.pathname + window.location.search;
      window.history.replaceState(null, "", path);

      if (error) {
        console.error("[session-from-hash]", error.message);
        setClientResolved(true);
        return;
      }
      // Full reload so the server reads cookies (avoids races with router.refresh()).
      window.location.replace(path);
    });
  }, []);

  useEffect(() => {
    if (!clientResolved || hasNotaryAccess) return;
    if (sessionMissing) {
      router.replace("/login");
    }
  }, [clientResolved, hasNotaryAccess, sessionMissing, router]);

  if (hasNotaryAccess) {
    return <>{children}</>;
  }

  if (!clientResolved) {
    return (
      <main style={{ padding: 32 }}>
        <p>Checking your session…</p>
      </main>
    );
  }

  if (sessionMissing) {
    return (
      <main style={{ padding: 32 }}>
        <p>Redirecting to sign-in…</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 32 }}>
      <p>
        Access denied. Your session must include{" "}
        <code>role: &quot;notary&quot;</code> in <code>user_metadata</code> or{" "}
        <code>app_metadata</code>.
      </p>
      <p style={{ marginTop: 12, fontSize: 14, color: "#4b5563" }}>
        If this persists, confirm <code>SUPABASE_SERVICE_ROLE_KEY</code> is set (needed to read
        your role from Auth) and that this app uses the same Supabase project as your user.
      </p>
    </main>
  );
}
