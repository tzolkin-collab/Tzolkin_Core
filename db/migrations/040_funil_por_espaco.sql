-- 040 — Funil por espaço (fase 1 do plano de leads da Kalidash, adaptada ao Core).
--
-- Um funil pertence a UM espaço do portfólio (`pipelines.space_id` → `products.id`) e um espaço pode ter vários
-- (ex.: Sites, um por nicho). O lead herda o espaço do funil. O nicho do funil casa com o `utm_tzolkin`
-- (`<espaço>.<nicho>`, ex.: `sites.corretor` → funil de slug `corretor`); sem casamento, o lead cai no funil padrão
-- do espaço. Valores em centavos inteiros, como no resto do Core.
--
-- Tabelas novas: pipelines, pipeline_stages, lost_reasons, commercial_opportunities.
-- Colunas novas em commercial_leads: pipeline_id, stage_id, origin, was_seen, first_contact_at,
-- estimated_value_minor, expected_close_at (todas opcionais ou com padrão).
--
-- EXPANSÃO, NÃO CONTRAÇÃO. Nada é apagado nem reescrito. O banco tem 0 leads, então não há dado a converter;
-- o status de sempre (open/qualified/won/lost/archived) continua valendo e o código antigo ignora as colunas novas.
-- Pode rodar ANTES do deploy.
--
-- SEMENTE. Cada espaço ativo com ciclo comercial (plataforma, linha de serviço, consultoria e assessoria) ganha um
-- funil padrão com as etapas do desenho da Kalidash. A lista de etapas está escrita em dois lugares (aqui e em
-- DEFAULT_STAGES, commercial-pipelines.mjs); um teste confere que são a mesma.
--
-- IDEMPOTENTE. Uma transação por migração (scripts/migrate.mjs): falhou, nada fica.

CREATE TABLE IF NOT EXISTS pipelines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 space_id text NOT NULL REFERENCES products(id),
 slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
 name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
 offer_name text CHECK (offer_name IS NULL OR length(offer_name) BETWEEN 2 AND 160),
 is_default boolean NOT NULL DEFAULT false,
 is_active boolean NOT NULL DEFAULT true,
 position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (space_id, slug)
);
-- No máximo um funil padrão ativo por espaço.
CREATE UNIQUE INDEX IF NOT EXISTS pipelines_default_idx ON pipelines(space_id) WHERE is_default AND is_active;

CREATE TABLE IF NOT EXISTS pipeline_stages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 pipeline_id uuid NOT NULL REFERENCES pipelines(id),
 name text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
 kind text NOT NULL CHECK (kind IN ('LEAD', 'OPEN', 'WON', 'LOST')),
 position integer NOT NULL CHECK (position >= 0),
 color text CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$'),
 probability integer CHECK (probability IS NULL OR probability BETWEEN 0 AND 100),
 stale_days integer CHECK (stale_days IS NULL OR stale_days > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (pipeline_id, name)
);
CREATE INDEX IF NOT EXISTS pipeline_stages_pipeline_idx ON pipeline_stages(pipeline_id, position);

CREATE TABLE IF NOT EXISTS lost_reasons (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL UNIQUE CHECK (length(name) BETWEEN 2 AND 120),
 is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS commercial_opportunities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 pipeline_id uuid NOT NULL REFERENCES pipelines(id),
 stage_id uuid NOT NULL REFERENCES pipeline_stages(id),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 stakeholder_id uuid REFERENCES stakeholders(id),
 lead_id uuid UNIQUE REFERENCES commercial_leads(id),
 title text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
 value_minor bigint NOT NULL DEFAULT 0 CHECK (value_minor >= 0),
 currency text NOT NULL DEFAULT 'BRL' CHECK (currency IN ('BRL', 'USD', 'EUR', 'GBP')),
 origin text NOT NULL DEFAULT 'INBOUND' CHECK (origin IN ('INBOUND', 'OUTBOUND')),
 owner_id uuid REFERENCES operator_accounts(id),
 expected_close_at timestamptz,
 entered_stage_at timestamptz NOT NULL DEFAULT now(),
 closed_at timestamptz,
 lost_reason_id uuid REFERENCES lost_reasons(id),
 custom_data jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(custom_data) = 'object' AND pg_column_size(custom_data) <= 16384),
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commercial_opportunities_stage_idx ON commercial_opportunities(pipeline_id, stage_id, created_at DESC);
CREATE INDEX IF NOT EXISTS commercial_opportunities_tenant_idx ON commercial_opportunities(tenant_id);

ALTER TABLE commercial_leads
 ADD COLUMN IF NOT EXISTS pipeline_id uuid REFERENCES pipelines(id),
 ADD COLUMN IF NOT EXISTS stage_id uuid REFERENCES pipeline_stages(id),
 ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'INBOUND' CHECK (origin IN ('INBOUND', 'OUTBOUND')),
 ADD COLUMN IF NOT EXISTS was_seen boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS first_contact_at timestamptz,
 ADD COLUMN IF NOT EXISTS estimated_value_minor bigint CHECK (estimated_value_minor IS NULL OR estimated_value_minor >= 0),
 ADD COLUMN IF NOT EXISTS expected_close_at timestamptz;
CREATE INDEX IF NOT EXISTS commercial_leads_stage_idx ON commercial_leads(pipeline_id, stage_id, created_at DESC) WHERE pipeline_id IS NOT NULL;

-- Semente: funil padrão por espaço com ciclo comercial.
INSERT INTO pipelines(space_id, slug, name, is_default, position)
SELECT id, 'padrao', 'Funil padrão', true, 0 FROM products
 WHERE lifecycle_status IN ('active', 'draft') AND portfolio_kind IN ('product', 'platform', 'service_line', 'advisory')
ON CONFLICT (space_id, slug) DO NOTHING;

INSERT INTO pipeline_stages(pipeline_id, name, kind, position, probability)
SELECT p.id, s.name, s.kind, s.pos, s.prob
  FROM pipelines p
 CROSS JOIN (VALUES
   ('Novos', 'LEAD', 0, NULL::integer), ('Em contato', 'LEAD', 1, NULL::integer),
   ('Qualificação', 'OPEN', 2, 20), ('Proposta', 'OPEN', 3, 40), ('Negociação', 'OPEN', 4, 70),
   ('Assinatura do contrato', 'OPEN', 5, 90), ('Ganho', 'WON', 6, 100), ('Perdido', 'LOST', 7, 0)
 ) AS s(name, kind, pos, prob)
 WHERE p.slug = 'padrao' AND NOT EXISTS (SELECT 1 FROM pipeline_stages x WHERE x.pipeline_id = p.id);

INSERT INTO lost_reasons(name) VALUES
 ('Sem orçamento'), ('Escolheu outro fornecedor'), ('Sem resposta'), ('Fora do perfil'), ('Projeto adiado')
ON CONFLICT (name) DO NOTHING;
