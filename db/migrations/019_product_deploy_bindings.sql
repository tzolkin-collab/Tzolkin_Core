-- Classificação explícita entre um projeto observado no provedor e um produto
-- do Core. O nome do projeto nunca é tratado como prova de vínculo.
CREATE TABLE IF NOT EXISTS product_deploy_bindings (
 provider text NOT NULL CHECK(provider IN ('vercel','easypanel')),
 external_project_id text NOT NULL CHECK(length(external_project_id) BETWEEN 1 AND 240),
 external_project_name text NOT NULL CHECK(length(external_project_name) BETWEEN 1 AND 240),
 product_id text NOT NULL REFERENCES products(id),
 environment text NOT NULL DEFAULT 'production' CHECK(environment IN ('development','staging','production')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(provider,external_project_id)
);
CREATE INDEX IF NOT EXISTS product_deploy_bindings_product_idx ON product_deploy_bindings(product_id);
