import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToken } from "@/lib/jwt";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/session")) return NextResponse.next();

  const token =
    request.nextUrl.searchParams.get("token") ||
    request.cookies.get("session_token")?.value;

  if (!token) {
    const homeUrl = new URL("/", request.url);
    homeUrl.searchParams.set("error", "missing_token");
    return NextResponse.redirect(homeUrl);
  }

  const payload = await verifyToken(token);
  if (!payload) {
    const homeUrl = new URL("/", request.url);
    homeUrl.searchParams.set("error", "invalid_token");
    return NextResponse.redirect(homeUrl);
  }

  const requestHeaders = new Headers(request.headers);
  if (payload.sessionId) requestHeaders.set("x-session-id", payload.sessionId);
  requestHeaders.set("x-role", payload.role);
  if (payload.signerId) requestHeaders.set("x-signer-id", payload.signerId);
  if (payload.notaryId) requestHeaders.set("x-notary-id", payload.notaryId);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  response.cookies.set("session_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });

  return response;
}

export const config = {
  matcher: ["/session/:path*"],
};
