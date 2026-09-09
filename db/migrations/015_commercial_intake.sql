ALTER TABLE app_clients ADD COLUMN IF NOT EXISTS label text NOT NULL DEFAULT 'produto';
ALTER TABLE app_clients ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS commercial_leads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 stakeholder_id uuid REFERENCES stakeholders(id), email text, whatsapp text, message text,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','qualified','won','lost','archived')),
 source_system text, source_ref text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commercial_leads_tenant_idx ON commercial_leads(tenant_id, created_at DESC);
CREATE TABLE IF NOT EXISTS commercial_attributions (
 lead_id uuid PRIMARY KEY REFERENCES commercial_leads(id) ON DELETE CASCADE,
 source_system text NOT NULL, source_ref text, channel text, utm_source text, utm_medium text,
 utm_campaign text, utm_content text, landing_page text, referrer text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS commercial_intake_requests (
 idempotency_key text PRIMARY KEY, product_id text NOT NULL REFERENCES products(id), response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS commercial_leads_source_idx ON commercial_leads(source_system, source_ref)
 WHERE source_system IS NOT NULL AND source_ref IS NOT NULL;

