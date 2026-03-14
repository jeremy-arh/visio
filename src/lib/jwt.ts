import { SignJWT, jwtVerify } from "jose";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";

export type JwtPayload = {
  sessionId?: string; // Optionnel pour notaire (accès dashboard)
  signerId?: string;
  notaryId?: string;
  role: "signer" | "notary";
  exp: number;
};

export async function signToken(payload: Omit<JwtPayload, "exp">): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return new SignJWT({
    ...payload,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
  })
    .setProtectedHeader({ alg: "HS256" })
    .sign(secret);
}

export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
    });
    return payload as unknown as JwtPayload;
  } catch {
    return null;
  }
}
