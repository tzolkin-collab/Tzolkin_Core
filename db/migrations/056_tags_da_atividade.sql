-- 056 — Tags da atividade.
--
-- NÃO APLICADA. Escrita em 2026-10-13, pendente de autorização do dono (o banco compartilhado é o de produção).
-- Até ela ser aplicada o Core funciona como antes: GET /api/tracking responde `agenda_tags: false`, a tela não oferece o campo,
-- o MCP recusa as ferramentas de tag com MENSAGEM_056 e nada quebra.
--
-- DUAS TABELAS, ADITIVAS.
--
--   agenda_tags              o catálogo: cada tag existe uma vez, com nome, cor, quem criou e se alguém já revisou.
--   service_activity_tags    quais tags uma atividade tem.
--
-- TAG NÃO É A CATEGORIA. A categoria da atividade (mentoria, consultoria…) continua sendo herdada da contratação do cliente,
-- automática. A tag é outra coisa: classificação livre que a pessoa OU a IA cria, útil sobretudo quando não há cliente ou a
-- empresa é a própria Tzolkin, onde não há categoria para herdar.
--
-- QUEM CRIOU E QUEM REVISOU. `origin` diz se a tag nasceu de uma pessoa ou da IA (MCP). Tag de pessoa nasce já revisada; a da
-- IA nasce com `reviewed_at` nulo e VALE NA HORA, só aparece marcada como "sugerida" até alguém — pessoa ou IA — revisar
-- (aprovar, renomear ou arquivar). Nada trava o trabalho de quem classifica.
--
-- NADA SE APAGA. Arquivar uma tag é `archived_at`; tirar uma tag de uma atividade é `removed_at`. Tag arquivada continua nas
-- atividades que já a tinham (o histórico não muda), mas não pode ser escolhida de novo. Sem DELETE, como nas conexões (034).
--
-- IDEMPOTENTE. Uma transação por migração (scripts/migrate.mjs): falhou, nada fica.

CREATE TABLE IF NOT EXISTS agenda_tags (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 slug text NOT NULL,
 label text NOT NULL,
 tone text NOT NULL DEFAULT 'neutral',
 origin text NOT NULL DEFAULT 'person',
 created_by text NOT NULL,
 reviewed_at timestamptz,
 reviewed_by text,
 archived_at timestamptz,
 revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT agenda_tags_slug_key UNIQUE (slug),
 CONSTRAINT agenda_tags_slug_formato CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
 CONSTRAINT agenda_tags_label_tamanho CHECK (length(label) BETWEEN 2 AND 40),
 CONSTRAINT agenda_tags_tone_valido CHECK (tone IN ('accent','info','success','warning','danger','neutral')),
 CONSTRAINT agenda_tags_origin_valida CHECK (origin IN ('person','ai')),
 CONSTRAINT agenda_tags_revisao_coerente CHECK ((reviewed_at IS NULL) = (reviewed_by IS NULL)),
 CONSTRAINT agenda_tags_revision_positiva CHECK (revision >= 1)
);

CREATE TABLE IF NOT EXISTS service_activity_tags (
 activity_id uuid NOT NULL REFERENCES service_activities(id),
 tag_id uuid NOT NULL REFERENCES agenda_tags(id),
 added_by text NOT NULL,
 added_at timestamptz NOT NULL DEFAULT now(),
 removed_at timestamptz,
 removed_by text,
 CONSTRAINT service_activity_tags_pkey PRIMARY KEY (activity_id, tag_id),
 CONSTRAINT service_activity_tags_remocao_coerente CHECK ((removed_at IS NULL) = (removed_by IS NULL))
);

-- "Atividades com esta tag" e "tags desta atividade", só entre as que estão valendo.
CREATE INDEX IF NOT EXISTS service_activity_tags_tag_idx ON service_activity_tags (tag_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS agenda_tags_a_revisar_idx ON agenda_tags (created_at) WHERE reviewed_at IS NULL AND archived_at IS NULL;

COMMENT ON TABLE agenda_tags IS
 'Catálogo de tags da agenda. Criada por pessoa (nasce revisada) ou pela IA (nasce a revisar, e vale na hora). Arquivar é archived_at.';
COMMENT ON TABLE service_activity_tags IS
 'Tags de cada atividade. Tirar uma tag é removed_at, nunca DELETE; religar reaproveita a linha.';
