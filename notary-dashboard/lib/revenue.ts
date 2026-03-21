/**
 * UK-style fee model (GBP) for completed notarization sessions.
 * — First document: £25; each additional document: £15
 * — Each signer beyond the first: £15
 * — Each apostille: £60
 */
export type RevenueBreakdown = {
  documentCount: number;
  signerCount: number;
  apostilleCount: number;
  firstDocumentGbp: number;
  additionalDocumentsGbp: number;
  extraSignersGbp: number;
  apostillesGbp: number;
  totalGbp: number;
};

export function computeSessionRevenueGbp(params: {
  documentCount: number;
  signerCount: number;
  apostilleCount: number;
}): RevenueBreakdown {
  const documentCount = Math.max(0, Math.floor(params.documentCount));
  const signerCount = Math.max(0, Math.floor(params.signerCount));
  const apostilleCount = Math.max(0, Math.floor(params.apostilleCount));

  const firstDocumentGbp = documentCount >= 1 ? 25 : 0;
  const additionalDocumentsGbp = documentCount >= 2 ? (documentCount - 1) * 15 : 0;
  const extraSigners = Math.max(0, signerCount - 1);
  const extraSignersGbp = extraSigners * 15;
  const apostillesGbp = apostilleCount * 60;

  const totalGbp =
    firstDocumentGbp + additionalDocumentsGbp + extraSignersGbp + apostillesGbp;

  return {
    documentCount,
    signerCount,
    apostilleCount,
    firstDocumentGbp,
    additionalDocumentsGbp,
    extraSignersGbp,
    apostillesGbp,
    totalGbp,
  };
}

/** Best-effort apostille count from submission JSON (selected_services, options, etc.). */
export function apostilleCountFromSubmissionData(data: unknown): number {
  if (data == null || typeof data !== "object") return 0;
  const d = data as Record<string, unknown>;

  if (typeof d.apostille_count === "number" && Number.isFinite(d.apostille_count)) {
    return Math.max(0, Math.floor(d.apostille_count));
  }
  if (typeof d.apostilleCount === "number" && Number.isFinite(d.apostilleCount)) {
    return Math.max(0, Math.floor(d.apostilleCount));
  }

  const services = d.selected_services;
  if (Array.isArray(services)) {
    const n = services.filter((s) =>
      String(s).toLowerCase().includes("apostille")
    ).length;
    if (n > 0) return n;
  }

  const serviceDocuments = d.serviceDocuments;
  if (serviceDocuments && typeof serviceDocuments === "object") {
    let n = 0;
    for (const v of Object.values(serviceDocuments as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === "object") {
            const opts = (item as { selectedOptions?: unknown[] }).selectedOptions;
            if (Array.isArray(opts)) {
              n += opts.filter((o) => String(o).toLowerCase().includes("apostille"))
                .length;
            }
          }
        }
      }
    }
    if (n > 0) return n;
  }

  const documents = d.documents;
  if (documents && typeof documents === "object") {
    let n = 0;
    for (const v of Object.values(documents as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item && typeof item === "object") {
            const opts = (item as { selectedOptions?: unknown[] }).selectedOptions;
            if (Array.isArray(opts)) {
              n += opts.filter((o) => String(o).toLowerCase().includes("apostille"))
                .length;
            }
          }
        }
      }
    }
    if (n > 0) return n;
  }

  return 0;
}
