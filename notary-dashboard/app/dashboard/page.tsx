import { DashboardClient, type DashboardSession } from "./dashboard-client";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase";

export const metadata = {
  title: { absolute: "My requests" },
};

async function loadSessions(notaryIds: string[]): Promise<DashboardSession[]> {
  const supabase = createServiceClient();
  const assignedQuery = supabase
    .from("notarization_sessions")
    .select("id, order_id, status, created_at, notary_id")
    .in("notary_id", notaryIds)
    .order("created_at", { ascending: false })
    .limit(100);

  const unassignedReadyQuery = supabase
    .from("notarization_sessions")
    .select("id, order_id, status, created_at, notary_id")
    .is("notary_id", null)
    .in("status", ["pending_kyc", "kyc_complete", "waiting_notary"])
    .order("created_at", { ascending: false })
    .limit(100);

  const [{ data: assigned }, { data: unassignedReady }] = await Promise.all([
    assignedQuery,
    unassignedReadyQuery,
  ]);

  const dedup = new Map<string, (typeof assigned)[number]>();
  for (const row of [...(assigned || []), ...(unassignedReady || [])]) {
    if (row) dedup.set(row.id, row);
  }
  let sessions = Array.from(dedup.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  // If nothing is assigned to this notary, show a global view so the dashboard is not empty.
  if (!sessions.length) {
    const { data: globalSessions } = await supabase
      .from("notarization_sessions")
      .select("id, order_id, status, created_at, notary_id")
      .order("created_at", { ascending: false })
      .limit(100);
    sessions = globalSessions || [];
  }

  if (!sessions?.length) return [];

  const ids = sessions.map((s) => s.id);
  const { data: signers } = await supabase
    .from("session_signers")
    .select("id, session_id, name, email, kyc_status, is_in_waiting_room")
    .in("session_id", ids);

  const map = new Map<
    string,
    { total: number; approved: number; waiting: number; firstName: string | null; firstEmail: string | null }
  >();

  for (const s of signers || []) {
    const prev = map.get(s.session_id) || {
      total: 0,
      approved: 0,
      waiting: 0,
      firstName: null,
      firstEmail: null,
    };
    prev.total += 1;
    if (s.kyc_status === "approved") prev.approved += 1;
    if (s.is_in_waiting_room) prev.waiting += 1;
    if (!prev.firstName && s.name) prev.firstName = s.name;
    if (!prev.firstEmail && s.email) prev.firstEmail = s.email;
    map.set(s.session_id, prev);
  }

  return sessions.map((session) => {
    const st = map.get(session.id) || {
      total: 0,
      approved: 0,
      waiting: 0,
      firstName: null,
      firstEmail: null,
    };
    return {
      id: session.id,
      orderId: session.order_id,
      status: session.status,
      createdAt: session.created_at,
      clientName: st.firstName || "Client",
      clientEmail: st.firstEmail || "",
      signerApproved: st.approved,
      signerTotal: st.total,
      signerWaiting: st.waiting,
      kycReady: st.total > 0 && st.approved === st.total,
      allInWaitingRoom: st.total > 0 && st.waiting === st.total,
    };
  });
}

export default async function DashboardPage() {
  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await authSupabase.auth.getUser();

  if (!user?.email) {
    return null;
  }

  const service = createServiceClient();
  const [{ data: notariesPlural }, { data: notarySingular }] = await Promise.all([
    service.from("notaries").select("id, email").eq("email", user.email),
    service.from("notary").select("id, email, user_id").or(`email.eq.${user.email},user_id.eq.${user.id}`),
  ]);

  const notaryIds = Array.from(
    new Set([...(notariesPlural || []).map((n) => n.id), ...(notarySingular || []).map((n) => n.id)])
  );

  if (!notaryIds.length) {
    return (
      <main style={{ padding: 32 }}>
        Notary profile not found for {user.email}. Check the{" "}
        <code>notaries</code> or <code>notary</code> table.
      </main>
    );
  }

  const baseSessions = await loadSessions(notaryIds);
  return <DashboardClient sessions={baseSessions} />;
}
