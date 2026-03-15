import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyToken } from "@/lib/jwt";
import { advanceSigningWorkflow, getExpectedSignature, loadSigningContext } from "@/lib/signing-workflow";

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
    if (!payload || payload.sessionId !== sessionId) {
      return NextResponse.json({ error: "token invalide" }, { status: 403 });
    }

    const supabase = createServiceClient();
    const context = await advanceSigningWorkflow(supabase, sessionId);
    if (!context) {
      return NextResponse.json({ error: "Session introuvable" }, { status: 404 });
    }

    const expected = getExpectedSignature(context.signatures);
    const signerById = new Map(context.signers.map((s) => [s.id, s]));
    const expectedSigner = expected?.session_signer_id
      ? signerById.get(expected.session_signer_id) || null
      : null;

    return NextResponse.json({
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
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error("[signing-state] error", details);
    return NextResponse.json({ error: "Erreur serveur", details }, { status: 500 });
  }
}
