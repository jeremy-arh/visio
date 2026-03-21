import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceClient } from "@/lib/supabase";
import { loadRevenueForNotary } from "@/lib/revenue-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: { absolute: "Revenus" },
};

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

export default async function RevenusPage() {
  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await authSupabase.auth.getUser();

  if (!user?.email) return null;

  const service = createServiceClient();
  const { data: notariesPlural } = await service
    .from("notaries")
    .select("id")
    .eq("email", user.email);

  /** `notarization_sessions.notary_id` → `notaries.id` only (not the `notary` dashboard profile). */
  const notaryIds = (notariesPlural || []).map((n) => n.id);

  if (!notaryIds.length) {
    return (
      <div className="p-8">
        <p className="text-gray-600">
          Notary profile not found for {user.email}. Check the <code>notaries</code> or{" "}
          <code>notary</code> table.
        </p>
      </div>
    );
  }

  const { rows, totalGbp } = await loadRevenueForNotary(notaryIds);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Revenus</h1>
        <p className="mt-1 text-sm text-gray-500">
          Estimated earnings from completed sessions (GBP), using the rules below.
        </p>
      </div>

      <Card className="mb-8 border-gray-200 shadow-sm bg-white">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-gray-900">
            Total (completed sessions)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold tracking-tight text-[#2563eb]">
            {gbp.format(totalGbp)}
          </p>
          <p className="mt-3 text-sm text-gray-600">
            First document <span className="font-medium">£25</span>, then{" "}
            <span className="font-medium">£15</span> per additional document;{" "}
            <span className="font-medium">£15</span> per extra signer (beyond the first);{" "}
            <span className="font-medium">£60</span> per apostille (from submission data
            when available).
          </p>
        </CardContent>
      </Card>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">Session breakdown</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            One row per completed session assigned to you.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Order
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Completed
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Docs
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Signers
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Apostilles
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50/60">
                  <td className="px-6 py-4 font-mono text-xs text-gray-800">{r.orderId}</td>
                  <td className="px-6 py-4 text-gray-600">
                    {new Date(r.completedAt).toLocaleString("en-GB", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums">{r.documentCount}</td>
                  <td className="px-6 py-4 text-right tabular-nums">{r.signerCount}</td>
                  <td className="px-6 py-4 text-right tabular-nums">{r.apostilleCount}</td>
                  <td className="px-6 py-4 text-right font-semibold text-gray-900 tabular-nums">
                    {gbp.format(r.breakdown.totalGbp)}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-sm text-gray-400">
                    No completed sessions yet — amounts will appear here after you close
                    sessions as completed.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
