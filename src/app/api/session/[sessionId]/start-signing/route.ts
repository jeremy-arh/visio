import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyToken } from "@/lib/jwt";

/** Notary explicitly starts the signing workflow (idle → pending_signers). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const body = (await request.json()) as { token?: string };
    const token = body.token || "";
    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 401 });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Invalid token" }, { status: 403 });
    }
    if (payload.sessionId && payload.sessionId !== sessionId) {
      return NextResponse.json({ error: "Invalid token" }, { status: 403 });
    }
    if (payload.role !== "notary" || !payload.notaryId) {
      return NextResponse.json({ error: "Notary only" }, { status: 403 });
    }

    const supabase = createServiceClient();
    const { data: session, error: fetchErr } = await supabase
      .from("notarization_sessions")
      .select("id, notary_id, signing_flow_status")
      .eq("id", sessionId)
      .single();

    if (fetchErr || !session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (session.notary_id !== payload.notaryId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (session.signing_flow_status !== "idle") {
      return NextResponse.json(
        { error: "Signing flow already started or completed", signingFlowStatus: session.signing_flow_status },
        { status: 409 }
      );
    }

    const { error: updErr } = await supabase
      .from("notarization_sessions")
      .update({
        signing_flow_status: "pending_signers",
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("signing_flow_status", "idle");

    if (updErr) {
      console.error("[start-signing]", updErr);
      return NextResponse.json({ error: "Update failed", details: updErr.message }, { status: 500 });
    }

    try {
      await supabase.from("audit_trail").insert({
        session_id: sessionId,
        event_type: "signing_flow_started",
        actor_type: "notary",
        actor_id: payload.notaryId,
        metadata: { source: "notary_room" },
      });
    } catch {
      /* audit optionnel */
    }

    return NextResponse.json({ ok: true, signingFlowStatus: "pending_signers" });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error("[start-signing] error", details);
    return NextResponse.json({ error: "Server error", details }, { status: 500 });
  }
}
