import type { Metadata } from "next";
import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";
import { redirect } from "next/navigation";
import { RoomClient } from "./room-client";

export const metadata: Metadata = {
  title: { absolute: "Session" },
};

interface DocumentItem {
  id: string;
  label: string;
  url: string;
  status: "available" | "pending";
  source?: "session" | "veriff" | "submission";
}

async function fetchInitialDocuments(session: {
    submission_id: string | null;
    document_url: string | null;
    stamped_document_url: string | null;
    signed_document_url: string | null;
  }
): Promise<DocumentItem[]> {
  const supabase = createServiceClient();
  const documents: DocumentItem[] = [
    {
      id: "session-document",
      label: "Document to notarize",
      url: session.document_url || "",
      source: "session",
      status: session.document_url ? "available" : "pending",
    },
    {
      id: "session-stamped",
      label: "Stamped document",
      url: session.stamped_document_url || "",
      source: "session",
      status: session.stamped_document_url ? "available" : "pending",
    },
    {
      id: "session-signed",
      label: "Signed document",
      url: session.signed_document_url || "",
      source: "session",
      status: session.signed_document_url ? "available" : "pending",
    },
  ];

  if (session.submission_id) {
    const { data: submissionData } = await supabase
      .from("submission")
      .select("data")
      .eq("id", session.submission_id)
      .single();

    // Documents stockés dans submission.data.documents (JSONB)
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

    // Aussi depuis submission_files et notarized_files si peuplés
    const [submissionFilesRes, notarizedFilesRes] = await Promise.all([
      supabase.from("submission_files").select("id, file_name, file_url").eq("submission_id", session.submission_id),
      supabase.from("notarized_files").select("id, file_name, file_url").eq("submission_id", session.submission_id),
    ]);
    for (const file of submissionFilesRes.data || []) {
      if (file.file_url) documents.push({ id: `sf-${file.id}`, label: file.file_name || "Document", url: file.file_url, source: "submission", status: "available" });
    }
    for (const file of notarizedFilesRes.data || []) {
      if (file.file_url) documents.push({ id: `nf-${file.id}`, label: file.file_name || "Notarized document", url: file.file_url, source: "submission", status: "available" });
    }
  }

  return documents;
}

export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { id } = await params;
  const { token } = await searchParams;
  const headersList = await headers();
  const signerId = headersList.get("x-signer-id");
  const role = headersList.get("x-role");
  const notaryId = headersList.get("x-notary-id");

  if (role === "notary") {
    if (!notaryId) redirect("/");
  } else if (!signerId) {
    redirect("/");
  }

  const supabase = createServiceClient();
  const { data: session } = await supabase
    .from("notarization_sessions")
    .select("id, status, daily_room_url, submission_id, document_url, stamped_document_url, signed_document_url")
    .eq("id", id)
    .single();

  const { data: signers } = await supabase
    .from("session_signers")
    .select("id, name, order, kyc_status, signed_at")
    .eq("session_id", id)
    .order("order");

  if (!session) redirect("/");

  // Si la session est déjà terminée, rediriger directement vers la page de fin
  if (session.status === "completed") {
    redirect(`/session/${id}/completed${token ? `?token=${encodeURIComponent(token)}` : ""}`);
  }

  const initialDocuments = await fetchInitialDocuments(session);

  return (
    <main className="h-screen overflow-hidden bg-[#111213]">
        <RoomClient
          sessionId={id}
          isNotary={role === "notary"}
          signerId={signerId || ""}
          status={session.status}
          dailyRoomUrl={session.daily_room_url}
          documentUrl={session.document_url}
          stampedDocumentUrl={session.stamped_document_url}
          signedDocumentUrl={session.signed_document_url}
          signers={signers || []}
          token={token || ""}
          initialDocuments={initialDocuments}
        />
    </main>
  );
}
