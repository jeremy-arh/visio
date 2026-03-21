import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyToken } from "@/lib/jwt";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const body = await request.json() as { token?: string; signerId?: string; status?: "waiting" | "left" };
    const { token, signerId, status } = body;

    if (!token || !signerId || !status) {
      return NextResponse.json({ error: "token, signerId et status requis" }, { status: 400 });
    }

    const payload = await verifyToken(token);
    if (!payload || payload.sessionId !== sessionId || payload.signerId !== signerId) {
      return NextResponse.json({ error: "token invalide" }, { status: 403 });
    }

    const supabase = createServiceClient();
    const isWaiting = status === "waiting";

    await supabase
      .from("session_signers")
      .update({
        is_in_waiting_room: isWaiting,
        waiting_room_updated_at: new Date().toISOString(),
      })
      .eq("id", signerId)
      .eq("session_id", sessionId);

    return NextResponse.json({ ok: true, is_in_waiting_room: isWaiting });
  } catch (err) {
    console.error("[presence]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
