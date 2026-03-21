import { SupabaseClient } from "@supabase/supabase-js";

export type AuditEventType =
  // Session lifecycle
  | "session_created"
  | "session_started"
  | "session_completed"
  | "session_cancelled"
  // KYC
  | "kyc_started"
  | "kyc_approved"
  | "kyc_declined"
  | "kyc_resubmission_requested"
  // Video (Daily.co)
  | "video_room_created"
  | "video_joined"
  | "video_left"
  | "video_recording_started"
  | "video_recording_stopped"
  // Signing flow
  | "signing_flow_started"
  | "signing_flow_advanced"
  | "signer_invited"
  | "signer_signed"
  | "signer_signed_inapp"
  | "notary_invited"
  | "notary_joined"
  | "notary_signed"
  | "document_completed"
  | "yousign_request_created"
  | "yousign_embed_opened"
  // Errors
  | "signing_error"
  | "kyc_error";

export interface AuditEventPayload {
  sessionId: string;
  eventType: AuditEventType;
  actorType?: "signer" | "notary" | "system";
  actorId?: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
  sessionSignerId?: string | null;
  documentId?: string | null;
  documentLabel?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function logAuditEvent(
  supabase: SupabaseClient,
  payload: AuditEventPayload
): Promise<void> {
  try {
    await supabase.from("audit_trail").insert({
      session_id: payload.sessionId,
      event_type: payload.eventType,
      actor_type: payload.actorType ?? "system",
      actor_id: payload.actorId ?? null,
      actor_name: payload.actorName ?? null,
      actor_email: payload.actorEmail ?? null,
      session_signer_id: payload.sessionSignerId ?? null,
      document_id: payload.documentId ?? null,
      document_label: payload.documentLabel ?? null,
      metadata: payload.metadata ?? null,
      ip_address: payload.ipAddress ?? null,
      user_agent: payload.userAgent ?? null,
    });
  } catch {
    // Ne jamais crasher l'app sur un échec de log
  }
}

/** Extrait IP + User-Agent depuis les headers d'une NextRequest */
export function extractRequestMeta(headers: Headers): { ipAddress: string | null; userAgent: string | null } {
  return {
    ipAddress: headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? headers.get("x-real-ip") ?? null,
    userAgent: headers.get("user-agent") ?? null,
  };
}
