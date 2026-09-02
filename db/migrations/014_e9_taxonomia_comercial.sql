-- E9 — Taxonomia comercial.
--
-- A 013 já foi aplicada como migração de times e contas. Esta migração
-- preserva esse histórico e faz a alteração efetiva em bancos existentes.
-- `service_model` descreve O QUE foi vendido; assinatura descreve COMO se
-- cobra e continua exclusivamente em billing_offers.kind.

-- Removemos os CHECKs antigos antes do backfill: eles ainda não conhecem
-- `product` nem `service_line`, portanto bloqueariam a própria migração.
ALTER TABLE client_engagements DROP CONSTRAINT IF EXISTS client_engagements_service_model_check;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_portfolio_kind_check;

UPDATE client_engagements SET service_model = 'education' WHERE service_model = 'mentorship';
UPDATE client_engagements SET service_model = 'product' WHERE service_model = 'subscription';

UPDATE products SET portfolio_kind = 'service_line' WHERE id IN ('sites','commerce','data');
UPDATE products SET portfolio_kind = 'product' WHERE id IN ('barber','skiller');
UPDATE products SET portfolio_kind = 'platform' WHERE id IN ('core','educare');
UPDATE products SET portfolio_kind = 'service_line' WHERE portfolio_kind = 'business_unit';

ALTER TABLE client_engagements ADD CONSTRAINT client_engagements_service_model_check
 CHECK (service_model IN ('on_demand','education','consulting','advisory','product','unclassified'));

ALTER TABLE products ADD CONSTRAINT products_portfolio_kind_check
 CHECK (portfolio_kind IN ('product','platform','service_line'));
