import type { Metadata } from "next";
import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";
import { redirect } from "next/navigation";
import { SessionPreRoomLogo } from "@/components/session-pre-room-logo";
import { CompletedHero } from "./completed-hero";
import { CompletedActions } from "./completed-actions";
import { CompletedFeedback } from "./completed-feedback";
import { SessionEndedFallback } from "./session-ended-fallback";

export const metadata: Metadata = {
  title: { absolute: "Session completed" },
};

export default async function CompletedPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const headersList = await headers();
  const signerId = headersList.get("x-signer-id");

  const supabase = createServiceClient();
  const { data: session } = await supabase
    .from("notarization_sessions")
    .select("id, signed_document_url")
    .eq("id", id)
    .single();

  if (!session) redirect("/");

  // Signataire non authentifié (token expiré ou lien direct post-session) :
  // afficher une page générique "session terminée" sans données personnalisées
  if (!signerId) {
    return (
      <main className="relative flex min-h-screen flex-col px-4 pb-6 pt-4 sm:px-8 sm:pb-8 sm:pt-6">
        <SessionPreRoomLogo />
        <div className="flex w-full min-h-0 flex-1 flex-col items-center justify-center py-2 sm:py-4">
          <div className="w-full min-w-0 max-w-2xl">
            <SessionEndedFallback signedDocumentUrl={session.signed_document_url} />
          </div>
        </div>
      </main>
    );
  }

  const { data: signerRow } = await supabase
    .from("session_signers")
    .select("session_rating, session_rating_comment, session_rating_at")
    .eq("id", signerId)
    .eq("session_id", id)
    .maybeSingle();

  return (
    <main className="relative flex min-h-screen flex-col px-4 pb-6 pt-4 sm:px-8 sm:pb-8 sm:pt-6">
      <SessionPreRoomLogo />
      <div className="flex w-full min-h-0 flex-1 flex-col items-center justify-center py-2 sm:py-4">
        <div className="w-full min-w-0 max-w-2xl">
          <CompletedHero />
          <div className="mb-6 space-y-6 sm:mb-8">
            <CompletedFeedback
              sessionId={id}
              initialRating={signerRow?.session_rating ?? null}
              initialComment={signerRow?.session_rating_comment ?? null}
              submittedAt={signerRow?.session_rating_at ?? null}
            />
            <CompletedActions signedDocumentUrl={session.signed_document_url} />
          </div>
        </div>
      </div>
    </main>
  );
}
