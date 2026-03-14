import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";
import { redirect } from "next/navigation";
import { WaitingClient } from "./waiting-client";

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

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <WaitingClient sessionId={id} status={session.status} token={token || ""} />
    </main>
  );
}
