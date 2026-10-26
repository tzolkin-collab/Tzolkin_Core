-- 069 — Corrige a restrição do fbc: o PostgreSQL não compila repetição de regex acima de 255 ("invalid repetition count(s)").
-- A 038 criou `{10,500}`; como o banco só compila a expressão quando há valor não nulo, a restrição foi criada sem erro e passou a
-- derrubar (HTTP 500) todo intake que traz fbc. O app aceita o mesmo limite (FBC em platform/attribution.mjs).
ALTER TABLE commercial_attributions DROP CONSTRAINT IF EXISTS commercial_attributions_ids_fmt;
ALTER TABLE commercial_attributions ADD CONSTRAINT commercial_attributions_ids_fmt CHECK (
 (utm_tzolkin IS NULL OR utm_tzolkin ~ '^[a-z0-9][a-z0-9._-]{0,79}$')
 AND (session_key IS NULL OR session_key ~ '^[A-Za-z0-9_-]{8,64}$')
 AND (fbp IS NULL OR fbp ~ '^fb\.[0-9]\.[0-9]{10,13}\.[0-9]{5,20}$')
 AND (fbc IS NULL OR fbc ~ '^fb\.[0-9]\.[0-9]{10,13}\.[A-Za-z0-9_-]{10,255}$'));
