-- 042 — Ganhar a oportunidade cria a contratação (fase 3 do funil, decisão 3 de 01/10).
--
-- A oportunidade guarda a contratação que nasceu dela. Serve para duas coisas: reabrir e ganhar de novo não cria
-- uma segunda contratação, e a tela consegue mostrar "esta venda virou a contratação X".
--
-- EXPANSÃO, NÃO CONTRAÇÃO: uma coluna opcional. Nada é apagado nem reescrito; o banco tinha 0 oportunidades.
-- Pode rodar ANTES do deploy, junto com a 040. Idempotente.

ALTER TABLE commercial_opportunities
 ADD COLUMN IF NOT EXISTS engagement_id uuid REFERENCES client_engagements(id);

CREATE UNIQUE INDEX IF NOT EXISTS commercial_opportunities_engagement_idx
 ON commercial_opportunities(engagement_id) WHERE engagement_id IS NOT NULL;

COMMENT ON COLUMN commercial_opportunities.engagement_id IS
 'Contratação criada quando a oportunidade foi ganha. Reabrir não a apaga; ganhar de novo reaproveita.';
