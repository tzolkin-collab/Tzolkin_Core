-- Model Context Protocol (MCP): tokens de acesso para bots e agentes de IA externos (ex.: Google Spark).
--
-- Armazena apenas o hash SHA-256 do token gerado pela tela de Configurações ou ambiente.
-- O token real (mcp_live_...) é exibido apenas uma vez para o operador copiar para o bot.

CREATE TABLE IF NOT EXISTS mcp_tokens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 label text NOT NULL CHECK (length(label) BETWEEN 2 AND 100),
 token_hash text NOT NULL UNIQUE,
 token_prefix text NOT NULL,
 created_by text,
 last_used_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS mcp_tokens_hash_idx ON mcp_tokens(token_hash) WHERE revoked_at IS NULL;

COMMENT ON TABLE mcp_tokens IS 'Tokens de acesso para bots e agentes externos via Model Context Protocol (MCP / Google Spark).';
