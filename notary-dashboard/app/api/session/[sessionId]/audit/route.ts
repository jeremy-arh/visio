import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createServiceClient } from "@/lib/supabase";
import { isNotaryUserWithAuthLookup } from "@/lib/notary-auth-server";
import { verifyRecordingToken } from "@/lib/recording-token";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const recordingToken = request.nextUrl.searchParams.get("recordingToken");

    if (recordingToken) {
      const payload = await verifyRecordingToken(recordingToken);
      if (!payload || payload.sessionId !== sessionId) {
        return NextResponse.json({ error: "Invalid recording token" }, { status: 401 });
      }
    } else {
      const authResponse = NextResponse.next();
      const authSupabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() { return request.cookies.getAll(); },
            setAll(cookiesToSet) {
              cookiesToSet.forEach(({ name, value, options }) =>
                authResponse.cookies.set(name, value, options)
              );
            },
          },
        }
      );
      const { data: { user } } = await authSupabase.auth.getUser();
      if (!user?.email) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
      if (!(await isNotaryUserWithAuthLookup(user))) return NextResponse.json({ error: "Notaries only" }, { status: 403 });
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
