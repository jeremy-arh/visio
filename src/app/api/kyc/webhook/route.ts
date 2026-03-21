import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { logAuditEvent } from "@/lib/audit";
import crypto from "crypto";

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get("x-hmac-signature") || "";
    const webhookSecret = process.env.VERIFF_WEBHOOK_SECRET;

    if (webhookSecret) {
      const expectedSig = crypto
        .createHmac("sha256", webhookSecret)
        .update(body)
        .digest("hex");
      if (signature !== expectedSig) {
        return NextResponse.json({ error: "Signature invalide" }, { status: 401 });
      }
    }

    const data = JSON.parse(body);
    const verification = data?.verification;
    const verificationId = verification?.id as string | undefined;
    const status = verification?.status;
    const code = verification?.code;
    const vendorData = verification?.vendorData || verification?.endUserId;
    const supabase = createServiceClient();

    // Veriff decision payloads can vary by version:
    // - verification.status can be approved/declined/resubmission_requested
    // - verification.code can be 9001 for approved
    const normalizedStatus = String(status || "").toLowerCase();
    const normalizedCode = String(code || "");
    const approved = normalizedStatus === "approved" || normalizedCode === "9001";

    let signer:
      | {
          id: string;
          session_id: string;
        }
      | null = null;

    if (vendorData) {
      const { data: signerFromVendor } = await supabase
        .from("session_signers")
        .select("id, session_id")
        .eq("id", vendorData)
        .single();
      signer = signerFromVendor || null;
    }

    // Fallback: if vendorData is missing/unexpected, resolve via Veriff session id
    if (!signer && verificationId) {
      const { data: signerFromVeriff } = await supabase
        .from("session_signers")
        .select("id, session_id")
        .eq("veriff_session_id", verificationId)
        .single();
      signer = signerFromVeriff || null;
    }

    if (!signer) {
      console.warn("[KYC webhook] signer not found", {
        vendorData,
        verificationId,
        status,
        code,
      });
      return NextResponse.json({ received: true });
    }

    console.log("[KYC webhook] signer resolved", {
      signerId: signer.id,
      sessionId: signer.session_id,
      vendorData,
      verificationId,
      approved,
    });

    const { error: signerUpdateError } = await supabase
      .from("session_signers")
      .update({ kyc_status: approved ? "approved" : "declined" })
      .eq("id", signer.id);

    if (signerUpdateError) {
      console.error("[KYC webhook] signer update failed", signerUpdateError);
      return NextResponse.json({ error: "Signer update failed" }, { status: 500 });
    }

    // Récupérer les infos du signer pour l'audit
    const { data: signerInfo } = await supabase
      .from("session_signers")
      .select("name, email")
      .eq("id", signer.id)
      .single();

    const kycEventType = approved ? "kyc_approved" : (normalizedStatus === "resubmission_requested" ? "kyc_resubmission_requested" : "kyc_declined");
    await logAuditEvent(supabase, {
      sessionId: signer.session_id,
      eventType: kycEventType,
      actorType: "signer",
      actorId: signer.id,
      actorName: signerInfo?.name ?? null,
      actorEmail: signerInfo?.email ?? null,
      sessionSignerId: signer.id,
      metadata: {
        veriff_session_id: verificationId ?? null,
        veriff_status: status ?? null,
        veriff_code: code ?? null,
        approved,
      },
    });

    if (approved) {
      const { data: signers } = await supabase
        .from("session_signers")
        .select("kyc_status")
        .eq("session_id", signer.session_id);

      const allApproved = signers?.every((s) => s.kyc_status === "approved");
      if (allApproved) {
        await supabase
          .from("notarization_sessions")
          .update({ status: "waiting_notary", updated_at: new Date().toISOString() })
          .eq("id", signer.session_id);

        await logAuditEvent(supabase, {
          sessionId: signer.session_id,
          eventType: "session_started",
          actorType: "system",
          metadata: { reason: "all_kyc_approved" },
        });
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Erreur" }, { status: 500 });
  }
}
