import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createServiceClient } from "@/lib/supabase";
import {
  advanceSigningWorkflow,
  getExpectedSignature,
  type SignatureRow,
  type SigningContext,
} from "@/lib/signing-workflow";
import { logAuditEvent } from "@/lib/audit";
import { PDFDocument } from "pdf-lib";
import { normalizePdfToA4, isPdfBytes } from "@/lib/pdf-normalize";
import { isNotaryUserWithAuthLookup } from "@/lib/notary-auth-server";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "bmp", "webp", "tiff", "tif"]);

function getFileExtension(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function isImageFile(fileName: string): boolean {
  return IMAGE_EXTENSIONS.has(getFileExtension(fileName));
}

/**
 * Enveloppe un buffer image (JPEG/PNG) dans une page PDF A4.
 * YouSign n'accepte que des PDFs comme `signable_document` — les images
 * doivent être converties avant upload.
 */
async function wrapImageInPdf(
  imageBuffer: ArrayBuffer,
  fileName: string
): Promise<{ pdfBytes: Uint8Array; pdfFileName: string }> {
  const ext = getFileExtension(fileName);
  const pdfDoc = await PDFDocument.create();

  let image;
  if (ext === "png") {
    image = await pdfDoc.embedPng(new Uint8Array(imageBuffer));
  } else {
    image = await pdfDoc.embedJpg(new Uint8Array(imageBuffer));
  }

  // Page A4 en points (72 DPI)
  const A4_W = 595;
  const A4_H = 842;
  const MARGIN = 40;

  const page = pdfDoc.addPage([A4_W, A4_H]);
  const maxW = A4_W - MARGIN * 2;
  const maxH = A4_H - MARGIN * 2;

  const ratio = Math.min(maxW / image.width, maxH / image.height);
  const drawW = image.width * ratio;
  const drawH = image.height * ratio;

  page.drawImage(image, {
    x: (A4_W - drawW) / 2,
    y: (A4_H - drawH) / 2,
    width: drawW,
    height: drawH,
  });

  const pdfBytes = await pdfDoc.save();
  const baseName = fileName.replace(/\.[^/.]+$/, "");
  const pdfFileName = `${baseName}.pdf`;
  console.log(`[YS-INIT] ✓ Image wrapped in PDF: ${fileName} → ${pdfFileName} (${pdfBytes.byteLength} bytes)`);
  return { pdfBytes, pdfFileName };
}

/**
 * Extrait le bucket et le chemin objet depuis une URL Supabase Storage signée.
 * Pattern : /storage/v1/object/sign/{bucket}/{path}
 * Retourne null si ce n'est pas une URL signée Supabase.
 */
function parseSupabaseStoragePath(url: string): { bucket: string; objectPath: string } | null {
  const supabaseBase = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  if (!supabaseBase || !url.startsWith(supabaseBase)) return null;
  const match = url.match(/\/storage\/v1\/object\/sign\/([^/?]+)\/(.+?)(\?|$)/);
  if (!match) return null;
  return { bucket: match[1], objectPath: match[2] };
}

/**
 * Si `url` est une URL signée Supabase Storage expirée ou sur le point d'expirer,
 * génère une nouvelle URL signée valide 24h via le service client.
 * Met également à jour session_documents.source_url en base si `documentId` est fourni.
 * Retourne l'URL originale inchangée pour tout autre type d'URL.
 */
async function refreshSupabaseSignedUrl(
  supabase: ReturnType<typeof createServiceClient>,
  url: string,
  opts?: { documentId?: string; logPrefix?: string }
): Promise<string> {
  const prefix = opts?.logPrefix ?? "[YS-EMBED]";
  try {
    const parsed = parseSupabaseStoragePath(url);
    if (!parsed) {
      console.log(`${prefix} URL is not a Supabase signed URL, using as-is:`, url.slice(0, 80));
      return url;
    }

    const { bucket, objectPath } = parsed;
    console.log(`${prefix} Refreshing Supabase signed URL | bucket:`, bucket, "| path:", objectPath);

    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(objectPath, 86400); // valide 24h

    if (error || !data?.signedUrl) {
      console.warn(`${prefix} Failed to refresh signed URL:`, error?.message, "| fallback to original");
      return url;
    }

    console.log(`${prefix} ✓ Fresh signed URL generated (24h):`, data.signedUrl.slice(0, 80) + "...");

    // Mettre à jour en base pour que les prochains appels bénéficient de l'URL fraîche
    if (opts?.documentId) {
      const { error: updateErr } = await supabase
        .from("session_documents")
        .update({ source_url: data.signedUrl, updated_at: new Date().toISOString() })
        .eq("id", opts.documentId);
      if (updateErr) {
        console.warn(`${prefix} Failed to update source_url in DB:`, updateErr.message);
      } else {
        console.log(`${prefix} ✓ source_url updated in DB for document:`, opts.documentId);
      }
    }

    return data.signedUrl;
  } catch (err) {
    console.warn(`${prefix} refreshSupabaseSignedUrl exception:`, err, "| fallback to original");
    return url;
  }
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

async function yousignFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const apiKey = process.env.YOUSIGN_API_KEY;
  if (!apiKey) throw new Error("YOUSIGN_API_KEY manquant");
  const fullUrl = `${YOUSIGN_BASE}${path}`;
  console.log(`[YS-FETCH] ${options.method || "GET"} ${fullUrl}`);
  const res = await fetch(fullUrl, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  console.log(`[YS-FETCH] → ${res.status} ${res.statusText}`);
  return res;
}

class YousignRateLimitError extends Error {
  constructor() {
    super("YouSign API rate limit exceeded (429). Veuillez patienter quelques secondes.");
    this.name = "YousignRateLimitError";
  }
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

async function initYousign(params: {
  supabase: ReturnType<typeof createServiceClient>;
  orderId: string;
  documentUrl: string;
  context: SigningContext;
  placement: SignaturePlacement;
  /** ID de la requête YouSign existante (phase signataires) depuis laquelle
   *  télécharger le document déjà signé, pour que le notaire signe le même
   *  document que les clients. */
  prevSignatureRequestId?: string | null;
}): Promise<{ signatureRequestId: string; signerMapBySignatureRowId: Record<string, string> }> {
  const { supabase, orderId, documentUrl, context, placement, prevSignatureRequestId } = params;
  const customExperienceId = process.env.YOUSIGN_CUSTOM_EXPERIENCE_ID?.trim();

  // Rafraîchir l'URL si c'est une URL signée Supabase expirée, et mettre à jour la DB
  const freshDocumentUrl = await refreshSupabaseSignedUrl(supabase, documentUrl, {
    documentId: context.currentDocument?.id,
    logPrefix: "[YS-INIT]",
  });

  console.log("[YS-INIT] ── initYousign START ──────────────────────────────────");
  console.log("[YS-INIT] orderId:", orderId);
  console.log("[YS-INIT] documentUrl (original):", documentUrl);
  console.log("[YS-INIT] documentUrl (fresh):", freshDocumentUrl);
  console.log("[YS-INIT] prevSignatureRequestId:", prevSignatureRequestId ?? "(none)");
  console.log("[YS-INIT] placement:", JSON.stringify(placement));
  console.log("[YS-INIT] YOUSIGN_BASE:", YOUSIGN_BASE, "| sandbox:", IS_YOUSIGN_SANDBOX);
  console.log("[YS-INIT] customExperienceId:", customExperienceId ?? "(none)");
  console.log("[YS-INIT] session.id:", context.session.id, "| notary_id:", context.session.notary_id);
  console.log("[YS-INIT] signers count:", context.signers.length, "| signatures count:", context.signatures.length);
  console.log("[YS-INIT] currentDocument:", context.currentDocument
    ? { id: context.currentDocument.id, label: context.currentDocument.label, status: context.currentDocument.status, source_url: context.currentDocument.source_url }
    : null);

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

  // Tenter de récupérer le document déjà signé par les clients depuis la
  // requête YouSign précédente (phase signataires), afin que le notaire
  // contre-signe le même PDF avec les signatures des clients visibles.
  let docBuffer: ArrayBuffer | null = null;
  let fileName = freshDocumentUrl.split("/").pop()?.split("?")[0] || "document.pdf";

  console.log("[YS-INIT] signatureRequest created:", signatureRequest.id);

  if (prevSignatureRequestId) {
    console.log("[YS-INIT] Fetching signed doc from prevSignatureRequest:", prevSignatureRequestId);
    try {
      const ysDocList = await yousignJson<Array<{ id: string; nature: string; filename?: string }>>(
        `/signature_requests/${prevSignatureRequestId}/documents`
      );
      console.log("[YS-INIT] prevRequest docs:", JSON.stringify(ysDocList.map(d => ({ id: d.id, nature: d.nature, filename: d.filename }))));
      const mainDoc =
        ysDocList.find((d) => d.nature === "signable_document") ?? ysDocList[0] ?? null;
      if (mainDoc?.id) {
        console.log("[YS-INIT] Downloading doc:", mainDoc.id, "from prevRequest:", prevSignatureRequestId);
        const dlRes = await yousignFetch(
          `/signature_requests/${prevSignatureRequestId}/documents/${mainDoc.id}/download`
        );
        if (dlRes.ok) {
          docBuffer = await dlRes.arrayBuffer();
          if (mainDoc.filename) fileName = mainDoc.filename;
          console.log(`[YS-INIT] ✓ Got signed doc from prevRequest (${fileName}, ${docBuffer.byteLength} bytes)`);
        } else {
          const dlText = await dlRes.text().catch(() => "(no body)");
          console.warn(`[YS-INIT] ✗ Download signed doc → ${dlRes.status} | body: ${dlText} | fallback to source_url`);
        }
      } else {
        console.warn("[YS-INIT] No mainDoc found in prevRequest docs, fallback to source_url");
      }
    } catch (err) {
      console.warn("[YS-INIT] Exception fetching signed doc from prevRequest:", err, "| fallback source_url");
    }
  }

  if (!docBuffer) {
    console.log("[YS-INIT] Fetching document from source_url (fresh):", freshDocumentUrl);
    let docResponse: Response;
    try {
      docResponse = await fetch(freshDocumentUrl, { cache: "no-store" });
    } catch (fetchErr) {
      console.error("[YS-INIT] ✗ fetch(source_url) threw exception:", fetchErr);
      throw new Error(`Could not download document (network exception): ${fetchErr}`);
    }
    console.log("[YS-INIT] source_url fetch result →", docResponse.status, docResponse.statusText);
    if (!docResponse.ok) {
      const errorBody = await docResponse.text().catch(() => "(no body)");
      console.error("[YS-INIT] ✗ source_url returned non-OK status:", docResponse.status, "| body:", errorBody, "| url:", freshDocumentUrl);
      throw new Error(`Could not download document: ${docResponse.status} | body: ${errorBody} | url: ${freshDocumentUrl}`);
    }
    docBuffer = await docResponse.arrayBuffer();
    console.log("[YS-INIT] ✓ source_url doc downloaded:", docBuffer.byteLength, "bytes, fileName:", fileName);
  }

  // Convertir les images en PDF avant l'upload — YouSign refuse les JPEG/PNG comme signable_document
  let uploadBytes: Uint8Array = new Uint8Array(docBuffer);
  let uploadFileName = fileName;
  if (isImageFile(fileName)) {
    console.log("[YS-INIT] Image detected, converting to PDF before YouSign upload:", fileName);
    const wrapped = await wrapImageInPdf(docBuffer, fileName);
    uploadBytes = wrapped.pdfBytes;
    uploadFileName = wrapped.pdfFileName;
  }

  // Normaliser en A4 portrait avant envoi à YouSign
  if (isPdfBytes(uploadBytes.buffer)) {
    try {
      console.log("[YS-INIT] Normalisation A4 du document:", uploadFileName);
      uploadBytes = await normalizePdfToA4(uploadBytes.buffer);
    } catch (err) {
      console.warn("[YS-INIT] Normalisation A4 échouée, envoi brut:", err);
    }
  }

  console.log("[YS-INIT] Uploading doc to YS signature request:", signatureRequest.id, "| fileName:", uploadFileName, "| size:", uploadBytes.byteLength);
  const formData = new FormData();
  formData.append("file", new Blob([uploadBytes], { type: "application/pdf" }), uploadFileName);
  formData.append("nature", "signable_document");
  formData.append("parse_anchors", "false");

  const uploadRes = await yousignFetch(
    `/signature_requests/${signatureRequest.id}/documents`,
    { method: "POST", body: formData }
  );
  const docText = await uploadRes.text();
  console.log("[YS-INIT] doc upload result →", uploadRes.status, "| body:", docText.slice(0, 300));
  let uploadedDoc: YousignDocument;
  try {
    uploadedDoc = JSON.parse(docText);
  } catch {
    throw new Error(`Yousign doc upload failed: ${docText}`);
  }
  if (!uploadRes.ok) throw new Error(`Yousign doc upload ${uploadRes.status}: ${docText}`);
  console.log("[YS-INIT] ✓ Doc uploaded to YS:", uploadedDoc.id);

  const signerMapBySignatureRowId: Record<string, string> = {};
  const toNames = (fullName: string) => {
    const parts = fullName.trim().split(/\s+/);
    return {
      firstName: parts[0] || "Signataire",
      lastName: parts.slice(1).join(" ") || ".",
    };
  };

  // Pour la phase notaire, on n'inclut que les signatures encore non signées dans
  // la nouvelle requête YouSign. Les signataires qui ont déjà signé ne doivent pas
  // être rajoutés (ils ont terminé leur part dans la requête précédente).
  const signaturesInOrder = [...context.signatures]
    .filter((s) => s.status !== "signed")
    .sort((a, b) => a.signature_order - b.signature_order);
  console.log("[YS-INIT] signaturesInOrder (non-signed):", signaturesInOrder.map(s => ({ id: s.id, role: s.role, status: s.status, order: s.signature_order })));
  const signerById = new Map(context.signers.map((s) => [s.id, s]));
  for (let i = 0; i < signaturesInOrder.length; i++) {
    const signatureRow = signaturesInOrder[i];
    const actor =
      signatureRow.role === "signer"
        ? signatureRow.session_signer_id
          ? signerById.get(signatureRow.session_signer_id) || null
          : null
        : context.notary;

    console.log(`[YS-INIT] Adding signer #${i}: role=${signatureRow.role} | email=${actor?.email ?? "?"} | name=${actor?.name ?? "?"}`);
    if (!actor?.email) {
      console.error("[YS-INIT] ✗ Actor not found for signature row:", signatureRow.id, "role:", signatureRow.role);
      throw new Error(
        `Signature actor not found for row ${signatureRow.id} (${signatureRow.role})`
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
    console.log(`[YS-INIT] ✓ YS signer created: ${ysSigner.id} | status: ${ysSigner.status}`);
    signerMapBySignatureRowId[signatureRow.id] = ysSigner.id;
  }

  console.log("[YS-INIT] Activating signature request:", signatureRequest.id);
  await yousignJson(`/signature_requests/${signatureRequest.id}/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  console.log("[YS-INIT] ✓ Signature request activated:", signatureRequest.id);

  if (!context.currentDocument) {
    throw new Error("No current document to initialize");
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

  console.log("[YS-INIT] ── initYousign END ── requestId:", signatureRequest.id, "| signerMap:", JSON.stringify(signerMapBySignatureRowId));
  return { signatureRequestId: signatureRequest.id, signerMapBySignatureRowId };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const placement = parsePlacement(request.nextUrl.searchParams);
    console.log("\n[YS-EMBED] ══════════════════════════════════════════════════════");
    console.log("[YS-EMBED] GET /api/session/" + sessionId + "/yousign-embed");
    console.log("[YS-EMBED] placement:", JSON.stringify(placement));
    console.log("[YS-EMBED] YOUSIGN_BASE:", YOUSIGN_BASE, "| sandbox:", IS_YOUSIGN_SANDBOX);
    if (!process.env.YOUSIGN_API_KEY) {
      console.error("[YS-EMBED] ✗ YOUSIGN_API_KEY manquant !");
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
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!(await isNotaryUserWithAuthLookup(user))) {
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
      return NextResponse.json({ error: "Notary not authorized" }, { status: 403 });
    }

    // notarization_sessions.notary_id référence la table "notaries" (contrainte FK).
    // On ne peut assigner QUE des IDs présents dans cette table.
    const assignableNotaryIds = (notariesPlural || []).map((n) => n.id);

    // Si la session n'a pas de notary_id, on assigne le notaire connecté maintenant.
    // Sans cette assignation, advanceSigningWorkflow traite la session comme "sans notaire"
    // et marque tout comme complété dès que les signataires ont signé.
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

    console.log("[YS-EMBED] user:", user.email, "| role:", role, "| notaryIds:", [...notaryIds]);

    let context = await advanceSigningWorkflow(supabase, sessionId);
    if (!context || !context.session) {
      console.error("[YS-EMBED] ✗ Session not found:", sessionId);
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    console.log("[YS-EMBED] session:", { id: context.session.id, status: context.session.status, signing_flow_status: context.session.signing_flow_status, notary_id: context.session.notary_id });

    /** Start the flow from the room before any signature (explain to signers first). */
    if (context.session.signing_flow_status === "idle") {
      return NextResponse.json(
        {
          waiting: true,
          code: "signing_flow_not_started",
          message:
            "Start signing first (Start signing button). Signers must hear your explanation before they can e-sign.",
        },
        { status: 409 }
      );
    }
    console.log("[YS-EMBED] currentDocument:", context.currentDocument
      ? { id: context.currentDocument.id, label: context.currentDocument.label, status: context.currentDocument.status, source_url: context.currentDocument.source_url, yousign_signature_request_id: context.currentDocument.yousign_signature_request_id }
      : null);
    console.log("[YS-EMBED] signatures:", context.signatures.map(s => ({ id: s.id, role: s.role, status: s.status, order: s.signature_order, yousign_signer_id: s.yousign_signer_id })));
    console.log("[YS-EMBED] signers:", context.signers.map(s => ({ id: s.id, name: s.name, email: s.email })));
    console.log("[YS-EMBED] notary:", context.notary);

    if (context.session.notary_id && !notaryIds.has(context.session.notary_id)) {
      console.warn("[YS-EMBED] ✗ Session not assigned to this notary. session.notary_id:", context.session.notary_id, "| notaryIds:", [...notaryIds]);
      return NextResponse.json({ error: "Session not assigned to this notary" }, { status: 403 });
    }

    // Si context.notary est null (notaire absent de la table "notaries" mais présent dans
    // "notary"), on utilise les infos de l'utilisateur connecté pour ne pas bloquer.
    if (!context.notary && user.email) {
      const notaryId = context.session.notary_id || assignableNotaryIds[0] || "";
      console.log("[YS-EMBED] context.notary null → fallback to connected user:", user.email, "| notaryId:", notaryId);
      context = {
        ...context,
        notary: {
          id: notaryId,
          name:
            (user.user_metadata?.full_name as string | undefined) ||
            (user.user_metadata?.name as string | undefined) ||
            user.email,
          email: user.email,
        },
      };
    }
    if (!context.currentDocument) {
      console.log("[YS-EMBED] No currentDocument → all documents finalized");
      return NextResponse.json(
        { completed: true, message: "All documents are finalized." },
        { status: 200 }
      );
    }

    const expected = getExpectedSignature(context.signatures);
    console.log("[YS-EMBED] expected signature:", expected ? { id: expected.id, role: expected.role, status: expected.status, yousign_signer_id: expected.yousign_signer_id } : null);
    if (!expected || expected.role !== "notary") {
      console.log("[YS-EMBED] Not notary turn yet. expected role:", expected?.role ?? "(null)");
      return NextResponse.json(
        {
          waiting: true,
          code: "waiting_for_signers",
          message: "Waiting for all signers to sign.",
        },
        { status: 409 }
      );
    }

    if (!expected.notary_id || !notaryIds.has(expected.notary_id)) {
      console.warn("[YS-EMBED] ✗ expected.notary_id:", expected.notary_id, "not in notaryIds:", [...notaryIds]);
      return NextResponse.json({ error: "Current notary is not allowed for this step" }, { status: 403 });
    }

  let signatureRequestId = context.currentDocument.yousign_signature_request_id;
  let expectedSignatureRow: SignatureRow = expected;
  const resetYousign = request.nextUrl.searchParams.get("reset") === "true";
  console.log("[YS-EMBED] signatureRequestId:", signatureRequestId ?? "(none)", "| reset:", resetYousign, "| expectedSignatureRow.yousign_signer_id:", expectedSignatureRow.yousign_signer_id ?? "(none)");

  // Si reset demandé (repositionnement) : vider l'état YouSign en DB pour forcer
  // la réinitialisation avec les nouvelles coordonnées. On garde context.currentDocument
  // inchangé afin que initYousign puisse télécharger le doc déjà signé via prevSignatureRequestId.
  if (resetYousign && signatureRequestId && expectedSignatureRow.yousign_signer_id) {
    console.log("[YS-EMBED] Reset: nettoyage état YouSign, réinitialisation avec nouveau placement");
    await supabase
      .from("session_documents")
      .update({ yousign_signature_request_id: null, updated_at: new Date().toISOString() })
      .eq("id", context.currentDocument.id);
    await supabase
      .from("session_document_signatures")
      .update({ yousign_signer_id: null, status: "pending", signature_link: null, updated_at: new Date().toISOString() })
      .eq("id", expected.id);
    signatureRequestId = null;
    expectedSignatureRow = { ...expectedSignatureRow, yousign_signer_id: null };
  }

  if (!signatureRequestId || !expectedSignatureRow.yousign_signer_id) {
      console.log("[YS-EMBED] Need to initYousign. source_url:", context.currentDocument.source_url);
      if (!context.currentDocument.source_url) {
        console.error("[YS-EMBED] ✗ No source_url on currentDocument:", context.currentDocument.id);
        return NextResponse.json(
          { error: "No document source available for signing" },
          { status: 409 }
        );
      }

      const init = await initYousign({
        supabase,
        orderId: context.session.order_id,
        documentUrl: context.currentDocument.source_url,
        context,
        placement,
        // Si le document a déjà une requête YouSign (phase signataires), on
        // télécharge le PDF signé pour que le notaire contre-signe le même doc.
        prevSignatureRequestId: context.currentDocument.yousign_signature_request_id ?? null,
      });
      signatureRequestId = init.signatureRequestId;

      const { data: refreshedExpected } = await supabase
        .from("session_document_signatures")
        .select(
          "id, session_document_id, session_signer_id, role, notary_id, signature_order, status, yousign_signer_id, signed_at"
        )
        .eq("id", expected.id)
        .single();

      console.log("[YS-EMBED] initYousign done. signatureRequestId:", signatureRequestId, "| refreshing expectedSignatureRow...");
      if (refreshedExpected) {
        console.log("[YS-EMBED] refreshedExpected:", { id: refreshedExpected.id, yousign_signer_id: (refreshedExpected as SignatureRow).yousign_signer_id });
        expectedSignatureRow = refreshedExpected as SignatureRow;
      }
    }

    if (!signatureRequestId || !expectedSignatureRow.yousign_signer_id) {
      console.error("[YS-EMBED] ✗ Cannot init notary signature. signatureRequestId:", signatureRequestId, "| yousign_signer_id:", expectedSignatureRow.yousign_signer_id);
      return NextResponse.json(
        { error: "Could not initialize current notary signature" },
        { status: 409 }
      );
    }

    // ── Cache du signature_link ────────────────────────────────────────────────
    // On lit le signature_link depuis la DB pour éviter d'appeler YouSign à chaque poll.
    // Si le lien est en cache et que le statut est "notified" (en cours de signature),
    // on le retourne directement sans appel YouSign.
    const { data: cachedRow } = await supabase
      .from("session_document_signatures")
      .select("signature_link, status")
      .eq("id", expectedSignatureRow.id)
      .single();

    const cachedLink: string | null = (cachedRow as { signature_link?: string | null } | null)?.signature_link ?? null;
    const cachedStatus: string | null = (cachedRow as { status?: string | null } | null)?.status ?? null;
    console.log("[YS-EMBED] cached signature_link:", cachedLink ? "present" : "absent", "| status:", cachedStatus);

    // Court-circuit : déjà signé en DB → pas besoin d'appeler YouSign
    if (cachedStatus === "signed") {
      console.log("[YS-EMBED] ✓ Déjà signé en DB — court-circuit sans appel YouSign");
      const advanced = await advanceSigningWorkflow(supabase, sessionId);
      const expectedAfterAdvance = getExpectedSignature(advanced?.signatures || []);
      return NextResponse.json({
        signed: true,
        signerStatus: "signed",
        message: "Notary signature and stamp completed for this document.",
        nextActor: expectedAfterAdvance
          ? {
              role: expectedAfterAdvance.role,
              sessionSignerId: expectedAfterAdvance.session_signer_id,
              notaryId: expectedAfterAdvance.notary_id,
            }
          : null,
      });
    }

    // Vérifier le statut YouSign (1 appel) pour détecter si signé dans l'iframe
    let signerData: YousignSigner = { id: expectedSignatureRow.yousign_signer_id ?? "" };
    console.log("[YS-EMBED] Fetching signer status from YS:", expectedSignatureRow.yousign_signer_id);
    const freshSigner = await yousignJson<YousignSigner>(
      `/signature_requests/${signatureRequestId}/signers/${expectedSignatureRow.yousign_signer_id}`
    );
    signerData = { ...signerData, ...freshSigner };
    console.log("[YS-EMBED] signerData:", { id: signerData.id, status: signerData.status, hasLink: !!signerData.signature_link });

    // Utiliser le lien en cache si YouSign ne le retourne pas.
    // Note: /signers/{id} n'existe pas en YouSign v3 (404), tout vient de signature_requests/{id}/signers/{id}
    if (cachedLink && !signerData.signature_link) {
      console.log("[YS-EMBED] ✓ Using cached signature_link");
      signerData = { ...signerData, signature_link: cachedLink };
    }

    if (!signerData.signature_link) {
      const normalizedSignerStatus = String(signerData.status || "").toLowerCase();
      console.log("[YS-EMBED] Still no signature_link. signerStatus:", normalizedSignerStatus);
      if (normalizedSignerStatus === "signed") {
        const signedAt = new Date().toISOString();
        await supabase
          .from("session_document_signatures")
          .update({
            status: "signed",
            signed_at: signedAt,
            updated_at: signedAt,
          })
          .eq("id", expectedSignatureRow.id);

        await logAuditEvent(supabase, {
          sessionId,
          eventType: "notary_signed",
          actorType: "notary",
          actorId: context.session.notary_id ?? null,
          actorName: context.notary?.name ?? user.user_metadata?.full_name ?? null,
          actorEmail: context.notary?.email ?? user.email ?? null,
          documentId: context.currentDocument?.id ?? null,
          documentLabel: context.currentDocument?.label ?? null,
          metadata: { yousign_signer_id: expectedSignatureRow.yousign_signer_id, signed_at: signedAt },
          ipAddress: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? null,
        });

        const advanced = await advanceSigningWorkflow(supabase, sessionId);
        const expectedAfterAdvance = getExpectedSignature(advanced?.signatures || []);

        return NextResponse.json({
          signed: true,
          signerStatus: signerData.status || "signed",
          message: "Notary signature and stamp completed for this document.",
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
      console.log("[YS-EMBED] ✓ signature_link cached in DB");
    } else {
      console.log("[YS-EMBED] ✓ signature_link already cached — skip DB write");
    }

    // Logguer seulement si le lien n'était pas déjà en cache (évite les doublons d'audit)
    if (!cachedLink) {
      await logAuditEvent(supabase, {
        sessionId,
        eventType: "yousign_embed_opened",
        actorType: "notary",
        actorId: context.session.notary_id ?? null,
        actorName: context.notary?.name ?? user.user_metadata?.full_name ?? null,
        actorEmail: context.notary?.email ?? user.email ?? null,
        documentId: context.currentDocument.id,
        documentLabel: context.currentDocument.label,
        metadata: { yousign_signer_id: expectedSignatureRow.yousign_signer_id, stage: "notary_signing_and_stamping" },
        ipAddress: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? null,
      });
    }

    const embedUrl = buildEmbedUrl(signerData.signature_link);
    console.log("[YS-EMBED] ✓ embedUrl ready:", embedUrl);
    return NextResponse.json({
      embedUrl,
      documentId: context.currentDocument.id,
      documentLabel: context.currentDocument.label,
      documentOrder: context.currentDocument.document_order,
      stage: "notary_signing_and_stamping",
    });
  } catch (error) {
    if (error instanceof YousignRateLimitError) {
      console.warn("[YS-EMBED] 429 rate limit — returning 429 to client");
      return NextResponse.json(
        { rateLimited: true, error: "YouSign API rate limit reached. Try again in a few seconds." },
        { status: 429 }
      );
    }
    const msg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("[YS-EMBED] ✗ UNHANDLED ERROR:", msg);
    if (stack) console.error("[YS-EMBED] stack:", stack);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
