import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyToken } from "@/lib/jwt";
import { advanceSigningWorkflow, getExpectedSignature, loadSigningContext } from "@/lib/signing-workflow";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const { token, status } = (await request.json()) as {
      token?: string;
      status?: "signed" | "declined";
    };

    if (!token) {
      return NextResponse.json({ error: "token requis" }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload || payload.sessionId !== sessionId) {
      return NextResponse.json({ error: "token invalide" }, { status: 403 });
    }

    const supabase = createServiceClient();
    const context = await loadSigningContext(supabase, sessionId);
    if (!context || !context.currentDocument) {
      return NextResponse.json({ error: "Session introuvable" }, { status: 404 });
    }

    const expected = getExpectedSignature(context.signatures);
    if (expected && status) {
      if (payload.role === "signer" && expected.role === "signer" && payload.signerId) {
        if (expected.session_signer_id !== payload.signerId) {
          return NextResponse.json({ error: "Ce signataire n'est pas autorisé à avancer maintenant" }, { status: 409 });
        }
        await supabase
          .from("session_document_signatures")
          .update({
            status,
            signed_at: status === "signed" ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", expected.id);
      }

      if (payload.role === "notary" && expected.role === "notary" && payload.notaryId) {
        if (expected.notary_id !== payload.notaryId) {
          return NextResponse.json({ error: "Ce notaire n'est pas autorisé à avancer maintenant" }, { status: 409 });
        }
        await supabase
          .from("session_document_signatures")
          .update({
            status,
            signed_at: status === "signed" ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", expected.id);
      }
    }

    const advanced = await advanceSigningWorkflow(supabase, sessionId);
    if (!advanced) {
      return NextResponse.json({ error: "Session introuvable" }, { status: 404 });
    }

    const nextExpected = getExpectedSignature(advanced.signatures);
    return NextResponse.json({
      sessionId,
      sessionStatus: advanced.session.status,
      signingFlowStatus: advanced.session.signing_flow_status,
      currentDocument: advanced.currentDocument,
      expectedActor: nextExpected
        ? {
            role: nextExpected.role,
            sessionSignerId: nextExpected.session_signer_id,
            notaryId: nextExpected.notary_id,
          }
        : null,
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error("[advance-signing] error", details);
    return NextResponse.json({ error: "Erreur serveur", details }, { status: 500 });
  }
}
