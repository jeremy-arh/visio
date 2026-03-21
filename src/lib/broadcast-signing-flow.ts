import type { SupabaseClient } from "@supabase/supabase-js";

const ROOM_CHANNEL_PREFIX = "session-room-";

/**
 * Notifies signer room clients immediately when the notary starts the signing flow.
 * Uses Realtime Broadcast (no RLS) — same channel name as `room-client.tsx`.
 */
export function broadcastSigningFlowStarted(supabase: SupabaseClient, sessionId: string): void {
  const ch = supabase.channel(`${ROOM_CHANNEL_PREFIX}${sessionId}`);
  ch.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      void ch.send({
        type: "broadcast",
        event: "signing_flow_started",
        payload: { ts: Date.now() },
      });
      setTimeout(() => {
        void supabase.removeChannel(ch);
      }, 800);
    }
  });
}
