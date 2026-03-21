import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { signToken } from "@/lib/jwt";
import { logAuditEvent } from "@/lib/audit";
import crypto from "crypto";

type SessionDocumentSeed = {
  label: string;
  source: "session" | "submission";
  source_url: string;
};

function generateOrderId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `ORD-${date}-${random}`;
}

function dedupeDocuments(items: SessionDocumentSeed[]): SessionDocumentSeed[] {
  const seen = new Set<string>();
  const unique: SessionDocumentSeed[] = [];
  for (const item of items) {
    const key = item.source_url.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
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
        // Dédupliquer par email pour éviter les doublons liés aux document_key multiples
        const seen = new Set<string>();
        resolvedSigners = signatories
          .map((s) => ({
            name: [s.first_name, s.last_name].filter(Boolean).join(" ") || "Signataire",
            email: s.email || "",
          }))
          .filter((s) => {
            if (!s.email || seen.has(s.email)) return false;
            seen.add(s.email);
            return true;
          });
      }

      // 2. Si table signatories vide, lire submission.data.signatories
      if (!resolvedSigners.length) {
        const { data: submission } = await supabase
          .from("submission")
          .select("first_name, last_name, email, data")
          .eq("id", submission_id)
          .single();

        const dataSignatories: { firstName?: string; lastName?: string; email?: string }[] =
          Array.isArray(submission?.data?.signatories) ? submission.data.signatories : [];

        if (dataSignatories.length > 0) {
          // Pas de déduplication ici : chaque entrée est un signataire distinct voulu par l'utilisateur
          resolvedSigners = dataSignatories
            .map((s) => ({
              name: [s.firstName, s.lastName].filter(Boolean).join(" ") || "Signataire",
              email: s.email || "",
            }))
            .filter((s) => s.email);
        }

        // 3. Dernier recours : utiliser uniquement le client de la submission
        if (!resolvedSigners.length && submission?.email) {
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

    // Construire les documents de session pour le workflow par document.
    const documentSeeds: SessionDocumentSeed[] = [];
    if (resolvedDocumentUrl) {
      documentSeeds.push({
        label: "Document à notariser",
        source: "session",
        source_url: resolvedDocumentUrl,
      });
    }

    if (submission_id) {
      const [{ data: submissionData }, { data: submissionFiles }, { data: notarizedFiles }] = await Promise.all([
        supabase.from("submission").select("data").eq("id", submission_id).single(),
        supabase
          .from("submission_files")
          .select("id, file_name, file_url")
          .eq("submission_id", submission_id)
          .order("created_at", { ascending: true }),
        supabase
          .from("notarized_files")
          .select("id, file_name, file_url")
          .eq("submission_id", submission_id)
          .order("created_at", { ascending: true }),
      ]);

      const docsMap = submissionData?.data?.documents || submissionData?.data?.serviceDocuments || {};
      for (const [serviceName, files] of Object.entries(docsMap)) {
        const fileList = Array.isArray(files) ? files : [];
        for (const file of fileList as { url?: string; name?: string }[]) {
          if (!file.url) continue;
          documentSeeds.push({
            label: file.name || serviceName || "Document",
            source: "submission",
            source_url: file.url,
          });
        }
      }

      for (const file of submissionFiles || []) {
        if (!file.file_url) continue;
        documentSeeds.push({
          label: file.file_name || "Document submission",
          source: "submission",
          source_url: file.file_url,
        });
      }

      for (const file of notarizedFiles || []) {
        if (!file.file_url) continue;
        documentSeeds.push({
          label: file.file_name || "Document notarisé",
          source: "submission",
          source_url: file.file_url,
        });
      }
    }

    const workflowDocuments = dedupeDocuments(documentSeeds);
    if (!workflowDocuments.length) {
      await supabase.from("session_signers").delete().eq("session_id", session.id);
      await supabase.from("notarization_sessions").delete().eq("id", session.id);
      return NextResponse.json(
        { error: "Aucun document disponible pour initialiser le workflow de signature" },
        { status: 400 }
      );
    }

    const sessionDocumentsToInsert = workflowDocuments.map((doc, index) => ({
      session_id: session.id,
      document_order: index,
      label: doc.label,
      source: doc.source,
      source_url: doc.source_url,
      status: "pending_signers",
      started_at: index === 0 ? new Date().toISOString() : null,
    }));

    const { data: insertedDocuments, error: documentsError } = await supabase
      .from("session_documents")
      .insert(sessionDocumentsToInsert)
      .select("id, document_order")
      .order("document_order", { ascending: true });

    if (documentsError || !insertedDocuments?.length) {
      await supabase.from("session_signers").delete().eq("session_id", session.id);
      await supabase.from("notarization_sessions").delete().eq("id", session.id);
      return NextResponse.json(
        { error: "Erreur création documents session", details: documentsError?.message || "Aucun document créé" },
        { status: 500 }
      );
    }

    const signerSignatureRows = insertedDocuments.flatMap((doc) =>
      insertedSigners.map((signer) => ({
        session_document_id: doc.id,
        session_signer_id: signer.id,
        role: "signer",
        signature_order: signer.order ?? 0,
        status: "pending",
      }))
    );

    const notarySignatureRows = notary_id
      ? insertedDocuments.map((doc) => ({
          session_document_id: doc.id,
          notary_id,
          role: "notary",
          signature_order: 999,
          status: "pending",
        }))
      : [];

    const signatureRows = [...signerSignatureRows, ...notarySignatureRows];
    const { error: signaturesError } = await supabase
      .from("session_document_signatures")
      .insert(signatureRows);

    if (signaturesError) {
      await supabase.from("session_documents").delete().eq("session_id", session.id);
      await supabase.from("session_signers").delete().eq("session_id", session.id);
      await supabase.from("notarization_sessions").delete().eq("id", session.id);
      return NextResponse.json(
        { error: "Erreur création file de signatures", details: signaturesError.message },
        { status: 500 }
      );
    }

    const firstDocumentId = insertedDocuments[0].id;
    await supabase
      .from("notarization_sessions")
      .update({
        current_document_id: firstDocumentId,
        signing_flow_status: "idle",
      })
      .eq("id", session.id);

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

    await logAuditEvent(supabase, {
      sessionId: session.id,
      eventType: "session_created",
      actorType: "system",
      metadata: {
        order_id: resolvedOrderId,
        signers_count: insertedSigners.length,
        documents_count: insertedDocuments.length,
        notary_id: notary_id || null,
      },
      ipAddress: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? null,
    });

    return NextResponse.json({
      session_id: session.id,
      order_id: resolvedOrderId,
      status: session.status,
      documents_count: insertedDocuments.length,
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
