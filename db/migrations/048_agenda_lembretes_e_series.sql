-- Agenda: lembretes por atividade, preferências da agenda e atividades recorrentes (séries).
--
-- SÓ ADICIONA (e troca um CHECK de lista fechada). Nada é apagado nem reescrito. O código funciona antes e depois desta migração:
-- enquanto ela não existe no banco, a API devolve `agenda_lembretes: false`, a tela esconde lembrete e repetição, e quem tentar
-- usá-los recebe 409 com mensagem clara (nunca um erro de coluna do banco). Mesma regra da 047.
--
-- SEM DELETE. A role do Core (tzolkin_core_runtime) só tem SELECT, INSERT e UPDATE. Por isso "encerrar uma série" não apaga os
-- eventos futuros: marca `archived_at`, e o calendário deixa de mostrá-los. O histórico fica.
--
-- 1) TÓPICO DE PUSH. 'agenda.lembrete' junto de 'commercial.lead' (CHECK de lista fechada da 037). Quem já assinou continua com os
--    tópicos que tinha; só passa a receber lembrete de agenda quem ligar esse tópico em Configurações.
-- 2) PREFERÊNCIAS. Uma linha só (id = true): os lembretes que valem para toda atividade que não escolheu os seus.
-- 3) LEMBRETE POR ATIVIDADE. `reminders` = minutos ANTES do início. NULL = vale o padrão da agenda; '{}' = não avisar; '{15,60}' =
--    avisa 1h e 15 min antes.
-- 4) SÉRIES. Uma regra (semanal ou mensal) que gera atividades comuns. Cada ocorrência é uma linha de service_activities com
--    `series_id`, então arrastar, concluir, cancelar e registrar tempo funcionam como em qualquer atividade.
--    `series_detached` marca a ocorrência que a pessoa mexeu à mão: editar a série depois não a sobrescreve.
-- 5) LEMBRETES ENVIADOS. Uma linha por (atividade, antecedência): é o que garante UM aviso só, mesmo que o verificador rode duas vezes.

-- 1) tópicos
ALTER TABLE push_subscriptions DROP CONSTRAINT IF EXISTS push_subscriptions_topics_valid;
ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_topics_valid
 CHECK (topics <@ ARRAY['commercial.lead','agenda.lembrete']::text[] AND cardinality(topics) >= 1);

-- 2) preferências
CREATE TABLE IF NOT EXISTS agenda_preferences (
 id boolean PRIMARY KEY DEFAULT true,
 default_reminders integer[] NOT NULL DEFAULT ARRAY[15],
 revision integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by text,
 CONSTRAINT agenda_preferences_single CHECK (id),
 CONSTRAINT agenda_preferences_reminders CHECK (cardinality(default_reminders) <= 3 AND default_reminders <@ ARRAY[0,5,10,15,30,60,120,1440,2880,10080])
);
INSERT INTO agenda_preferences(id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- 4) séries (antes das colunas novas de atividade, que apontam para ela)
CREATE TABLE IF NOT EXISTS service_activity_series (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 engagement_id uuid,
 category text NOT NULL CHECK (category IN ('mentoria','consultoria','software','educacional','outro')),
 kind text NOT NULL CHECK (kind IN ('sessao','entregavel','feature','tarefa')),
 title text NOT NULL CHECK (length(title) BETWEEN 2 AND 160),
 description text CHECK (description IS NULL OR length(description) BETWEEN 1 AND 2000),
 location text CHECK (location IS NULL OR length(location) BETWEEN 1 AND 200),
 meeting_url text CHECK (meeting_url IS NULL OR (meeting_url ~ '^https://' AND length(meeting_url) <= 500)),
 frequency text NOT NULL CHECK (frequency IN ('weekly','monthly')),
 interval_n integer NOT NULL DEFAULT 1 CHECK (interval_n BETWEEN 1 AND 12),
 weekdays smallint[],
 month_day smallint,
 start_time time NOT NULL,
 duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 1440),
 starts_on date NOT NULL,
 ends_on date,
 count_limit integer CHECK (count_limit IS NULL OR count_limit BETWEEN 1 AND 366),
 reminders integer[],
 generated_until date,
 ended_at timestamptz,
 revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT service_activity_series_shape CHECK (
  (frequency = 'weekly' AND weekdays IS NOT NULL AND cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[] AND month_day IS NULL)
  OR (frequency = 'monthly' AND month_day BETWEEN 1 AND 31 AND weekdays IS NULL)),
 CONSTRAINT service_activity_series_period CHECK (ends_on IS NULL OR ends_on >= starts_on),
 CONSTRAINT service_activity_series_reminders CHECK (reminders IS NULL OR (cardinality(reminders) <= 3 AND reminders <@ ARRAY[0,5,10,15,30,60,120,1440,2880,10080])),
 CONSTRAINT service_activity_series_engagement_tenant_fk FOREIGN KEY (engagement_id, tenant_id) REFERENCES client_engagements (id, tenant_id)
);
CREATE INDEX IF NOT EXISTS service_activity_series_abertas ON service_activity_series (generated_until) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS service_activity_series_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 series_id uuid NOT NULL REFERENCES service_activity_series(id),
 action text NOT NULL,
 actor text NOT NULL,
 details jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);

-- 3) e 4) colunas novas da atividade
ALTER TABLE service_activities ADD COLUMN IF NOT EXISTS reminders integer[];
ALTER TABLE service_activities ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES service_activity_series(id);
ALTER TABLE service_activities ADD COLUMN IF NOT EXISTS series_ordinal integer;
ALTER TABLE service_activities ADD COLUMN IF NOT EXISTS series_detached boolean NOT NULL DEFAULT false;
ALTER TABLE service_activities ADD COLUMN IF NOT EXISTS archived_at timestamptz;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_activities_reminders_valid') THEN
  ALTER TABLE service_activities ADD CONSTRAINT service_activities_reminders_valid
   CHECK (reminders IS NULL OR (cardinality(reminders) <= 3 AND reminders <@ ARRAY[0,5,10,15,30,60,120,1440,2880,10080]));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_activities_series_ordinal_check') THEN
  ALTER TABLE service_activities ADD CONSTRAINT service_activities_series_ordinal_check
   CHECK ((series_id IS NULL AND series_ordinal IS NULL) OR (series_id IS NOT NULL AND series_ordinal >= 0));
 END IF;
END $$;

-- Uma ocorrência por posição da série: gerar duas vezes (job duas vezes, repetição do pedido) não duplica.
CREATE UNIQUE INDEX IF NOT EXISTS service_activities_series_posicao ON service_activities (series_id, series_ordinal) WHERE series_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS service_activities_series_futuras ON service_activities (series_id, starts_at) WHERE series_id IS NOT NULL AND archived_at IS NULL;

-- 5) lembretes enviados
CREATE TABLE IF NOT EXISTS agenda_reminders_sent (
 activity_id uuid NOT NULL REFERENCES service_activities(id),
 minutes integer NOT NULL,
 sent_at timestamptz NOT NULL DEFAULT now(),
 devices integer NOT NULL DEFAULT 0,
 PRIMARY KEY (activity_id, minutes)
);

COMMENT ON COLUMN service_activities.reminders IS 'Minutos ANTES do início em que o push avisa. NULL = padrão da agenda; {} = não avisar.';
COMMENT ON COLUMN service_activities.series_detached IS 'Ocorrência de série que foi alterada à mão: editar a série não a sobrescreve.';
COMMENT ON COLUMN service_activities.archived_at IS 'Ocorrência retirada do calendário (série encerrada). A role do Core não apaga linhas, por isso arquiva.';
COMMENT ON TABLE service_activity_series IS 'Regra de repetição (semanal ou mensal). As ocorrências são atividades comuns com series_id.';
