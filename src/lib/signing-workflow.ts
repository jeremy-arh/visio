type SupabaseClientLike = {
  from: (table: string) => any;
};

export type SessionWorkflowStatus = "idle" | "pending_signers" | "pending_notary" | "completed";

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

function hasMissingColumnError(error: unknown): boolean {
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  return message.toLowerCase().includes("column") && message.toLowerCase().includes("does not exist");
}

function guessLabelFromUrl(url: string): string {
  try {
    const clean = url.split("?")[0];
    const name = decodeURIComponent(clean.substring(clean.lastIndexOf("/") + 1));
    return name || "Document a signer";
  } catch {
    return "Document a signer";
  }
}

function extractSubmissionDoc(data: unknown): { url: string; label: string } | null {
  const root = data as { documents?: unknown; serviceDocuments?: unknown } | null;
  const docsMap = root?.documents || root?.serviceDocuments;
  if (!docsMap || typeof docsMap !== "object") return null;

  for (const [serviceName, files] of Object.entries(docsMap as Record<string, unknown>)) {
    if (!Array.isArray(files)) continue;
    for (const file of files as Array<{ url?: string; name?: string }>) {
      if (file?.url) {
        return {
          url: file.url,
          label: file.name || serviceName || guessLabelFromUrl(file.url),
        };
      }
    }
  }
  return null;
}

async function resolveLegacyDocumentSource(
  supabase: SupabaseClientLike,
  sessionId: string
): Promise<{ url: string; label: string; source: SessionDocumentRow["source"] } | null> {
  const { data: sessionMeta } = await supabase
    .from("notarization_sessions")
    .select("document_url, submission_id")
    .eq("id", sessionId)
    .single();

  const documentUrl = sessionMeta?.document_url as string | null | undefined;
  if (documentUrl) {
    return {
      url: documentUrl,
      label: guessLabelFromUrl(documentUrl),
      source: "session",
    };
  }

  const submissionId = sessionMeta?.submission_id as string | null | undefined;
  if (!submissionId) return null;

  const { data: submissionRow } = await supabase
    .from("submission")
    .select("data")
    .eq("id", submissionId)
    .single();
  const fromSubmissionData = extractSubmissionDoc(submissionRow?.data);
  if (fromSubmissionData) {
    return { ...fromSubmissionData, source: "submission" };
  }

  const { data: submissionFiles } = await supabase
    .from("submission_files")
    .select("file_name, file_url")
    .eq("submission_id", submissionId)
    .limit(1);
  const firstSubmissionFile = (submissionFiles || [])[0];
  if (firstSubmissionFile?.file_url) {
    return {
      url: firstSubmissionFile.file_url,
      label: firstSubmissionFile.file_name || guessLabelFromUrl(firstSubmissionFile.file_url),
      source: "submission",
    };
  }

  return null;
}

export async function loadSigningContext(
  supabase: SupabaseClientLike,
  sessionId: string,
  allowBootstrap = true
): Promise<SigningContext | null> {
  const { data: session, error: sessionError } = await supabase
    .from("notarization_sessions")
    .select("id, order_id, status, notary_id, current_document_id, signing_flow_status")
    .eq("id", sessionId)
    .single();

  // Backward compatibility: some environments may not have workflow columns yet.
  // In that case, fall back to the legacy session projection instead of returning a false 404.
  let resolvedSession = session as SessionRow | null;
  if (!resolvedSession && sessionError && hasMissingColumnError(sessionError)) {
    const { data: legacySession } = await supabase
      .from("notarization_sessions")
      .select("id, order_id, status, notary_id")
      .eq("id", sessionId)
      .single();

    if (legacySession) {
      resolvedSession = {
        ...(legacySession as Omit<SessionRow, "current_document_id" | "signing_flow_status">),
        current_document_id: null,
        signing_flow_status: legacySession.status === "completed" ? "completed" : "pending_signers",
      };
    }
  }

  if (!resolvedSession) return null;

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
    resolvedSession.notary_id
      ? supabase.from("notaries").select("id, name, email").eq("id", resolvedSession.notary_id).limit(1)
      : Promise.resolve({ data: [] }),
  ]);

  let docs = (documents || []) as SessionDocumentRow[];

  // Legacy sessions can exist without session_documents/signatures rows.
  // Bootstrap one workflow document and signer steps from existing session data.
  if (
    allowBootstrap &&
    docs.length === 0 &&
    resolvedSession.status !== "completed"
  ) {
    const source = await resolveLegacyDocumentSource(supabase, sessionId);
    if (source) {
      const { data: createdDoc } = await supabase
        .from("session_documents")
        .insert({
          session_id: sessionId,
          document_order: 0,
          label: source.label,
          source: source.source,
          source_url: source.url,
          status: "pending_signers",
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (createdDoc?.id) {
        const signerRows = ((signers || []) as SessionSignerRow[])
          .slice()
          .sort((a, b) => a.order - b.order);
        const signatureRows = signerRows.map((signer, idx) => ({
          session_document_id: createdDoc.id,
          session_signer_id: signer.id,
          role: "signer" as const,
          signature_order: idx,
          status: "pending",
        }));
        if (resolvedSession.notary_id) {
          signatureRows.push({
            session_document_id: createdDoc.id,
            session_signer_id: null,
            role: "notary" as const,
            notary_id: resolvedSession.notary_id,
            signature_order: signerRows.length,
            status: "pending",
          } as unknown as {
            session_document_id: string;
            session_signer_id: string | null;
            role: "signer" | "notary";
            signature_order: number;
            status: string;
          });
        }
        if (signatureRows.length > 0) {
          await supabase.from("session_document_signatures").insert(signatureRows);
        }
        await supabase
          .from("notarization_sessions")
          .update({
            current_document_id: createdDoc.id,
            signing_flow_status: "idle",
            updated_at: new Date().toISOString(),
          })
          .eq("id", sessionId);

        return await loadSigningContext(supabase, sessionId, false);
      }
    }
  }

  const currentDocument =
    docs.find((d) => d.id === resolvedSession.current_document_id) ||
    docs.find((d) => d.status !== "completed" && d.status !== "cancelled") ||
    null;

  const signaturesDocId =
    currentDocument?.id ??
    docs.find((d) => d.status === "completed")?.id ??
    docs[docs.length - 1]?.id ??
    null;

  const { data: signatures } = signaturesDocId
    ? await supabase
        .from("session_document_signatures")
        .select(
          "id, session_document_id, session_signer_id, role, notary_id, signature_order, status, yousign_signer_id, signed_at"
        )
        .eq("session_document_id", signaturesDocId)
    : { data: [] };

  return {
    session: resolvedSession,
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

async function tryLog(
  supabase: SupabaseClientLike,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await (supabase as any).from("audit_trail").insert(payload);
  } catch { /* silencieux */ }
}

export async function advanceSigningWorkflow(
  supabase: SupabaseClientLike,
  sessionId: string
): Promise<SigningContext | null> {
  let context = await loadSigningContext(supabase, sessionId);
  if (!context) return null;

  /** Le notaire doit lancer le workflow explicitement (statut idle → pending_signers via l’API). */
  if (context.session.signing_flow_status === "idle") {
    return context;
  }

  if (!context.currentDocument && context.session.notary_id && context.documents.length > 0) {
    for (const doc of context.documents) {
      if (doc.status !== "completed") continue;
      const { data: sigs } = await supabase
        .from("session_document_signatures")
        .select("id, role, status")
        .eq("session_document_id", doc.id);
      const notarySigs = (sigs || []).filter((s: { role: string }) => s.role === "notary");
      const hasUnsignedNotary = notarySigs.some((s: { status: string }) => s.status !== "signed");
      if (hasUnsignedNotary || (context.session.notary_id && notarySigs.length === 0)) {
        await supabase
          .from("session_documents")
          .update({
            status: "pending_notary",
            completed_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", doc.id);
        if (notarySigs.length === 0 && context.session.notary_id) {
          await supabase.from("session_document_signatures").insert({
            session_document_id: doc.id,
            notary_id: context.session.notary_id,
            role: "notary",
            signature_order: 999,
            status: "pending",
          });
        }
        await supabase
          .from("notarization_sessions")
          .update({
            current_document_id: doc.id,
            signing_flow_status: "pending_notary",
            updated_at: new Date().toISOString(),
          })
          .eq("id", sessionId);
        context = await loadSigningContext(supabase, sessionId, false);
        break;
      }
    }
  }

  if (!context || !context.currentDocument) return context;

  const signerRows = context.signatures.filter((s) => s.role === "signer");
  let notaryRows = context.signatures.filter((s) => s.role === "notary");
  const allSignersSigned = signerRows.length > 0 && signerRows.every((s) => s.status === "signed");

  // allNotariesSigned est TRUE uniquement s'il existe des lignes notaire ET qu'elles sont
  // toutes signées. On n'auto-complète JAMAIS en l'absence de lignes notaire, même si
  // notary_id est null — cela évite de finaliser la session avant que le notaire signe.
  const allNotariesSigned =
    notaryRows.length > 0 && notaryRows.every((s) => s.status === "signed");

  // Recovery : si le document est pending_notary, qu'un notaire est assigné, mais qu'il
  // n'y a pas encore de ligne de signature notaire → on la crée maintenant.
  if (
    context.currentDocument.status === "pending_notary" &&
    context.session.notary_id &&
    notaryRows.length === 0 &&
    allSignersSigned
  ) {
    await supabase.from("session_document_signatures").insert({
      session_document_id: context.currentDocument.id,
      notary_id: context.session.notary_id,
      role: "notary",
      signature_order: 999,
      status: "pending",
    });
    context = (await loadSigningContext(supabase, sessionId, false)) ?? context;
    notaryRows = context.signatures.filter((s) => s.role === "notary");
  }

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

    await tryLog(supabase, {
      session_id: sessionId,
      event_type: "signing_flow_advanced",
      actor_type: "system",
      document_id: context.currentDocument.id,
      document_label: context.currentDocument.label,
      metadata: { from: "pending_signers", to: nextDocStatus },
    });
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

    const notaryRow = notaryRows[0];
    await tryLog(supabase, {
      session_id: sessionId,
      event_type: "notary_signed",
      actor_type: "notary",
      actor_id: context.session.notary_id ?? null,
      actor_name: context.notary?.name ?? null,
      actor_email: context.notary?.email ?? null,
      document_id: context.currentDocument.id,
      document_label: context.currentDocument.label,
      metadata: { yousign_signer_id: notaryRow?.yousign_signer_id ?? null, signed_at: notaryRow?.signed_at ?? null },
    });
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
        current_document_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
    await tryLog(supabase, {
      session_id: sessionId,
      event_type: "session_completed",
      actor_type: "system",
      metadata: { total_documents: refreshed.documents.length },
    });
    return await loadSigningContext(supabase, sessionId);
  }

  const nextCurrent = pendingDocs[0];
  const nextFlowStatus: SessionWorkflowStatus =
    nextCurrent.status === "pending_notary" ? "pending_notary" : "pending_signers";

  // N'écrire en DB que si les valeurs changent réellement pour éviter de déclencher
  // Supabase realtime à chaque appel signing-state (boucle de rétroaction).
  const sessionUnchanged =
    refreshed.session.current_document_id === nextCurrent.id &&
    refreshed.session.signing_flow_status === nextFlowStatus &&
    refreshed.session.status === "signing";

  if (!sessionUnchanged) {
    await supabase
      .from("notarization_sessions")
      .update({
        current_document_id: nextCurrent.id,
        signing_flow_status: nextFlowStatus,
        status: "signing",
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
  }

  if (!nextCurrent.started_at) {
    await supabase
      .from("session_documents")
      .update({ started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", nextCurrent.id);
  }

  return await loadSigningContext(supabase, sessionId);
}
