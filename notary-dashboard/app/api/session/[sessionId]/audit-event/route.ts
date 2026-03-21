import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createServiceClient } from "@/lib/supabase";
import { logAuditEvent, extractRequestMeta, type AuditEventType } from "@/lib/audit";
import { isNotaryUserWithAuthLookup } from "@/lib/notary-auth-server";

const ALLOWED_CLIENT_EVENTS: AuditEventType[] = [
  "video_joined",
  "video_left",
  "video_recording_started",
  "video_recording_stopped",
  "yousign_embed_opened",
];

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

    const body = await request.json() as {
      eventType?: string;
      metadata?: Record<string, unknown>;
    };

    const eventType = body.eventType as AuditEventType | undefined;
    if (!eventType || !ALLOWED_CLIENT_EVENTS.includes(eventType)) {
      return NextResponse.json({ error: "Invalid event_type" }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data: notaryRow } = await supabase
      .from("notaries")
      .select("id, name")
      .eq("email", user.email)
      .single();

    const { ipAddress, userAgent } = extractRequestMeta(request.headers);

    await logAuditEvent(supabase, {
      sessionId,
      eventType,
      actorType: "notary",
      actorId: notaryRow?.id ?? null,
      actorName: notaryRow?.name ?? (user.user_metadata?.full_name as string | undefined) ?? user.email ?? null,
      actorEmail: user.email,
      metadata: body.metadata ?? {},
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
