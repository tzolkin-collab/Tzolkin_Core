-- A descrição da atividade é gravada pela tela como JSON de blocos (Editor.js), bem mais longo que o texto digitado,
-- e o bot MCP escreve Markdown que também vira esse JSON. O limite de 2000 caracteres recusava descrições curtas na prática.
-- Sobe para 20000 em service_activities e em service_activity_series (a regra de série herda a descrição).
ALTER TABLE service_activities DROP CONSTRAINT IF EXISTS service_activities_description_len;
ALTER TABLE service_activities ADD CONSTRAINT service_activities_description_len
  CHECK (description IS NULL OR length(description) BETWEEN 1 AND 20000);

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'service_activity_series'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%description%' AND pg_get_constraintdef(oid) LIKE '%2000%'
  LOOP
    EXECUTE format('ALTER TABLE service_activity_series DROP CONSTRAINT %I', c.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_activity_series_description_len') THEN
    ALTER TABLE service_activity_series ADD CONSTRAINT service_activity_series_description_len
      CHECK (description IS NULL OR length(description) BETWEEN 1 AND 20000);
  END IF;
END $$;

COMMENT ON COLUMN service_activities.description IS 'Descrição do evento (JSON de blocos do Editor.js; até 20000 caracteres).';
