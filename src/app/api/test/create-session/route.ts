import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { signToken } from "@/lib/jwt";

export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient();

    const { data: notaries } = await supabase
      .from("notaries")
      .select("id")
      .limit(1);

    const notaryId = notaries?.[0]?.id || null;
    const orderId = `test-${Date.now()}`;

    const { data: session, error: sessionError } = await supabase
      .from("notarization_sessions")
      .insert({
        order_id: orderId,
        document_url: null,
        status: "pending_kyc",
        notary_id: notaryId,
      })
      .select()
      .single();

    if (sessionError) {
      return NextResponse.json(
        { error: "Erreur création session", details: sessionError.message },
        { status: 500 }
      );
    }

    const { data: signers, error: signersError } = await supabase
      .from("session_signers")
      .insert([
        { session_id: session.id, name: "Jean Dupont", email: "jean@test.fr", "order": 0, kyc_status: "pending" },
        { session_id: session.id, name: "Marie Martin", email: "marie@test.fr", "order": 1, kyc_status: "pending" },
      ])
      .select();

    if (signersError) {
      await supabase.from("notarization_sessions").delete().eq("id", session.id);
      return NextResponse.json(
        { error: "Erreur création signataires", details: signersError.message },
        { status: 500 }
      );
    }

    const token = await signToken({
      sessionId: session.id,
      signerId: signers[0].id,
      role: "signer",
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const url = `${baseUrl}/session/${session.id}/kyc?token=${token}`;

    return NextResponse.redirect(url);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
