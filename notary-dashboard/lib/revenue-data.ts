import { createServiceClient } from "@/lib/supabase";
import {
  apostilleCountFromSubmissionData,
  computeSessionRevenueGbp,
  type RevenueBreakdown,
} from "@/lib/revenue";

export type RevenueSessionRow = {
  id: string;
  orderId: string;
  completedAt: string;
  documentCount: number;
  signerCount: number;
  apostilleCount: number;
  breakdown: RevenueBreakdown;
};

function documentCountFromRows(
  sessionId: string,
  docCounts: Map<string, number>,
  legacySignedUrl: string | null
): number {
  const n = docCounts.get(sessionId) || 0;
  if (n > 0) return n;
  if (legacySignedUrl && legacySignedUrl.trim()) return 1;
  return 0;
}

export async function loadRevenueForNotary(notaryIds: string[]): Promise<{
  rows: RevenueSessionRow[];
  totalGbp: number;
}> {
  const supabase = createServiceClient();
  if (!notaryIds.length) return { rows: [], totalGbp: 0 };

  const { data: sessions, error } = await supabase
    .from("notarization_sessions")
    .select("id, order_id, status, updated_at, created_at, submission_id, signed_document_url")
    .in("notary_id", notaryIds)
    .eq("status", "completed")
    .order("updated_at", { ascending: false })
    .limit(500);

  if (error || !sessions?.length) {
    if (error) console.error("[revenue-data] sessions", error);
    return { rows: [], totalGbp: 0 };
  }

  const sessionIds = sessions.map((s) => s.id);
  const submissionIds = sessions
    .map((s) => s.submission_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const [{ data: signerRows }, { data: submissionRows }, { data: docRows }] =
    await Promise.all([
      supabase
        .from("session_signers")
        .select("session_id")
        .in("session_id", sessionIds),
      submissionIds.length
        ? supabase.from("submission").select("id, data").in("id", submissionIds)
        : Promise.resolve({ data: [] as { id: string; data: unknown }[] }),
      supabase
        .from("session_documents")
        .select("session_id, signed_document_url, stamped_document_url")
        .in("session_id", sessionIds),
    ]);

  const docCounts = new Map<string, number>();
  for (const d of docRows || []) {
    const sid = d.session_id as string;
    const has =
      (d.signed_document_url && String(d.signed_document_url).trim()) ||
      (d.stamped_document_url && String(d.stamped_document_url).trim());
    if (!has) continue;
    docCounts.set(sid, (docCounts.get(sid) || 0) + 1);
  }

  const signersPerSession = new Map<string, number>();
  for (const r of signerRows || []) {
    const sid = r.session_id as string;
    signersPerSession.set(sid, (signersPerSession.get(sid) || 0) + 1);
  }

  const submissionDataById = new Map<string, unknown>();
  for (const r of submissionRows || []) {
    submissionDataById.set(r.id as string, r.data);
  }

  const rows: RevenueSessionRow[] = [];
  let totalGbp = 0;

  for (const s of sessions) {
    const sid = s.id as string;
    const submissionId = s.submission_id as string | null;
    const legacyUrl = (s.signed_document_url as string | null) || null;

    const documentCount = documentCountFromRows(sid, docCounts, legacyUrl);
    const signerCount = signersPerSession.get(sid) || 0;

    let apostilleCount = 0;
    if (submissionId && submissionDataById.has(submissionId)) {
      apostilleCount = apostilleCountFromSubmissionData(
        submissionDataById.get(submissionId)
      );
    }

    const breakdown = computeSessionRevenueGbp({
      documentCount,
      signerCount,
      apostilleCount,
    });

    totalGbp += breakdown.totalGbp;
    rows.push({
      id: sid,
      orderId: s.order_id as string,
      completedAt: (s.updated_at as string) || (s.created_at as string),
      documentCount,
      signerCount,
      apostilleCount,
      breakdown,
    });
  }

  return { rows, totalGbp };
}
