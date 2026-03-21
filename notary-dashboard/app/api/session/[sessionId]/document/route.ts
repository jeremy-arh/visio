import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createServiceClient } from "@/lib/supabase";
import { normalizePdfToA4, normalizeImageToA4Pdf, isPdfBytes, isImageBytes } from "@/lib/pdf-normalize";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";

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
 * Authentification via session notaire (cookies).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const documentId = request.nextUrl.searchParams.get("documentId");
    const urlEncoded = request.nextUrl.searchParams.get("url");

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

    const supabase = createServiceClient();
    const { data: notary } = await supabase
      .from("notaries")
      .select("id")
      .eq("email", user.email)
      .single();

    if (!notary) {
      return NextResponse.json({ error: "Notaries only" }, { status: 403 });
    }

    let docUrl: string | null = null;

    if (documentId) {
      const { data: doc, error } = await supabase
        .from("session_documents")
        .select("id, session_id, source_url")
        .eq("id", documentId)
        .eq("session_id", sessionId)
        .single();

      if (error || !doc?.source_url) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
      }
      docUrl = doc.source_url as string;
    } else if (urlEncoded) {
      try {
        docUrl = decodeURIComponent(atob(urlEncoded));
      } catch {
        return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
      }
    }

    if (!docUrl) {
      return NextResponse.json({ error: "documentId ou url requis" }, { status: 400 });
    }

    if (!isAllowedStorageUrl(docUrl)) {
      return NextResponse.json({ error: "URL not allowed" }, { status: 403 });
    }

    const res = await fetch(docUrl, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Document fetch error: ${res.status}` },
        { status: res.status }
      );
    }

    const docBuffer = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || "application/pdf";

    let responseBody: ArrayBuffer | Uint8Array = docBuffer;
    let responseContentType = contentType;
    try {
      if (isPdfBytes(docBuffer)) {
        responseBody = await normalizePdfToA4(docBuffer);
        responseContentType = "application/pdf";
      } else if (isImageBytes(docBuffer)) {
        responseBody = await normalizeImageToA4Pdf(docBuffer, contentType);
        responseContentType = "application/pdf";
      }
    } catch (err) {
      console.warn("[document-proxy] normalization failed, serving raw:", err);
    }

    return new NextResponse(responseBody, {
      headers: {
        "Content-Type": responseContentType,
        "Content-Disposition": "inline",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err) {
    console.error("[document-proxy] error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
