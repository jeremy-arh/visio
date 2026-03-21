"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, Clock, Radio } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const STATUS_LABELS: Record<string, string> = {
  pending_kyc: "Identity verification in progress",
  kyc_complete: "Identity verified",
  waiting_notary: "Waiting for the notary",
  in_session: "Session in progress",
  signing: "Signing in progress",
  notary_stamping: "Applying notary seal",
  completed: "Completed",
};

const HEARTBEAT_INTERVAL_MS = 20_000;

function statusBadgeVariant(
  status: string
): "secondary" | "warning" | "success" {
  if (status === "waiting_notary" || status === "pending_kyc") return "warning";
  if (status === "kyc_complete") return "success";
  return "secondary";
}

function WaitingAnimation() {
  return (
    <div
      className="flex flex-col items-center border-b border-neutral-100 bg-gradient-to-b from-[#2563eb]/[0.04] to-transparent px-3 pb-5 pt-4 sm:px-6 sm:pt-5"
      aria-hidden
    >
      <div className="relative flex h-[7.5rem] w-full max-w-[220px] items-center justify-center">
        <div className="absolute h-[5.5rem] w-[5.5rem] rounded-full border border-[#2563eb]/25 bg-[#2563eb]/[0.07] shadow-[0_0_40px_-8px_rgba(37,99,235,0.35)] animate-[pulse_2.8s_ease-in-out_infinite]" />
        <div className="absolute h-[4rem] w-[4rem] rounded-full border border-[#2563eb]/35 animate-[ping_2.4s_cubic-bezier(0,0,0.2,1)_infinite] [animation-delay:300ms] opacity-60" />
        <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-md ring-1 ring-[#2563eb]/25">
          <Clock className="h-5 w-5 text-[#2563eb]" strokeWidth={1.75} />
        </div>
      </div>
    </div>
  );
}

export function WaitingClient({
  sessionId,
  signerId,
  status: initialStatus,
  token,
}: {
  sessionId: string;
  signerId: string;
  status: string;
  token: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const tokenRef = useRef(token);
  const signerIdRef = useRef(signerId);
  const sessionIdRef = useRef(sessionId);

  useEffect(() => {
    const sendPresence = (presenceStatus: "waiting" | "left") => {
      const body = JSON.stringify({
        token: tokenRef.current,
        signerId: signerIdRef.current,
        status: presenceStatus,
      });
      const url = `/api/session/${sessionIdRef.current}/presence`;
      if (presenceStatus === "left" && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      } else {
        fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => {});
      }
    };

    sendPresence("waiting");

    const heartbeat = setInterval(() => sendPresence("waiting"), HEARTBEAT_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === "hidden") sendPresence("left");
      else sendPresence("waiting");
    };
    const onBeforeUnload = () => sendPresence("left");

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      sendPresence("left");
    };
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`session-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notarization_sessions",
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          const newStatus = (payload.new as { status: string }).status;
          setStatus(newStatus);
          if (["in_session", "signing", "notary_stamping"].includes(newStatus)) {
            router.push(`/session/${sessionId}/room?token=${token}`);
          }
          if (newStatus === "completed") {
            router.push(`/session/${sessionId}/completed?token=${token}`);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, token, router]);

  useEffect(() => {
    if (!signerId) return;
    if (!["pending_kyc", "kyc_complete", "waiting_notary"].includes(status)) return;

    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/kyc/sync-decision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, signerId }),
        });
        if (!res.ok || cancelled) return;

        const data = (await res.json()) as {
          signerStatus?: string;
          sessionStatus?: string | null;
        };

        if (data.sessionStatus) {
          setStatus(data.sessionStatus);
          if (["in_session", "signing", "notary_stamping"].includes(data.sessionStatus)) {
            router.push(`/session/${sessionId}/room?token=${token}`);
          }
        }
      } catch {
        // Keep waiting silently; realtime flow still exists.
      }
    }, 6000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionId, signerId, status, token, router]);

  return (
    <Card className="min-w-0 w-full overflow-hidden shadow-sm">
      <WaitingAnimation />
      <CardHeader className="space-y-2 px-4 pb-2 pt-4 sm:space-y-1 sm:px-6 sm:pt-5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Activity
            className="h-5 w-5 shrink-0 text-[#2563eb]"
            aria-hidden
            strokeWidth={1.75}
          />
          <h2 className="min-w-0 text-base font-semibold sm:text-lg">
            Current status
          </h2>
        </div>
        <p className="text-sm text-muted-foreground sm:pl-7">
          You will be redirected automatically when the session starts.
        </p>
      </CardHeader>
      <CardContent className="space-y-5 px-4 pb-6 pt-0 sm:px-6">
        <div className="rounded-lg border border-neutral-100 bg-neutral-50/80 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Status
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant={statusBadgeVariant(status)}>
              {STATUS_LABELS[status] || status}
            </Badge>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Radio className="h-4 w-4 shrink-0 text-[#2563eb]/80" aria-hidden strokeWidth={1.75} />
          <span className="inline-flex min-w-0 items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
            </span>
            Live updates
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
