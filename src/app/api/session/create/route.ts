import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { signToken } from "@/lib/jwt";
import crypto from "crypto";

function generateOrderId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `ORD-${date}-${random}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { order_id, document_url, signers, notary_id, submission_id } = body;

    const supabase = createServiceClient();

    // Générer order_id automatiquement si non fourni
    const resolvedOrderId = order_id || generateOrderId();

    // Récupérer automatiquement les signataires depuis la submission si non fournis
    let resolvedSigners: { name: string; email: string }[] = signers || [];
    if (!resolvedSigners.length && submission_id) {
      // 1. D'abord depuis la table signatories
      const { data: signatories } = await supabase
        .from("signatories")
        .select("first_name, last_name, email")
        .eq("submission_id", submission_id)
        .order("created_at", { ascending: true });
      if (signatories?.length) {
        resolvedSigners = signatories
          .map((s) => ({
            name: [s.first_name, s.last_name].filter(Boolean).join(" ") || "Signataire",
            email: s.email || "",
          }))
          .filter((s) => s.email);
      }
      // 2. Si aucun signataire, utiliser le client de la submission (signataire unique)
      if (!resolvedSigners.length) {
        const { data: submission } = await supabase
          .from("submission")
          .select("first_name, last_name, email")
          .eq("id", submission_id)
          .single();
        if (submission?.email) {
          resolvedSigners = [
            {
              name: [submission.first_name, submission.last_name].filter(Boolean).join(" ") || "Signataire",
              email: submission.email,
            },
          ];
        }
      }
    }

    if (!resolvedSigners.length) {
      return NextResponse.json(
        { error: "signers requis, ou submission_id avec des signataires/client" },
        { status: 400 }
      );
    }

    // Récupérer automatiquement le document depuis la submission si non fourni
    let resolvedDocumentUrl = document_url || null;
    if (!resolvedDocumentUrl && submission_id) {
      const [submissionRes, notarizedRes] = await Promise.all([
        supabase
          .from("submission_files")
          .select("file_url")
          .eq("submission_id", submission_id)
          .order("created_at", { ascending: true })
          .limit(1),
        supabase
          .from("notarized_files")
          .select("file_url")
          .eq("submission_id", submission_id)
          .order("created_at", { ascending: true })
          .limit(1),
      ]);
      resolvedDocumentUrl =
        submissionRes.data?.[0]?.file_url || notarizedRes.data?.[0]?.file_url || null;
    }

    const { data: session, error: sessionError } = await supabase
      .from("notarization_sessions")
      .insert({
        order_id: resolvedOrderId,
        document_url: resolvedDocumentUrl,
        status: "pending_kyc",
        notary_id: notary_id || null,
        submission_id: submission_id || null,
      })
      .select()
      .single();

    if (sessionError) {
      return NextResponse.json(
        { error: "Erreur création session", details: sessionError.message },
        { status: 500 }
      );
    }

    const signersToInsert = resolvedSigners.map(
      (s: { name: string; email: string }, i: number) => ({
        session_id: session.id,
        name: s.name,
        email: s.email,
        "order": i,
        kyc_status: "pending",
      })
    );

    const { data: insertedSigners, error: signersError } = await supabase
      .from("session_signers")
      .insert(signersToInsert)
      .select();

    if (signersError) {
      await supabase.from("notarization_sessions").delete().eq("id", session.id);
      return NextResponse.json(
        { error: "Erreur création signataires", details: signersError.message },
        { status: 500 }
      );
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const signerLinks = await Promise.all(
      insertedSigners.map(async (signer) => {
        const token = await signToken({
          sessionId: session.id,
          signerId: signer.id,
          role: "signer",
        });
        return {
          signer_id: signer.id,
          name: signer.name,
          email: signer.email,
          link: `${baseUrl}/session/${session.id}/kyc?token=${token}`,
        };
      })
    );

    let notaryLink: string | null = null;
    if (notary_id) {
      const notaryDashboardUrl = process.env.NOTARY_DASHBOARD_URL || baseUrl;
      notaryLink = `${notaryDashboardUrl}/login`;
    }

    return NextResponse.json({
      session_id: session.id,
      order_id: resolvedOrderId,
      status: session.status,
      signer_links: signerLinks,
      notary_link: notaryLink,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Erreur serveur" },
      { status: 500 }
    );
  }
}
