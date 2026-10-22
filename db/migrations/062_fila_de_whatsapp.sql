-- Fila de WhatsApp (transactional outbox) e lista de supressão. Mesmo desenho da fila de e-mail (051), para a Evolution API.
--
-- SÓ ADICIONA. Sem esta migração as ações "Enviar WhatsApp" e "Avisar a equipe" respondem que falta aplicá-la (a falha fica no histórico
-- da automação e o resto do funil segue). Nada é apagado nem reescrito.
--
-- 1) whatsapp_outbox: uma mensagem A ENVIAR (ou já enviada). A automação NÃO manda mensagem: grava uma linha aqui, DENTRO da mesma
--    transação do evento (lead criado, etc.). Quem manda é o consumidor da fila, em ritmo baixo e só com o envio ligado
--    (WHATSAPP_ENVIO=ligado). `idempotency_key` é único: o mesmo evento reentregue não enfileira duas vezes. O texto já fica
--    RENDERIZADO (o que foi enviado é o que está aqui). `to_number` guarda só dígitos com DDI (55...).
-- 2) whatsapp_suppressions: números que NÃO devem receber mais nada (pediu para sair, sem WhatsApp). Consultada antes de cada envio.
--    Remover é revogar (`revoked_at`): a role do Core não tem DELETE.

CREATE TABLE IF NOT EXISTS whatsapp_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 300),
 kind text NOT NULL CHECK (kind IN ('lead','equipe','teste')),
 product_id text REFERENCES products(id),
 event text,
 automation_id uuid REFERENCES automations(id),
 lead_id uuid REFERENCES commercial_leads(id),
 to_number text NOT NULL CHECK (to_number ~ '^[0-9]{10,15}$'),
 to_name text,
 body_text text NOT NULL CHECK (length(body_text) BETWEEN 1 AND 4096),
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
CREATE INDEX IF NOT EXISTS whatsapp_outbox_pendentes ON whatsapp_outbox (next_attempt_at) WHERE status IN ('queued','sending');
CREATE INDEX IF NOT EXISTS whatsapp_outbox_recentes ON whatsapp_outbox (created_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_outbox_lead ON whatsapp_outbox (lead_id) WHERE lead_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS whatsapp_suppressions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 number text NOT NULL CHECK (number ~ '^[0-9]{10,15}$'),
 reason text NOT NULL DEFAULT 'manual' CHECK (reason IN ('manual','pediu_para_sair','sem_whatsapp')),
 created_by text,
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_suppressions_ativa ON whatsapp_suppressions (number) WHERE revoked_at IS NULL;

COMMENT ON TABLE whatsapp_outbox IS 'Fila de WhatsApp. A automação grava aqui na transação do evento; o consumidor envia pela Evolution API, com retentativas.';
COMMENT ON TABLE whatsapp_suppressions IS 'Números que não recebem mais WhatsApp do Core.';
