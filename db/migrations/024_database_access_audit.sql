-- 024 — Trilha de leitura de linhas do explorador de bancos.
--
-- Conserta um 500 garantido: a rota GET /api/management/rows registrava o acesso
-- em audit_events, cuja coluna tenant_id é NOT NULL REFERENCES tenants(id). A
-- leitura de uma tabela do banco não tem tenant, então todo INSERT violava a
-- constraint e a rota nunca respondeu 200.
--
-- A saída é a mesma já adotada em product_resource_audit: tabela de auditoria de
-- domínio, sem tenant. Tornar audit_events.tenant_id nulo resolveria o sintoma e
-- enfraqueceria uma constraint que protege os eventos que TÊM tenant — e o
-- test/core.test.mjs limpa audit_events por tenant_id, então linhas nulas
-- vazariam entre execuções.
CREATE TABLE IF NOT EXISTS database_access_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor text NOT NULL,
 database_name text NOT NULL,
 schema_name text NOT NULL,
 table_name text NOT NULL,
 row_limit integer CHECK(row_limit IS NULL OR row_limit BETWEEN 1 AND 100),
 row_offset integer CHECK(row_offset IS NULL OR row_offset >= 0),
 -- Só o NOME da coluna filtrada, nunca o valor procurado. Quem busca por um CPF
 -- deixaria esse CPF na trilha de auditoria — a trilha viraria o vazamento que
 -- ela existe para vigiar. O mesmo motivo pelo qual payment_webhook_events.detail
 -- é vazia de propósito.
 filter_column text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS database_access_audit_recent ON database_access_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS database_access_audit_target ON database_access_audit(database_name,schema_name,table_name,created_at DESC);
