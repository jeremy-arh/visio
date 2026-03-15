type SupabaseClientLike = {
  from: (table: string) => any;
};

export type SessionWorkflowStatus = "pending_signers" | "pending_notary" | "completed";

export type SessionRow = {
  id: string;
  order_id: string;
  status: string;
  notary_id: string | null;
  current_document_id: string | null;
  signing_flow_status: SessionWorkflowStatus;
};

export type SessionDocumentRow = {
  id: string;
  session_id: string;
  document_order: number;
  label: string;
  source: "session" | "submission" | "veriff" | "generated";
  source_url: string | null;
  status: "pending_signers" | "pending_notary" | "completed" | "cancelled";
  yousign_signature_request_id: string | null;
  signed_document_url: string | null;
  stamped_document_url: string | null;
  started_at: string | null;
  completed_at: string | null;
};

export type SignatureRow = {
  id: string;
  session_document_id: string;
  session_signer_id: string | null;
  role: "signer" | "notary";
  notary_id: string | null;
  signature_order: number;
  status: "pending" | "notified" | "signed" | "declined" | "skipped";
  yousign_signer_id: string | null;
  signed_at: string | null;
};

export type SessionSignerRow = {
  id: string;
  name: string;
  email: string;
  order: number;
  signed_at: string | null;
};

export type NotaryRow = {
  id: string;
  name: string;
  email: string;
};

export type SigningContext = {
  session: SessionRow;
  documents: SessionDocumentRow[];
  currentDocument: SessionDocumentRow | null;
  signatures: SignatureRow[];
  signers: SessionSignerRow[];
  notary: NotaryRow | null;
};

export async function loadSigningContext(
  supabase: SupabaseClientLike,
  sessionId: string
): Promise<SigningContext | null> {
  const { data: session } = await supabase
    .from("notarization_sessions")
    .select("id, order_id, status, notary_id, current_document_id, signing_flow_status")
    .eq("id", sessionId)
    .single();

  if (!session) return null;

  const [{ data: documents }, { data: signers }, { data: notaryRows }] = await Promise.all([
    supabase
      .from("session_documents")
      .select(
        "id, session_id, document_order, label, source, source_url, status, yousign_signature_request_id, signed_document_url, stamped_document_url, started_at, completed_at"
      )
      .eq("session_id", sessionId)
      .order("document_order", { ascending: true }),
    supabase
      .from("session_signers")
      .select("id, name, email, order, signed_at")
      .eq("session_id", sessionId)
      .order("order", { ascending: true }),
    session.notary_id
      ? supabase.from("notaries").select("id, name, email").eq("id", session.notary_id).limit(1)
      : Promise.resolve({ data: [] }),
  ]);

  const docs = (documents || []) as SessionDocumentRow[];
  const currentDocument =
    docs.find((d) => d.id === session.current_document_id) ||
    docs.find((d) => d.status !== "completed" && d.status !== "cancelled") ||
    null;

  const { data: signatures } = currentDocument
    ? await supabase
        .from("session_document_signatures")
        .select(
          "id, session_document_id, session_signer_id, role, notary_id, signature_order, status, yousign_signer_id, signed_at"
        )
        .eq("session_document_id", currentDocument.id)
    : { data: [] };

  return {
    session: session as SessionRow,
    documents: docs,
    currentDocument,
    signatures: (signatures || []) as SignatureRow[],
    signers: (signers || []) as SessionSignerRow[],
    notary: ((notaryRows || [])[0] as NotaryRow | undefined) || null,
  };
}

export function getExpectedSignature(signatures: SignatureRow[]): SignatureRow | null {
  const pendingSigner = signatures
    .filter((s) => s.role === "signer" && s.status !== "signed")
    .sort((a, b) => a.signature_order - b.signature_order)[0];
  if (pendingSigner) return pendingSigner;

  const pendingNotary = signatures
    .filter((s) => s.role === "notary" && s.status !== "signed")
    .sort((a, b) => a.signature_order - b.signature_order)[0];
  return pendingNotary || null;
}

export async function advanceSigningWorkflow(
  supabase: SupabaseClientLike,
  sessionId: string
): Promise<SigningContext | null> {
  const context = await loadSigningContext(supabase, sessionId);
  if (!context || !context.currentDocument) return context;

  const signerRows = context.signatures.filter((s) => s.role === "signer");
  const notaryRows = context.signatures.filter((s) => s.role === "notary");
  const allSignersSigned = signerRows.length > 0 && signerRows.every((s) => s.status === "signed");
  const allNotariesSigned = notaryRows.length === 0 || notaryRows.every((s) => s.status === "signed");

  if (context.currentDocument.status === "pending_signers" && allSignersSigned) {
    const nextDocStatus: SessionWorkflowStatus = allNotariesSigned ? "completed" : "pending_notary";
    await supabase
      .from("session_documents")
      .update({
        status: allNotariesSigned ? "completed" : "pending_notary",
        completed_at: allNotariesSigned ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", context.currentDocument.id);

    await supabase
      .from("notarization_sessions")
      .update({
        signing_flow_status: nextDocStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
  }

  if (context.currentDocument.status === "pending_notary" && allSignersSigned && allNotariesSigned) {
    await supabase
      .from("session_documents")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", context.currentDocument.id);
  }

  const refreshed = await loadSigningContext(supabase, sessionId);
  if (!refreshed) return null;

  const pendingDocs = refreshed.documents
    .filter((d) => d.status !== "completed" && d.status !== "cancelled")
    .sort((a, b) => a.document_order - b.document_order);

  if (!pendingDocs.length) {
    await supabase
      .from("notarization_sessions")
      .update({
        signing_flow_status: "completed",
        status: "completed",
        current_document_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
    return await loadSigningContext(supabase, sessionId);
  }

  const nextCurrent = pendingDocs[0];
  const nextFlowStatus: SessionWorkflowStatus =
    nextCurrent.status === "pending_notary" ? "pending_notary" : "pending_signers";

  await supabase
    .from("notarization_sessions")
    .update({
      current_document_id: nextCurrent.id,
      signing_flow_status: nextFlowStatus,
      status: "signing",
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (!nextCurrent.started_at) {
    await supabase
      .from("session_documents")
      .update({ started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", nextCurrent.id);
  }

  return await loadSigningContext(supabase, sessionId);
}
