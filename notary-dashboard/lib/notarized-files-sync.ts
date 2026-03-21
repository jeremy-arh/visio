import type { SupabaseClient } from "@supabase/supabase-js";

export type SignedDocRow = {
  id: string;
  label: string;
  signed_document_url: string | null;
  stamped_document_url: string | null;
};

/** Table `notary` (profil dashboard), requis par la FK de `notarized_files`. */
export async function resolveNotaryProfileId(
  supabase: SupabaseClient,
  sessionNotaryId: string | null,
  userEmail: string,
  userId: string
): Promise<string | null> {
  const { data: byEmail } = await supabase
    .from("notary")
    .select("id")
    .eq("email", userEmail)
    .maybeSingle();
  if (byEmail?.id) return byEmail.id;
  const { data: byUser } = await supabase
    .from("notary")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (byUser?.id) return byUser.id;

  if (sessionNotaryId) {
    const { data: n } = await supabase
      .from("notaries")
      .select("email")
      .eq("id", sessionNotaryId)
      .maybeSingle();
    if (n?.email) {
      const { data: ny } = await supabase
        .from("notary")
        .select("id")
        .eq("email", n.email)
        .maybeSingle();
      if (ny?.id) return ny.id;
    }
  }
  return null;
}

function finalSignedUrl(row: SignedDocRow): string | null {
  const u = row.signed_document_url?.trim() || row.stamped_document_url?.trim();
  return u || null;
}

function safeFileName(url: string, label: string, index: number): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (last && /\.[a-z0-9]+$/i.test(last)) {
      return last.slice(0, 200);
    }
  } catch {
    /* ignore */
  }
  const safe = label.replace(/[^\w\s\-().]/g, "_").trim().slice(0, 80);
  return `${safe || "signed-document"}-${index + 1}.pdf`;
}

/**
 * Insère dans `notarized_files` les PDF signés issus de `session_documents`
 * (et la session legacy `signed_document_url`) pour la submission liée.
 * Ignore les URLs déjà présentes pour cette submission.
 */
export async function insertNotarizedFilesFromSession(args: {
  supabase: SupabaseClient;
  sessionId: string;
  submissionId: string;
  notaryProfileId: string;
  legacySessionSignedUrl: string | null;
}): Promise<{ inserted: number; skipped: number; error?: string }> {
  const { supabase, sessionId, submissionId, notaryProfileId, legacySessionSignedUrl } =
    args;

  const { data: docs, error: docsErr } = await supabase
    .from("session_documents")
    .select("id, label, signed_document_url, stamped_document_url")
    .eq("session_id", sessionId);

  if (docsErr) {
    console.error("[notarized-files-sync] session_documents", docsErr);
    return { inserted: 0, skipped: 0, error: docsErr.message };
  }

  const rows: SignedDocRow[] = (docs || []).map((d) => ({
    id: d.id as string,
    label: (d.label as string) || "Document",
    signed_document_url: d.signed_document_url as string | null,
    stamped_document_url: d.stamped_document_url as string | null,
  }));

  const { data: existing } = await supabase
    .from("notarized_files")
    .select("file_url")
    .eq("submission_id", submissionId);

  const existingUrls = new Set(
    (existing || []).map((r) => r.file_url as string).filter(Boolean)
  );

  const toInsert: {
    submission_id: string;
    notary_id: string;
    file_name: string;
    file_url: string;
    file_type: string;
    storage_path: string;
    uploaded_at: string;
    updated_at: string;
  }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const url = finalSignedUrl(row);
    if (!url || existingUrls.has(url)) continue;
    const file_name = safeFileName(url, row.label, i);
    const storage_path = `notarized/${submissionId}/session-${sessionId}-${row.id}.pdf`;
    const now = new Date().toISOString();
    toInsert.push({
      submission_id: submissionId,
      notary_id: notaryProfileId,
      file_name,
      file_url: url,
      file_type: "application/pdf",
      storage_path,
      uploaded_at: now,
      updated_at: now,
    });
    existingUrls.add(url);
  }

  const legacy = legacySessionSignedUrl?.trim();
  if (legacy && !existingUrls.has(legacy)) {
    const file_name = safeFileName(legacy, "Session document", rows.length);
    const storage_path = `notarized/${submissionId}/session-${sessionId}-legacy.pdf`;
    const now = new Date().toISOString();
    toInsert.push({
      submission_id: submissionId,
      notary_id: notaryProfileId,
      file_name,
      file_url: legacy,
      file_type: "application/pdf",
      storage_path,
      uploaded_at: now,
      updated_at: now,
    });
  }

  let inserted = 0;
  for (const row of toInsert) {
    const { error } = await supabase.from("notarized_files").insert(row);
    if (error) {
      if (error.code === "23505") {
        continue;
      }
      console.error("[notarized-files-sync] insert", error);
      return { inserted, skipped: toInsert.length - inserted, error: error.message };
    }
    inserted++;
  }

  return {
    inserted,
    skipped: toInsert.length - inserted,
  };
}
