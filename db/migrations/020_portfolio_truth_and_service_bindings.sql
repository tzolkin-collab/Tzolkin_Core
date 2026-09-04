-- Verdade do portfólio: cadastro de catálogo não é prova de produto ativo.
-- O ciclo de vida legado permanece compatível com contratos; a interface
-- calcula a disponibilidade comercial a partir de deploy e evidência do
-- catálogo, sem transformar um registro antigo em produto vendável.

-- Assessoria é uma contratação, não um produto. Deploys desse trabalho são
-- vinculados à contratação para aparecerem em Serviços.
CREATE TABLE IF NOT EXISTS service_deploy_bindings (
 provider text NOT NULL CHECK(provider IN ('vercel','easypanel')),
 external_project_id text NOT NULL CHECK(length(external_project_id) BETWEEN 1 AND 240),
 external_project_name text NOT NULL CHECK(length(external_project_name) BETWEEN 1 AND 240),
 engagement_id uuid NOT NULL REFERENCES client_engagements(id),
 environment text NOT NULL DEFAULT 'production' CHECK(environment IN ('development','staging','production')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(provider, external_project_id)
);
CREATE INDEX IF NOT EXISTS service_deploy_bindings_engagement
 ON service_deploy_bindings(engagement_id);

-- A contratação existe mesmo sem produto associado. Mantemos o estado
-- importado (descontinuado) até que o contrato seja revalidado.
INSERT INTO client_engagements(tenant_id,product_id,service_model,status,label,source_system,source_ref)
SELECT id,NULL,'advisory','discontinued','Assessoria','notion','assinatura-assessoria'
FROM tenants WHERE slug='assinatura-marca-propria'
ON CONFLICT(tenant_id,label) DO UPDATE SET product_id=NULL,service_model='advisory';

-- O projeto já existente na Vercel faz parte da contratação de Assessoria da
-- Assinatura Marca Própria. O id nominal também permite casar pelo nome caso
-- a API da Vercel retorne um id interno diferente.
INSERT INTO service_deploy_bindings(provider,external_project_id,external_project_name,engagement_id)
SELECT 'vercel','designer','designer',e.id
FROM client_engagements e
JOIN tenants t ON t.id=e.tenant_id
WHERE t.slug='assinatura-marca-propria' AND e.service_model='advisory' AND e.label='Assessoria'
ON CONFLICT(provider,external_project_id) DO UPDATE SET
 external_project_name=EXCLUDED.external_project_name,
 engagement_id=EXCLUDED.engagement_id,
 updated_at=now();
