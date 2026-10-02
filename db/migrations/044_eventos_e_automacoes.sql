-- 044 — Eventos e automações (fase 5 do funil, plano de leads da Kalidash adaptado), com tarefas mínimas.
--
-- Cada ação do funil emite um evento padronizado (`lead.criado`, `oportunidade.mudou_de_etapa`…). Uma automação é:
-- espaço + (funil e etapa opcionais) + evento + lista de ações. Roda na mesma transação do evento, cada uma dentro de um
-- savepoint: se falhar, a gravação principal (por exemplo, o lead do site) segue e a falha fica registrada em
-- `automation_runs`. Ações de hoje: criar tarefa e atribuir responsável. Ação com atraso só existe para o prazo da
-- tarefa; não há agendador (ADR 0011: sem worker), então nada fica "agendado" sem rodar.
--
-- Tarefas: o mínimo para a ação "criar tarefa" ser de verdade. Pertence a um lead e/ou a uma oportunidade (sempre a uma
-- empresa), tem prazo e responsável opcionais e se conclui. Não é o Acompanhamento (que é horas de serviço).
--
-- EXPANSÃO, NÃO CONTRAÇÃO: três tabelas novas. Nada é apagado nem reescrito. Idempotente.
-- Pode rodar ANTES do deploy, junto com 040 a 043.

CREATE TABLE IF NOT EXISTS automations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 space_id text NOT NULL REFERENCES products(id),
 pipeline_id uuid REFERENCES pipelines(id),
 stage_id uuid REFERENCES pipeline_stages(id),
 name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
 trigger_event text NOT NULL CHECK (trigger_event IN (
  'lead.criado', 'lead.mudou_de_etapa', 'lead.qualificado', 'lead.descartado', 'lead.restaurado',
  'oportunidade.criada', 'oportunidade.mudou_de_etapa', 'oportunidade.ganha', 'oportunidade.perdida', 'contratacao.criada')),
 actions jsonb NOT NULL CHECK (jsonb_typeof(actions) = 'array' AND jsonb_array_length(actions) BETWEEN 1 AND 5 AND pg_column_size(actions) <= 8192),
 is_enabled boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (stage_id IS NULL OR pipeline_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS automations_event_idx ON automations(space_id, trigger_event) WHERE is_enabled;

CREATE TABLE IF NOT EXISTS commercial_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 lead_id uuid REFERENCES commercial_leads(id),
 opportunity_id uuid REFERENCES commercial_opportunities(id),
 title text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
 tag text NOT NULL DEFAULT 'Geral' CHECK (length(tag) BETWEEN 1 AND 40),
 due_at timestamptz,
 owner_id uuid REFERENCES operator_accounts(id),
 source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'automacao')),
 automation_id uuid REFERENCES automations(id),
 done_at timestamptz,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (lead_id IS NOT NULL OR opportunity_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS commercial_tasks_lead_idx ON commercial_tasks(lead_id, created_at DESC) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS commercial_tasks_opportunity_idx ON commercial_tasks(opportunity_id, created_at DESC) WHERE opportunity_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS automation_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 automation_id uuid NOT NULL REFERENCES automations(id),
 event text NOT NULL,
 lead_id uuid REFERENCES commercial_leads(id),
 opportunity_id uuid REFERENCES commercial_opportunities(id),
 tenant_id uuid REFERENCES tenants(id),
 result text NOT NULL CHECK (result IN ('OK', 'FAILED')),
 note text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS automation_runs_automation_idx ON automation_runs(automation_id, created_at DESC);
