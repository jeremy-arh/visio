import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase";
import { NotaryRoomClient } from "./roomClient";
import { isNotaryUserWithAuthLookup } from "@/lib/notary-auth-server";

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

export default async function NotaryRoomPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await authSupabase.auth.getUser();

  if (!user?.email) redirect("/login");
  if (!(await isNotaryUserWithAuthLookup(user))) redirect("/login");

  const service = createServiceClient();
  const [{ data: notariesPlural }, { data: notarySingular }] = await Promise.all([
    service.from("notaries").select("id, email, name").eq("email", user.email),
    service.from("notary").select("id, email, user_id").or(`email.eq.${user.email},user_id.eq.${user.id}`),
  ]);
  const notaryIds = new Set([
    ...(notariesPlural || []).map((n) => n.id),
    ...(notarySingular || []).map((n) => n.id),
  ]);
  if (!notaryIds.size) {
    return <main className="flex min-h-screen flex-col p-4">Notary profile not found.</main>;
  }

  const { data: session } = await service
    .from("notarization_sessions")
    .select("id, status, daily_room_url, notary_id, submission_id, document_url, stamped_document_url, signed_document_url")
    .eq("id", sessionId)
    .single();

  if (!session) {
    return <main className="flex min-h-screen flex-col p-4">Session not found.</main>;
  }
  if (session.notary_id && !notaryIds.has(session.notary_id)) {
    return <main className="flex min-h-screen flex-col p-4">This session is not assigned to your notary profile.</main>;
  }

  const { data: signers } = await service
    .from("session_signers")
    .select("id, name, email, kyc_status, signed_at")
    .eq("session_id", sessionId)
    .order("order", { ascending: true });

  const initialDocuments = await fetchInitialDocuments(session);
  const notaryName =
    (notariesPlural || [])[0]?.name ??
    (user.user_metadata?.full_name as string | undefined) ??
    user.email ??
    "Notaire";

  return (
    <main className="flex min-h-screen flex-col p-4 bg-[#F9FAFB]">
      <NotaryRoomClient
        sessionId={session.id}
        initialStatus={session.status}
        initialRoomUrl={session.daily_room_url}
        signers={(signers || []) as Signer[]}
        initialDocuments={initialDocuments}
        notaryName={notaryName}
      />
    </main>
  );
}
