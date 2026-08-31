BEGIN;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE TABLE IF NOT EXISTS tenants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(name) BETWEEN 2 AND 160),
 slug text NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS memberships (
 tenant_id uuid REFERENCES tenants(id), subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 200),
 active boolean NOT NULL DEFAULT true, PRIMARY KEY(tenant_id,subject)
);
CREATE TABLE IF NOT EXISTS products (id text PRIMARY KEY CHECK(id ~ '^[a-z][a-z0-9-]{1,63}$'),name text NOT NULL);
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
CREATE TABLE IF NOT EXISTS ecosystem_entries (
 id text PRIMARY KEY, kind text NOT NULL, payload jsonb NOT NULL, imported_at date NOT NULL
);
COMMIT;
