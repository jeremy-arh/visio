import type { SigningContext } from "@/lib/signing-workflow";
import { getExpectedSignature } from "@/lib/signing-workflow";

type SupabaseLike = { from: (table: string) => any };

function sanitizeYousignBase(raw?: string): string {
  const value = (raw || "").trim().replace(/\/+$/, "");
  if (!value) return "https://api-sandbox.yousign.app/v3";
  if (value.includes("staging-api.yousign.app")) return "https://api-sandbox.yousign.app/v3";
  return value;
}

/** Statuts YouSign considérés comme signature terminée (v3 varie selon les comptes). */
function isYousignSignedStatus(status: unknown): boolean {
  const s = String(status || "").toLowerCase().trim();
  return s === "signed" || s === "done" || s === "completed" || s === "approved";
}

/** Limite les appels YouSign par session (évite le rate-limit à chaque poll client). */
const lastNotarySyncAttempt = new Map<string, number>();
const MIN_MS_BETWEEN_NOTARY_SYNC = 10_000;

/**
 * Si la DB indique encore « notaire à signer » mais YouSign indique déjà signé
 * (cas où le dashboard n’a pas rappelé / embed ou poll a manqué), met à jour la ligne
 * session_document_signatures et retourne true pour que l’appelant relance advanceSigningWorkflow.
 */
export async function trySyncNotarySignatureFromYousign(
  supabase: SupabaseLike,
  context: SigningContext
): Promise<boolean> {
  const apiKey = process.env.YOUSIGN_API_KEY;
  if (!apiKey) return false;

  const expected = getExpectedSignature(context.signatures);
  if (!expected || expected.role !== "notary") return false;
  if (expected.status === "signed") return false;

  const doc = context.currentDocument;
  if (!doc?.yousign_signature_request_id || !expected.yousign_signer_id) return false;

  const sessionId = context.session.id;
  const now = Date.now();
  const last = lastNotarySyncAttempt.get(sessionId) ?? 0;
  if (now - last < MIN_MS_BETWEEN_NOTARY_SYNC) return false;
  lastNotarySyncAttempt.set(sessionId, now);

  const base = sanitizeYousignBase(process.env.YOUSIGN_API_URL);

  try {
    const path = `/signature_requests/${doc.yousign_signature_request_id}/signers/${expected.yousign_signer_id}`;
    const res = await fetch(`${base}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    if (!res.ok) return false;

    const signer = (await res.json()) as { status?: string };
    if (!isYousignSignedStatus(signer.status)) return false;

    const signedAt = new Date().toISOString();
    await supabase
      .from("session_document_signatures")
      .update({
        status: "signed",
        signed_at: signedAt,
        updated_at: signedAt,
      })
      .eq("id", expected.id);

    return true;
  } catch (err) {
    console.warn("[yousign-notary-sync] sync failed:", err);
    return false;
  }
}
