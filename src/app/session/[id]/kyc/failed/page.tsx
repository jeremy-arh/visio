import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SessionPreRoomLogo } from "@/components/session-pre-room-logo";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: { absolute: "Verification failed" },
};

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
    <main className="relative flex min-h-screen flex-col px-4 pb-6 pt-4 sm:px-8 sm:pb-8 sm:pt-6">
      <SessionPreRoomLogo />
      <div className="flex w-full min-h-0 flex-1 flex-col items-center justify-center py-2 sm:py-4">
        <Card className="min-w-0 w-full max-w-md">
          <CardHeader className="px-4 sm:px-6">
            <h1 className="text-xl font-bold">Verification failed</h1>
            <p className="text-sm text-muted-foreground">
              Your identity verification was not approved.
            </p>
          </CardHeader>
          <CardContent className="space-y-3 px-4 sm:px-6">
            <p className="text-sm text-muted-foreground">
              Please try verification again to continue.
            </p>
            <Button asChild>
              <a href={retryUrl}>Retry verification</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
