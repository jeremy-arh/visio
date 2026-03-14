"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function KycClient({
  sessionId,
  signerId,
  signerName,
  signerEmail,
  veriffEnabled,
}: {
  sessionId: string;
  signerId: string;
  signerName: string;
  signerEmail: string;
  veriffEnabled: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [loading, setLoading] = useState(false);
  const [veriffError, setVeriffError] = useState<string | null>(null);

  const handleVerifyIdentity = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/kyc/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, signerId }),
      });
      if (res.ok) {
        router.push(`/session/${sessionId}/waiting?token=${token}`);
      } else {
        const data = await res.json();
        console.error(data.error || "Erreur");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleStartVeriff = async () => {
    setLoading(true);
    setVeriffError(null);
    try {
      const callbackUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/session/${sessionId}/waiting${token ? `?token=${token}` : ""}`;
      const res = await fetch("/api/kyc/veriff-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, signerId, callbackUrl }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
      } else {
        setVeriffError(data.error || "Impossible de créer la session Veriff");
      }
    } catch (e) {
      setVeriffError("Erreur lors du chargement de Veriff");
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-semibold">Vérification d&apos;identité</h2>
        <p className="text-sm text-muted-foreground">
          {veriffEnabled
            ? "Lancez la vérification Veriff ci-dessous pour confirmer votre identité."
            : "Confirmez votre identité pour poursuivre la session de notarisation."}
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 text-sm text-muted-foreground mb-4">
          <p>Signataire : {signerName} ({signerEmail})</p>
        </div>
        {veriffEnabled ? (
          <div className="space-y-4">
            <Button onClick={handleStartVeriff} disabled={loading}>
              {loading ? "Chargement..." : "Lancer la vérification Veriff"}
            </Button>
            {veriffError && (
              <p className="text-sm text-destructive">{veriffError}</p>
            )}
          </div>
        ) : (
          <Button onClick={handleVerifyIdentity} disabled={loading}>
            {loading ? "Vérification..." : "Confirmer mon identité"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
