import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createServiceClient } from "@/lib/supabase";
import {
  advanceSigningWorkflow,
  getExpectedSignature,
  type SignatureRow,
  type SigningContext,
} from "@/lib/signing-workflow";

const sanitizeYousignBase = (raw?: string) => {
  const value = (raw || "").trim().replace(/\/+$/, "");
  if (!value) return "https://api-sandbox.yousign.app/v3";
  // Legacy endpoint alias often configured by mistake.
  if (value.includes("staging-api.yousign.app")) return "https://api-sandbox.yousign.app/v3";
  return value;
};

const YOUSIGN_BASE = sanitizeYousignBase(process.env.YOUSIGN_API_URL);
const IS_YOUSIGN_SANDBOX = YOUSIGN_BASE.includes("api-sandbox.yousign.app");

const buildEmbedUrl = (signatureLink: string) => {
  try {
    const url = new URL(signatureLink);
    // In sandbox, bypass iframe domain checks for local/dev and custom domains.
    if (IS_YOUSIGN_SANDBOX) {
      url.searchParams.set("disable_domain_validation", "true");
    }
    return url.toString();
  } catch {
    return signatureLink;
  }
};

async function yousignFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const apiKey = process.env.YOUSIGN_API_KEY;
  if (!apiKey) throw new Error("YOUSIGN_API_KEY manquant");
  return fetch(`${YOUSIGN_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
}

async function yousignJson<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await yousignFetch(path, options);
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    console.error(`[Yousign] ${options.method || "GET"} ${path} -> ${res.status}`, body);
    throw new Error(`Yousign ${res.status}: ${JSON.stringify(body)}`);
  }
  return body as T;
}

interface YousignSignatureRequest {
  id: string;
}

interface YousignDocument {
  id: string;
}

interface YousignSigner {
  id: string;
  status?: string;
  signature_link?: string;
}

async function initYousign(params: {
  supabase: ReturnType<typeof createServiceClient>;
  orderId: string;
  documentUrl: string;
  context: SigningContext;
}): Promise<{ signatureRequestId: string; signerMapBySignatureRowId: Record<string, string> }> {
  const { supabase, orderId, documentUrl, context } = params;
  const customExperienceId = process.env.YOUSIGN_CUSTOM_EXPERIENCE_ID?.trim();

  const signatureRequest = await yousignJson<YousignSignatureRequest>(
    "/signature_requests",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `Notarisation ${orderId}`,
        delivery_mode: "none",
        ordered_signers: true,
        timezone: "Europe/Paris",
        ...(customExperienceId ? { custom_experience_id: customExperienceId } : {}),
      }),
    }
  );

  const docResponse = await fetch(documentUrl, { cache: "no-store" });
  if (!docResponse.ok) {
    throw new Error(`Impossible de telecharger le document: ${docResponse.status}`);
  }
  const docBuffer = await docResponse.arrayBuffer();
  const fileName = documentUrl.split("/").pop()?.split("?")[0] || "document.pdf";

  const formData = new FormData();
  formData.append("file", new Blob([docBuffer], { type: "application/pdf" }), fileName);
  formData.append("nature", "signable_document");
  formData.append("parse_anchors", "false");

  const uploadRes = await yousignFetch(
    `/signature_requests/${signatureRequest.id}/documents`,
    { method: "POST", body: formData }
  );
  const docText = await uploadRes.text();
  let uploadedDoc: YousignDocument;
  try {
    uploadedDoc = JSON.parse(docText);
  } catch {
    throw new Error(`Yousign doc upload failed: ${docText}`);
  }
  if (!uploadRes.ok) throw new Error(`Yousign doc upload ${uploadRes.status}: ${docText}`);

  const signerMapBySignatureRowId: Record<string, string> = {};
  const toNames = (fullName: string) => {
    const parts = fullName.trim().split(/\s+/);
    return {
      firstName: parts[0] || "Signataire",
      lastName: parts.slice(1).join(" ") || ".",
    };
  };

  const signaturesInOrder = [...context.signatures].sort(
    (a, b) => a.signature_order - b.signature_order
  );
  const signerById = new Map(context.signers.map((s) => [s.id, s]));
  for (const signatureRow of signaturesInOrder) {
    const actor =
      signatureRow.role === "signer"
        ? signatureRow.session_signer_id
          ? signerById.get(signatureRow.session_signer_id) || null
          : null
        : context.notary;

    if (!actor?.email) {
      throw new Error(
        `Acteur de signature introuvable pour la ligne ${signatureRow.id} (${signatureRow.role})`
      );
    }

    const { firstName, lastName } = toNames(actor.name || "Signataire");
    const ysSigner = await yousignJson<YousignSigner>(
      `/signature_requests/${signatureRequest.id}/signers`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          info: {
            first_name: firstName,
            last_name: lastName,
            email: actor.email,
            locale: "fr",
          },
          signature_level: "electronic_signature",
          signature_authentication_mode: "no_otp",
          fields: [
            {
              document_id: uploadedDoc.id,
              type: "signature",
              page: 1,
              x: 77,
              y: 700,
              width: 200,
              height: 100,
            },
          ],
        }),
      }
    );
    signerMapBySignatureRowId[signatureRow.id] = ysSigner.id;
  }

  await yousignJson(`/signature_requests/${signatureRequest.id}/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  if (!context.currentDocument) {
    throw new Error("Aucun document courant à initialiser");
  }

  await supabase
    .from("session_documents")
    .update({
      yousign_signature_request_id: signatureRequest.id,
      started_at: context.currentDocument.started_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", context.currentDocument.id);

  for (const [signatureRowId, ysSignerId] of Object.entries(signerMapBySignatureRowId)) {
    await supabase
      .from("session_document_signatures")
      .update({
        yousign_signer_id: ysSignerId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", signatureRowId);
  }

  return { signatureRequestId: signatureRequest.id, signerMapBySignatureRowId };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    if (!process.env.YOUSIGN_API_KEY) {
      return NextResponse.json({ error: "YOUSIGN_API_KEY non configuree" }, { status: 500 });
    }

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
    if (!context || !context.session) {
      return NextResponse.json({ error: "Session introuvable" }, { status: 404 });
    }
    if (context.session.notary_id && !notaryIds.has(context.session.notary_id)) {
      return NextResponse.json({ error: "Session non assignee a ce notaire" }, { status: 403 });
    }
    if (!context.currentDocument) {
      return NextResponse.json(
        { completed: true, message: "Tous les documents sont finalisés." },
        { status: 200 }
      );
    }

    const expected = getExpectedSignature(context.signatures);
    if (!expected || expected.role !== "notary") {
      return NextResponse.json(
        {
          waiting: true,
          code: "waiting_for_signers",
          message: "En attente de la signature de tous les signataires.",
        },
        { status: 409 }
      );
    }

    if (!expected.notary_id || !notaryIds.has(expected.notary_id)) {
      return NextResponse.json({ error: "Notaire courant non autorisé pour cette étape" }, { status: 403 });
    }

    let signatureRequestId = context.currentDocument.yousign_signature_request_id;
    let expectedSignatureRow: SignatureRow = expected;

    if (!signatureRequestId || !expectedSignatureRow.yousign_signer_id) {
      if (!context.currentDocument.source_url) {
        return NextResponse.json(
          { error: "Aucune source document disponible pour la signature" },
          { status: 409 }
        );
      }

      const init = await initYousign({
        supabase,
        orderId: context.session.order_id,
        documentUrl: context.currentDocument.source_url,
        context,
      });
      signatureRequestId = init.signatureRequestId;

      const { data: refreshedExpected } = await supabase
        .from("session_document_signatures")
        .select(
          "id, session_document_id, session_signer_id, role, notary_id, signature_order, status, yousign_signer_id, signed_at"
        )
        .eq("id", expected.id)
        .single();

      if (refreshedExpected) {
        expectedSignatureRow = refreshedExpected as SignatureRow;
      }
    }

    if (!signatureRequestId || !expectedSignatureRow.yousign_signer_id) {
      return NextResponse.json(
        { error: "Impossible d'initialiser la signature notaire courante" },
        { status: 409 }
      );
    }

    let signerData = await yousignJson<YousignSigner>(
      `/signature_requests/${signatureRequestId}/signers/${expectedSignatureRow.yousign_signer_id}`
    );

    if (!signerData.signature_link) {
      try {
        const byId = await yousignJson<YousignSigner>(
          `/signers/${expectedSignatureRow.yousign_signer_id}`
        );
        if (byId.signature_link) {
          signerData = { ...signerData, ...byId };
        }
      } catch {
        // Endpoint alternatif indisponible: on conserve la réponse initiale.
      }
    }

    if (!signerData.signature_link) {
      const normalizedSignerStatus = String(signerData.status || "").toLowerCase();
      if (normalizedSignerStatus === "signed") {
        await supabase
          .from("session_document_signatures")
          .update({
            status: "signed",
            signed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", expectedSignatureRow.id);

        const advanced = await advanceSigningWorkflow(supabase, sessionId);
        const expectedAfterAdvance = getExpectedSignature(advanced?.signatures || []);

        return NextResponse.json({
          signed: true,
          signerStatus: signerData.status || "signed",
          message: "Signature et tampon notaire finalisés pour ce document.",
          nextActor: expectedAfterAdvance
            ? {
                role: expectedAfterAdvance.role,
                sessionSignerId: expectedAfterAdvance.session_signer_id,
                notaryId: expectedAfterAdvance.notary_id,
              }
            : null,
        });
      }

      return NextResponse.json(
        {
          waiting: true,
          code: "link_not_ready",
          error: "signature_link absent dans la reponse Yousign",
          signerStatus: signerData.status || null,
        },
        { status: 409 }
      );
    }

    await supabase
      .from("session_document_signatures")
      .update({
        status: "notified",
        updated_at: new Date().toISOString(),
      })
      .eq("id", expectedSignatureRow.id)
      .neq("status", "signed");

    return NextResponse.json({
      embedUrl: buildEmbedUrl(signerData.signature_link),
      documentId: context.currentDocument.id,
      documentLabel: context.currentDocument.label,
      documentOrder: context.currentDocument.document_order,
      stage: "notary_signing_and_stamping",
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Yousign] embed route error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
