import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";
import { redirect } from "next/navigation";
import { KycClient } from "./kyc-client";

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

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-2xl">
        <h1 className="text-2xl font-bold mb-2">Vérification d&apos;identité</h1>
        <p className="text-muted-foreground mb-6">
          Bonjour {signer.name}, veuillez compléter la vérification de votre
          identité pour continuer.
        </p>
        <KycClient
          sessionId={id}
          signerId={signerId}
          signerName={signer.name}
          signerEmail={signer.email}
          veriffEnabled={process.env.NEXT_PUBLIC_VERIFF_ENABLED === "true"}
        />
      </div>
    </main>
  );
}
