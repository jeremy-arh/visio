import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyToken } from "@/lib/jwt";
import { advanceSigningWorkflow, getExpectedSignature } from "@/lib/signing-workflow";
import { trySyncNotarySignatureFromYousign } from "@/lib/yousign-notary-sync";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const token = request.nextUrl.searchParams.get("token") || "";
    if (!token) {
      return NextResponse.json({ error: "token requis" }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: "token invalide" }, { status: 403 });
    }
    if (payload.sessionId && payload.sessionId !== sessionId) {
      return NextResponse.json({ error: "token invalide" }, { status: 403 });
    }
    if (!payload.sessionId && payload.role !== "notary") {
      return NextResponse.json({ error: "token invalide" }, { status: 403 });
    }

    const supabase = createServiceClient();
    if (!payload.sessionId && payload.role === "notary" && payload.notaryId) {
      const { data: owner } = await supabase
        .from("notarization_sessions")
        .select("notary_id")
        .eq("id", sessionId)
        .single();
      if (!owner || owner.notary_id !== payload.notaryId) {
        return NextResponse.json({ error: "token invalide" }, { status: 403 });
      }
    }
    let context = await advanceSigningWorkflow(supabase, sessionId);
    if (!context) {
      return NextResponse.json({ error: "Session introuvable" }, { status: 404 });
    }

    // Rattrapage : YouSign peut être à "signed" alors que la DB est encore "notary" (poll notaire manqué).
    let expected = getExpectedSignature(context.signatures);
    if (expected?.role === "notary") {
      try {
        const synced = await trySyncNotarySignatureFromYousign(supabase, context);
        if (synced) {
          context = (await advanceSigningWorkflow(supabase, sessionId)) ?? context;
          expected = getExpectedSignature(context.signatures);
        }
      } catch (syncErr) {
        console.warn("[signing-state] notary yousign sync skipped:", syncErr);
      }
    }

    if (context.session.signing_flow_status === "idle") {
      expected = null;
    }
    const signerById = new Map(context.signers.map((s) => [s.id, s]));
    const expectedSigner = expected?.session_signer_id
      ? signerById.get(expected.session_signer_id) || null
      : null;

    return NextResponse.json(
      {
        sessionId,
        sessionStatus: context.session.status,
        signingFlowStatus: context.session.signing_flow_status,
        currentDocument: context.currentDocument,
      documents: context.documents,
      expectedActor: expected
        ? {
            role: expected.role,
            sessionSignerId: expected.session_signer_id,
            signerName: expectedSigner?.name || null,
            notaryId: expected.notary_id,
          }
        : null,
      signatures: context.signatures.map((sig) => ({
        ...sig,
        signerName: sig.session_signer_id
          ? (signerById.get(sig.session_signer_id)?.name ?? null)
          : null,
      })),
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        Pragma: "no-cache",
      },
    }
    );
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error("[signing-state] error", details);
    return NextResponse.json({ error: "Erreur serveur", details }, { status: 500 });
  }
}
