-- E9 — Produto em draft nasce junto do projeto técnico.
--
-- Produtos existentes permanecem ativos. Projetos antigos sem vínculo não
-- recebem um produto inventado; só novos projetos criam o par explicitamente.

ALTER TABLE products ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active';
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_lifecycle_status_check;
ALTER TABLE products ADD CONSTRAINT products_lifecycle_status_check
 CHECK (lifecycle_status IN ('draft','active','archived'));

ALTER TABLE delivery_projects ADD COLUMN IF NOT EXISTS product_id text REFERENCES products(id);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_projects_product_unique
 ON delivery_projects(product_id) WHERE product_id IS NOT NULL;
