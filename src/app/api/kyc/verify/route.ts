import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(request: NextRequest) {
  try {
    const { sessionId, signerId } = await request.json();
    if (!sessionId || !signerId) {
      return NextResponse.json(
        { error: "sessionId et signerId requis" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    const { error: updateError } = await supabase
      .from("session_signers")
      .update({ kyc_status: "approved" })
      .eq("id", signerId)
      .eq("session_id", sessionId);

    if (updateError) {
      return NextResponse.json(
        { error: "Erreur mise à jour KYC", details: updateError.message },
        { status: 500 }
      );
    }

    const { data: signers } = await supabase
      .from("session_signers")
      .select("kyc_status")
      .eq("session_id", sessionId);

    const allApproved = signers?.every((s) => s.kyc_status === "approved");

    if (allApproved) {
      await supabase
        .from("notarization_sessions")
        .update({ status: "waiting_notary", updated_at: new Date().toISOString() })
        .eq("id", sessionId);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Erreur serveur" },
      { status: 500 }
    );
  }
}
