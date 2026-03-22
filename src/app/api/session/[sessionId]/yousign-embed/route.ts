import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyToken } from "@/lib/jwt";
import {
  advanceSigningWorkflow,
  getExpectedSignature,
  type SignatureRow,
  type SigningContext,
} from "@/lib/signing-workflow";
import { logAuditEvent } from "@/lib/audit";
import { PDFDocument } from "pdf-lib";
import { normalizePdfToA4, isPdfBytes } from "@/lib/pdf-normalize";

/** Copie en BlobPart compatible TS strict (évite Uint8Array<ArrayBufferLike> dans `new Blob([…])`). */
function toBlobPart(data: ArrayBuffer | Uint8Array): BlobPart {
  if (data instanceof ArrayBuffer) return data;
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy;
}

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

class YousignRateLimitError extends Error {
  constructor() {
    super("YouSign API rate limit exceeded (429). Veuillez patienter quelques secondes.");
    this.name = "YousignRateLimitError";
  }
}

async function yousignFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const apiKey = process.env.YOUSIGN_API_KEY;
  if (!apiKey) throw new Error("YOUSIGN_API_KEY manquant");
  console.log(`[YS-FETCH-SIGNER] ${options.method || "GET"} ${YOUSIGN_BASE}${path}`);
  const res = await fetch(`${YOUSIGN_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  console.log(`[YS-FETCH-SIGNER] → ${res.status} ${res.statusText}`);
  return res;
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
    console.error(`[Yousign-signer] ${options.method || "GET"} ${path} -> ${res.status}`, body);
    if (res.status === 429) throw new YousignRateLimitError();
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

type SignaturePlacement = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

const DEFAULT_PLACEMENT: SignaturePlacement = {
  page: 1,
  x: 77,
  y: 700,
  width: 200,
  height: 100,
};

function parsePlacement(searchParams: URLSearchParams): SignaturePlacement {
  const toNumber = (value: string | null, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  return {
    page: clamp(Math.round(toNumber(searchParams.get("page"), DEFAULT_PLACEMENT.page)), 1, 50),
    x: clamp(toNumber(searchParams.get("x"), DEFAULT_PLACEMENT.x), 0, 1200),
    y: clamp(toNumber(searchParams.get("y"), DEFAULT_PLACEMENT.y), 0, 1800),
    width: clamp(toNumber(searchParams.get("width"), DEFAULT_PLACEMENT.width), 40, 600),
    height: clamp(toNumber(searchParams.get("height"), DEFAULT_PLACEMENT.height), 20, 300),
  };
}

function isImageFile(fileName: string): boolean {
  return /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(fileName);
}

async function wrapImageInPdf(
  imageBuffer: ArrayBuffer,
  fileName: string
): Promise<{ uploadBytes: Uint8Array; pdfFileName: string }> {
  const pdfDoc = await PDFDocument.create();
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  let image;
  if (ext === "png") {
    image = await pdfDoc.embedPng(imageBuffer);
  } else {
    image = await pdfDoc.embedJpg(imageBuffer);
  }
  const page = pdfDoc.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  const pdfBytes = await pdfDoc.save();
  const baseName = fileName.replace(/\.[^/.]+$/, "");
  console.log(`[YS-SIGNER] Image "${fileName}" convertie en PDF (${pdfBytes.length} bytes)`);
  return { uploadBytes: pdfBytes, pdfFileName: `${baseName}.pdf` };
}

function parseSupabaseStoragePath(url: string): { bucket: string; objectPath: string } | null {
  try {
    const u = new URL(url);
    const match = u.pathname.match(/\/storage\/v1\/object\/(?:sign|public)\/([^/]+)\/(.+)/);
    if (!match) return null;
    const objectPath = match[2].split("?")[0];
    return { bucket: match[1], objectPath };
  } catch {
    return null;
  }
}

async function refreshSupabaseSignedUrl(
  supabase: ReturnType<typeof createServiceClient>,
  url: string,
  documentId: string
): Promise<string> {
  const parsed = parseSupabaseStoragePath(url);
  if (!parsed) return url;
  const { data, error } = await supabase.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.objectPath, 86400);
  if (error || !data?.signedUrl) {
    console.warn("[YS-SIGNER] refreshSignedUrl failed:", error?.message);
    return url;
  }
  console.log("[YS-SIGNER] URL rafraîchie pour document", documentId);
  await supabase
    .from("session_documents")
    .update({ source_url: data.signedUrl, updated_at: new Date().toISOString() })
    .eq("id", documentId);
  return data.signedUrl;
}

/**
 * Après la signature d'un signataire, télécharge le PDF certifié depuis YouSign
 * et le stocke en tant que nouveau source_url dans session_documents.
 * Ainsi le signataire suivant signe un document qui contient déjà les signatures précédentes.
 */
async function archiveSignedDocument(
  supabase: ReturnType<typeof createServiceClient>,
  signatureRequestId: string,
  documentId: string,
  sessionId: string
): Promise<void> {
  try {
    console.log(`[YS-ARCHIVE] Archivage du PDF signé depuis requête ${signatureRequestId}`);
    const ysDocList = await yousignJson<Array<{ id: string; nature: string; filename?: string }>>(
      `/signature_requests/${signatureRequestId}/documents`
    );
    const mainDoc = ysDocList.find((d) => d.nature === "signable_document") ?? ysDocList[0];
    if (!mainDoc?.id) {
      console.warn("[YS-ARCHIVE] Aucun document trouvé dans la requête YouSign");
      return;
    }
    const dlRes = await yousignFetch(
      `/signature_requests/${signatureRequestId}/documents/${mainDoc.id}/download`
    );
    if (!dlRes.ok) {
      console.warn("[YS-ARCHIVE] Téléchargement échoué:", dlRes.status);
      return;
    }
    const pdfBytes = await dlRes.arrayBuffer();
    console.log(`[YS-ARCHIVE] PDF signé téléchargé (${pdfBytes.byteLength} bytes)`);

    const storagePath = `signed-intermediate/${sessionId}/${documentId}_${Date.now()}.pdf`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("form-documents")
      .upload(storagePath, new Blob([pdfBytes], { type: "application/pdf" }), {
        upsert: true,
        cacheControl: "3600",
      });
    if (uploadError || !uploadData) {
      console.warn("[YS-ARCHIVE] Upload Supabase échoué:", uploadError?.message);
      return;
    }
    const { data: signedUrlData } = await supabase.storage
      .from("form-documents")
      .createSignedUrl(uploadData.path, 86400 * 30);
    if (!signedUrlData?.signedUrl) {
      console.warn("[YS-ARCHIVE] Génération URL signée échouée");
      return;
    }
    await supabase
      .from("session_documents")
      .update({ source_url: signedUrlData.signedUrl, updated_at: new Date().toISOString() })
      .eq("id", documentId);
    console.log("[YS-ARCHIVE] ✓ source_url mis à jour avec le PDF signé pour le prochain signataire");
  } catch (err) {
    console.warn("[YS-ARCHIVE] Erreur non-fatale lors de l'archivage:", err);
  }
}

/**
 * Crée une requête YouSign avec UN SEUL signataire (le signataire courant attendu).
 * Chaque signataire a sa propre requête YouSign, ce qui permet :
 * - À chaque signataire de choisir sa propre position de signature.
 * - Au document archivé (source_url) de contenir les signatures des précédents.
 */
async function initYousign(params: {
  supabase: ReturnType<typeof createServiceClient>;
  orderId: string;
  documentUrl: string;
  documentId: string;
  context: SigningContext;
  placement: SignaturePlacement;
  currentSignatureRow: SignatureRow;
}): Promise<{ signatureRequestId: string; yousignSignerId: string }> {
  const { supabase, orderId, documentUrl: rawDocumentUrl, documentId, context, placement, currentSignatureRow } = params;
  const customExperienceId = process.env.YOUSIGN_CUSTOM_EXPERIENCE_ID?.trim();

  const documentUrl = await refreshSupabaseSignedUrl(supabase, rawDocumentUrl, documentId);
  const docResponse = await fetch(documentUrl, { cache: "no-store" });
  if (!docResponse.ok) throw new Error(`Impossible de telecharger le document: ${docResponse.status}`);
  const docBuffer = await docResponse.arrayBuffer();
  const rawFileName = rawDocumentUrl.split("/").pop()?.split("?")[0] || "document.pdf";

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

  let uploadBytes: Uint8Array | ArrayBuffer = docBuffer;
  let fileName = rawFileName;

  if (isImageFile(rawFileName)) {
    console.log(`[YS-SIGNER] Fichier image détecté "${rawFileName}" → conversion PDF`);
    const wrapped = await wrapImageInPdf(docBuffer, rawFileName);
    uploadBytes = wrapped.uploadBytes;
    fileName = wrapped.pdfFileName;
  }

  if (isPdfBytes(uploadBytes)) {
    try {
      console.log(`[YS-SIGNER] Normalisation A4 du document "${fileName}"`);
      uploadBytes = await normalizePdfToA4(uploadBytes);
    } catch (err) {
      console.warn(`[YS-SIGNER] Normalisation A4 échouée pour "${fileName}", envoi brut:`, err);
    }
  }

  const formData = new FormData();
  formData.append("file", new Blob([toBlobPart(uploadBytes)], { type: "application/pdf" }), fileName);
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

  const toNames = (fullName: string) => {
    const parts = fullName.trim().split(/\s+/);
    return {
      firstName: parts[0] || "Signataire",
      lastName: parts.slice(1).join(" ") || ".",
    };
  };

  const signerById = new Map(context.signers.map((s) => [s.id, s]));
  const actor =
    currentSignatureRow.role === "signer"
      ? currentSignatureRow.session_signer_id
        ? signerById.get(currentSignatureRow.session_signer_id) || null
        : null
      : context.notary;

  if (!actor?.email) {
    throw new Error(`Acteur de signature introuvable pour la ligne ${currentSignatureRow.id}`);
  }

  const { firstName, lastName } = toNames(actor.name || "Signataire");
  const ysSigner = await yousignJson<YousignSigner>(
    `/signature_requests/${signatureRequest.id}/signers`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        info: { first_name: firstName, last_name: lastName, email: actor.email, locale: "fr" },
        signature_level: "electronic_signature",
        signature_authentication_mode: "no_otp",
        fields: [
          {
            document_id: uploadedDoc.id,
            type: "signature",
            page: placement.page,
            x: placement.x,
            y: placement.y,
            width: placement.width,
            height: placement.height,
          },
        ],
      }),
    }
  );

  await yousignJson(`/signature_requests/${signatureRequest.id}/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  if (!context.currentDocument) throw new Error("Aucun document courant à initialiser");

  await supabase
    .from("session_documents")
    .update({
      yousign_signature_request_id: signatureRequest.id,
      started_at: context.currentDocument.started_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", context.currentDocument.id);

  await supabase
    .from("session_document_signatures")
    .update({ yousign_signer_id: ysSigner.id, updated_at: new Date().toISOString() })
    .eq("id", currentSignatureRow.id);

  return { signatureRequestId: signatureRequest.id, yousignSignerId: ysSigner.id };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const signerId = request.nextUrl.searchParams.get("signerId");
    const placement = parsePlacement(request.nextUrl.searchParams);
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
    let context = await advanceSigningWorkflow(supabase, sessionId);
    if (!context || !context.currentDocument) {
      return NextResponse.json(
        {
          completed: true,
          message: "Tous les documents sont finalisés.",
        },
        { status: 200 }
      );
    }

    /** Notary must start the flow (explain the document) before any e-signature. */
    if (context.session.signing_flow_status === "idle") {
      return NextResponse.json(
        {
          waiting: true,
          code: "signing_flow_not_started",
          message:
            "The notary must start signing from their room first. You can sign after they have explained the document.",
        },
        { status: 409 }
      );
    }

    const expected = getExpectedSignature(context.signatures);
    if (!expected) {
      context = await advanceSigningWorkflow(supabase, sessionId);
      return NextResponse.json(
        { waiting: true, message: "Transition de workflow en cours." },
        { status: 409 }
      );
    }

    if (expected.role !== "signer") {
      return NextResponse.json(
        {
          waiting: true,
          code: "waiting_for_notary",
          message: "Le notaire doit signer ce document avant de poursuivre.",
        },
        { status: 409 }
      );
    }

    if (expected.session_signer_id !== signerId) {
      return NextResponse.json(
        {
          waiting: true,
          code: "waiting_for_others",
          message: "Ce n'est pas encore votre tour de signer.",
        },
        { status: 409 }
      );
    }

    let signatureRequestId = context.currentDocument.yousign_signature_request_id;
    let expectedSignatureRow: SignatureRow = expected;
    const resetYousign = request.nextUrl.searchParams.get("reset") === "true";

    // Repositionnement : vider les infos YouSign du signataire courant uniquement.
    // La source_url (potentiellement déjà mis à jour avec le doc signé des précédents) est conservée.
    if (resetYousign && expectedSignatureRow.yousign_signer_id) {
      console.log("[YS-EMBED-SIGNER] Reset: nettoyage pour repositionnement");
      await supabase
        .from("session_document_signatures")
        .update({ yousign_signer_id: null, status: "pending", signature_link: null, updated_at: new Date().toISOString() })
        .eq("id", expected.id);
      expectedSignatureRow = { ...expectedSignatureRow, yousign_signer_id: null };
    }

    // Chaque signataire a sa propre requête YouSign (1 requête = 1 signataire).
    // On doit initialiser si le signataire courant n'a pas encore de yousign_signer_id.
    if (!expectedSignatureRow.yousign_signer_id) {
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
        documentId: context.currentDocument.id,
        context,
        placement,
        currentSignatureRow: expectedSignatureRow,
      });
      signatureRequestId = init.signatureRequestId;
      expectedSignatureRow = { ...expectedSignatureRow, yousign_signer_id: init.yousignSignerId };
    }

    if (!signatureRequestId || !expectedSignatureRow.yousign_signer_id) {
      return NextResponse.json(
        { error: "Impossible d'initialiser le signataire Yousign courant" },
        { status: 409 }
      );
    }

    // ── Cache signature_link ──────────────────────────────────────────────
    const { data: cachedRow } = await supabase
      .from("session_document_signatures")
      .select("signature_link, status")
      .eq("id", expectedSignatureRow.id)
      .single();

    const cachedLink: string | null = (cachedRow as { signature_link?: string | null } | null)?.signature_link ?? null;
    const cachedStatus: string | null = (cachedRow as { status?: string | null } | null)?.status ?? null;
    console.log("[YS-EMBED-SIGNER] cached signature_link:", cachedLink ? "present" : "absent", "| status:", cachedStatus);

    // Court-circuit : déjà signé en DB → pas besoin d'appeler YouSign
    if (cachedStatus === "signed") {
      console.log("[YS-EMBED-SIGNER] ✓ Déjà signé en DB — court-circuit sans appel YouSign");
      const advanced = await advanceSigningWorkflow(supabase, sessionId);
      const expectedAfterAdvance = getExpectedSignature(advanced?.signatures || []);
      return NextResponse.json({
        signed: true,
        signerStatus: "signed",
        message: "Document signé avec succès.",
        nextActor: expectedAfterAdvance
          ? {
              role: expectedAfterAdvance.role,
              sessionSignerId: expectedAfterAdvance.session_signer_id,
              notaryId: expectedAfterAdvance.notary_id,
            }
          : null,
      });
    }

    // Appel YouSign pour détecter si le signataire a signé dans l'iframe.
    let signerData: YousignSigner = { id: expectedSignatureRow.yousign_signer_id ?? "" };
    const freshSigner = await yousignJson<YousignSigner>(
      `/signature_requests/${signatureRequestId}/signers/${expectedSignatureRow.yousign_signer_id}`
    );
    signerData = { ...signerData, ...freshSigner };
    console.log("[YS-EMBED-SIGNER] YouSign signer status:", signerData.status);

    // Si signé dans YouSign → mettre à jour le DB et retourner signed
    if (String(signerData.status || "").toLowerCase() === "signed") {
      const signedAt = new Date().toISOString();
      await supabase
        .from("session_document_signatures")
        .update({ status: "signed", signed_at: signedAt, updated_at: signedAt })
        .eq("id", expectedSignatureRow.id);
      console.log("[YS-EMBED-SIGNER] ✓ Signature détectée → DB mis à jour");

      // Archiver le PDF signé en arrière-plan (non-bloquant) : le signataire suivant
      // verra les signatures précédentes. L'archivage se fait pendant que signer 2
      // interagit avec le placement picker (plusieurs secondes d'interaction utilisateur).
      archiveSignedDocument(supabase, signatureRequestId, context.currentDocument.id, sessionId);

      const signerInfo = context.signers.find((s) => s.id === signerId);
      await logAuditEvent(supabase, {
        sessionId,
        eventType: "signer_signed",
        actorType: "signer",
        actorId: signerId,
        actorName: signerInfo?.name ?? null,
        actorEmail: signerInfo?.email ?? null,
        documentId: context.currentDocument?.id ?? null,
        documentLabel: context.currentDocument?.label ?? null,
        metadata: { yousign_signer_id: expectedSignatureRow.yousign_signer_id },
      });

      const advanced = await advanceSigningWorkflow(supabase, sessionId);
      const expectedAfterAdvance = getExpectedSignature(advanced?.signatures || []);
      return NextResponse.json({
        signed: true,
        signerStatus: "signed",
        message: "Document signé avec succès.",
        nextActor: expectedAfterAdvance
          ? {
              role: expectedAfterAdvance.role,
              sessionSignerId: expectedAfterAdvance.session_signer_id,
              notaryId: expectedAfterAdvance.notary_id,
            }
          : null,
      });
    }

    // Pas encore signé → utiliser le lien en cache ou celui de YouSign
    // Note: /signers/{id} n'existe pas en YouSign v3 (404), tout vient de signature_requests/{id}/signers/{id}
    if (cachedLink) {
      console.log("[YS-EMBED-SIGNER] ✓ Using cached signature_link");
      if (!signerData.signature_link) signerData = { ...signerData, signature_link: cachedLink };
    }

    if (!signerData.signature_link) {
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

    // N'écrire en DB que si le lien n'est pas encore en cache (évite des writes répétés qui
    // déclenchent Supabase realtime et saturent YouSign via re-polling côté client).
    if (!cachedLink) {
      await supabase
        .from("session_document_signatures")
        .update({
          status: "notified",
          signature_link: signerData.signature_link,
          updated_at: new Date().toISOString(),
        })
        .eq("id", expectedSignatureRow.id)
        .neq("status", "signed");
      console.log("[YS-EMBED-SIGNER] ✓ signature_link cached in DB");
    } else {
      console.log("[YS-EMBED-SIGNER] ✓ signature_link already cached — skip DB write");
    }

    if (!cachedLink) {
      const signerInfo = context.signers.find((s) => s.id === signerId);
      await logAuditEvent(supabase, {
        sessionId,
        eventType: "yousign_embed_opened",
        actorType: "signer",
        actorId: signerId,
        actorName: signerInfo?.name ?? null,
        actorEmail: signerInfo?.email ?? null,
        documentId: context.currentDocument.id,
        documentLabel: context.currentDocument.label,
        metadata: { yousign_signer_id: expectedSignatureRow.yousign_signer_id },
        ipAddress: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? null,
      });
    }

    return NextResponse.json({
      signingUrl: buildEmbedUrl(signerData.signature_link),
      embedUrl: buildEmbedUrl(signerData.signature_link),
      documentId: context.currentDocument.id,
      documentLabel: context.currentDocument.label,
      documentOrder: context.currentDocument.document_order,
    });
  } catch (error) {
    if (error instanceof YousignRateLimitError) {
      console.warn("[YS-EMBED-SIGNER] 429 rate limit — returning 429 to client");
      return NextResponse.json(
        { rateLimited: true, error: "Limite API YouSign atteinte. Réessayez dans quelques secondes." },
        { status: 429 }
      );
    }
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Yousign-signer] embed route error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
