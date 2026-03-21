import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/jwt";
import { normalizePdfToA4, normalizeImageToA4Pdf, isPdfBytes, isImageBytes } from "@/lib/pdf-normalize";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";

/** Ensures a BodyInit-compatible buffer for NextResponse (strict TS DOM / ArrayBufferLike). */
function toResponseBody(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

function isAllowedStorageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.origin === SUPABASE_URL ||
      u.hostname.endsWith(".supabase.co") ||
      u.hostname.includes("supabase.co")
    );
  } catch {
    return false;
  }
}

/**
 * Proxy pour afficher les documents Supabase Storage dans des iframes.
 * Supabase envoie X-Frame-Options: SAMEORIGIN qui bloque l'embedding depuis localhost.
 * Cette route récupère le document et le sert depuis notre domaine (même origine).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const token = request.nextUrl.searchParams.get("token") || "";
    const documentId = request.nextUrl.searchParams.get("documentId");
    const urlEncoded = request.nextUrl.searchParams.get("url");

    if (!token) {
      return NextResponse.json({ error: "token requis" }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload || payload.sessionId !== sessionId) {
      return NextResponse.json({ error: "token invalide" }, { status: 403 });
    }

    let docUrl: string | null = null;

    if (documentId) {
      const { createServiceClient } = await import("@/lib/supabase/service");
      const supabase = createServiceClient();
      const { data: doc, error } = await supabase
        .from("session_documents")
        .select("id, session_id, source_url")
        .eq("id", documentId)
        .eq("session_id", sessionId)
        .single();

      if (error || !doc?.source_url) {
        return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
      }
      docUrl = doc.source_url as string;
    } else if (urlEncoded) {
      try {
        docUrl = decodeURIComponent(atob(urlEncoded));
      } catch {
        return NextResponse.json({ error: "URL invalide" }, { status: 400 });
      }
    }

    if (!docUrl) {
      return NextResponse.json({ error: "documentId ou url requis" }, { status: 400 });
    }

    if (!isAllowedStorageUrl(docUrl)) {
      return NextResponse.json({ error: "URL non autorisée" }, { status: 403 });
    }

    const res = await fetch(docUrl, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Erreur récupération document: ${res.status}` },
        { status: res.status }
      );
    }

    const docBuffer = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || "application/pdf";

    // Normaliser en A4 portrait (PDF ou image) pour l'affichage dans le PlacementPicker
    let responseBody: ArrayBuffer | Uint8Array = docBuffer;
    let responseContentType = contentType;
    try {
      if (isPdfBytes(docBuffer)) {
        responseBody = await normalizePdfToA4(docBuffer);
        responseContentType = "application/pdf";
      } else if (isImageBytes(docBuffer)) {
        // PNG/JPEG → convertir en PDF A4 pour que pdf.js puisse l'afficher
        responseBody = await normalizeImageToA4Pdf(docBuffer, contentType);
        responseContentType = "application/pdf";
      }
    } catch (err) {
      console.warn("[document-proxy] normalization failed, serving raw:", err);
    }

    return new NextResponse(toResponseBody(responseBody), {
      headers: {
        "Content-Type": responseContentType,
        "Content-Disposition": "inline",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err) {
    console.error("[document-proxy] error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
