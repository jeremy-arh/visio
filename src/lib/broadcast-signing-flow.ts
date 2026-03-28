import type { SupabaseClient } from "@supabase/supabase-js";

export const SESSION_ROOM_CHANNEL = (sessionId: string) => `session-room-${sessionId}`;

/** Sends a one-shot broadcast on the session Realtime channel. */
function sendBroadcast(
  supabase: SupabaseClient,
  sessionId: string,
  event: string,
  payload: Record<string, unknown> = {}
): void {
  const ch = supabase.channel(SESSION_ROOM_CHANNEL(sessionId));
  ch.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      void ch.send({ type: "broadcast", event, payload: { ts: Date.now(), ...payload } });
      setTimeout(() => void supabase.removeChannel(ch), 800);
    }
  });
}

/**
 * Notifies all room clients immediately when the notary starts the signing flow.
 * Uses Realtime Broadcast (no RLS).
 */
export function broadcastSigningFlowStarted(supabase: SupabaseClient, sessionId: string): void {
  sendBroadcast(supabase, sessionId, "signing_flow_started");
}

/**
 * Notifies all room clients immediately when a signer has signed.
 * Received by all other signers + the notary room → instant UI update.
 */
export function broadcastSignerSigned(supabase: SupabaseClient, sessionId: string, signerId: string): void {
  sendBroadcast(supabase, sessionId, "signer_signed", { signerId });
}
