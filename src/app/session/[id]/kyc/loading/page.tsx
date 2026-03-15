import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { KycLoadingClient } from "./loading-client";

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
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <KycLoadingClient sessionId={id} signerId={signerId} token={token || ""} />
    </main>
  );
}
