import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyToken } from "@/lib/jwt";

const MAX_COMMENT_LEN = 4000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const body = (await request.json()) as {
      stars?: number;
      comment?: string;
    };

    const token =
      request.cookies.get("session_token")?.value || "";

    const payload = token ? await verifyToken(token) : null;
    if (
      !payload ||
      payload.sessionId !== sessionId ||
      payload.role !== "signer" ||
      !payload.signerId
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    const supabase = createServiceClient();
    const { data: signer, error: fetchErr } = await supabase
      .from("session_signers")
      .select("id, session_rating_at")
      .eq("id", payload.signerId)
      .eq("session_id", sessionId)
      .maybeSingle();

    if (fetchErr || !signer) {
      return NextResponse.json({ error: "Signer not found" }, { status: 404 });
    }

    if (signer.session_rating_at) {
      return NextResponse.json(
        { error: "Feedback already submitted" },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from("session_signers")
      .update({
        session_rating: stars,
        session_rating_comment: commentRaw.length > 0 ? commentRaw : null,
        session_rating_at: now,
      })
      .eq("id", payload.signerId)
      .eq("session_id", sessionId);

    if (updateErr) {
      console.error("[feedback]", updateErr);
      return NextResponse.json({ error: "Failed to save feedback" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      session_rating: stars,
      session_rating_comment: commentRaw.length > 0 ? commentRaw : null,
      session_rating_at: now,
    });
  } catch (err) {
    console.error("[feedback]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
