"use client";

import { useState } from "react";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Props = {
  sessionId: string;
  initialRating: number | null;
  initialComment: string | null;
  submittedAt: string | null;
};

export function CompletedFeedback({
  sessionId,
  initialRating,
  initialComment,
  submittedAt: initialSubmittedAt,
}: Props) {
  const [submittedAt, setSubmittedAt] = useState<string | null>(initialSubmittedAt);
  const [rating, setRating] = useState<number>(initialRating ?? 0);
  const [comment, setComment] = useState(initialComment ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitted = Boolean(submittedAt);
  const displayRating = submitted ? initialRating ?? rating : rating;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (rating < 1 || rating > 5) {
      setError("Please select a rating from 1 to 5 stars.");
      return;
    }
    setPending(true);
    try {
      const res = await fetch(`/api/session/${sessionId}/feedback`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stars: rating, comment }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        session_rating_at?: string;
      };
      if (!res.ok) {
        setError(data.error || "Could not save your feedback. Please try again.");
        return;
      }
      if (data.session_rating_at) {
        setSubmittedAt(data.session_rating_at);
      } else {
        setSubmittedAt(new Date().toISOString());
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="min-w-0 w-full overflow-hidden shadow-sm">
      <CardHeader className="space-y-1 px-4 pb-2 pt-4 sm:px-6 sm:pt-5">
        <h2 className="text-base font-semibold sm:text-lg">Rate your session</h2>
        <p className="text-sm text-muted-foreground">
          {submitted
            ? "Thank you — your feedback helps us improve the experience."
            : "How would you rate this notarization session? You can add an optional comment."}
        </p>
      </CardHeader>
      <CardContent className="space-y-4 px-4 pb-6 pt-0 sm:px-6">
        <div className="flex items-center gap-1" role="group" aria-label="Rating">
          {[1, 2, 3, 4, 5].map((star) => {
            const active = displayRating >= star;
            return (
              <button
                key={star}
                type="button"
                disabled={submitted}
                onClick={() => !submitted && setRating(star)}
                className={cn(
                  "rounded-md p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2",
                  submitted ? "cursor-default" : "cursor-pointer hover:bg-neutral-100"
                )}
                aria-label={`${star} star${star > 1 ? "s" : ""}`}
                aria-pressed={active}
              >
                <Star
                  className={cn(
                    "h-8 w-8 sm:h-9 sm:w-9",
                    active ? "fill-amber-400 text-amber-400" : "text-neutral-300"
                  )}
                  strokeWidth={1.5}
                />
              </button>
            );
          })}
        </div>

        {!submitted && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="session-feedback-comment"
                className="text-sm font-medium text-foreground"
              >
                Comment{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <textarea
                id="session-feedback-comment"
                name="comment"
                rows={4}
                maxLength={4000}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Share any feedback about the session…"
                className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            {error ? (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            ) : null}
            <Button
              type="submit"
              size="lg"
              disabled={pending || rating < 1}
              className="min-w-[200px] border border-[#2563eb] bg-[#2563eb] text-white hover:bg-[#2563eb]/90 shadow-sm"
            >
              {pending ? "Sending…" : "Submit feedback"}
            </Button>
          </form>
        )}

        {submitted && (comment.trim() || initialComment?.trim()) ? (
          <div className="rounded-lg border border-neutral-100 bg-neutral-50/80 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Your comment
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
              {(comment.trim() || initialComment || "").trim()}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
