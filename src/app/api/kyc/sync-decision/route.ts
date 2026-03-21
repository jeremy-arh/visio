import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { logAuditEvent, extractRequestMeta } from "@/lib/audit";
import crypto from "crypto";

const VERIFF_API_URL = process.env.VERIFF_API_URL || "https://stationapi.veriff.com";

type VeriffDecisionResponse = {
  verification?: {
    status?: string;
    code?: number | string;
  } | null;
};

export async function POST(request: NextRequest) {
  try {
    const { sessionId, signerId } = (await request.json()) as {
      sessionId?: string;
      signerId?: string;
    };

    if (!sessionId || !signerId) {
      return NextResponse.json(
        { error: "sessionId et signerId requis" },
        { status: 400 }
      );
    }

    const apiKey = process.env.VERIFF_API_KEY;
    // Veriff decision endpoint signature must use Integration API Secret,
    // not webhook secret.
    const apiSecret = process.env.VERIFF_API_SECRET;
    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        {
          error: "Veriff non configuré",
          details: "VERIFF_API_KEY et VERIFF_API_SECRET sont requis",
        },
        { status: 500 }
      );
    }

    const supabase = createServiceClient();
    const { data: signer, error: signerError } = await supabase
      .from("session_signers")
      .select("id, session_id, kyc_status, veriff_session_id")
      .eq("id", signerId)
      .eq("session_id", sessionId)
      .single();

    if (signerError || !signer) {
      return NextResponse.json({ error: "Signataire introuvable" }, { status: 404 });
    }

    if (!signer.veriff_session_id) {
      return NextResponse.json({
        synced: false,
        signerStatus: signer.kyc_status,
        reason: "veriff_session_id manquant",
      });
    }

    const signature = crypto
      .createHmac("sha256", apiSecret)
      .update(signer.veriff_session_id)
      .digest("hex");

    const res = await fetch(
      `${VERIFF_API_URL}/v1/sessions/${signer.veriff_session_id}/decision`,
      {
        headers: {
          "Content-Type": "application/json",
          "X-AUTH-CLIENT": apiKey,
          "X-HMAC-SIGNATURE": signature,
        },
        cache: "no-store",
      }
    );

    if (!res.ok) {
      const details = await res.text();
      console.error("[KYC sync] Veriff decision error", { sessionId, signerId, details });
      return NextResponse.json(
        { error: "Erreur récupération décision Veriff", details },
        { status: 502 }
      );
    }

    const payload = (await res.json()) as VeriffDecisionResponse;
    const decision = payload.verification;

    // Decision not ready yet
    if (!decision) {
      return NextResponse.json({
        synced: false,
        signerStatus: signer.kyc_status,
        decisionReady: false,
      });
    }

    const normalizedStatus = String(decision.status || "").toLowerCase();
    const normalizedCode = String(decision.code || "");
    const approved = normalizedStatus === "approved" || normalizedCode === "9001";

    const nextSignerStatus = approved ? "approved" : "declined";
    const { error: updateSignerError } = await supabase
      .from("session_signers")
      .update({ kyc_status: nextSignerStatus })
      .eq("id", signer.id);

    if (updateSignerError) {
      return NextResponse.json(
        { error: "Erreur mise à jour signer", details: updateSignerError.message },
        { status: 500 }
      );
    }

    const { data: signerFull } = await supabase
      .from("session_signers")
      .select("name, email")
      .eq("id", signer.id)
      .single();

    const { ipAddress, userAgent } = extractRequestMeta(request.headers);
    await logAuditEvent(supabase, {
      sessionId: signer.session_id,
      eventType: approved ? "kyc_approved" : "kyc_declined",
      actorType: "signer",
      actorId: signer.id,
      actorName: signerFull?.name ?? null,
      actorEmail: signerFull?.email ?? null,
      sessionSignerId: signer.id,
      metadata: {
        veriff_session_id: signer.veriff_session_id,
        veriff_status: decision.status ?? null,
        veriff_code: decision.code ?? null,
        approved,
        source: "sync_decision",
      },
      ipAddress,
      userAgent,
    });

    let sessionStatus: string | null = null;
    if (approved) {
      const { data: allSigners } = await supabase
        .from("session_signers")
        .select("kyc_status")
        .eq("session_id", signer.session_id);

      const allApproved = allSigners?.every((s) => s.kyc_status === "approved");
      if (allApproved) {
        await supabase
          .from("notarization_sessions")
          .update({ status: "waiting_notary", updated_at: new Date().toISOString() })
          .eq("id", signer.session_id);
        sessionStatus = "waiting_notary";

        await logAuditEvent(supabase, {
          sessionId: signer.session_id,
          eventType: "session_started",
          actorType: "system",
          metadata: { reason: "all_kyc_approved" },
        });
      }
    }

    return NextResponse.json({
      synced: true,
      decisionReady: true,
      signerStatus: nextSignerStatus,
      sessionStatus,
    });
  } catch (err) {
    console.error("[KYC sync] error", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
