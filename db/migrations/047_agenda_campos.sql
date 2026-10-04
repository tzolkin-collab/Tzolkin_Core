-- Agenda (Acompanhamento): campos de evento que o calendário passa a mostrar e editar.
-- Só adiciona colunas opcionais; atividade antiga continua válida e a API só toca nelas quando vêm preenchidas,
-- então o Core funciona antes e depois desta migração (usar descrição/local/link antes dela dá erro de coluna).
-- NÃO foi aplicada no banco compartilhado: aplicar antes de liberar a edição desses três campos.

ALTER TABLE service_activities ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE service_activities ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE service_activities ADD COLUMN IF NOT EXISTS meeting_url text;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_activities_description_len') THEN
  ALTER TABLE service_activities ADD CONSTRAINT service_activities_description_len CHECK (description IS NULL OR length(description) BETWEEN 1 AND 2000);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_activities_location_len') THEN
  ALTER TABLE service_activities ADD CONSTRAINT service_activities_location_len CHECK (location IS NULL OR length(location) BETWEEN 1 AND 200);
 END IF;
 -- https apenas: o link vira <a href> na tela.
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_activities_meeting_url_https') THEN
  ALTER TABLE service_activities ADD CONSTRAINT service_activities_meeting_url_https CHECK (meeting_url IS NULL OR (meeting_url ~ '^https://' AND length(meeting_url) <= 500));
 END IF;
END $$;

COMMENT ON COLUMN service_activities.description IS 'Descrição livre do evento (até 2000 caracteres).';
COMMENT ON COLUMN service_activities.location IS 'Local do evento (até 200 caracteres).';
COMMENT ON COLUMN service_activities.meeting_url IS 'Link da reunião (https). Fase 1 da agenda preenche com Meet/Teams/Zoom.';
