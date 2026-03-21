import * as jose from "jose";

const RECORDING_SECRET = process.env.RECORDING_SECRET || process.env.JWT_SECRET || "recording-secret-change-me";

export async function createRecordingToken(sessionId: string, expiresInSeconds = 7200): Promise<string> {
  const secret = new TextEncoder().encode(RECORDING_SECRET);
  return new jose.SignJWT({ sessionId, purpose: "recording" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .sign(secret);
}

export async function verifyRecordingToken(token: string): Promise<{ sessionId: string } | null> {
  try {
    const secret = new TextEncoder().encode(RECORDING_SECRET);
    const { payload } = await jose.jwtVerify(token, secret);
    if (payload.purpose !== "recording" || !payload.sessionId) return null;
    return { sessionId: String(payload.sessionId) };
  } catch {
    return null;
  }
}
