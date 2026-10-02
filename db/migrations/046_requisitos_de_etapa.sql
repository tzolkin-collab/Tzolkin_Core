-- 046 — Requisitos de etapa (plano de leads da Kalidash, gate.ts adaptado ao Core).
--
-- Uma etapa pode exigir algo para o registro ENTRAR nela ou SAIR dela:
--   ACTION: uma tarefa. Ao tentar mover, a tarefa nasce para aquele lead ou oportunidade (se ainda não existe) e o
--           movimento fica bloqueado até ela ser concluída. Duas ou mais tarefas na mesma fronteira: todas precisam fechar.
--   FIELD:  um campo próprio do espaço (migração 043) preenchido. Bloqueia até o valor existir; não cria tarefa.
-- O bloqueio vale para mover o lead entre etapas de lead e para mover a oportunidade. Qualificar e descartar não são
-- bloqueados (descartar nunca pode ficar preso).
--
-- A origem da tarefa ganha o valor 'requisito' e a tarefa guarda o requisito que a gerou (`requirement_id`), com índice
-- único por registro: tentar mover duas vezes não cria duas tarefas.
--
-- EXPANSÃO, NÃO CONTRAÇÃO: uma tabela nova e uma coluna opcional; a lista de origens aceitas só ganha um valor. Idempotente.
-- Pode rodar ANTES do deploy, junto com 040 a 045.

CREATE TABLE IF NOT EXISTS stage_requirements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 pipeline_id uuid NOT NULL REFERENCES pipelines(id),
 stage_id uuid NOT NULL REFERENCES pipeline_stages(id),
 gate text NOT NULL CHECK (gate IN ('ENTER', 'EXIT')),
 kind text NOT NULL CHECK (kind IN ('ACTION', 'FIELD')),
 title text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
 field_entity text CHECK (field_entity IN ('lead', 'opportunity')),
 field_key text CHECK (field_key IS NULL OR field_key ~ '^[a-z][a-z0-9_]{0,39}$'),
 tag text NOT NULL DEFAULT 'Geral' CHECK (length(tag) BETWEEN 1 AND 40),
 owner_id uuid REFERENCES operator_accounts(id),
 due_days integer CHECK (due_days IS NULL OR due_days BETWEEN 0 AND 365),
 position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
 is_active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((kind = 'FIELD') = (field_key IS NOT NULL AND field_entity IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS stage_requirements_stage_idx ON stage_requirements(stage_id) WHERE is_active;

ALTER TABLE commercial_tasks ADD COLUMN IF NOT EXISTS requirement_id uuid REFERENCES stage_requirements(id);

DO $$
DECLARE antigo text;
BEGIN
 SELECT conname INTO antigo FROM pg_constraint
  WHERE conrelid = 'commercial_tasks'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%source%' AND pg_get_constraintdef(oid) NOT LIKE '%requisito%';
 IF antigo IS NOT NULL THEN EXECUTE format('ALTER TABLE commercial_tasks DROP CONSTRAINT %I', antigo); END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commercial_tasks_source_values') THEN
  ALTER TABLE commercial_tasks ADD CONSTRAINT commercial_tasks_source_values CHECK (source IN ('manual', 'automacao', 'requisito'));
 END IF;
END $$;

-- Uma tarefa por requisito e por registro: a da oportunidade e a do lead são registros diferentes.
CREATE UNIQUE INDEX IF NOT EXISTS commercial_tasks_requirement_opp_idx ON commercial_tasks(requirement_id, opportunity_id)
 WHERE requirement_id IS NOT NULL AND opportunity_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS commercial_tasks_requirement_lead_idx ON commercial_tasks(requirement_id, lead_id)
 WHERE requirement_id IS NOT NULL AND opportunity_id IS NULL;
