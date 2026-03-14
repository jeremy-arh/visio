export type SessionStatus =
  | "pending_kyc"
  | "kyc_complete"
  | "waiting_notary"
  | "in_session"
  | "signing"
  | "notary_stamping"
  | "completed";

export type KycStatus = "pending" | "approved" | "declined";

export interface Notary {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  commission_number: string | null;
  jurisdiction: string | null;
  stamp_image_url: string | null;
}

export interface NotarizationSession {
  id: string;
  order_id: string;
  status: SessionStatus;
  document_url: string | null;
  stamped_document_url: string | null;
  signed_document_url: string | null;
  notary_id: string | null;
  daily_room_url: string | null;
  yousign_signature_request_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionSigner {
  id: string;
  session_id: string;
  name: string;
  email: string;
  order: number;
  kyc_status: KycStatus;
  signed_at: string | null;
  yousign_signer_id: string | null;
  created_at: string;
}
