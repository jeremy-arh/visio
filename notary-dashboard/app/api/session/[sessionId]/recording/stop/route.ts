import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createServiceClient } from "@/lib/supabase";
import { isNotaryUserWithAuthLookup } from "@/lib/notary-auth-server";

/**
 * Tells the Playwright recording script to stop.
 * Called when the notary leaves the call or closes the page.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    const authSupabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: () => {},
        },
      }
    );

    const { data: { user } } = await authSupabase.auth.getUser();
    if (!user?.email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!(await isNotaryUserWithAuthLookup(user))) {
      return NextResponse.json({ error: "Notaries only" }, { status: 403 });
    }

    const supabase = createServiceClient();
    const { error } = await supabase
      .from("notarization_sessions")
      .update({
        recording_stop_requested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);

    if (error) {
      console.error("[REC-STOP] Error:", error);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: "Recording stop requested" });
  } catch (err) {
    console.error("[REC-STOP] Error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
