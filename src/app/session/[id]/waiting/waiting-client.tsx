"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const STATUS_LABELS: Record<string, string> = {
  pending_kyc: "Vérification d'identité en cours",
  kyc_complete: "Identité vérifiée",
  waiting_notary: "En attente du notaire",
  in_session: "Session en cours",
  signing: "Signature en cours",
  notary_stamping: "Apposition du tampon",
  completed: "Terminé",
};

export function WaitingClient({
  sessionId,
  status: initialStatus,
  token,
}: {
  sessionId: string;
  status: string;
  token: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);

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

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <h1 className="text-xl font-bold">Salle d&apos;attente</h1>
        <p className="text-sm text-muted-foreground">
          Vous serez redirigé automatiquement lorsque la session commencera.
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <span className="text-sm">Statut :</span>
          <Badge variant="secondary">{STATUS_LABELS[status] || status}</Badge>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-sm text-muted-foreground">
            Mise à jour en temps réel
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
