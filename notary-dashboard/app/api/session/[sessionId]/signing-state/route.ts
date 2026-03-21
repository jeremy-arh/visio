import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createServiceClient } from "@/lib/supabase";
import { verifyRecordingToken } from "@/lib/recording-token";
import { advanceSigningWorkflow, getExpectedSignature } from "@/lib/signing-workflow";
import { isNotaryUserWithAuthLookup } from "@/lib/notary-auth-server";

/** Vérifie si une URL signée Supabase expire dans moins de minSeconds. */
function isUrlExpiringSoon(url: string, minSeconds = 3600): boolean {
  const tokenMatch = url.match(/[?&]token=([^&]+)/);
  if (!tokenMatch) return true;
  try {
    const payload = JSON.parse(atob(tokenMatch[1].split(".")[1] || "{}"));
    const exp = payload.exp as number | undefined;
    if (!exp) return true;
    return exp < Math.floor(Date.now() / 1000) + minSeconds;
  } catch {
    return true;
  }
}

/**
 * Génère une URL signée fraîche (24h) uniquement si l'URL expire bientôt.
 * Évite les refresh inutiles à chaque requête.
 */
async function refreshSourceUrl(
  supabase: ReturnType<typeof createServiceClient>,
  url: string | null | undefined,
  documentId?: string | null
): Promise<string | null | undefined> {
  if (!url) return url;
  const supabaseBase = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  if (!supabaseBase || !url.startsWith(supabaseBase)) return url;
  if (!isUrlExpiringSoon(url)) return url;

  const match = url.match(/\/storage\/v1\/object\/sign\/([^/?]+)\/(.+?)(\?|$)/);
  if (!match) return url;
  const bucket = match[1];
  const objectPath = match[2];
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(objectPath, 86400);
  if (error || !data?.signedUrl) return url;
  if (documentId) {
    await supabase
      .from("session_documents")
      .update({ source_url: data.signedUrl, updated_at: new Date().toISOString() })
      .eq("id", documentId);
  }
  return data.signedUrl;
}

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

    const recordingToken = request.nextUrl.searchParams.get("recordingToken");
    let notaryIds = new Set<string>();

    if (recordingToken) {
      const payload = await verifyRecordingToken(recordingToken);
      if (!payload || payload.sessionId !== sessionId) {
        console.warn("[SIGNING-STATE] ✗ Invalid recording token");
        return NextResponse.json({ error: "Token enregistrement invalide" }, { status: 401 });
      }
    } else {
      const {
        data: { user },
      } = await authSupabase.auth.getUser();
      if (!user?.email) {
        console.warn("[SIGNING-STATE] ✗ No user session");
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
      }
      if (!(await isNotaryUserWithAuthLookup(user))) {
        console.warn("[SIGNING-STATE] ✗ Access denied, not a notary session");
        return NextResponse.json({ error: "Acces reserve aux notaires" }, { status: 403 });
      }
      const supabase = createServiceClient();
      const [{ data: notariesPlural }, { data: notarySingular }] = await Promise.all([
        supabase.from("notaries").select("id, email").eq("email", user.email),
        supabase.from("notary").select("id, email, user_id").or(`email.eq.${user.email},user_id.eq.${user.id}`),
      ]);
      notaryIds = new Set([
        ...(notariesPlural || []).map((n) => n.id),
        ...(notarySingular || []).map((n) => n.id),
      ]);
      if (!notaryIds.size) {
        return NextResponse.json({ error: "Notary not authorized" }, { status: 403 });
      }
    }

    const supabase = createServiceClient();

    // notarization_sessions.notary_id référence la table "notaries" (contrainte FK).
    // Avec recording token, on ne fait pas d'auto-assign.
    let assignableNotaryIds: string[] = [];
    if (!recordingToken) {
      const { data: { user } } = await authSupabase.auth.getUser();
      if (user?.email) {
        const { data: notaries } = await supabase.from("notaries").select("id").eq("email", user.email);
        assignableNotaryIds = (notaries || []).map((n) => n.id);
      }
    }

    // Si la session n'a pas de notary_id, on assigne le notaire connecté immédiatement.
    // Cela empêche advanceSigningWorkflow de traiter la session comme "sans notaire requis"
    // et de la compléter prématurément dès que les signataires ont signé.
    const { data: sessionCheck } = await supabase
      .from("notarization_sessions")
      .select("notary_id")
      .eq("id", sessionId)
      .single();

    if (sessionCheck && !sessionCheck.notary_id && assignableNotaryIds.length > 0) {
      await supabase
        .from("notarization_sessions")
        .update({ notary_id: assignableNotaryIds[0], updated_at: new Date().toISOString() })
        .eq("id", sessionId);
    }

    const context = await advanceSigningWorkflow(supabase, sessionId);
    if (!context) {
      console.error("[SIGNING-STATE] ✗ Session not found:", sessionId);
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (!recordingToken && context.session.notary_id && !notaryIds.has(context.session.notary_id)) {
      console.warn("[SIGNING-STATE] ✗ Session not assigned to this notary:", context.session.notary_id);
      return NextResponse.json({ error: "Session not assigned to this notary" }, { status: 403 });
    }

    let expected = getExpectedSignature(context.signatures);
    if (context.session.signing_flow_status === "idle") {
      expected = null;
    }
    const signerById = new Map(context.signers.map((s) => [s.id, s]));

    // Enrichir chaque signer avec le signed_at réel depuis session_document_signatures
    const signersWithStatus = context.signers.map((signer) => {
      const sig = context.signatures.find(
        (s) => s.session_signer_id === signer.id && s.role === "signer"
      );
      return {
        ...signer,
        signed_at: sig?.signed_at ?? signer.signed_at ?? null,
      };
    });

    // Rafraîchir la source_url du document courant si elle est expirée
    let currentDocumentToReturn = context.currentDocument;
    if (currentDocumentToReturn?.source_url) {
      const freshUrl = await refreshSourceUrl(supabase, currentDocumentToReturn.source_url, currentDocumentToReturn.id);
      if (freshUrl !== currentDocumentToReturn.source_url) {
        currentDocumentToReturn = { ...currentDocumentToReturn, source_url: freshUrl ?? null };
      }
    }

    return NextResponse.json({
      sessionId,
      sessionStatus: context.session.status,
      signingFlowStatus: context.session.signing_flow_status,
      currentDocument: currentDocumentToReturn,
      documents: context.documents,
      signers: signersWithStatus,
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
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("[SIGNING-STATE] ✗ UNHANDLED ERROR:", details);
    if (stack) console.error("[SIGNING-STATE] stack:", stack);
    return NextResponse.json({ error: "Server error", details }, { status: 500 });
  }
}
