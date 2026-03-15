-- Workflow de signature par document
CREATE TABLE IF NOT EXISTS session_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES notarization_sessions(id) ON DELETE CASCADE,
  document_order INT NOT NULL CHECK (document_order >= 0),
  label TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'session' CHECK (source IN ('session', 'submission', 'veriff', 'generated')),
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending_signers' CHECK (status IN ('pending_signers', 'pending_notary', 'completed', 'cancelled')),
  yousign_signature_request_id TEXT,
  signed_document_url TEXT,
  stamped_document_url TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, document_order)
);

CREATE INDEX IF NOT EXISTS idx_session_documents_session ON session_documents(session_id);
CREATE INDEX IF NOT EXISTS idx_session_documents_status ON session_documents(status);

CREATE TABLE IF NOT EXISTS session_document_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_document_id UUID NOT NULL REFERENCES session_documents(id) ON DELETE CASCADE,
  session_signer_id UUID REFERENCES session_signers(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('signer', 'notary')),
  notary_id UUID REFERENCES notaries(id),
  signature_order INT NOT NULL DEFAULT 0 CHECK (signature_order >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'notified', 'signed', 'declined', 'skipped')),
  yousign_signer_id TEXT,
  signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_signature_actor_consistency CHECK (
    (role = 'signer' AND session_signer_id IS NOT NULL AND notary_id IS NULL) OR
    (role = 'notary' AND session_signer_id IS NULL AND notary_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_session_document_signatures_signer
  ON session_document_signatures(session_document_id, session_signer_id, role)
  WHERE session_signer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_session_document_signatures_notary
  ON session_document_signatures(session_document_id, notary_id, role)
  WHERE notary_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_session_document_signatures_document
  ON session_document_signatures(session_document_id);

CREATE INDEX IF NOT EXISTS idx_session_document_signatures_status
  ON session_document_signatures(status);

-- Pointeur document courant sur la session pour simplifier l'orchestration
ALTER TABLE notarization_sessions
  ADD COLUMN IF NOT EXISTS current_document_id UUID REFERENCES session_documents(id),
  ADD COLUMN IF NOT EXISTS signing_flow_status TEXT NOT NULL DEFAULT 'pending_signers'
    CHECK (signing_flow_status IN ('pending_signers', 'pending_notary', 'completed'));

CREATE INDEX IF NOT EXISTS idx_sessions_current_document ON notarization_sessions(current_document_id);

-- Realtime sur les nouvelles tables
ALTER PUBLICATION supabase_realtime ADD TABLE session_documents;
ALTER PUBLICATION supabase_realtime ADD TABLE session_document_signatures;
