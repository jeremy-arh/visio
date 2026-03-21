"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MAX_COMMENT = 4000;

export function CompleteSessionDialog({
  sessionId,
  onComplete,
  className,
}: {
  sessionId: string;
  onComplete: () => void;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpen = () => {
    setError(null);
    setOpen(true);
  };

  const handleClose = () => {
    if (loading) return;
    setOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (rating < 1 || rating > 5) {
      setError("Please select a rating from 1 to 5 stars.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/session/${sessionId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stars: rating,
          comment: comment.trim() || undefined,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        onComplete();
        setOpen(false);
        router.push(`/dashboard`);
      } else {
        setError(data.error || "Failed to close the session.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        size="lg"
        className={className}
        onClick={handleOpen}
        disabled={loading}
      >
        End session
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="complete-session-dialog-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Close dialog"
            onClick={handleClose}
          />
          <div className="relative z-10 w-full max-w-md rounded-xl border border-neutral-200 bg-white p-6 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <h2
                id="complete-session-dialog-title"
                className="text-lg font-semibold text-foreground"
              >
                Before you end the session
              </h2>
              <button
                type="button"
                onClick={handleClose}
                disabled={loading}
                className="rounded-md p-1 text-muted-foreground hover:bg-neutral-100 hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Rate this notarization session and optionally leave a comment. The session
              will be marked as completed.
            </p>

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <div>
                <p className="text-sm font-medium text-foreground mb-2">Rating</p>
                <div className="flex items-center gap-1" role="group" aria-label="Rating">
                  {[1, 2, 3, 4, 5].map((star) => {
                    const active = rating >= star;
                    return (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRating(star)}
                        className="rounded-md p-1 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2"
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
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="notary-complete-comment"
                  className="text-sm font-medium text-foreground"
                >
                  Comment{" "}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <textarea
                  id="notary-complete-comment"
                  name="comment"
                  rows={4}
                  maxLength={MAX_COMMENT}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Optional feedback about this session…"
                  className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2 disabled:opacity-50"
                />
              </div>

              {error ? (
                <p className="text-sm text-red-600" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-3 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClose}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="lg"
                  disabled={loading || rating < 1}
                  className="min-w-[160px] border border-[#2563eb] bg-[#2563eb] text-white hover:bg-[#2563eb]/90 shadow-sm"
                >
                  {loading ? "Saving…" : "Confirm and end session"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
