export type SessionStatus =
  | "pending_kyc"
  | "kyc_complete"
  | "waiting_notary"
  | "in_session"
  | "signing"
  | "notary_stamping"
  | "completed";

export type KycStatus = "pending" | "approved" | "declined";
export type DocumentWorkflowStatus =
  | "pending_signers"
  | "pending_notary"
  | "completed"
  | "cancelled";
export type DocumentSignatureRole = "signer" | "notary";
export type DocumentSignatureStatus =
  | "pending"
  | "notified"
  | "signed"
  | "declined"
  | "skipped";

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
  current_document_id: string | null;
  signing_flow_status: Exclude<DocumentWorkflowStatus, "cancelled">;
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

export interface SessionDocument {
  id: string;
  session_id: string;
  document_order: number;
  label: string;
  source: "session" | "submission" | "veriff" | "generated";
  source_url: string | null;
  status: DocumentWorkflowStatus;
  yousign_signature_request_id: string | null;
  signed_document_url: string | null;
  stamped_document_url: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionDocumentSignature {
  id: string;
  session_document_id: string;
  session_signer_id: string | null;
  role: DocumentSignatureRole;
  notary_id: string | null;
  signature_order: number;
  status: DocumentSignatureStatus;
  yousign_signer_id: string | null;
  signed_at: string | null;
  created_at: string;
  updated_at: string;
}
