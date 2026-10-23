-- Dedupe por CPF (hash SHA-256) e CNPJ alfanumérico no intake comercial
ALTER TABLE stakeholders ADD COLUMN IF NOT EXISTS document_hash text
 CHECK(document_hash IS NULL OR length(document_hash) = 64);

CREATE INDEX IF NOT EXISTS stakeholders_document_hash_idx ON stakeholders(document_hash)
 WHERE document_hash IS NOT NULL;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tax_id text
 CHECK(tax_id IS NULL OR length(tax_id) BETWEEN 14 AND 18);

CREATE INDEX IF NOT EXISTS tenants_tax_id_idx ON tenants(tax_id)
 WHERE tax_id IS NOT NULL;
