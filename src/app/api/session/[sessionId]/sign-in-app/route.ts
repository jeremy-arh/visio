import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyToken } from "@/lib/jwt";
import { advanceSigningWorkflow, getExpectedSignature } from "@/lib/signing-workflow";
import { logAuditEvent } from "@/lib/audit";

const YOUSIGN_BASE = (process.env.YOUSIGN_API_URL || "https://api-sandbox.yousign.app/v3")
  .trim()
  .replace(/\/+$/, "");

async function archiveSignedDocumentBackground(
  supabase: ReturnType<typeof createServiceClient>,
  signatureRequestId: string,
  documentId: string,
  sessionId: string
): Promise<void> {
  try {
    const apiKey = process.env.YOUSIGN_API_KEY;
    if (!apiKey) return;
    const docsRes = await fetch(`${YOUSIGN_BASE}/signature_requests/${signatureRequestId}/documents`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    if (!docsRes.ok) return;
    const docs = await docsRes.json() as Array<{ id: string; nature: string }>;
    const mainDoc = docs.find((d) => d.nature === "signable_document") ?? docs[0];
    if (!mainDoc?.id) return;

    const dlRes = await fetch(
      `${YOUSIGN_BASE}/signature_requests/${signatureRequestId}/documents/${mainDoc.id}/download`,
      { headers: { Authorization: `Bearer ${apiKey}` }, cache: "no-store" }
    );
    if (!dlRes.ok) return;
    const pdfBytes = await dlRes.arrayBuffer();

    const storagePath = `signed-intermediate/${sessionId}/${documentId}_${Date.now()}.pdf`;
    const { data: uploadData, error } = await supabase.storage
      .from("form-documents")
      .upload(storagePath, new Blob([pdfBytes], { type: "application/pdf" }), { upsert: true });
    if (error || !uploadData) return;

    const { data: signedUrlData } = await supabase.storage
      .from("form-documents")
      .createSignedUrl(uploadData.path, 86400 * 30);
    if (!signedUrlData?.signedUrl) return;

    await supabase
      .from("session_documents")
      .update({ source_url: signedUrlData.signedUrl, updated_at: new Date().toISOString() })
      .eq("id", documentId);
    console.log("[SIGN-IN-APP] ✓ source_url archivé pour le prochain signataire");
  } catch (err) {
    console.warn("[SIGN-IN-APP] archive error (non-fatal):", err);
  }
}

/**
 * POST /api/session/[sessionId]/sign-in-app
 *
 * Appelé dès que YouSign envoie le postMessage "signer:signed" dans l'iframe.
 * Ne re-vérifie PAS auprès de l'API YouSign (race condition : le statut n'est
 * pas encore "signed" côté YouSign quelques ms après le postMessage).
 * On fait confiance à l'event YouSign et on met à jour la DB directement.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const body = await request.json() as { token: string; signerId: string };
    const { token, signerId } = body;

    if (!token || !signerId) {
      return NextResponse.json({ error: "token et signerId requis" }, { status: 400 });
    }

    const payload = await verifyToken(token);
    if (!payload || payload.role !== "signer") {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }
    if (payload.sessionId !== sessionId || payload.signerId !== signerId) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }

    const supabase = createServiceClient();

    const { data: sessionRow } = await supabase
      .from("notarization_sessions")
      .select("signing_flow_status")
      .eq("id", sessionId)
      .single();
    if (sessionRow?.signing_flow_status === "idle") {
      return NextResponse.json(
        {
          error: "The notary has not started the signing flow yet.",
          code: "signing_flow_not_started",
        },
        { status: 403 }
      );
    }

    // Trouver la ligne de signature du signataire courant
    const { data: sigRow } = await supabase
      .from("session_document_signatures")
      .select("id, status, session_document_id, yousign_signer_id")
      .eq("session_signer_id", signerId)
      .eq("status", "notified")
      .order("signature_order", { ascending: true })
      .limit(1)
      .single();

    // Fallback : chercher aussi les lignes "pending" avec yousign_signer_id
    const sigRowFinal = sigRow ?? (await supabase
      .from("session_document_signatures")
      .select("id, status, session_document_id, yousign_signer_id")
      .eq("session_signer_id", signerId)
      .neq("status", "signed")
      .order("signature_order", { ascending: true })
      .limit(1)
      .single()).data;

    if (!sigRowFinal) {
      // Déjà signé ou introuvable — workflow déjà avancé
      await advanceSigningWorkflow(supabase, sessionId);
      return NextResponse.json({ signed: true, message: "Déjà signé ou signature introuvable" });
    }

    if (sigRowFinal.status === "signed") {
      return NextResponse.json({ signed: true, message: "Déjà signé" });
    }

    const signedAt = new Date().toISOString();

    // Mise à jour immédiate en DB — déclenche le realtime sur signer 2 instantanément
    await supabase
      .from("session_document_signatures")
      .update({ status: "signed", signed_at: signedAt, updated_at: signedAt })
      .eq("id", sigRowFinal.id)
      .neq("status", "signed");

    console.log("[SIGN-IN-APP] ✓ Signature enregistrée en DB pour signer", signerId);

    // Audit
    const { data: signerInfo } = await supabase
      .from("session_signers")
      .select("name, email")
      .eq("id", signerId)
      .single();

    const { data: docInfo } = await supabase
      .from("session_documents")
      .select("id, label, yousign_signature_request_id")
      .eq("id", sigRowFinal.session_document_id)
      .single();

    await logAuditEvent(supabase, {
      sessionId,
      eventType: "signer_signed",
      actorType: "signer",
      actorId: signerId,
      actorName: (signerInfo as { name?: string } | null)?.name ?? null,
      actorEmail: (signerInfo as { email?: string } | null)?.email ?? null,
      documentId: sigRowFinal.session_document_id ?? null,
      documentLabel: (docInfo as { label?: string } | null)?.label ?? null,
      metadata: { yousign_signer_id: sigRowFinal.yousign_signer_id ?? null, source: "postMessage" },
    });

    // Avancer le workflow (met à jour notarization_sessions → déclenche realtime notaire)
    await advanceSigningWorkflow(supabase, sessionId);

    // Archiver le PDF signé en arrière-plan pour le prochain signataire
    const reqId = (docInfo as { yousign_signature_request_id?: string | null } | null)?.yousign_signature_request_id ?? null;
    if (reqId) {
      archiveSignedDocumentBackground(supabase, reqId, sigRowFinal.session_document_id, sessionId);
    }

    return NextResponse.json({ signed: true, message: "Signature enregistrée" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[SIGN-IN-APP] error:", msg);
    return NextResponse.json({ error: "Erreur serveur", details: msg }, { status: 500 });
  }
}
