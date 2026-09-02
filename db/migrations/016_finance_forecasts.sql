-- Previsões comerciais e recorrências. Separadas do extrato realizado.
CREATE TABLE IF NOT EXISTS finance_forecasts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 160),
 direction text NOT NULL CHECK (direction IN ('income','expense')),
 amount_minor bigint NOT NULL CHECK (amount_minor > 0),
 currency text NOT NULL DEFAULT 'BRL' CHECK (currency IN ('BRL','USD','EUR','GBP')),
 recurrence text NOT NULL DEFAULT 'once' CHECK (recurrence IN ('once','monthly','quarterly','yearly')),
 due_date date NOT NULL,
 end_date date,
 project_id uuid REFERENCES delivery_projects(id),
 tenant_id uuid REFERENCES tenants(id),
 product_id text REFERENCES products(id),
 tags jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tags)='array'),
 source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','stripe','asaas','contract')),
 confidence text NOT NULL DEFAULT 'probable' CHECK (confidence IN ('conservative','probable','optimistic')),
 notes text,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS finance_forecasts_due_idx ON finance_forecasts(due_date,active);
CREATE INDEX IF NOT EXISTS finance_forecasts_project_idx ON finance_forecasts(project_id);
