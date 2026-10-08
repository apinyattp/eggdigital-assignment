exports.up = (pgm) => {
  pgm.sql(`CREATE TABLE provider_connections (
    id uuid PRIMARY KEY,
    creator_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    provider text NOT NULL CHECK (provider IN ('GOOGLE_CALENDAR','ZOOM')),
    provider_subject text NOT NULL,
    provider_account_id text,
    granted_scopes text[] NOT NULL,
    credentials_ciphertext bytea NOT NULL,
    nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
    authentication_tag bytea NOT NULL CHECK (octet_length(authentication_tag) = 16),
    key_version text NOT NULL,
    access_expires_at timestamptz NOT NULL,
    credential_version bigint NOT NULL DEFAULT 1,
    status text NOT NULL CHECK (status IN ('connected','reconnect_required')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (creator_id,provider)
  )`);
};
exports.down = (pgm) => {
  pgm.sql('DROP TABLE provider_connections');
};
