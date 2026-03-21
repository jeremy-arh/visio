/**
 * Enregistrement serveur de la session via Playwright.
 * Usage: npx ts-node scripts/record-session.ts <sessionId> <token> <appUrl>
 * Ex: npx ts-node scripts/record-session.ts abc-123 eyJ... http://localhost:3010
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const [sessionId, token, appUrl] = process.argv.slice(2);
if (!sessionId || !token || !appUrl) {
  console.error("[REC-SERVER] Usage: record-session <sessionId> <token> <appUrl>");
  process.exit(1);
}

const recordUrl = `${appUrl.replace(/\/$/, "")}/room/${sessionId}/record?token=${encodeURIComponent(token)}`;
console.log("[REC-SERVER] Starting recording:", recordUrl);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!supabaseUrl || !supabaseKey) {
  console.error("[REC-SERVER] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: path.join(process.cwd(), ".recordings"),
      size: { width: 1280, height: 720 },
    },
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  try {
    await page.goto(recordUrl, { waitUntil: "networkidle", timeout: 60000 });
    console.log("[REC-SERVER] Page loaded, recording...");

    // Attendre : session complétée, arrêt demandé (quitte visio / ferme page), ou max 2h
    const maxDurationMs = 2 * 60 * 60 * 1000;
    const pollIntervalMs = 5000;
    const start = Date.now();

    while (Date.now() - start < maxDurationMs) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      const { data } = await supabase
        .from("notarization_sessions")
        .select("status, recording_stop_requested_at")
        .eq("id", sessionId)
        .single();
      if (data?.status === "completed") {
        console.log("[REC-SERVER] Session completed, stopping recording");
        break;
      }
      if (data?.recording_stop_requested_at) {
        console.log("[REC-SERVER] Stop requested (left visio / closed page), stopping recording");
        break;
      }
    }

    // Délai pour capturer les dernières secondes avant fermeture
    console.log("[REC-SERVER] Finalizing recording (3s)...");
    await new Promise((r) => setTimeout(r, 3000));
  } catch (err) {
    console.error("[REC-SERVER] Recording error:", err);
  } finally {
    await context.close();
  }

  const video = page.video();
  if (!video) {
    console.error("[REC-SERVER] No video recorded");
    process.exit(1);
  }

  const recordingsDir = path.join(process.cwd(), ".recordings");
  fs.mkdirSync(recordingsDir, { recursive: true });
  const outputPath = path.join(recordingsDir, `rec_${sessionId}_${Date.now()}.webm`);
  await video.saveAs(outputPath);
  console.log("[REC-SERVER] Video saved to:", outputPath);

  const fileBuffer = fs.readFileSync(outputPath);
  const fileName = `screen_${Date.now()}.webm`;
  const filePath = `session_${sessionId}/${fileName}`;

  const { error } = await supabase.storage
    .from("session-recordings")
    .upload(filePath, fileBuffer, { contentType: "video/webm", upsert: true });

  if (error) {
    console.error("[REC-SERVER] Upload failed:", error);
    process.exit(1);
  }

  console.log("[REC-SERVER] Uploaded to session-recordings/" + filePath);

  // Cleanup local file
  try {
    fs.unlinkSync(outputPath);
  } catch {}

  await supabase.from("audit_trail").insert({
    session_id: sessionId,
    event_type: "video_recording_stopped",
    actor_type: "system",
    metadata: { type: "server", file: filePath } as unknown as Record<string, unknown>,
  }).catch(() => {});

  console.log("[REC-SERVER] Done");
}

main().catch((err) => {
  console.error("[REC-SERVER] Fatal:", err);
  process.exit(1);
});
