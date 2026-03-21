"use client";

import { Clock } from "lucide-react";

export function WaitingHero({ firstName }: { firstName: string }) {
  return (
    <header className="mb-6 space-y-3 sm:mb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#2563eb]/10 text-[#2563eb] sm:mt-0.5">
          <Clock className="h-6 w-6" aria-hidden strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Waiting room
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
            Hello{" "}
            <span className="font-medium text-foreground">{firstName}</span>
            <span className="mx-1 inline-block" aria-hidden>
              👋
            </span>
            , hang tight — you&apos;ll join the session as soon as the notary is
            ready.
          </p>
        </div>
      </div>
    </header>
  );
}
