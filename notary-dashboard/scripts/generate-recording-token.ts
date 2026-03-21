/**
 * Génère un token pour accéder à la page d'enregistrement.
 * Usage: npx tsx scripts/generate-recording-token.ts <sessionId>
 * Ex: npx tsx scripts/generate-recording-token.ts e016008b-e74d-41ba-9a99-0e7a32b2a16d
 */
import * as dotenv from "dotenv";
import * as path from "path";
import * as jose from "jose";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const sessionId = process.argv[2];
if (!sessionId) {
  console.error("Usage: npx tsx scripts/generate-recording-token.ts <sessionId>");
  process.exit(1);
}

const secret =
  process.env.RECORDING_SECRET || process.env.JWT_SECRET || "recording-secret-change-me";
const encoded = new TextEncoder().encode(secret);

const token = await new jose.SignJWT({ sessionId, purpose: "recording" })
  .setProtectedHeader({ alg: "HS256" })
  .setExpirationTime("2h")
  .sign(encoded);

const appUrl = process.env.RECORDING_APP_URL || "http://localhost:3010";
const url = `${appUrl}/room/${sessionId}/record?token=${token}`;

console.log("\nToken généré (valide 2h):");
console.log(token);
console.log("\nURL complète:");
console.log(url);
console.log("");
