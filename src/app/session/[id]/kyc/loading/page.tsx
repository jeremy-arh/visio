import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SessionPreRoomLogo } from "@/components/session-pre-room-logo";
import { KycLoadingClient } from "./loading-client";

export const metadata: Metadata = {
  title: { absolute: "Verification in progress" },
};

export default async function KycLoadingPage({
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

  return (
    <main className="relative flex min-h-screen flex-col px-4 pb-6 pt-4 sm:px-8 sm:pb-8 sm:pt-6">
      <SessionPreRoomLogo />
      <div className="flex w-full min-h-0 flex-1 flex-col items-center justify-center py-2 sm:py-4">
        <KycLoadingClient sessionId={id} signerId={signerId} token={token || ""} />
      </div>
    </main>
  );
}
