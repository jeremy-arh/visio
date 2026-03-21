import type { ReactNode } from "react";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { DashboardShell } from "@/components/dashboard-shell";
import { isNotaryUserWithAuthLookup } from "@/lib/notary-auth-server";
import { SessionFromHashRecovery } from "@/components/session-from-hash-recovery";

export default async function DashboardSectionLayout({
  children,
}: {
  children: ReactNode;
}) {
  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await authSupabase.auth.getUser();

  const isNotary = user ? await isNotaryUserWithAuthLookup(user) : false;
  const sessionMissing = !user?.email;
  const hasNotaryAccess = !!user?.email && isNotary;

  return (
    <SessionFromHashRecovery sessionMissing={sessionMissing} hasNotaryAccess={hasNotaryAccess}>
      {hasNotaryAccess ? (
        <DashboardShell userEmail={user.email!}>{children}</DashboardShell>
      ) : null}
    </SessionFromHashRecovery>
  );
}
