import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { signToken } from "@/lib/jwt";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const orderId = searchParams.get("order_id") || "ORD-2024-001";
    const signerOrder = parseInt(searchParams.get("signer_order") || "0", 10);

    const supabase = createServiceClient();

    const { data: session } = await supabase
      .from("notarization_sessions")
      .select("id")
      .eq("order_id", orderId)
      .single();

    if (!session) {
      return NextResponse.json(
        { error: "Session non trouvée", hint: "Exécutez supabase/seed_test_data.sql" },
        { status: 404 }
      );
    }

    const { data: signer } = await supabase
      .from("session_signers")
      .select("id")
      .eq("session_id", session.id)
      .eq("order", signerOrder)
      .single();

    if (!signer) {
      return NextResponse.json(
        { error: "Signataire non trouvé" },
        { status: 404 }
      );
    }

    const token = await signToken({
      sessionId: session.id,
      signerId: signer.id,
      role: "signer",
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const url = `${baseUrl}/session/${session.id}/kyc?token=${token}`;

    return NextResponse.json({ url });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
