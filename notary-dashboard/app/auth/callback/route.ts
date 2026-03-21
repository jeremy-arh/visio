import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";

const EMAIL_OTP_TYPES: readonly EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
];

function parseEmailOtpType(raw: string | null): EmailOtpType | null {
  if (!raw) return null;
  return EMAIL_OTP_TYPES.includes(raw as EmailOtpType) ? (raw as EmailOtpType) : null;
}

/**
 * Exchanges PKCE (`code`) or email/invite links (`token_hash` + `type`).
 * Back-office invites often use token_hash, not only `code`.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const next = requestUrl.searchParams.get("next") ?? "/dashboard";
  const nextPath = next.startsWith("/") ? next : "/dashboard";

  const oauthError = requestUrl.searchParams.get("error");
  const oauthDesc = requestUrl.searchParams.get("error_description");
  if (oauthError) {
    const msg = oauthDesc || oauthError;
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(msg)}`, requestUrl.origin)
    );
  }

  const code = requestUrl.searchParams.get("code");
  const token_hash = requestUrl.searchParams.get("token_hash");
  const typeParam = requestUrl.searchParams.get("type");

  const response = NextResponse.redirect(new URL(nextPath, requestUrl.origin));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[auth/callback] exchangeCodeForSession", error.message);
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(error.message)}`, requestUrl.origin)
      );
    }
    return response;
  }

  if (token_hash) {
    const type = parseEmailOtpType(typeParam);
    if (!type) {
      return NextResponse.redirect(
        new URL(
          "/login?error=" + encodeURIComponent("Invalid or missing type in email link"),
          requestUrl.origin
        )
      );
    }
    const { error } = await supabase.auth.verifyOtp({ token_hash, type });
    if (error) {
      console.error("[auth/callback] verifyOtp", error.message);
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(error.message)}`, requestUrl.origin)
      );
    }
    return response;
  }

  return NextResponse.redirect(
    new URL(
      "/login?error=" + encodeURIComponent("Missing authentication parameters in link"),
      requestUrl.origin
    )
  );
}
