import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createServiceClient } from "@/lib/supabase";
import { logAuditEvent, extractRequestMeta } from "@/lib/audit";
import {
  insertNotarizedFilesFromSession,
  resolveNotaryProfileId,
} from "@/lib/notarized-files-sync";
import { isNotaryUserWithAuthLookup } from "@/lib/notary-auth-server";

const MAX_COMMENT_LEN = 4000;

function isUuidString(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim()
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    let body: { stars?: number; comment?: string } = {};
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === "object") body = parsed as typeof body;
    } catch {
      body = {};
    }

    const stars = body.stars;
    if (
      typeof stars !== "number" ||
      !Number.isInteger(stars) ||
      stars < 1 ||
      stars > 5
    ) {
      return NextResponse.json(
        { error: "stars must be an integer between 1 and 5" },
        { status: 400 }
      );
    }

    const commentRaw =
      typeof body.comment === "string" ? body.comment.trim() : "";
    if (commentRaw.length > MAX_COMMENT_LEN) {
      return NextResponse.json(
        { error: `comment must be at most ${MAX_COMMENT_LEN} characters` },
        { status: 400 }
      );
    }

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
      return NextResponse.json({ error: "Notary not authorized" }, { status: 403 });
    }

    const { data: session } = await supabase
      .from("notarization_sessions")
      .select("id, status, notary_id, submission_id, signed_document_url")
      .eq("id", sessionId)
      .single();

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (session.notary_id && !notaryIds.has(session.notary_id)) {
      return NextResponse.json({ error: "Session not assigned to this notary" }, { status: 403 });
    }

    const now = new Date().toISOString();

    await supabase
      .from("notarization_sessions")
      .update({
        status: "completed",
        signing_flow_status: "completed",
        current_document_id: null,
        updated_at: now,
        notary_session_rating: stars,
        notary_session_rating_comment: commentRaw.length > 0 ? commentRaw : null,
        notary_session_rating_at: now,
      })
      .eq("id", sessionId);

    const subId = session.submission_id;
    if (subId && isUuidString(subId)) {
      const { error: submissionErr } = await supabase
        .from("submission")
        .update({
          status: "completed",
          completed_at: now,
          updated_at: now,
        })
        .eq("id", subId.trim());
      if (submissionErr) {
        console.error("[complete-session] submission status update", submissionErr);
      }

      const notaryProfileId = await resolveNotaryProfileId(
        supabase,
        session.notary_id,
        user.email!,
        user.id
      );
      if (notaryProfileId) {
        const sync = await insertNotarizedFilesFromSession({
          supabase,
          sessionId,
          submissionId: subId.trim(),
          notaryProfileId,
          legacySessionSignedUrl: session.signed_document_url,
        });
        if (sync.error) {
          console.error("[complete-session] notarized_files sync", sync.error);
        }
      } else {
        console.warn(
          "[complete-session] notarized_files skipped: no row in table notary for this user / session notary"
        );
      }
    }

    const notaryId = [...notaryIds][0] ?? null;
    const { data: notaryRow } = await supabase.from("notaries").select("name, email").eq("id", notaryId ?? "").maybeSingle();
    const { ipAddress, userAgent } = extractRequestMeta(request.headers);
    await logAuditEvent(supabase, {
      sessionId,
      eventType: "session_completed",
      actorType: "notary",
      actorId: notaryId,
      actorName: notaryRow?.name ?? (user.user_metadata?.full_name as string | undefined) ?? user.email ?? null,
      actorEmail: notaryRow?.email ?? user.email ?? null,
      metadata: { triggered_by: "notary_complete_button" },
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ ok: true, message: "Session completed." });
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error("[complete-session] error", details);
    return NextResponse.json({ error: "Server error", details }, { status: 500 });
  }
}
