-- Conexões técnicas confirmadas por produto. Inventário observado continua
-- separado: esta tabela registra somente a decisão explícita do operador.
CREATE TABLE IF NOT EXISTS product_resource_bindings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_id text NOT NULL REFERENCES products(id),
 resource_type text NOT NULL CHECK(resource_type IN ('repository','frontend','backend','domain','api','worker','database','cache','checkout','email')),
 provider text NOT NULL CHECK(provider IN ('github','vercel','easypanel','hostinger','stripe','asaas','manual')),
 external_id text NOT NULL CHECK(length(external_id) BETWEEN 1 AND 300),
 display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 240),
 environment text CHECK(environment IS NULL OR environment IN ('development','staging','production','internal')),
 url text CHECK(url IS NULL OR length(url) BETWEEN 8 AND 1000),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(resource_type,provider,external_id)
);
CREATE INDEX IF NOT EXISTS product_resource_bindings_product_idx
 ON product_resource_bindings(product_id,resource_type);

CREATE TABLE IF NOT EXISTS product_resource_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 binding_id uuid,
 product_id text NOT NULL REFERENCES products(id),
 action text NOT NULL CHECK(action IN ('created','updated','deleted')),
 actor text NOT NULL,
 before_value jsonb,
 after_value jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_resource_audit_product_idx
 ON product_resource_audit(product_id,created_at DESC);

-- Preserva as classificações de deploy já confirmadas antes desta migração.
INSERT INTO product_resource_bindings(product_id,resource_type,provider,external_id,display_name,environment)
SELECT product_id,
 CASE WHEN provider='vercel' THEN 'frontend' ELSE 'backend' END,
 provider,external_project_id,external_project_name,environment
FROM product_deploy_bindings
ON CONFLICT(resource_type,provider,external_id) DO NOTHING;
