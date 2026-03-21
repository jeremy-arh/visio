"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FilePenLine, Mail, User } from "lucide-react";
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
        console.error(data.error || "Error");
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
      const callbackUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/session/${sessionId}/kyc/loading${token ? `?token=${token}` : ""}`;
      const res = await fetch("/api/kyc/veriff-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, signerId, callbackUrl }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
      } else {
        setVeriffError(data.error || "Could not create Veriff session");
      }
    } catch (e) {
      setVeriffError("Error loading Veriff");
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="min-w-0 w-full overflow-hidden shadow-sm">
      <CardHeader className="space-y-2 px-4 pb-2 pt-4 sm:space-y-1 sm:px-6 sm:pt-6">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <FilePenLine
            className="h-5 w-5 shrink-0 text-[#2563eb]"
            aria-hidden
            strokeWidth={1.75}
          />
          <h2 className="min-w-0 text-base font-semibold sm:text-lg">Next step</h2>
        </div>
        <p className="text-sm text-muted-foreground sm:pl-7">
          {veriffEnabled
            ? "Start Veriff verification below to confirm your identity."
            : "Confirm your identity to continue the notarization session."}
        </p>
      </CardHeader>
      <CardContent className="space-y-5 px-4 pt-2 sm:px-6">
        <div className="rounded-lg border border-neutral-100 bg-neutral-50/80 px-3 py-3 text-sm sm:px-4">
          <div className="flex min-w-0 items-start gap-2 text-muted-foreground">
            <User className="mt-0.5 h-4 w-4 shrink-0" aria-hidden strokeWidth={1.75} />
            <span className="min-w-0 break-words">
              <span className="text-foreground/80">Signer</span>{" "}
              <span className="font-medium text-foreground">{signerName}</span>
            </span>
          </div>
          <div className="mt-2 flex min-w-0 items-start gap-2 text-muted-foreground">
            <Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden strokeWidth={1.75} />
            <span className="min-w-0 break-all sm:break-words">{signerEmail}</span>
          </div>
        </div>
        {veriffEnabled ? (
          <div className="space-y-4">
            <Button onClick={handleStartVeriff} disabled={loading}>
              {loading ? "Loading…" : "Start Veriff verification"}
            </Button>
            {veriffError && (
              <p className="text-sm text-destructive">{veriffError}</p>
            )}
          </div>
        ) : (
          <Button onClick={handleVerifyIdentity} disabled={loading}>
            {loading ? "Verifying…" : "Confirm my identity"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
