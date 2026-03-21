import type { Metadata } from "next";
import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";
import { redirect } from "next/navigation";
import { SessionPreRoomLogo } from "@/components/session-pre-room-logo";
import { WaitingClient } from "./waiting-client";
import { WaitingHero } from "./waiting-hero";

export const metadata: Metadata = {
  title: { absolute: "Waiting room" },
};

export default async function WaitingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { id } = await params;
  const { token } = await searchParams;
  const headersList = await headers();
  const signerId = headersList.get("x-signer-id");

  if (!signerId) redirect("/");

  const supabase = createServiceClient();
  const { data: session } = await supabase
    .from("notarization_sessions")
    .select("id, status")
    .eq("id", id)
    .single();

  if (!session) redirect("/");

  if (["in_session", "signing", "notary_stamping"].includes(session.status)) {
    redirect(`/session/${id}/room?token=${token}`);
  }

  if (session.status === "completed") {
    redirect(`/session/${id}/completed?token=${token}`);
  }

  const { data: signer } = await supabase
    .from("session_signers")
    .select("name")
    .eq("id", signerId)
    .eq("session_id", id)
    .single();

  const firstName =
    (signer?.name ?? "there").trim().split(/\s+/)[0] || "there";

  return (
    <main className="relative flex min-h-screen flex-col px-4 pb-6 pt-4 sm:px-8 sm:pb-8 sm:pt-6">
      <SessionPreRoomLogo />
      <div className="flex w-full min-h-0 flex-1 flex-col items-center justify-center py-2 sm:py-4">
        <div className="w-full min-w-0 max-w-2xl">
          <WaitingHero firstName={firstName} />
          <WaitingClient
            sessionId={id}
            signerId={signerId}
            status={session.status}
            token={token || ""}
          />
        </div>
      </div>
    </main>
  );
}
