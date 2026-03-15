import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyToken } from "@/lib/jwt";

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

async function yousignFetch(path: string, options: RequestInit = {}): Promise<Response> {
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

async function yousignJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await yousignFetch(path, options);
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
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
  signature_link?: string;
}

async function initYousign(params: {
  supabase: ReturnType<typeof createServiceClient>;
  sessionId: string;
  orderId: string;
  documentUrl: string;
  signers: { id: string; name: string; email: string }[];
}): Promise<{ signatureRequestId: string; signerMap: Record<string, string> }> {
  const { supabase, sessionId, orderId, documentUrl, signers } = params;
  const customExperienceId = process.env.YOUSIGN_CUSTOM_EXPERIENCE_ID?.trim();

  const signatureRequest = await yousignJson<YousignSignatureRequest>("/signature_requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `Notarisation ${orderId}`,
      delivery_mode: "none",
      ordered_signers: false,
      timezone: "Europe/Paris",
      ...(customExperienceId ? { custom_experience_id: customExperienceId } : {}),
    }),
  });

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

  const signerMap: Record<string, string> = {};
  const toNames = (fullName: string) => {
    const parts = fullName.trim().split(/\s+/);
    return {
      firstName: parts[0] || "Signataire",
      lastName: parts.slice(1).join(" ") || ".",
    };
  };

  for (const signer of signers) {
    const { firstName, lastName } = toNames(signer.name);
    const ysSigner = await yousignJson<YousignSigner>(
      `/signature_requests/${signatureRequest.id}/signers`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          info: {
            first_name: firstName,
            last_name: lastName,
            email: signer.email,
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
    signerMap[signer.id] = ysSigner.id;
  }

  await yousignJson(`/signature_requests/${signatureRequest.id}/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  await supabase
    .from("notarization_sessions")
    .update({ yousign_signature_request_id: signatureRequest.id })
    .eq("id", sessionId);

  for (const [sessionSignerId, ysSignerId] of Object.entries(signerMap)) {
    await supabase
      .from("session_signers")
      .update({ yousign_signer_id: ysSignerId })
      .eq("id", sessionSignerId);
  }

  return { signatureRequestId: signatureRequest.id, signerMap };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const signerId = request.nextUrl.searchParams.get("signerId");
    if (!signerId) {
      return NextResponse.json({ error: "signerId manquant" }, { status: 400 });
    }
    if (!process.env.YOUSIGN_API_KEY) {
      return NextResponse.json({ error: "YOUSIGN_API_KEY non configuree" }, { status: 500 });
    }

    const token =
      request.nextUrl.searchParams.get("token") ||
      request.cookies.get("session_token")?.value ||
      "";
    const payload = token ? await verifyToken(token) : null;
    if (!payload || payload.role !== "signer") {
      return NextResponse.json({ error: "Non authentifie" }, { status: 401 });
    }
    if (payload.sessionId !== sessionId || payload.signerId !== signerId) {
      return NextResponse.json({ error: "Acces refuse" }, { status: 403 });
    }

    const supabase = createServiceClient();
    const { data: session } = await supabase
      .from("notarization_sessions")
      .select("id, order_id, document_url, submission_id, yousign_signature_request_id")
      .eq("id", sessionId)
      .single();

    if (!session) {
      return NextResponse.json({ error: "Session introuvable" }, { status: 404 });
    }

    const { data: allSigners } = await supabase
      .from("session_signers")
      .select("id, name, email, yousign_signer_id")
      .eq("session_id", sessionId);

    if (!allSigners?.length) {
      return NextResponse.json({ error: "Aucun signataire trouve" }, { status: 404 });
    }

    const currentSigner = allSigners.find((s) => s.id === signerId);
    if (!currentSigner) {
      return NextResponse.json({ error: "Signataire non trouve dans cette session" }, { status: 404 });
    }

    let signatureRequestId = session.yousign_signature_request_id;
    let ysSignerId = currentSigner.yousign_signer_id;

    if (!signatureRequestId || !ysSignerId) {
      let documentUrl = session.document_url;
      if (!documentUrl && session.submission_id) {
        const { data: sub } = await supabase
          .from("submission")
          .select("data")
          .eq("id", session.submission_id)
          .single();

        const docsMap = sub?.data?.documents || sub?.data?.serviceDocuments || {};
        for (const files of Object.values(docsMap)) {
          const fileList = Array.isArray(files) ? files : [];
          const first = (fileList as { url?: string }[]).find((f) => f.url);
          if (first?.url) {
            documentUrl = first.url;
            break;
          }
        }
      }

      if (!documentUrl) {
        return NextResponse.json(
          { error: "Aucun document disponible pour initialiser Yousign" },
          { status: 409 }
        );
      }

      const init = await initYousign({
        supabase,
        sessionId,
        orderId: session.order_id,
        documentUrl,
        signers: allSigners.map((s) => ({ id: s.id, name: s.name, email: s.email })),
      });
      signatureRequestId = init.signatureRequestId;
      ysSignerId = init.signerMap[signerId];
    }

    if (!ysSignerId) {
      return NextResponse.json(
        { error: "yousign_signer_id introuvable pour ce signataire" },
        { status: 409 }
      );
    }

    const signerData = await yousignJson<YousignSigner>(
      `/signature_requests/${signatureRequestId}/signers/${ysSignerId}`
    );

    if (!signerData.signature_link) {
      return NextResponse.json(
        { error: "signature_link absent dans la reponse Yousign" },
        { status: 502 }
      );
    }

    return NextResponse.json({ embedUrl: buildEmbedUrl(signerData.signature_link) });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Yousign] embed route error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
