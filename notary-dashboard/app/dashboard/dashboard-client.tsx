"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

export type DashboardSession = {
  id: string;
  orderId: string;
  status: string;
  createdAt: string;
  clientName: string;
  clientEmail: string;
  signerApproved: number;
  signerTotal: number;
  signerWaiting: number;
  kycReady: boolean;
  allInWaitingRoom: boolean;
};

function statusLabel(status: string) {
  switch (status) {
    case "pending_kyc":
      return "Pending KYC";
    case "waiting_notary":
      return "Confirmed";
    case "in_session":
      return "In session";
    case "signing":
      return "Signing";
    case "notary_stamping":
      return "Notary seal";
    case "completed":
      return "Completed";
    default:
      return status;
  }
}

function statusClasses(status: string) {
  if (["in_session", "signing", "notary_stamping"].includes(status))
    return "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-blue-100 text-blue-800";
  if (status === "waiting_notary")
    return "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-amber-100 text-amber-800";
  if (status === "completed")
    return "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-green-100 text-green-800";
  return "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-gray-100 text-gray-700";
}

export function DashboardClient({
  sessions: initialSessions,
}: {
  sessions: DashboardSession[];
}) {
  const router = useRouter();
  const [sessions, setSessions] = useState<DashboardSession[]>(initialSessions);
  const [filter, setFilter] = useState<"waiting" | "active" | "completed">("waiting");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setSessions(initialSessions);
  }, [initialSessions]);

  // Realtime: waiting-room presence → refetch for fresh data
  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const channel = supabase
      .channel("dashboard-presence")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "session_signers",
        },
        () => router.refresh()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [router]);

  // Polling de secours toutes les 15s sur l'onglet Salle d'attente
  useEffect(() => {
    if (filter !== "waiting") return;
    const interval = setInterval(() => router.refresh(), 15000);
    return () => clearInterval(interval);
  }, [filter, router]);

  const counts = useMemo(
    () => ({
      waiting: sessions.filter((s) => s.allInWaitingRoom && !["completed"].includes(s.status)).length,
      active: sessions.filter((s) => ["in_session", "signing", "notary_stamping"].includes(s.status)).length,
      completed: sessions.filter((s) => s.status === "completed").length,
    }),
    [sessions]
  );

  const filtered = useMemo(() => {
    if (filter === "waiting") return sessions.filter((s) => s.allInWaitingRoom && s.status !== "completed");
    if (filter === "active") return sessions.filter((s) => ["in_session", "signing", "notary_stamping"].includes(s.status));
    if (filter === "completed") return sessions.filter((s) => s.status === "completed");
    return sessions;
  }, [filter, sessions]);

  const joinVisio = async (sessionId: string) => {
    setLoadingId(sessionId);
    setErrors((p) => ({ ...p, [sessionId]: "" }));
    try {
      const res = await fetch(`/api/session/${sessionId}/daily-room`, { method: "POST" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setErrors((p) => ({ ...p, [sessionId]: data.error || "Could not start video" }));
        return;
      }
      window.location.href = `/room/${sessionId}`;
    } catch {
      setErrors((p) => ({ ...p, [sessionId]: "Network error" }));
    } finally {
      setLoadingId(null);
    }
  };

  const tabs = [
    { key: "waiting" as const, label: "Waiting room", count: counts.waiting },
    { key: "active" as const, label: "In progress", count: counts.active },
    { key: "completed" as const, label: "Completed", count: counts.completed },
  ];

  return (
    <main className="p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">My requests</h1>
          <p className="mt-1 text-sm text-gray-500">Manage your notarization requests</p>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex gap-1 border-b border-gray-200">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                filter === t.key
                  ? "border-primary text-primary"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {t.label}
              {t.count > 0 && (
                <span
                  className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
                    filter === t.key ? "bg-primary text-primary-foreground" : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Table card */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-6 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                {filter === "waiting" ? "Signers in the waiting room" : filter === "active" ? "Sessions in progress" : "Completed sessions"}
              </h2>
              <p className="mt-0.5 text-sm text-gray-500">
                {filter === "waiting"
                  ? "Only sessions where every signer is ready"
                  : "Click a row for details"}
              </p>
            </div>
            {filter === "waiting" && (
              <div className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
                <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                Live
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Client
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    KYC
                  </th>
                  {filter === "waiting" && (
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Present
                    </th>
                  )}
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Date
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-gray-900">{s.clientName}</div>
                      <div className="text-xs text-gray-500">{s.clientEmail}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={statusClasses(s.status)}>{statusLabel(s.status)}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-semibold ${
                          s.kycReady ? "text-green-600" : "text-amber-600"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${s.kycReady ? "bg-green-500" : "bg-amber-400"}`}
                        />
                        {s.signerApproved}/{s.signerTotal}
                      </span>
                    </td>
                    {filter === "waiting" && (
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600">
                          <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                          {s.signerWaiting}/{s.signerTotal}
                        </span>
                      </td>
                    )}
                    <td className="px-6 py-4 text-gray-600">
                      {new Date(s.createdAt).toLocaleDateString("en-US")}{" "}
                      <span className="text-gray-400">
                        {new Date(s.createdAt).toLocaleTimeString("en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        disabled={!s.kycReady || loadingId === s.id}
                        onClick={() => joinVisio(s.id)}
                        className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                          s.kycReady && loadingId !== s.id
                            ? "bg-primary text-primary-foreground hover:opacity-90"
                            : "cursor-not-allowed bg-gray-100 text-gray-400"
                        }`}
                      >
                        {loadingId === s.id ? "Connecting…" : "Join video"}
                      </button>
                      {errors[s.id] && (
                        <p className="mt-1.5 text-xs text-red-600">{errors[s.id]}</p>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={filter === "waiting" ? 6 : 5} className="px-6 py-12 text-center text-sm text-gray-400">
                      {filter === "waiting"
                        ? "No signers in the waiting room right now."
                        : "No requests for this filter."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
    </main>
  );
}
