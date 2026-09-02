-- CRM multimarcas: organização, oferta, contratação e pessoa são dimensões separadas.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS relationship_kind text NOT NULL DEFAULT 'customer'
 CHECK(relationship_kind IN ('internal','customer','prospect','partner'));
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active'
 CHECK(lifecycle_status IN ('lead','onboarding','active','paused','completed','discontinued','unclassified'));
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS organization_type text NOT NULL DEFAULT 'company'
 CHECK(organization_type IN ('company','person','nonprofit','internal'));
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS source_system text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS source_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_source_identity ON tenants(source_system,source_ref)
 WHERE source_system IS NOT NULL AND source_ref IS NOT NULL;

ALTER TABLE products ADD COLUMN IF NOT EXISTS portfolio_kind text NOT NULL DEFAULT 'product'
 CHECK(portfolio_kind IN ('product','platform','service_line'));
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand_family text NOT NULL DEFAULT 'tzolkin';

CREATE TABLE IF NOT EXISTS client_engagements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 product_id text REFERENCES products(id),
 service_model text NOT NULL CHECK(service_model IN ('on_demand','education','consulting','advisory','product','unclassified')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('planned','active','paused','completed','discontinued','unclassified')),
 label text NOT NULL CHECK(length(label) BETWEEN 2 AND 120),
 source_system text,
 source_ref text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,label)
);
CREATE INDEX IF NOT EXISTS client_engagements_tenant ON client_engagements(tenant_id);

CREATE TABLE IF NOT EXISTS stakeholders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(name) BETWEEN 2 AND 160),
 email text,
 phone text,
 source_system text,
 source_ref text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS stakeholders_source_identity ON stakeholders(source_system,source_ref)
 WHERE source_system IS NOT NULL AND source_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS organization_stakeholders (
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 stakeholder_id uuid NOT NULL REFERENCES stakeholders(id),
 role text NOT NULL DEFAULT 'contact' CHECK(role IN ('owner','decision_maker','champion','finance','technical','operational','student','contact')),
 title text,
 is_primary boolean NOT NULL DEFAULT false,
 contact_allowed boolean NOT NULL DEFAULT true,
 notes text,
 PRIMARY KEY(tenant_id,stakeholder_id)
);

INSERT INTO products(id,name,portfolio_kind,brand_family) VALUES
 ('skiller','TZOLKIN Skiller','product','tzolkin'),
 ('barber','TZOLKIN Barber','product','tzolkin'),
 ('educare','Educare','platform','tzolkin')
ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,portfolio_kind=EXCLUDED.portfolio_kind,brand_family=EXCLUDED.brand_family;
-- A linha de base já usa a taxonomia comercial final; a 014 também corrige
-- bancos existentes que ainda carregam o valor legado.
UPDATE products SET portfolio_kind='service_line' WHERE id IN ('sites','commerce','data');
UPDATE products SET portfolio_kind='platform' WHERE id='core';

-- Importa somente organizações cadastrais do Notion. Corpos de página e credenciais não entram no Core.
INSERT INTO tenants(name,slug,relationship_kind,lifecycle_status,organization_type,source_system,source_ref) VALUES
 ('Assinatura Marca Própria','assinatura-marca-propria','customer','discontinued','company','notion','36f2551e-c67e-80db-b25f-c702f422197d'),
 ('Bzbarber','bzbarber','customer','onboarding','company','notion','3822551e-c67e-8045-a818-f79fdc387399'),
 ('João Mentoria','joao-mentoria','customer','unclassified','person','notion','3832551e-c67e-80ff-9604-f594aae30101'),
 ('Kalidash','kalidash','customer','completed','company','notion','3742551e-c67e-8087-bc8d-fba2f1fcbc78'),
 ('Rafael (Sales)','rafael-sales','customer','discontinued','person','notion','3722551e-c67e-805e-b433-faf64f48e84b'),
 ('Tzolkin','tzolkin','internal','active','internal','notion','3742551e-c67e-80ab-b665-f40d56d2a766')
ON CONFLICT(slug) DO UPDATE SET
 name=EXCLUDED.name,relationship_kind=EXCLUDED.relationship_kind,lifecycle_status=EXCLUDED.lifecycle_status,
 organization_type=EXCLUDED.organization_type,source_system=EXCLUDED.source_system,source_ref=EXCLUDED.source_ref;

INSERT INTO client_engagements(tenant_id,product_id,service_model,status,label,source_system,source_ref)
SELECT id,'barber','product','planned','TZOLKIN Barber','notion','bzbarber-barber'
FROM tenants WHERE source_system='notion' AND source_ref='3822551e-c67e-8045-a818-f79fdc387399'
ON CONFLICT(tenant_id,label) DO UPDATE SET product_id=EXCLUDED.product_id,service_model=EXCLUDED.service_model,status=EXCLUDED.status;
INSERT INTO client_engagements(tenant_id,service_model,status,label,source_system,source_ref)
SELECT id,'education','discontinued','Mentoria Sales','notion','rafael-sales-mentoria'
FROM tenants WHERE source_system='notion' AND source_ref='3722551e-c67e-805e-b433-faf64f48e84b'
ON CONFLICT(tenant_id,label) DO UPDATE SET service_model=EXCLUDED.service_model,status=EXCLUDED.status;
