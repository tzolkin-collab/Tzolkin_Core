-- Credenciais de integração guardadas pela TELA (Configurações → Integrações), no lugar de variáveis do `.env`.
--
-- SÓ ADICIONA. Sem esta migração tudo continua vindo do ambiente, como antes: a tela explica que falta aplicá-la e nada quebra.
--
-- 1) integration_credentials: UM valor por variável (`nome`, ex.: VERCEL_TOKEN), CIFRADO (AES-256-GCM, chave CORE_SECRETS_KEY fora do banco).
--    Trocar um valor revoga a linha antiga e insere outra; remover só revoga (a role do Core não tem DELETE). O valor nunca sai do servidor:
--    a tela só vê "configurada", a data, quem salvou e a impressão digital (não reversível).
-- 2) integration_credentials_history: quem mudou o quê e quando. NUNCA guarda valor, só nome, ação e impressão digital.

CREATE TABLE IF NOT EXISTS integration_credentials (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 provider text NOT NULL CHECK (length(provider) BETWEEN 2 AND 40),
 nome text NOT NULL CHECK (nome ~ '^[A-Z][A-Z0-9_]{2,63}$'),
 token_ciphertext bytea NOT NULL,
 token_iv bytea NOT NULL,
 token_tag bytea NOT NULL,
 fingerprint text NOT NULL,
 updated_by text,
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);
-- Uma linha ATIVA por variável.
CREATE UNIQUE INDEX IF NOT EXISTS integration_credentials_ativa ON integration_credentials (nome) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS integration_credentials_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 provider text NOT NULL,
 nome text NOT NULL,
 action text NOT NULL CHECK (action IN ('set','removed')),
 fingerprint text,
 actor text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS integration_credentials_history_recente ON integration_credentials_history (provider, created_at DESC);

COMMENT ON TABLE integration_credentials IS 'Valor cifrado de uma variável de integração, definido pela tela. Vence o .env.';
COMMENT ON TABLE integration_credentials_history IS 'Quem definiu ou removeu cada credencial. Sem valores.';
