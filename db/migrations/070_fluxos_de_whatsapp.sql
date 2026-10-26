-- Fluxos de WhatsApp: sequências de mensagens com espera, iniciadas por uma ação de automação ("Iniciar fluxo") que leva dados do lead.
-- Desenho: docs/WHATSAPP-FLUXOS-DESENHO.md, seção 4.0. Fluxo é WhatsApp; automação é o motor geral do CRM e é ela que dispara o fluxo.
--
-- SÓ ADICIONA (e amplia a lista de eventos aceitos por `automations`). Sem esta migração nada muda: a aba Fluxos avisa e a ação "Iniciar
-- fluxo" falha com mensagem clara. Nada é apagado.
--
-- 1) whatsapp_flows: o fluxo de um espaço. `steps` é uma lista (até 20) de passos { tipo: 'mensagem', texto } ou { tipo: 'espera', minutos }.
--    Estado: rascunho (não inicia), teste (roda inteiro mas NÃO envia: só registra o que enviaria), ativo (envia de verdade), arquivado.
--    Fluxo não se apaga (a role do Core não tem DELETE): arquiva.
-- 2) whatsapp_flow_runs: um lead dentro de um fluxo. Guarda a CÓPIA dos passos da hora em que começou (editar o fluxo depois não muda quem
--    já está dentro), o `input` que a automação levou, o passo atual e a hora do próximo (`run_after`): a espera é durável e sobrevive a
--    reinício. A chave de idempotência impede o mesmo evento de colocar o mesmo lead duas vezes no mesmo fluxo.
-- 3) Eventos novos de automação: `fluxo.respondeu` (a pessoa respondeu enquanto o fluxo andava) e `fluxo.sem_resposta` (o fluxo acabou sem
--    resposta). É por eles que o resultado do fluxo volta para as automações (criar tarefa, mover de etapa, avisar a equipe).

CREATE TABLE IF NOT EXISTS whatsapp_flows (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 space_id text NOT NULL REFERENCES products(id),
 name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
 status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'teste', 'ativo', 'arquivado')),
 stop_on_reply boolean NOT NULL DEFAULT true,
 instance text CHECK (instance IS NULL OR instance ~ '^[A-Za-z0-9_.-]{1,64}$'),
 steps jsonb NOT NULL CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) BETWEEN 1 AND 20 AND pg_column_size(steps) <= 16384),
 version integer NOT NULL DEFAULT 1,
 created_by text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_flows_nome ON whatsapp_flows (space_id, lower(name));

CREATE TABLE IF NOT EXISTS whatsapp_flow_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 flow_id uuid NOT NULL REFERENCES whatsapp_flows(id),
 space_id text NOT NULL REFERENCES products(id),
 lead_id uuid REFERENCES commercial_leads(id),
 automation_id uuid REFERENCES automations(id),
 idempotency_key text NOT NULL UNIQUE,
 number text NOT NULL CHECK (number ~ '^[0-9]{10,15}$'),
 instance text CHECK (instance IS NULL OR instance ~ '^[A-Za-z0-9_.-]{1,64}$'),
 steps jsonb NOT NULL CHECK (jsonb_typeof(steps) = 'array' AND pg_column_size(steps) <= 16384),
 stop_on_reply boolean NOT NULL DEFAULT true,
 dry_run boolean NOT NULL DEFAULT false,
 input jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(input) = 'object' AND pg_column_size(input) <= 4096),
 step integer NOT NULL DEFAULT 0 CHECK (step >= 0),
 status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'stopped', 'failed')),
 outcome text CHECK (outcome IS NULL OR outcome IN ('respondeu', 'sem_resposta', 'suprimido', 'erro')),
 run_after timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz NOT NULL DEFAULT now(),
 last_sent_at timestamptz,
 locked_at timestamptz,
 attempts integer NOT NULL DEFAULT 0,
 log jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(log) = 'array' AND pg_column_size(log) <= 8192),
 finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS whatsapp_flow_runs_pendentes ON whatsapp_flow_runs (run_after) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS whatsapp_flow_runs_recentes ON whatsapp_flow_runs (flow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_flow_runs_lead ON whatsapp_flow_runs (lead_id) WHERE lead_id IS NOT NULL;

ALTER TABLE automations DROP CONSTRAINT IF EXISTS automations_trigger_event_check;
ALTER TABLE automations ADD CONSTRAINT automations_trigger_event_check CHECK (trigger_event IN (
 'lead.criado', 'lead.mudou_de_etapa', 'lead.qualificado', 'lead.descartado', 'lead.restaurado',
 'oportunidade.criada', 'oportunidade.mudou_de_etapa', 'oportunidade.ganha', 'oportunidade.perdida', 'contratacao.criada',
 'fluxo.respondeu', 'fluxo.sem_resposta'));
