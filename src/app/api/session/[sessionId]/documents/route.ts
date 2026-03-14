import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import crypto from "crypto";

const VERIFF_API_URL = process.env.VERIFF_API_URL || "https://stationapi.veriff.com";

export interface DocumentItem {
  id: string;
  label: string;
  url: string;
  source: "session" | "veriff" | "submission";
  status: "available" | "pending";
  context?: string;
  signerName?: string;
  mimetype?: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId requis" }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: session, error: sessionError } = await supabase
      .from("notarization_sessions")
      .select("id, submission_id, document_url, stamped_document_url, signed_document_url")
      .eq("id", sessionId)
      .single();

    if (sessionError || !session) {
      return NextResponse.json({ error: "Session non trouvée" }, { status: 404 });
    }

    const documents: DocumentItem[] = [];

    // Documents de la session (toujours listés avec leur statut)
    documents.push({
      id: "session-document",
      label: "Document à notariser",
      url: session.document_url || "",
      source: "session",
      status: session.document_url ? "available" : "pending",
    });
    documents.push({
      id: "session-stamped",
      label: "Document tamponné",
      url: session.stamped_document_url || "",
      source: "session",
      status: session.stamped_document_url ? "available" : "pending",
    });
    documents.push({
      id: "session-signed",
      label: "Document signé",
      url: session.signed_document_url || "",
      source: "session",
      status: session.signed_document_url ? "available" : "pending",
    });

    // Documents de la submission (data JSONB + submission_files + notarized_files)
    if (session.submission_id) {
      const { data: submissionData } = await supabase
        .from("submission")
        .select("data")
        .eq("id", session.submission_id)
        .single();

      const docsMap = submissionData?.data?.documents || submissionData?.data?.serviceDocuments || {};
      let docIndex = 0;
      for (const [serviceName, files] of Object.entries(docsMap)) {
        const fileList = Array.isArray(files) ? files : [];
        for (const file of fileList as { url?: string; name?: string }[]) {
          if (file.url) {
            documents.push({
              id: `submission-doc-${docIndex++}`,
              label: file.name || serviceName,
              url: file.url,
              source: "submission",
              status: "available",
            });
          }
        }
      }

      const [submissionFilesRes, notarizedFilesRes] = await Promise.all([
        supabase.from("submission_files").select("id, file_name, file_url").eq("submission_id", session.submission_id),
        supabase.from("notarized_files").select("id, file_name, file_url").eq("submission_id", session.submission_id),
      ]);
      for (const file of submissionFilesRes.data || []) {
        if (file.file_url) documents.push({ id: `sf-${file.id}`, label: file.file_name || "Document", url: file.file_url, source: "submission", status: "available" });
      }
      for (const file of notarizedFilesRes.data || []) {
        if (file.file_url) documents.push({ id: `nf-${file.id}`, label: file.file_name || "Document notarisé", url: file.file_url, source: "submission", status: "available" });
      }
    }

    // Documents Veriff (KYC) des signataires
    const apiKey = process.env.VERIFF_API_KEY;
    const apiSecret = process.env.VERIFF_API_SECRET || process.env.VERIFF_WEBHOOK_SECRET;

    if (apiKey && apiSecret) {
      const { data: signers } = await supabase
        .from("session_signers")
        .select("id, name, veriff_session_id")
        .eq("session_id", sessionId)
        .not("veriff_session_id", "is", null);

      for (const signer of signers || []) {
        if (!signer.veriff_session_id) continue;

        const signature = crypto
          .createHmac("sha256", apiSecret)
          .update(signer.veriff_session_id)
          .digest("hex");

        const res = await fetch(
          `${VERIFF_API_URL}/v1/sessions/${signer.veriff_session_id}/media`,
          {
            headers: {
              "Content-Type": "application/json",
              "X-AUTH-CLIENT": apiKey,
              "X-HMAC-SIGNATURE": signature,
            },
          }
        );

        if (!res.ok) continue;

        const mediaData = await res.json();
        const images = mediaData?.images || [];
        const videos = mediaData?.videos || [];

        for (const img of images) {
          documents.push({
            id: `veriff-${img.id}`,
            label: `${img.context || img.name} (${signer.name})`,
            url: `/api/session/${sessionId}/documents/proxy/${img.id}`,
            source: "veriff",
            status: "available",
            context: img.context,
            signerName: signer.name,
            mimetype: img.mimetype,
          });
        }
        for (const vid of videos) {
          documents.push({
            id: `veriff-${vid.id}`,
            label: `${vid.context || vid.name} (${signer.name})`,
            url: `/api/session/${sessionId}/documents/proxy/${vid.id}`,
            source: "veriff",
            status: "available",
            context: vid.context,
            signerName: signer.name,
            mimetype: vid.mimetype,
          });
        }
      }
    }

    return NextResponse.json({
      session_id: sessionId,
      submission_id: session.submission_id ?? null,
      documents,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
