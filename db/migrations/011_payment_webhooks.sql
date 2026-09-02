-- 011 — Recebimento de webhooks de pagamento (Stripe e Asaas).
--
-- Só REGISTRA. Nenhum efeito colateral: não emite cobrança, não altera contrato,
-- não escreve no Notion. É a base para conciliação, não um motor de cobrança.
--
-- Duas garantias que a fila NON_SEQUENTIALLY do Asaas torna obrigatórias:
--   1. deduplicação — os dois provedores entregam "pelo menos uma vez";
--   2. não retroceder — evento antigo chegando depois não desfaz progresso.

-- Todo evento aceito vira uma linha, inclusive o que não sabemos tratar.
-- Descartar em silêncio é pior do que registrar como não tratado.
CREATE TABLE payment_webhook_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 provider text NOT NULL CHECK (provider IN ('stripe','asaas')),
 -- Id do evento no provedor: é a chave de deduplicação.
 event_id text NOT NULL,
 event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 120),
 charge_ref text CHECK (charge_ref IS NULL OR length(charge_ref) BETWEEN 1 AND 200),
 outcome text NOT NULL CHECK (outcome IN ('applied','duplicate','stale','unhandled','invalid')),
 -- Só o que o painel precisa. NUNCA o corpo bruto: ele carrega dado de pagador.
 detail jsonb NOT NULL DEFAULT '{}'::jsonb,
 received_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (provider, event_id)
);
CREATE INDEX payment_webhook_events_recent ON payment_webhook_events(received_at DESC);
CREATE INDEX payment_webhook_events_charge ON payment_webhook_events(provider, charge_ref);

-- Estado consolidado por cobrança.
--
-- `state_rank` existe para a fila fora de ordem: o progresso só avança.
-- Um PAYMENT_CONFIRMED (30) chegando depois de PAYMENT_RECEIVED (40) é
-- registrado como 'stale' e NÃO rebaixa o estado — senão dinheiro disponível
-- sumiria da tela por causa de atraso de rede.
--
-- Estorno, contestação e cancelamento NÃO são posições da régua: são fatos
-- que convivem com o progresso. Uma cobrança recebida e depois estornada é
-- "recebida E estornada", não "estornada" apagando "recebida".
CREATE TABLE payment_charges (
 provider text NOT NULL CHECK (provider IN ('stripe','asaas')),
 charge_ref text NOT NULL CHECK (length(charge_ref) BETWEEN 1 AND 200),
 state text NOT NULL CHECK (state IN ('created','open','confirmed','received')),
 state_rank integer NOT NULL CHECK (state_rank BETWEEN 0 AND 1000),
 amount_cents bigint CHECK (amount_cents IS NULL OR amount_cents >= 0),
 currency text CHECK (currency IS NULL OR currency ~ '^[a-z]{3}$'),
 overdue_at timestamptz,
 refunded_at timestamptz,
 disputed_at timestamptz,
 canceled_at timestamptz,
 first_seen_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (provider, charge_ref)
);
CREATE INDEX payment_charges_updated ON payment_charges(updated_at DESC);
