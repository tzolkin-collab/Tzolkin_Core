BEGIN;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE TABLE IF NOT EXISTS tenants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(name) BETWEEN 2 AND 160),
 slug text NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
 relationship_kind text NOT NULL DEFAULT 'customer' CHECK(relationship_kind IN ('internal','customer','prospect','partner')),
 lifecycle_status text NOT NULL DEFAULT 'active' CHECK(lifecycle_status IN ('lead','onboarding','active','paused','completed','discontinued','unclassified')),
 organization_type text NOT NULL DEFAULT 'company' CHECK(organization_type IN ('company','person','nonprofit','internal')),
 source_system text, source_ref text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS memberships (
 tenant_id uuid REFERENCES tenants(id), subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 200),
 active boolean NOT NULL DEFAULT true, PRIMARY KEY(tenant_id,subject)
);
CREATE TABLE IF NOT EXISTS products (id text PRIMARY KEY CHECK(id ~ '^[a-z][a-z0-9-]{1,63}$'),name text NOT NULL,
 portfolio_kind text NOT NULL DEFAULT 'product' CHECK(portfolio_kind IN ('product','platform','service_line')),
 lifecycle_status text NOT NULL DEFAULT 'active' CHECK(lifecycle_status IN ('draft','active','archived')),
 brand_family text NOT NULL DEFAULT 'tzolkin');
CREATE TABLE IF NOT EXISTS entitlements (
 tenant_id uuid REFERENCES tenants(id), product_id text REFERENCES products(id), plan text NOT NULL CHECK(length(plan) BETWEEN 1 AND 80),
 active boolean NOT NULL DEFAULT true, rights text[] NOT NULL DEFAULT '{}', version bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,product_id)
);
CREATE TABLE IF NOT EXISTS app_clients (
 token_hash text PRIMARY KEY, product_id text NOT NULL REFERENCES products(id), active boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text NOT NULL, tenant_id uuid NOT NULL REFERENCES tenants(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO products(id,name) VALUES ('sites','TZOLKIN Sites'),('educare','Educare'),('barber','TZOLKIN Barber'),('commerce','TZOLKIN Commerce') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS client_engagements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), product_id text REFERENCES products(id),
 service_model text NOT NULL CHECK(service_model IN ('on_demand','education','consulting','advisory','product','unclassified')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('planned','active','paused','completed','discontinued','unclassified')),
 label text NOT NULL CHECK(length(label) BETWEEN 2 AND 120), source_system text, source_ref text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,label)
);
CREATE TABLE IF NOT EXISTS stakeholders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(name) BETWEEN 2 AND 160), email text, phone text,
 source_system text, source_ref text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS organization_stakeholders (
 tenant_id uuid NOT NULL REFERENCES tenants(id), stakeholder_id uuid NOT NULL REFERENCES stakeholders(id),
 role text NOT NULL DEFAULT 'contact' CHECK(role IN ('owner','decision_maker','champion','finance','technical','operational','student','contact')),
 title text, is_primary boolean NOT NULL DEFAULT false, contact_allowed boolean NOT NULL DEFAULT true, notes text,
 PRIMARY KEY(tenant_id,stakeholder_id)
);
CREATE TABLE IF NOT EXISTS ecosystem_entries (
 id text PRIMARY KEY, kind text NOT NULL, payload jsonb NOT NULL, imported_at date NOT NULL
);
COMMIT;
