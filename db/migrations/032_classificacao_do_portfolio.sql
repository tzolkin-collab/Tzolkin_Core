-- Classificação do portfólio decidida pelo dono em 2026-09-14. Ver ADR 0007.
--
--  core          internal      o próprio Core; não é vendido (responde D2)
--  skiller       product       sem mudança
--  sites         service_line  sem mudança
--  educare       platform      sem mudança: assinatura de cursos e conteúdos
--  mentorias     service_line  novo, com contexto próprio no painel
--  consultorias  service_line  novo, com contexto próprio no painel
--
-- O tipo continua sem governar regra: decidir A, B ou C é a outra metade da
-- ADR 0007. Cada mudança aqui deixa trilha em portfolio_audit, como faria o CRUD.

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_portfolio_kind_check;
ALTER TABLE products ADD CONSTRAINT products_portfolio_kind_check
 CHECK (portfolio_kind IN ('product', 'platform', 'service_line', 'internal'));

-- ---------------------------------------------------------------------------
-- core → internal
-- ---------------------------------------------------------------------------
WITH antes AS (
 SELECT * FROM products WHERE id = 'core' AND portfolio_kind <> 'internal' FOR UPDATE
), depois AS (
 UPDATE products p SET portfolio_kind = 'internal', revision = p.revision + 1, updated_at = now()
  FROM antes WHERE p.id = antes.id
 RETURNING p.*
)
INSERT INTO portfolio_audit(entity, entity_id, action, before, after, actor_subject)
SELECT 'product', depois.id, 'updated', to_jsonb(antes), to_jsonb(depois), 'migration:032'
  FROM depois JOIN antes ON antes.id = depois.id;

-- ---------------------------------------------------------------------------
-- Novas linhas de serviço
-- ---------------------------------------------------------------------------
-- Nascem ativas, não em rascunho: Mentorias já tem contratação em curso, e
-- rascunho não aceita contratação nova pelo CRUD.
WITH criados AS (
 INSERT INTO products(id, name, portfolio_kind, brand_family, lifecycle_status) VALUES
  ('mentorias', 'TZOLKIN Mentorias', 'service_line', 'tzolkin', 'active'),
  ('consultorias', 'TZOLKIN Consultorias', 'service_line', 'tzolkin', 'active')
 ON CONFLICT (id) DO NOTHING
 RETURNING *
)
INSERT INTO portfolio_audit(entity, entity_id, action, before, after, actor_subject)
SELECT 'product', criados.id, 'created', NULL, to_jsonb(criados), 'migration:032' FROM criados;

-- ---------------------------------------------------------------------------
-- Contratações sem item vão para a linha do seu tipo
-- ---------------------------------------------------------------------------
-- Só as que não apontam para item nenhum: uma consultoria vendida dentro de
-- Sites continua sendo de Sites. Arquivadas ficam como estão.
WITH antes AS (
 SELECT * FROM client_engagements
  WHERE product_id IS NULL AND archived_at IS NULL AND service_model IN ('education', 'consulting')
 FOR UPDATE
), depois AS (
 UPDATE client_engagements e
    SET product_id = CASE antes.service_model WHEN 'education' THEN 'mentorias' ELSE 'consultorias' END,
        revision = e.revision + 1, updated_at = now()
   FROM antes WHERE e.id = antes.id
 RETURNING e.*
)
INSERT INTO portfolio_audit(entity, entity_id, action, before, after, actor_subject)
SELECT 'engagement', depois.id::text, 'updated', to_jsonb(antes), to_jsonb(depois), 'migration:032'
  FROM depois JOIN antes ON antes.id = depois.id;
