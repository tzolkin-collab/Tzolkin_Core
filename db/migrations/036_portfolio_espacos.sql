-- 036 — Portfólio: espaços. Um nome só para plataforma, o tipo "Consultoria e
-- assessoria" e tags.
--
-- Decidido pelo dono em 2026-09-29:
--   * Produto e Plataforma viram um tipo só, "Plataforma" (software B2B ou B2C que o
--     cliente usa, muitas vezes por assinatura). O levantamento do mesmo dia mostrou
--     que as regras eram idênticas (ADR 0007): só o rótulo mudava. 'product' deixa de
--     ser usado; o valor antigo continua aceito pelo CHECK, para o código que ainda o
--     grave e para o rollback.
--   * Novo tipo 'advisory' — Consultoria e assessoria — com tags.
--
-- EXPANSÃO, NÃO CONTRAÇÃO. Nada é apagado: o CHECK ganha um valor, a tabela ganha uma
-- coluna com padrão, e a única mudança de dado é 'product' → 'platform', com trilha em
-- portfolio_audit como a 032 fez. O código anterior lê 'platform' com as mesmas regras
-- de 'product', então esta migração pode rodar ANTES do deploy sem quebrar nada.
--
-- ORDEM: aplicar ANTES do deploy do código que grava `tags` (o Portfólio passa a
-- selecionar a coluna) e que oferece o tipo 'advisory' (o CHECK precisa aceitá-lo).
--
-- FORA DESTA MIGRAÇÃO, DE PROPÓSITO: fundir Mentorias e Consultorias num só espaço.
-- Isso move contratações, recursos, planos de recebimento e campanhas de produção, e
-- o id de um item é imutável e a role não faz DELETE: um dos dois seria arquivado.
-- É decisão e ação do dono, item a item, e não cabe num script automático.
--
-- IDEMPOTENTE. Uma transação por migração (scripts/migrate.mjs): falhou, nada fica.

-- 1. O tipo novo ---------------------------------------------------------------
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_portfolio_kind_check;
ALTER TABLE products ADD CONSTRAINT products_portfolio_kind_check
 CHECK (portfolio_kind IN ('product', 'platform', 'service_line', 'advisory', 'internal'));

-- 2. Tags ----------------------------------------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_tags_check' AND conrelid = 'products'::regclass) THEN
  ALTER TABLE products ADD CONSTRAINT products_tags_check CHECK (cardinality(tags) <= 8);
 END IF;
END $$;

-- 3. 'product' passa a se chamar 'platform', com trilha ------------------------
WITH antes AS (
 SELECT * FROM products WHERE portfolio_kind = 'product' FOR UPDATE
), depois AS (
 UPDATE products p SET portfolio_kind = 'platform', revision = p.revision + 1, updated_at = now()
  FROM antes WHERE p.id = antes.id
 RETURNING p.*
)
INSERT INTO portfolio_audit(entity, entity_id, action, before, after, actor_subject)
SELECT 'product', depois.id, 'updated', to_jsonb(antes), to_jsonb(depois), 'migration:036'
  FROM depois JOIN antes ON antes.id = depois.id;

-- O padrão de um item novo é o nome atual.
ALTER TABLE products ALTER COLUMN portfolio_kind SET DEFAULT 'platform';
