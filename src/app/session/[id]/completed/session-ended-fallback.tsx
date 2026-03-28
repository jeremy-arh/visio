import { CheckCircle2, Download } from "lucide-react";
import { CLIENT_DASHBOARD_URL } from "@/lib/brand";

export function SessionEndedFallback({
  signedDocumentUrl,
}: {
  signedDocumentUrl: string | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#2563eb]/10 text-[#2563eb] sm:mt-0.5">
          <CheckCircle2 className="h-6 w-6" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            This session has been closed
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
            The notary has closed this notarization session. If the signing process
            was completed, your signed documents are available on your client
            dashboard at myNotary.
          </p>
        </div>
      </header>

      {/* Document download (if available) */}
      {signedDocumentUrl && (
        <div className="rounded-xl border border-neutral-100 bg-neutral-50/80 px-4 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Signed document
          </p>
          <a
            href={signedDocumentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-[#2563eb] hover:underline"
          >
            <Download className="h-4 w-4 shrink-0" />
            Download signed document
          </a>
        </div>
      )}

      {/* Dashboard link */}
      <a
        href={CLIENT_DASHBOARD_URL}
        className="inline-flex items-center justify-center w-full sm:w-auto min-w-[240px] px-6 py-3 rounded-lg bg-[#2563eb] text-white text-sm font-medium shadow-sm hover:bg-[#2563eb]/90 transition-colors"
      >
        Go to my dashboard →
      </a>
    </div>
  );
}
