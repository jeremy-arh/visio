import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default async function CompletedPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const headersList = await headers();
  const signerId = headersList.get("x-signer-id");

  if (!signerId) redirect("/");

  const supabase = createServiceClient();
  const { data: session } = await supabase
    .from("notarization_sessions")
    .select("id, signed_document_url")
    .eq("id", id)
    .single();

  if (!session) redirect("/");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="text-2xl font-bold text-green-600">Session terminée</h1>
          <p className="text-muted-foreground">
            La notarisation a été complétée avec succès.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {session.signed_document_url && (
            <a
              href={session.signed_document_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-primary hover:underline"
            >
              Télécharger le document signé
            </a>
          )}
          <Link href="/">
            <Button variant="outline">Retour à l&apos;accueil</Button>
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
