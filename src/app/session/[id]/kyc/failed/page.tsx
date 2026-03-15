import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default async function KycFailedPage({
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

  const retryUrl = `/session/${id}/kyc${token ? `?token=${token}` : ""}`;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="text-xl font-bold">Vérification échouée</h1>
          <p className="text-sm text-muted-foreground">
            Votre vérification d&apos;identité n&apos;a pas été validée.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Veuillez recommencer la vérification pour continuer.
          </p>
          <Button asChild>
            <a href={retryUrl}>Recommencer la vérification</a>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
