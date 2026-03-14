import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import crypto from "crypto";

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get("x-hmac-signature") || "";
    const webhookSecret = process.env.VERIFF_WEBHOOK_SECRET;

    if (webhookSecret) {
      const expectedSig = crypto
        .createHmac("sha256", webhookSecret)
        .update(body)
        .digest("hex");
      if (signature !== expectedSig) {
        return NextResponse.json({ error: "Signature invalide" }, { status: 401 });
      }
    }

    const data = JSON.parse(body);
    const verification = data?.verification;
    const status = verification?.status;
    const code = verification?.code;
    const vendorData = verification?.vendorData;

    if (!vendorData) {
      return NextResponse.json({ received: true });
    }

    const signerId = vendorData;
    const supabase = createServiceClient();

    const approved = code === 9001 || status === "approved";

    const { data: signer } = await supabase
      .from("session_signers")
      .select("id, session_id")
      .eq("id", signerId)
      .single();

    if (!signer) {
      return NextResponse.json({ received: true });
    }

    await supabase
      .from("session_signers")
      .update({ kyc_status: approved ? "approved" : "declined" })
      .eq("id", signerId);

    if (approved) {
      const { data: signers } = await supabase
        .from("session_signers")
        .select("kyc_status")
        .eq("session_id", signer.session_id);

      const allApproved = signers?.every((s) => s.kyc_status === "approved");
      if (allApproved) {
        await supabase
          .from("notarization_sessions")
          .update({ status: "waiting_notary", updated_at: new Date().toISOString() })
          .eq("id", signer.session_id);
      }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Erreur" }, { status: 500 });
  }
}
