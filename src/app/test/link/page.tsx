import { createServiceClient } from "@/lib/supabase/service";
import { signToken } from "@/lib/jwt";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function TestLinkPage() {
  const supabase = createServiceClient();

  const { data: session } = await supabase
    .from("notarization_sessions")
    .select("id")
    .eq("order_id", "ORD-2024-001")
    .single();

  if (!session) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8">
        <p className="text-amber-600 mb-4">Session ORD-2024-001 non trouvée.</p>
        <p className="text-sm text-muted-foreground mb-4">
          Exécutez supabase/seed_test_data.sql dans le SQL Editor Supabase.
        </p>
        <Link href="/">
          <Button variant="outline">Retour</Button>
        </Link>
      </main>
    );
  }

  const { data: signers } = await supabase
    .from("session_signers")
    .select("id, name")
    .eq("session_id", session.id)
    .limit(1);

  const signer = signers?.[0];

  if (!signer) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-8">
        <p className="text-amber-600 mb-4">Aucun signataire pour cette session.</p>
        <p className="text-sm text-muted-foreground mb-4 max-w-md text-center">
          Créez une session de test pour obtenir un lien valide.
        </p>
        <Link href="/api/test/create-session">
          <Button variant="outline">
            Créer une session de test
          </Button>
        </Link>
        <Link href="/" className="mt-4 text-sm hover:underline block">
          Retour
        </Link>
      </main>
    );
  }

  const token = await signToken({
    sessionId: session.id,
    signerId: signer.id,
    role: "signer",
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const url = `${baseUrl}/session/${session.id}/kyc?token=${token}`;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-xl font-bold mb-4">Lien de test</h1>
      <p className="text-sm text-muted-foreground mb-2">
        Signataire : {signer.name} (session ORD-2024-001)
      </p>
      <a
        href={url}
        className="rounded-lg bg-primary px-4 py-2 text-primary-foreground hover:opacity-90 mb-4"
      >
        Accéder à la session
      </a>
      <p className="text-xs text-muted-foreground max-w-lg break-all text-center">
        {url}
      </p>
      <Link href="/" className="mt-6 text-sm hover:underline">
        Retour à l&apos;accueil
      </Link>
    </main>
  );
}
