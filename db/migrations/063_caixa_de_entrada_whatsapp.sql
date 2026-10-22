-- Caixa de entrada do WhatsApp: as mensagens que os leads mandam de volta, recebidas pelo webhook da Evolution API.
--
-- SÓ ADICIONA. Sem esta migração o webhook responde que falta aplicá-la (a Evolution tenta de novo) e a aba Conversas explica. Nada é
-- apagado nem reescrito.
--
-- whatsapp_inbox: uma mensagem RECEBIDA. `provider_message_id` é único (o id da mensagem no WhatsApp): a Evolution reentrega o mesmo
-- evento e a segunda cópia não vira duas linhas. `from_number` é só dígitos com DDI. `lead_id` liga a mensagem ao lead pelo telefone
-- (últimos 8 dígitos) quando existe um; sem lead, a conversa existe do mesmo jeito. O que o Core enviou continua em whatsapp_outbox (062):
-- a conversa é a união das duas, por número. Mídia não é baixada nem guardada: a linha só marca `has_media` e o texto vira "[mídia]".
-- `read_at` marca a conversa como lida; não há DELETE (a role do Core não tem).

CREATE TABLE IF NOT EXISTS whatsapp_inbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 provider_message_id text NOT NULL UNIQUE CHECK (length(provider_message_id) BETWEEN 1 AND 200),
 from_number text NOT NULL CHECK (from_number ~ '^[0-9]{10,15}$'),
 push_name text CHECK (push_name IS NULL OR length(push_name) <= 200),
 body_text text NOT NULL CHECK (length(body_text) BETWEEN 1 AND 4096),
 has_media boolean NOT NULL DEFAULT false,
 lead_id uuid REFERENCES commercial_leads(id),
 product_id text REFERENCES products(id),
 received_at timestamptz NOT NULL,
 read_at timestamptz,
 read_by text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_inbox_conversa ON whatsapp_inbox (from_number, received_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_inbox_nao_lidas ON whatsapp_inbox (received_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS whatsapp_inbox_lead ON whatsapp_inbox (lead_id) WHERE lead_id IS NOT NULL;

COMMENT ON TABLE whatsapp_inbox IS 'Mensagens de WhatsApp recebidas pelo webhook da Evolution API. A conversa é esta tabela mais whatsapp_outbox, por número.';
