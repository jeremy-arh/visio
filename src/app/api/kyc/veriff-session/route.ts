import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { logAuditEvent, extractRequestMeta } from "@/lib/audit";

const VERIFF_API_URL = process.env.VERIFF_API_URL || "https://stationapi.veriff.com";

export async function POST(request: NextRequest) {
  try {
    const { sessionId, signerId, callbackUrl } = await request.json();
    if (!sessionId || !signerId) {
      return NextResponse.json(
        { error: "sessionId et signerId requis" },
        { status: 400 }
      );
    }

    const apiKey = process.env.VERIFF_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "VERIFF_API_KEY non configuré" },
        { status: 500 }
      );
    }

    const supabase = createServiceClient();
    const { data: signer } = await supabase
      .from("session_signers")
      .select("id, name, email")
      .eq("id", signerId)
      .eq("session_id", sessionId)
      .single();

    if (!signer) {
      return NextResponse.json({ error: "Signataire non trouvé" }, { status: 404 });
    }

    const [firstName, ...lastNameParts] = (signer.name || "").split(" ");
    const lastName = lastNameParts.join(" ") || firstName;

    const res = await fetch(`${VERIFF_API_URL}/v1/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AUTH-CLIENT": apiKey,
      },
      body: JSON.stringify({
        verification: {
          callback:
            callbackUrl ||
            `${process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin}/session/${sessionId}/kyc/loading`,
          person: {
            firstName: firstName || "Signataire",
            lastName: lastName || "Session",
            email: signer.email,
          },
          vendorData: signerId,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Veriff API error:", err);
      return NextResponse.json(
        { error: "Erreur Veriff", details: err },
        { status: 500 }
      );
    }

    const data = await res.json();
    const veriffUrl = data?.verification?.url;
    const veriffSessionId = data?.verification?.id;

    if (!veriffUrl) {
      return NextResponse.json(
        { error: "Veriff n'a pas retourné d'URL" },
        { status: 500 }
      );
    }

    await supabase
      .from("session_signers")
      .update({ veriff_session_id: veriffSessionId })
      .eq("id", signerId)
      .eq("session_id", sessionId);

    const { ipAddress, userAgent } = extractRequestMeta(request.headers);
    await logAuditEvent(supabase, {
      sessionId,
      eventType: "kyc_started",
      actorType: "signer",
      actorId: signerId,
      actorName: signer.name ?? null,
      actorEmail: signer.email ?? null,
      sessionSignerId: signerId,
      metadata: { veriff_session_id: veriffSessionId },
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ url: veriffUrl });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
