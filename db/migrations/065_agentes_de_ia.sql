-- Agentes de IA do WhatsApp: a CONFIGURAÇÃO de quem atende, o que sabe e o que pode fazer. Cada agente tem instrução, contexto do negócio,
-- os funis que atende, as ferramentas do Core liberadas, as capacidades (texto, áudio, ligação...) e os materiais (assets) que pode usar.
--
-- SÓ ADICIONA. Esta migração guarda a configuração; quem executa o agente (modelo + ferramentas) é outra etapa, e um agente salvo e ligado
-- não responde ninguém sozinho enquanto ela não existir. `tools` e `abilities` guardam só ids conhecidos (validados na API contra o catálogo
-- do código), `pipelines` guarda ids de funis, e `assets` é uma lista de até 20 materiais { name, kind, url, when } (o arquivo em si fica
-- onde já está: o Core guarda o link, não o conteúdo). Sem DELETE (a role do Core não tem): agente que não vale mais é desligado.

CREATE TABLE IF NOT EXISTS ai_agents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
 description text CHECK (description IS NULL OR length(description) <= 300),
 instance text CHECK (instance IS NULL OR instance ~ '^[A-Za-z0-9_.-]{1,64}$'),
 model text NOT NULL CHECK (length(model) BETWEEN 3 AND 80),
 instructions text NOT NULL CHECK (length(instructions) BETWEEN 10 AND 8000),
 context text CHECK (context IS NULL OR length(context) <= 8000),
 pipelines uuid[] NOT NULL DEFAULT '{}',
 tools text[] NOT NULL DEFAULT '{}',
 abilities jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(abilities) = 'object'),
 assets jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(assets) = 'array' AND jsonb_array_length(assets) <= 20 AND pg_column_size(assets) <= 16384),
 is_active boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1,
 created_by text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_agents_nome ON ai_agents (lower(name));
CREATE INDEX IF NOT EXISTS ai_agents_ativos ON ai_agents (instance) WHERE is_active;

COMMENT ON TABLE ai_agents IS 'Configuração dos agentes de IA do WhatsApp (instrução, contexto, funis, ferramentas, capacidades e materiais). A execução é outra etapa.';
