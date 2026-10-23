-- Execução dos agentes de IA do WhatsApp: a fila de turnos (um turno = ler a conversa, falar com o modelo, usar as ferramentas e responder)
-- e a passagem da conversa para uma pessoa.
--
-- SÓ ADICIONA. Sem esta migração o webhook segue guardando as mensagens e nenhum agente responde; a aba Agentes avisa. Nada é apagado.
--
-- 1) ai_agent_jobs: um turno de um agente numa conversa (instância + número). Há no máximo UM turno aberto por conversa e agente (índice
--    parcial): mensagens seguidas do lead empurram o `run_after` em vez de gerar vários turnos, e o agente responde uma vez, depois que o lead
--    parou de digitar. A mesma linha é o registro do que aconteceu (resultado, ferramentas usadas, tokens, motivo de ter pulado ou falhado).
-- 2) ai_handoffs: a conversa que está com uma PESSOA. Enquanto houver uma linha aberta (released_at nulo) para a instância e o número, nenhum
--    agente responde. Abre sozinha quando uma pessoa responde pelo Core ou quando o agente pede ajuda; fecha quando alguém devolve ao agente.
--    Revogar é fechar a linha (a role do Core não tem DELETE).

CREATE TABLE IF NOT EXISTS ai_agent_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 agent_id uuid NOT NULL REFERENCES ai_agents(id),
 instance text NOT NULL DEFAULT '' CHECK (instance = '' OR instance ~ '^[A-Za-z0-9_.-]{1,64}$'),
 number text NOT NULL CHECK (number ~ '^[0-9]{10,15}$'),
 inbox_id uuid REFERENCES whatsapp_inbox(id),
 lead_id uuid REFERENCES commercial_leads(id),
 run_after timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','skipped','failed')),
 attempts integer NOT NULL DEFAULT 0,
 locked_at timestamptz,
 started_at timestamptz,
 finished_at timestamptz,
 model text,
 input_tokens integer NOT NULL DEFAULT 0,
 output_tokens integer NOT NULL DEFAULT 0,
 tools_used jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(tools_used) = 'array'),
 reply text CHECK (reply IS NULL OR length(reply) <= 4096),
 note text CHECK (note IS NULL OR length(note) <= 500),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_agent_jobs_aberto ON ai_agent_jobs (agent_id, instance, number) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS ai_agent_jobs_pendentes ON ai_agent_jobs (run_after) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS ai_agent_jobs_recentes ON ai_agent_jobs (created_at DESC);

CREATE TABLE IF NOT EXISTS ai_handoffs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 instance text NOT NULL DEFAULT '' CHECK (instance = '' OR instance ~ '^[A-Za-z0-9_.-]{1,64}$'),
 number text NOT NULL CHECK (number ~ '^[0-9]{10,15}$'),
 reason text NOT NULL CHECK (reason IN ('pessoa_respondeu','agente_pediu','manual')),
 agent_id uuid REFERENCES ai_agents(id),
 note text CHECK (note IS NULL OR length(note) <= 500),
 created_by text,
 created_at timestamptz NOT NULL DEFAULT now(),
 released_at timestamptz,
 released_by text
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_handoffs_aberto ON ai_handoffs (instance, number) WHERE released_at IS NULL;

COMMENT ON TABLE ai_agent_jobs IS 'Turnos dos agentes de IA: a fila e o registro do que cada turno fez. Um turno aberto por conversa e agente.';
COMMENT ON TABLE ai_handoffs IS 'Conversas que estão com uma pessoa. Aberta (released_at nulo) = nenhum agente responde.';
