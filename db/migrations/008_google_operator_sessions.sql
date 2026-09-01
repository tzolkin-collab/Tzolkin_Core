CREATE TABLE operator_auth_flows(
 state_hash text PRIMARY KEY CHECK(length(state_hash)=64),code_verifier text NOT NULL,nonce text NOT NULL,
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE operator_sessions(
 token_hash text PRIMARY KEY CHECK(length(token_hash)=64),subject text NOT NULL,email text NOT NULL,
 expires_at timestamptz NOT NULL,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operator_sessions_active_idx ON operator_sessions(expires_at) WHERE revoked_at IS NULL;
