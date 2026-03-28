import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyToken } from "@/lib/jwt";
import { logAuditEvent, extractRequestMeta, type AuditEventType } from "@/lib/audit";

const ALLOWED_CLIENT_EVENTS: AuditEventType[] = [
  "video_joined",
  "video_left",
  "video_screen_share_started",
  "video_screen_share_stopped",
  "video_recording_started",
  "video_recording_stopped",
  "signing_flow_started",
  "yousign_embed_opened",
];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const body = await request.json() as {
      token?: string;
      eventType?: string;
      metadata?: Record<string, unknown>;
    };

    const token = body.token || request.cookies.get("session_token")?.value || "";
    const payload = token ? await verifyToken(token) : null;
    if (!payload || payload.sessionId !== sessionId) {
      return NextResponse.json({ error: "Non authentifie" }, { status: 401 });
    }

    const eventType = body.eventType as AuditEventType | undefined;
    if (!eventType || !ALLOWED_CLIENT_EVENTS.includes(eventType)) {
      return NextResponse.json({ error: "event_type invalide ou non autorisé" }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { ipAddress, userAgent } = extractRequestMeta(request.headers);

    let actorName: string | null = null;
    let actorEmail: string | null = null;
    if (payload.role === "signer" && payload.signerId) {
      const { data: signer } = await supabase
        .from("session_signers")
        .select("name, email")
        .eq("id", payload.signerId)
        .single();
      actorName = signer?.name ?? null;
      actorEmail = signer?.email ?? null;
    }

    await logAuditEvent(supabase, {
      sessionId,
      eventType,
      actorType: payload.role === "signer" ? "signer" : "notary",
      actorId: payload.signerId ?? payload.notaryId ?? null,
      actorName,
      actorEmail,
      sessionSignerId: payload.signerId ?? null,
      metadata: body.metadata ?? {},
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
