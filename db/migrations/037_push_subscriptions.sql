-- 037 — Assinaturas de push: o aparelho do operador recebe o aviso de lead novo.
--
-- O service worker do Core (apps/web/public/sw.js) já exibe uma notificação push
-- recebida, mas nada assinava nem enviava: não havia VAPID, tabela nem rota
-- (STATUS.md §3). Esta migração cria o lado do servidor que faltava.
--
-- UMA LINHA POR APARELHO (endpoint). O mesmo operador pode ter vários (celular e
-- computador); o mesmo aparelho assinado por outro operador passa a ser dele.
--
-- TÓPICOS. `topics` guarda o que a pessoa quer receber. Hoje só existe
-- 'commercial.lead' (lead novo chegou pelo intake). O CHECK é a lista fechada: um
-- tópico novo entra aqui, junto com o código que o dispara. O roadmap prevê tópicos
-- por produto e por serviço; esta tabela comporta isso sem mudar de forma.
--
-- SEM DELETE. A role do Core não apaga linha (mesma regra da 034). Desligar é
-- `revoked_at`. Religar o mesmo aparelho limpa `revoked_at` (ver PUT da rota).
--
-- SEM AUDIT_EVENTS. A trilha de auditoria exige tenant_id, e uma assinatura de push
-- não pertence a organização nenhuma. O histórico mínimo vive na própria linha
-- (criada, último sucesso, última falha, contagem de falhas, revogada).
--
-- O que é guardado: endpoint e chaves de criptografia da assinatura. Eles só servem
-- para enviar um push a ESTE aparelho e não permitem ler nada dele. Mesmo assim ficam
-- fora de qualquer resposta de API (a listagem devolve só id, tópicos e datas).
--
-- IDEMPOTENTE. Uma transação por migração (scripts/migrate.mjs): falhou, nada fica.

CREATE TABLE IF NOT EXISTS push_subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operator_subject text NOT NULL,
 operator_email text,
 endpoint text NOT NULL,
 p256dh text NOT NULL,
 auth text NOT NULL,
 topics text[] NOT NULL DEFAULT ARRAY['commercial.lead']::text[],
 user_agent text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 last_success_at timestamptz,
 last_failure_at timestamptz,
 failure_count integer NOT NULL DEFAULT 0,
 revoked_at timestamptz,
 CONSTRAINT push_subscriptions_endpoint_unique UNIQUE (endpoint),
 CONSTRAINT push_subscriptions_endpoint_https CHECK (endpoint ~ '^https://' AND length(endpoint) <= 600),
 CONSTRAINT push_subscriptions_keys_size CHECK (length(p256dh) BETWEEN 80 AND 120 AND length(auth) BETWEEN 16 AND 40),
 CONSTRAINT push_subscriptions_topics_valid CHECK (topics <@ ARRAY['commercial.lead']::text[] AND cardinality(topics) >= 1),
 CONSTRAINT push_subscriptions_failures_nonneg CHECK (failure_count >= 0)
);

-- Quem recebe o aviso de um tópico: as ativas que o assinaram.
CREATE INDEX IF NOT EXISTS push_subscriptions_ativas_idx
 ON push_subscriptions USING gin (topics) WHERE revoked_at IS NULL;

-- "Meus aparelhos": listar e desligar só as do operador logado.
CREATE INDEX IF NOT EXISTS push_subscriptions_operador_idx
 ON push_subscriptions (operator_subject) WHERE revoked_at IS NULL;

COMMENT ON TABLE push_subscriptions IS
 'Aparelhos de operador que aceitaram receber push. Endpoint e chaves nunca saem em resposta de API.';
