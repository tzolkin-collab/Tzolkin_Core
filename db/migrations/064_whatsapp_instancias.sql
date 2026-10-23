-- WhatsApp com várias instâncias da Evolution: cada mensagem passa a saber de qual instância veio e por qual vai sair.
--
-- SÓ ADICIONA (duas colunas opcionais e índices). `instance` NULL = a instância padrão (EVOLUTION_INSTANCE), que é como tudo já gravado
-- antes desta migração foi enviado e recebido: nada é reescrito. Sem a migração, o Core segue com a instância padrão e a tela avisa.

ALTER TABLE whatsapp_inbox ADD COLUMN IF NOT EXISTS instance text CHECK (instance IS NULL OR instance ~ '^[A-Za-z0-9_.-]{1,64}$');
ALTER TABLE whatsapp_outbox ADD COLUMN IF NOT EXISTS instance text CHECK (instance IS NULL OR instance ~ '^[A-Za-z0-9_.-]{1,64}$');

CREATE INDEX IF NOT EXISTS whatsapp_inbox_instancia ON whatsapp_inbox (instance, from_number, received_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_outbox_instancia ON whatsapp_outbox (instance, to_number, created_at DESC);

COMMENT ON COLUMN whatsapp_inbox.instance IS 'Instância da Evolution que recebeu a mensagem. NULL = a instância padrão.';
COMMENT ON COLUMN whatsapp_outbox.instance IS 'Instância da Evolution que envia a mensagem. NULL = a instância padrão.';
