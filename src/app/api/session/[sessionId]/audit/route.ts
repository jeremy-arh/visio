import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyToken } from "@/lib/jwt";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    const token =
      request.nextUrl.searchParams.get("token") ||
      request.cookies.get("session_token")?.value ||
      "";

    const payload = token ? await verifyToken(token) : null;
    if (!payload || payload.sessionId !== sessionId) {
      return NextResponse.json({ error: "Non authentifie" }, { status: 401 });
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("audit_trail")
      .select("id, event_type, actor_type, actor_name, actor_email, document_label, metadata, ip_address, user_agent, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ events: data || [] });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
