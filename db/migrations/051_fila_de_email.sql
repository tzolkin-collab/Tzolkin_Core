-- Fila de e-mail (transactional outbox) e lista de supressão. Base das automações de e-mail.
--
-- SÓ ADICIONA. Sem esta migração a automação "Enviar e-mail" responde que falta aplicá-la (a falha fica no histórico da automação, e o
-- resto do funil segue), e a tela de Atividade explica. Nada é apagado nem reescrito.
--
-- 1) email_outbox: um e-mail A ENVIAR (ou já enviado). A automação NÃO manda e-mail: grava uma linha aqui, DENTRO da mesma transação do
--    evento (lead criado, etc.), então ou o lead e o e-mail existem juntos ou nenhum dos dois. Quem manda é o consumidor da fila
--    (processo do Core, com tentativa, espera crescente e limite de ritmo). `idempotency_key` é único: o mesmo evento reentregue não
--    enfileira duas vezes. O assunto e o corpo já ficam RENDERIZADOS (o que foi enviado é o que está aqui, mesmo que o modelo mude depois).
-- 2) email_suppressions: endereços que NÃO devem receber mais nada (pediu para sair, voltou como inválido). Consultada antes de cada envio.
--    Remover é revogar (`revoked_at`): a role do Core não tem DELETE.

CREATE TABLE IF NOT EXISTS email_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 300),
 kind text NOT NULL CHECK (kind IN ('automacao','teste')),
 product_id text REFERENCES products(id),
 template_slug text,
 event text,
 automation_id uuid REFERENCES automations(id),
 lead_id uuid REFERENCES commercial_leads(id),
 to_email text NOT NULL CHECK (length(to_email) BETWEEN 5 AND 254),
 to_name text,
 subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 300),
 body_text text NOT NULL,
 body_html text NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','cancelled','suppressed')),
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 locked_at timestamptz,
 provider_message_id text,
 last_error text,
 created_by text,
 created_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS email_outbox_pendentes ON email_outbox (next_attempt_at) WHERE status IN ('queued','sending');
CREATE INDEX IF NOT EXISTS email_outbox_recentes ON email_outbox (created_at DESC);
CREATE INDEX IF NOT EXISTS email_outbox_lead ON email_outbox (lead_id) WHERE lead_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_suppressions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 email text NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 5 AND 254),
 reason text NOT NULL DEFAULT 'manual' CHECK (reason IN ('manual','pediu_para_sair','invalido')),
 created_by text,
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS email_suppressions_ativa ON email_suppressions (email) WHERE revoked_at IS NULL;

COMMENT ON TABLE email_outbox IS 'Fila de e-mail. A automação grava aqui na transação do evento; o consumidor envia, com retentativas.';
COMMENT ON TABLE email_suppressions IS 'Endereços que não recebem mais e-mail do Core.';
