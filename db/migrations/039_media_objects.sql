-- 039 — Fotos de empresas e leads, guardadas no Cloudflare R2 (bucket privado).
--
-- O arquivo mora no R2; aqui fica só o registro: de quem é, onde está (object_key),
-- que tipo foi VERIFICADO pelos primeiros bytes (não o que o navegador declarou), o
-- tamanho e o hash. A leitura é sempre por URL assinada de curta duração, gerada na hora
-- para o operador logado; nenhuma URL fica gravada.
--
-- owner_type/owner_id é referência polimórfica: o banco não consegue ter FK para duas
-- tabelas, então a rota confere que o dono existe antes de gravar.
--
-- EXPANSÃO, NÃO CONTRAÇÃO. Só CREATE ... IF NOT EXISTS; o código antigo ignora a tabela,
-- então esta migração pode rodar ANTES do deploy.
CREATE TABLE IF NOT EXISTS media_objects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_type text NOT NULL CHECK (owner_type IN ('tenant', 'lead')),
 owner_id uuid NOT NULL,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 object_key text NOT NULL UNIQUE,
 content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
 byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 8388608),
 sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
 original_name text CHECK (original_name IS NULL OR length(original_name) <= 200),
 is_primary boolean NOT NULL DEFAULT false,
 uploaded_by text NOT NULL,
 uploaded_email text,
 created_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS media_objects_owner_idx ON media_objects(owner_type, owner_id, created_at) WHERE deleted_at IS NULL;
-- No máximo uma foto principal por dono.
CREATE UNIQUE INDEX IF NOT EXISTS media_objects_primary_idx ON media_objects(owner_type, owner_id) WHERE is_primary AND deleted_at IS NULL;
