import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createServiceClient } from "@/lib/supabase";
import { isNotaryUserWithAuthLookup } from "@/lib/notary-auth-server";

/** Notary starts the signing workflow (idle → pending_signers). Supabase session auth. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

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
    if (!(await isNotaryUserWithAuthLookup(user))) {
      return NextResponse.json({ error: "Notaries only" }, { status: 403 });
    }

    const supabase = createServiceClient();
    const [{ data: notariesPlural }, { data: notarySingular }] = await Promise.all([
      supabase.from("notaries").select("id, email").eq("email", user.email),
      supabase.from("notary").select("id, email, user_id").or(`email.eq.${user.email},user_id.eq.${user.id}`),
    ]);
    const notaryIds = new Set([
      ...(notariesPlural || []).map((n) => n.id),
      ...(notarySingular || []).map((n) => n.id),
    ]);

    if (!notaryIds.size) {
      return NextResponse.json({ error: "Notary not allowed" }, { status: 403 });
    }

    const { data: session, error: fetchErr } = await supabase
      .from("notarization_sessions")
      .select("id, notary_id, signing_flow_status")
      .eq("id", sessionId)
      .single();

    if (fetchErr || !session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (session.notary_id && !notaryIds.has(session.notary_id)) {
      return NextResponse.json({ error: "Session not assigned to this notary" }, { status: 403 });
    }
    if (session.signing_flow_status !== "idle") {
      return NextResponse.json(
        {
          error: "Signing flow already started or completed",
          signingFlowStatus: session.signing_flow_status,
        },
        { status: 409 }
      );
    }

    const notaryId = session.notary_id ?? [...notaryIds][0];
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
        actor_id: notaryId ?? null,
        metadata: { source: "notary_dashboard" },
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
