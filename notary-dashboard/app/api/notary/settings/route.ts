import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createServiceClient } from "@/lib/supabase";
import { isNotaryUserWithAuthLookup } from "@/lib/notary-auth-server";

const MAX_LEN = 512;

type Body = {
  full_name?: unknown;
  phone?: unknown;
  city?: unknown;
  country?: unknown;
  timezone?: unknown;
  bank_name?: unknown;
  iban?: unknown;
  bic?: unknown;
};

function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length ? t.slice(0, MAX_LEN) : "";
}

/**
 * Updates notary profile: only allowed fields (not account or legal data).
 */
export async function PATCH(request: NextRequest) {
  const authResponse = NextResponse.next();
  const authSupabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            authResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await authSupabase.auth.getUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await isNotaryUserWithAuthLookup(user))) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  let body: Body = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object") body = parsed as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const payload = {
    full_name: str(body.full_name),
    phone: str(body.phone),
    city: str(body.city),
    country: str(body.country),
    timezone: str(body.timezone),
    bank_name: str(body.bank_name),
    iban: str(body.iban),
    bic: str(body.bic),
  };

  const service = createServiceClient();
  const { data: row, error: findErr } = await service
    .from("notary")
    .select("id")
    .eq("email", user.email)
    .maybeSingle();

  if (findErr) {
    console.error("[notary/settings]", findErr.message);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
  if (!row?.id) {
    return NextResponse.json(
      { error: "No notary profile for this email" },
      { status: 404 }
    );
  }

  const { data: updated, error: updErr } = await service
    .from("notary")
    .update({
      full_name: payload.full_name ?? null,
      phone: payload.phone ?? null,
      city: payload.city ?? null,
      country: payload.country ?? null,
      timezone: payload.timezone ?? null,
      bank_name: payload.bank_name ?? null,
      iban: payload.iban ?? null,
      bic: payload.bic ?? null,
    })
    .eq("id", row.id)
    .eq("email", user.email)
    .select(
      "id, name, full_name, email, phone, city, country, timezone, iban, bic, bank_name, license_number, jurisdiction, commission_number, commission_valid_until"
    )
    .maybeSingle();

  if (updErr) {
    console.error("[notary/settings] update", updErr.message);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, notary: updated });
}
