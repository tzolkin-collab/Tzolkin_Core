-- Model Context Protocol (MCP) OAuth 2.0: clientes e códigos de autorização para o Google Spark / Gemini
CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id text NOT NULL UNIQUE,
 client_secret_hash text NOT NULL,
 client_secret_prefix text NOT NULL,
 label text NOT NULL CHECK (length(label) BETWEEN 2 AND 100),
 redirect_uris text[] NOT NULL DEFAULT '{}',
 created_by text,
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
 code text PRIMARY KEY,
 client_id text NOT NULL,
 redirect_uri text,
 code_challenge text,
 code_challenge_method text,
 scope text,
 user_actor text,
 expires_at timestamptz NOT NULL,
 used_at timestamptz
);

CREATE INDEX IF NOT EXISTS mcp_oauth_clients_id_idx ON mcp_oauth_clients(client_id) WHERE revoked_at IS NULL;
