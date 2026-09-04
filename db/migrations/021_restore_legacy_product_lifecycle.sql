-- Registros de catálogo criados antes do fluxo de draft continuam aceitos
-- pelas chaves de contratos e acesso. A disponibilidade exibida ao operador
-- é calculada pela evidência (deploy/catálogo) no painel.
UPDATE products SET lifecycle_status='active' WHERE id IN ('barber','commerce','data','skiller');
