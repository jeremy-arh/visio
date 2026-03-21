import { BadgeCheck } from "lucide-react";

export function CompletedHero() {
  return (
    <header className="mb-6 space-y-3 sm:mb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#2563eb]/10 text-[#2563eb] sm:mt-0.5">
          <BadgeCheck className="h-6 w-6" aria-hidden strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Session completed
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
            The notarization was completed successfully. Your signed documents will
            also be available in your client dashboard at myNotary — use the button
            below to open it.
          </p>
        </div>
      </div>
    </header>
  );
}
