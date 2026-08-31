-- 001 — Vínculo de pessoa passa a ser por produto.
--
-- Antes: memberships(tenant_id, subject) — quem tinha vínculo ativo alcançava
-- todos os produtos contratados pela organização.
-- Depois: memberships(tenant_id, subject, product_id) — o Core garante a
-- segmentação por produto, em vez de confiar que cada app a aplique.
--
-- Decisão: docs/decisions/0002-vinculo-de-pessoa-por-produto.md (opção B).
--
-- O backfill expande cada vínculo existente em uma linha por produto que a
-- organização já contrata: preserva exatamente o acesso atual e NÃO amplia
-- nada. Vínculo de organização sem nenhum contrato não dava acesso a produto
-- algum e por isso não sobrevive — a linha some junto com o acesso que ela
-- nunca concedeu.

ALTER TABLE memberships ADD COLUMN IF NOT EXISTS product_id text REFERENCES products(id);

-- A PK antiga impediria duas linhas do mesmo (tenant, subject): cai antes do backfill.
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_pkey;

INSERT INTO memberships(tenant_id, subject, product_id, active)
SELECT m.tenant_id, m.subject, e.product_id, m.active
  FROM memberships m
  JOIN entitlements e ON e.tenant_id = m.tenant_id
 WHERE m.product_id IS NULL;

DELETE FROM memberships WHERE product_id IS NULL;

ALTER TABLE memberships ALTER COLUMN product_id SET NOT NULL;

ALTER TABLE memberships ADD CONSTRAINT memberships_pkey PRIMARY KEY (tenant_id, subject, product_id);
