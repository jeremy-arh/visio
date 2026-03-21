import type { Metadata } from "next";
import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";
import { redirect } from "next/navigation";
import { SessionPreRoomLogo } from "@/components/session-pre-room-logo";
import { KycClient } from "./kyc-client";
import { KycHero } from "./kyc-hero";

export const metadata: Metadata = {
  title: { absolute: "Identity verification" },
};

export default async function KycPage({
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

  const { data: signer } = await supabase
    .from("session_signers")
    .select("id, name, email, kyc_status")
    .eq("id", signerId)
    .eq("session_id", id)
    .single();

  if (!session || !signer) redirect("/");

  if (signer.kyc_status === "approved") {
    redirect(`/session/${id}/waiting?token=${token}`);
  }

  const firstName =
    signer.name.trim().split(/\s+/)[0] || signer.name;

  return (
    <main className="relative flex min-h-screen flex-col px-4 pb-6 pt-4 sm:px-8 sm:pb-8 sm:pt-6">
      <SessionPreRoomLogo />
      <div className="flex w-full min-h-0 flex-1 flex-col items-center justify-center py-2 sm:py-4">
        <div className="w-full min-w-0 max-w-2xl">
          <KycHero firstName={firstName} />
          <KycClient
            sessionId={id}
            signerId={signerId}
            signerName={signer.name}
            signerEmail={signer.email}
            veriffEnabled={process.env.NEXT_PUBLIC_VERIFF_ENABLED === "true"}
          />
        </div>
      </div>
    </main>
  );
}
