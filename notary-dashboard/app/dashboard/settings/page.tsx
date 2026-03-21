import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsEditableSections } from "@/components/settings-editable-sections";

export const metadata = {
  title: { absolute: "Settings" },
};

export default async function SettingsPage() {
  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await authSupabase.auth.getUser();

  if (!user?.email) return null;

  const service = createServiceClient();
  const { data: notaryRow } = await service
    .from("notary")
    .select(
      "id, name, full_name, email, phone, city, country, timezone, iban, bic, bank_name, license_number, jurisdiction, commission_number, commission_valid_until"
    )
    .eq("email", user.email)
    .maybeSingle();

  const { data: legacyNotary } = await service
    .from("notaries")
    .select("id, name, email, phone, jurisdiction, commission_number")
    .eq("email", user.email)
    .maybeSingle();

  const initialForm = {
    full_name:
      (notaryRow?.full_name || notaryRow?.name || legacyNotary?.name || "").trim() ||
      (user.user_metadata?.full_name as string | undefined)?.trim() ||
      "",
    phone: (notaryRow?.phone || legacyNotary?.phone || "").trim(),
    city: (notaryRow?.city || "").trim(),
    country: (notaryRow?.country || "").trim(),
    timezone: (notaryRow?.timezone || "").trim(),
    bank_name: (notaryRow?.bank_name || "").trim(),
    iban: (notaryRow?.iban || "").trim(),
    bic: (notaryRow?.bic || "").trim(),
  };

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Account, banking, and professional details for your notary workspace.
        </p>
      </div>

      <div className="space-y-6">
        <Card className="border-gray-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Account</CardTitle>
            <p className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 mt-2">
              Read-only — only an administrator can change the sign-in email or account identifiers.
            </p>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Email
              </p>
              <p className="mt-1 text-gray-900">{user.email}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                User ID
              </p>
              <p className="mt-1 font-mono text-xs text-gray-700 break-all">{user.id}</p>
            </div>
          </CardContent>
        </Card>

        <SettingsEditableSections
          hasNotaryRow={!!notaryRow?.id}
          initial={initialForm}
        />

        {!notaryRow && !legacyNotary && (
          <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-sm">
            No matching row in <code className="text-xs">notary</code> or{" "}
            <code className="text-xs">notaries</code> for this email. Ask an admin to link your
            account before you can edit profile and banking details.
          </p>
        )}

        {(notaryRow || legacyNotary) && (
          <Card className="border-gray-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Legal &amp; notarial</CardTitle>
              <p className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 mt-2">
                Read-only — jurisdiction, commission number, and validity are managed by an
                administrator.
              </p>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Jurisdiction
                </p>
                <p className="mt-1 text-gray-900">
                  {notaryRow?.jurisdiction?.trim() ||
                    legacyNotary?.jurisdiction?.trim() ||
                    "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Commission number
                </p>
                <p className="mt-1 text-gray-900">
                  {notaryRow?.commission_number?.trim() ||
                    notaryRow?.license_number?.trim() ||
                    legacyNotary?.commission_number?.trim() ||
                    "—"}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Valid until
                </p>
                <p className="mt-1 text-gray-900">
                  {notaryRow?.commission_valid_until
                    ? new Date(notaryRow.commission_valid_until + "T12:00:00").toLocaleDateString(
                        "en-GB",
                        { day: "numeric", month: "long", year: "numeric" }
                      )
                    : "—"}
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
