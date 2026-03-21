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
            setError("Unable to verify your status right now.");
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
          setError("Verification still pending. Please try again.");
        }
      } catch {
        if (!cancelled && attemptsRef.current >= maxAttempts) {
          setError("Network error while verifying.");
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
    <Card className="min-w-0 w-full max-w-md">
      <CardHeader className="px-4 sm:px-6">
        <h1 className="text-xl font-bold">Verification in progress</h1>
        <p className="text-sm text-muted-foreground">
          We are retrieving your identity verification result.
        </p>
      </CardHeader>
      <CardContent className="px-4 sm:px-6">
        {!error ? (
          <div className="flex min-w-0 items-start gap-2">
            <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500 animate-pulse" />
            <span className="min-w-0 text-sm leading-relaxed text-muted-foreground">
              Please wait — you will be redirected automatically…
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-destructive">{error}</p>
            <Button onClick={() => router.replace(retryUrl)}>
              Retry verification
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
