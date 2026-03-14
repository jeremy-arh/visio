import Link from "next/link";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-bold mb-6">My Notary</h1>
      <p className="text-muted-foreground text-center max-w-md mb-8">
        Outil de notarisation à distance. Les signataires accèdent via le lien
        reçu par email.
      </p>
      <Link
        href="/api/test/create-session"
        className="rounded-lg bg-primary px-6 py-3 text-primary-foreground hover:opacity-90 font-medium"
      >
        Démarrer une session de test
      </Link>
      {error === "missing_token" && (
        <p className="text-sm text-amber-600 mt-4">Lien manquant ou expiré.</p>
      )}
      {error === "invalid_token" && (
        <p className="text-sm text-amber-600 mt-4">Lien invalide ou expiré.</p>
      )}
    </main>
  );
}
