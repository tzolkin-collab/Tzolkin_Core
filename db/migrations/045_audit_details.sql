-- 045 — audit_events passa a poder guardar o antes e o depois de uma alteração.
--
-- Até aqui a trilha só dizia "tenant.status_changed" por empresa e operador, sem o que mudou. Reclassificar uma
-- organização (relacionamento, ciclo de vida, tipo, nome) precisa registrar de quê para quê. A coluna é opcional: só a
-- rota que tem o que contar a preenche (`{ before, after }` com as chaves que mudaram); as demais seguem como estavam.
--
-- EXPANSÃO, NÃO CONTRAÇÃO: uma coluna opcional. Nada é apagado nem reescrito. Idempotente.
-- Pode rodar ANTES do deploy; o Core novo só grava `details` quando a rota devolve algo para guardar.

ALTER TABLE audit_events
 ADD COLUMN IF NOT EXISTS details jsonb
  CHECK (details IS NULL OR (jsonb_typeof(details) = 'object' AND pg_column_size(details) <= 4096));

COMMENT ON COLUMN audit_events.details IS 'O que mudou, quando a rota sabe contar: { before, after } só com as chaves alteradas.';
