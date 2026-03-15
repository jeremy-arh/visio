"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function KycLoadingClient({
  sessionId,
  signerId,
  token,
}: {
  sessionId: string;
  signerId: string;
  token: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const attemptsRef = useRef(0);
  const maxAttempts = 45;

  const retryUrl = useMemo(
    () => `/session/${sessionId}/kyc${token ? `?token=${token}` : ""}`,
    [sessionId, token]
  );

  useEffect(() => {
    let cancelled = false;

    const checkDecision = async () => {
      attemptsRef.current += 1;
      try {
        const res = await fetch("/api/kyc/sync-decision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, signerId }),
        });

        if (!res.ok) {
          if (!cancelled && attemptsRef.current >= maxAttempts) {
            setError("Impossible de vérifier votre statut pour le moment.");
          }
          return;
        }

        const data = (await res.json()) as {
          signerStatus?: string;
        };

        if (cancelled) return;

        if (data.signerStatus === "approved") {
          router.replace(`/session/${sessionId}/waiting?token=${token}`);
          return;
        }

        if (data.signerStatus === "declined") {
          router.replace(`/session/${sessionId}/kyc/failed?token=${token}`);
          return;
        }

        if (attemptsRef.current >= maxAttempts) {
          setError("Vérification toujours en cours. Veuillez réessayer.");
        }
      } catch {
        if (!cancelled && attemptsRef.current >= maxAttempts) {
          setError("Erreur réseau lors de la vérification.");
        }
      }
    };

    checkDecision();
    const interval = setInterval(checkDecision, 4000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionId, signerId, token, router]);

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <h1 className="text-xl font-bold">Vérification en cours</h1>
        <p className="text-sm text-muted-foreground">
          Nous récupérons le résultat de votre vérification d&apos;identité.
        </p>
      </CardHeader>
      <CardContent>
        {!error ? (
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-sm text-muted-foreground">
              Patientez, redirection automatique...
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-destructive">{error}</p>
            <Button onClick={() => router.replace(retryUrl)}>
              Recommencer la vérification
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
