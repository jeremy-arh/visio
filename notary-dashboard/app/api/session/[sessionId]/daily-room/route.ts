import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createServiceClient } from "@/lib/supabase";
import { logAuditEvent, extractRequestMeta } from "@/lib/audit";
import { isNotaryUserWithAuthLookup } from "@/lib/notary-auth-server";

const DAILY_API_URL = "https://api.daily.co/v1";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const apiKey = process.env.DAILY_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "DAILY_API_KEY is not configured" }, { status: 500 });
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

    const notaryId = (notariesPlural || [])[0]?.id ?? (notarySingular || [])[0]?.id ?? null;

    const { data: session } = await supabase
      .from("notarization_sessions")
      .select("id, status, daily_room_url, notary_id")
      .eq("id", sessionId)
      .single();

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (session.notary_id && !notaryIds.has(session.notary_id)) {
      return NextResponse.json({ error: "Session not assigned to this notary" }, { status: 403 });
    }

    // Assign notary as soon as they click "Join video"
    if (!session.notary_id && notaryId) {
      await supabase
        .from("notarization_sessions")
        .update({ notary_id: notaryId, updated_at: new Date().toISOString() })
        .eq("id", sessionId);
    }

    const { ipAddress, userAgent } = extractRequestMeta(request.headers);

    if (session.daily_room_url) {
      await logAuditEvent(supabase, {
        sessionId,
        eventType: "video_joined",
        actorType: "notary",
        actorId: notaryId ?? null,
        actorEmail: user.email ?? null,
        actorName: (user.user_metadata?.full_name as string | undefined) ?? user.email ?? null,
        metadata: { daily_room_url: session.daily_room_url, rejoined: true },
        ipAddress,
        userAgent,
      });
      return NextResponse.json({ url: session.daily_room_url, alreadyExists: true });
    }

    if (session.status !== "waiting_notary") {
      return NextResponse.json(
        { error: "Session must be waiting for the notary", currentStatus: session.status },
        { status: 400 }
      );
    }

    const roomName = `notary-${sessionId.replace(/-/g, "")}`.slice(0, 128);
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24;

    const res = await fetch(`${DAILY_API_URL}/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        name: roomName,
        properties: {
          exp,
          enable_prejoin_ui: true,
          enable_chat: true,
          lang: "fr",
          geo: "eu-central-1",
          enable_adaptive_simulcast: true,
          enable_multiparty_adaptive_simulcast: true,
          enable_recording: "cloud",
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: "Failed to create Daily room", details: err }, { status: 500 });
    }

    const data = (await res.json()) as { url?: string };
    if (!data.url) {
      return NextResponse.json({ error: "Daily did not return a room URL" }, { status: 500 });
    }

    await supabase
      .from("notarization_sessions")
      .update({
        daily_room_url: data.url,
        status: "in_session",
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);

    await logAuditEvent(supabase, {
      sessionId,
      eventType: "video_room_created",
      actorType: "notary",
      actorId: notaryId ?? null,
      actorEmail: user.email ?? null,
      actorName: (user.user_metadata?.full_name as string | undefined) ?? user.email ?? null,
      metadata: { daily_room_url: data.url, daily_room_name: roomName, enable_recording: true },
      ipAddress,
      userAgent,
    });

    await logAuditEvent(supabase, {
      sessionId,
      eventType: "video_joined",
      actorType: "notary",
      actorId: notaryId ?? null,
      actorEmail: user.email ?? null,
      actorName: (user.user_metadata?.full_name as string | undefined) ?? user.email ?? null,
      metadata: { daily_room_url: data.url },
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ url: data.url });
  } catch (err) {
    console.error("[Daily] Exception", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
