import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import crypto from "crypto";

const VERIFF_API_URL = process.env.VERIFF_API_URL || "https://stationapi.veriff.com";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; mediaId: string }> }
) {
  try {
    const { sessionId, mediaId } = await params;
    if (!sessionId || !mediaId) {
      return NextResponse.json({ error: "sessionId et mediaId requis" }, { status: 400 });
    }

    const apiKey = process.env.VERIFF_API_KEY;
    const apiSecret = process.env.VERIFF_API_SECRET;
    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        {
          error: "Veriff non configuré",
          details: "VERIFF_API_KEY et VERIFF_API_SECRET sont requis",
        },
        { status: 500 }
      );
    }

    const supabase = createServiceClient();
    const { data: signers } = await supabase
      .from("session_signers")
      .select("veriff_session_id")
      .eq("session_id", sessionId)
      .not("veriff_session_id", "is", null);

    const hasAccess = signers?.some((s) => s.veriff_session_id);
    if (!hasAccess) {
      return NextResponse.json({ error: "Session non trouvée ou accès refusé" }, { status: 404 });
    }

    const signature = crypto
      .createHmac("sha256", apiSecret)
      .update(mediaId)
      .digest("hex");

    const res = await fetch(`${VERIFF_API_URL}/v1/media/${mediaId}`, {
      headers: {
        "Content-Type": "application/json",
        "X-AUTH-CLIENT": apiKey,
        "X-HMAC-SIGNATURE": signature,
      },
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Veriff media error:", err);
      return NextResponse.json({ error: "Erreur récupération média" }, { status: res.status });
    }

    const blob = await res.blob();
    const contentType = res.headers.get("content-type") || "application/octet-stream";

    return new NextResponse(blob, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="veriff-${mediaId}"`,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
