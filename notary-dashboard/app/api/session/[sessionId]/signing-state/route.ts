import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createServiceClient } from "@/lib/supabase";
import { advanceSigningWorkflow, getExpectedSignature } from "@/lib/signing-workflow";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    const authResponse = NextResponse.next();
    const authSupabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              authResponse.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    const {
      data: { user },
    } = await authSupabase.auth.getUser();
    if (!user?.email) {
      return NextResponse.json({ error: "Non authentifie" }, { status: 401 });
    }
    const role = (user.user_metadata?.role as string | undefined)?.toLowerCase();
    if (role !== "notary") {
      return NextResponse.json({ error: "Acces reserve aux notaires" }, { status: 403 });
    }

    const supabase = createServiceClient();
    const [{ data: notariesPlural }, { data: notarySingular }] = await Promise.all([
      supabase.from("notaries").select("id, email").eq("email", user.email),
      supabase.from("notary").select("id, email, user_id").or(`email.eq.${user.email},user_id.eq.${user.id}`),
    ]);
    const notaryIds = new Set([
      ...(notariesPlural || []).map((n) => n.id),
      ...(notarySingular || []).map((n) => n.id),
    ]);
    if (!notaryIds.size) {
      return NextResponse.json({ error: "Notaire non autorise" }, { status: 403 });
    }

    const context = await advanceSigningWorkflow(supabase, sessionId);
    if (!context) {
      return NextResponse.json({ error: "Session introuvable" }, { status: 404 });
    }
    if (context.session.notary_id && !notaryIds.has(context.session.notary_id)) {
      return NextResponse.json({ error: "Session non assignee a ce notaire" }, { status: 403 });
    }

    const expected = getExpectedSignature(context.signatures);
    const signerById = new Map(context.signers.map((s) => [s.id, s]));

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
            signerName: expected.session_signer_id
              ? signerById.get(expected.session_signer_id)?.name || null
              : null,
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
    console.error("[notary signing-state] error", details);
    return NextResponse.json({ error: "Erreur serveur", details }, { status: 500 });
  }
}
