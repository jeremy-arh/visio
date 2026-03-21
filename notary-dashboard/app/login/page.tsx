"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { MY_NOTARY_LOGO_SRC } from "@/lib/brand";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const supabase = createClient();
      const redirectTo =
        process.env.NEXT_PUBLIC_MAGIC_LINK_REDIRECT_URL ||
        `${window.location.origin}/auth/callback`;

      // Force redirect to the dedicated notary dashboard.
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectTo,
          shouldCreateUser: false,
        },
      });
      if (otpError) {
        setError(otpError.message);
      } else {
        setMessage(
          "Magic link sent. Check your email and open the link from this notary domain."
        );
      }
    } catch {
      setError("Failed to send magic link.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main suppressHydrationWarning style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div suppressHydrationWarning style={{ width: "100%", maxWidth: 420, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 24 }}>
        <div style={{ marginBottom: 20, display: "flex", justifyContent: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={MY_NOTARY_LOGO_SRC}
            alt="myNotary"
            style={{ height: 40, width: "auto", maxWidth: "100%", objectFit: "contain" }}
          />
        </div>
        <p style={{ margin: 0, color: "#6b7280", fontSize: 14, textAlign: "center" }}>
          Sign in with a magic link.
        </p>
        <form onSubmit={onSubmit} style={{ marginTop: 20 }}>
          <label htmlFor="email" style={{ fontSize: 13, fontWeight: 600 }}>Email</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="notary@domain.tld"
            style={{
              marginTop: 6,
              width: "100%",
              border: "1px solid #d1d5db",
              borderRadius: 8,
              padding: "10px 12px",
              fontSize: 14,
            }}
          />
          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 14,
              width: "100%",
              border: 0,
              borderRadius: 8,
              padding: "10px 12px",
              fontWeight: 600,
              background: "#111827",
              color: "#fff",
              cursor: "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "Sending…" : "Send magic link"}
          </button>
        </form>
        {message && <p style={{ marginTop: 12, color: "#15803d", fontSize: 13 }}>{message}</p>}
        {error && <p style={{ marginTop: 12, color: "#dc2626", fontSize: 13 }}>{error}</p>}
      </div>
    </main>
  );
}
