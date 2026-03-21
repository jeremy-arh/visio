"use client";

import Link from "next/link";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CLIENT_DASHBOARD_URL } from "@/lib/brand";

export function CompletedActions({
  signedDocumentUrl,
}: {
  signedDocumentUrl: string | null;
}) {
  return (
    <Card className="min-w-0 w-full overflow-hidden shadow-sm">
      <CardHeader className="space-y-1 px-4 pb-2 pt-4 sm:px-6 sm:pt-5">
        <h2 className="text-base font-semibold sm:text-lg">What&apos;s next</h2>
        <p className="text-sm text-muted-foreground">
          Your signed documents will remain available on your{" "}
          <span className="font-medium text-foreground">client dashboard</span> on
          myNotary. You can download them here when a link is shown, or anytime from
          the dashboard.
        </p>
      </CardHeader>
      <CardContent className="space-y-5 px-4 pb-6 pt-0 sm:px-6">
        {signedDocumentUrl ? (
          <div className="rounded-lg border border-neutral-100 bg-neutral-50/80 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Signed document
            </p>
            <a
              href={signedDocumentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-[#2563eb] hover:underline"
            >
              <Download className="h-4 w-4 shrink-0" aria-hidden />
              Download signed document
            </a>
            <p className="mt-3 text-xs text-muted-foreground">
              A copy will also stay on your client dashboard at myNotary.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-neutral-100 bg-neutral-50/80 px-4 py-3 text-sm text-muted-foreground">
            No direct download link here yet — your signed documents will be available
            on your <span className="font-medium text-foreground">client dashboard</span>{" "}
            at myNotary (same place as your other cases).
          </div>
        )}
        <div className="flex flex-wrap gap-3 pt-1">
          <Button
            type="button"
            size="lg"
            className="min-w-[240px] border border-[#2563eb] bg-[#2563eb] text-white hover:bg-[#2563eb]/90 shadow-sm"
            asChild
          >
            <Link href={CLIENT_DASHBOARD_URL}>Go to my dashboard →</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
