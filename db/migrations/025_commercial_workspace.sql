ALTER TABLE app_clients ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS app_clients_id_idx ON app_clients(id);
ALTER TABLE app_clients ADD COLUMN IF NOT EXISTS scopes text[] NOT NULL DEFAULT ARRAY['context:read'];
ALTER TABLE app_clients ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE app_clients ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
ALTER TABLE app_clients ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE app_clients ADD COLUMN IF NOT EXISTS rotated_from uuid REFERENCES app_clients(id);
CREATE TABLE IF NOT EXISTS app_client_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key_id uuid NOT NULL REFERENCES app_clients(id),
 product_id text NOT NULL REFERENCES products(id), action text NOT NULL,
 actor_subject text NOT NULL, actor_email text, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_client_audit_product_idx ON app_client_audit(product_id,created_at DESC);
ALTER TABLE commercial_intake_requests DROP CONSTRAINT IF EXISTS commercial_intake_requests_pkey;
ALTER TABLE commercial_intake_requests ADD PRIMARY KEY(product_id,idempotency_key);
ALTER TABLE commercial_intake_requests ADD COLUMN IF NOT EXISTS request_hash text;
ALTER TABLE commercial_leads ADD COLUMN IF NOT EXISTS product_id text REFERENCES products(id);
UPDATE commercial_leads l SET product_id=r.product_id FROM commercial_intake_requests r WHERE r.response->>'lead_id'=l.id::text AND l.product_id IS NULL;
ALTER TABLE commercial_leads ADD COLUMN IF NOT EXISTS name text;
UPDATE commercial_leads l SET name=s.name FROM stakeholders s WHERE s.id=l.stakeholder_id AND l.name IS NULL;
ALTER TABLE commercial_leads ADD COLUMN IF NOT EXISTS service_model text NOT NULL DEFAULT 'on_demand';
ALTER TABLE commercial_leads ADD COLUMN IF NOT EXISTS interest text;
ALTER TABLE commercial_leads ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES operator_accounts(id);
ALTER TABLE commercial_leads ADD COLUMN IF NOT EXISTS loss_reason text;
ALTER TABLE commercial_leads ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE commercial_leads ADD COLUMN IF NOT EXISTS privacy jsonb NOT NULL DEFAULT '{}';
ALTER TABLE commercial_leads ADD COLUMN IF NOT EXISTS source_created_at timestamptz;
ALTER TABLE commercial_leads ADD COLUMN IF NOT EXISTS request_hash text;
DROP INDEX IF EXISTS commercial_leads_source_idx;
CREATE UNIQUE INDEX commercial_leads_source_idx ON commercial_leads(product_id,source_system,source_ref) WHERE source_system IS NOT NULL AND source_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS commercial_leads_product_idx ON commercial_leads(product_id,created_at DESC,id);
CREATE TABLE IF NOT EXISTS commercial_activities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid NOT NULL REFERENCES commercial_leads(id),
 kind text NOT NULL, note text, details jsonb NOT NULL DEFAULT '{}', actor_subject text NOT NULL,
 actor_email text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commercial_activities_lead_idx ON commercial_activities(lead_id,created_at,id);
CREATE TABLE IF NOT EXISTS commercial_contracts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid REFERENCES commercial_leads(id),
 tenant_id uuid NOT NULL REFERENCES tenants(id), product_id text NOT NULL REFERENCES products(id),
 title text NOT NULL, scope text NOT NULL, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','completed','canceled')),
 amount_minor bigint NOT NULL CHECK(amount_minor>=0), currency text NOT NULL DEFAULT 'BRL' CHECK(currency IN ('BRL','USD','EUR','GBP')),
 starts_on date, ends_on date, acceptance_reference text, accepted_at timestamptz, owner_id uuid REFERENCES operator_accounts(id),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_on IS NULL OR starts_on IS NULL OR ends_on>=starts_on),
 CHECK(status NOT IN ('active','completed') OR (accepted_at IS NOT NULL AND acceptance_reference IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS commercial_contract_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contract_id uuid NOT NULL REFERENCES commercial_contracts(id),
 actor_subject text NOT NULL, actor_email text, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
