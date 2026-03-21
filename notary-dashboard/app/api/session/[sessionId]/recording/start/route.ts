import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createServiceClient } from "@/lib/supabase";
import { isNotaryUserWithAuthLookup } from "@/lib/notary-auth-server";
import { createRecordingToken } from "@/lib/recording-token";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    const authSupabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: () => {},
        },
      }
    );

    const { data: { user } } = await authSupabase.auth.getUser();
    if (!user?.email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!(await isNotaryUserWithAuthLookup(user))) {
      return NextResponse.json({ error: "Notaries only" }, { status: 403 });
    }

    const supabase = createServiceClient();
    const { data: session, error: sessionError } = await supabase
      .from("notarization_sessions")
      .select("id, daily_room_url, status")
      .eq("id", sessionId)
      .single();

    if (sessionError) {
      console.error("[REC-API] Session fetch error:", sessionError);
      return NextResponse.json(
        { error: "Database error", details: sessionError.message },
        { status: 500 }
      );
    }
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (!session.daily_room_url) {
      return NextResponse.json(
        { error: "Video room not created yet. Join the call first." },
        { status: 400 }
      );
    }

    await supabase
      .from("notarization_sessions")
      .update({ recording_stop_requested_at: null, updated_at: new Date().toISOString() })
      .eq("id", sessionId);

    const token = await createRecordingToken(sessionId);
    const appUrl =
      process.env.RECORDING_APP_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
      "http://localhost:3010";

    const scriptPath = path.join(process.cwd(), "scripts", "record-session.ts");
    if (!fs.existsSync(scriptPath)) {
      console.error("[REC-API] Script not found:", scriptPath, "cwd:", process.cwd());
      return NextResponse.json(
        { error: "Recording script not found", path: scriptPath },
        { status: 500 }
      );
    }

    const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
    const env = {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };

    if (process.platform === "win32") {
      // On Windows, detached+shell can show a window. Use VBScript to launch without a window.
      const escapeVbs = (s: string) => String(s).replace(/"/g, '""');
      const allArgs = [process.execPath, tsxCli, scriptPath, sessionId, token, appUrl].map(escapeVbs);
      const cmd = allArgs.map((a) => `"${a}"`).join(" ");
      const cwd = process.cwd().replace(/"/g, '""');
      const vbsContent = [
        `Set o = CreateObject("WScript.Shell")`,
        `o.CurrentDirectory = "${cwd}"`,
        `o.Run "${cmd.replace(/"/g, '""')}", 0, False`,
      ].join("\n");
      const vbsPath = path.join(os.tmpdir(), `rec-${sessionId}-${Date.now()}.vbs`);
      fs.writeFileSync(vbsPath, vbsContent, "utf8");
      const child = spawn("wscript.exe", [vbsPath], {
        detached: true,
        stdio: "ignore",
        shell: false,
        windowsHide: true,
        cwd: process.cwd(),
        env,
      });
      child.unref();
      setTimeout(() => fs.unlink(vbsPath, () => {}), 5000);
    } else {
      const child = spawn(process.execPath, [tsxCli, scriptPath, sessionId, token, appUrl], {
        detached: true,
        stdio: "ignore",
        shell: false,
        windowsHide: true,
        cwd: process.cwd(),
        env,
      });
      child.on("error", (spawnErr) => console.error("[REC-API] Spawn error:", spawnErr));
      child.unref();
    }

    return NextResponse.json({ ok: true, message: "Server recording started" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[REC-API] Error:", message, stack);
    return NextResponse.json(
      {
        error: "Recording start failed",
        details: process.env.NODE_ENV === "development" ? message : undefined,
      },
      { status: 500 }
    );
  }
}
