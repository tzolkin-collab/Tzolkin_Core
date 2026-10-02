-- Acompanhamento ligado à contratação: a atividade (e as horas dela) passa a poder pertencer a uma
-- contratação (client_engagements), em vez de só à empresa. A coluna é opcional: atividade antiga e
-- atividade geral da empresa continuam válidas, e a ficha da empresa mostra as horas "sem contratação".
-- Só adiciona; não apaga nem reescreve linha. O banco tinha 0 atividades quando isto foi escrito.

-- Chave composta para o banco garantir que a contratação é da MESMA empresa da atividade.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_engagements_id_tenant_key') THEN
  ALTER TABLE client_engagements ADD CONSTRAINT client_engagements_id_tenant_key UNIQUE (id, tenant_id);
 END IF;
END $$;

ALTER TABLE service_activities ADD COLUMN IF NOT EXISTS engagement_id uuid;

-- MATCH SIMPLE: com engagement_id nulo a chave não é conferida, então a ligação continua opcional.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_activities_engagement_tenant_fk') THEN
  ALTER TABLE service_activities ADD CONSTRAINT service_activities_engagement_tenant_fk
   FOREIGN KEY (engagement_id, tenant_id) REFERENCES client_engagements (id, tenant_id);
 END IF;
END $$;

CREATE INDEX IF NOT EXISTS service_activities_engagement ON service_activities (engagement_id, starts_at)
 WHERE engagement_id IS NOT NULL;

COMMENT ON COLUMN service_activities.engagement_id IS
 'Contratação a que a atividade pertence (mesma empresa, garantido pela chave composta). Nulo = atividade geral da empresa.';
