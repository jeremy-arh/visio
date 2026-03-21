import { createServiceClient } from "@/lib/supabase";
import { verifyRecordingToken } from "@/lib/recording-token";
import { NotaryRoomClient } from "../roomClient";

type Signer = {
  id: string;
  name: string;
  email: string;
  kyc_status: string;
  signed_at: string | null;
};

type DocumentItem = {
  id: string;
  label: string;
  url: string;
  status: "available" | "pending";
  source?: "session" | "submission";
};

async function fetchInitialDocuments(session: {
  submission_id: string | null;
  document_url: string | null;
  stamped_document_url: string | null;
  signed_document_url: string | null;
}): Promise<DocumentItem[]> {
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

    const docsMap =
      submissionData?.data?.documents || submissionData?.data?.serviceDocuments || {};
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
  }

  return documents;
}

export default async function RecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { sessionId } = await params;
  const { token } = await searchParams;

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <p className="text-destructive">Recording token missing.</p>
      </main>
    );
  }

  const payload = await verifyRecordingToken(token);
  if (!payload || payload.sessionId !== sessionId) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <p className="text-destructive">Invalid or expired token.</p>
      </main>
    );
  }

  const service = createServiceClient();
  const { data: session } = await service
    .from("notarization_sessions")
    .select("id, status, daily_room_url, notary_id, submission_id, document_url, stamped_document_url, signed_document_url")
    .eq("id", sessionId)
    .single();

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <p className="text-destructive">Session not found.</p>
      </main>
    );
  }

  const { data: signers } = await service
    .from("session_signers")
    .select("id, name, email, kyc_status, signed_at")
    .eq("session_id", sessionId)
    .order("order", { ascending: true });

  const initialDocuments = await fetchInitialDocuments(session);

  return (
    <main className="flex min-h-screen flex-col p-4" data-recording-view="true">
      <NotaryRoomClient
        sessionId={session.id}
        initialStatus={session.status}
        initialRoomUrl={session.daily_room_url}
        signers={(signers || []) as Signer[]}
        initialDocuments={initialDocuments}
        isRecordingView
        recordingToken={token}
      />
    </main>
  );
}
