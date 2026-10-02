-- 043 — Campos próprios por espaço (fase 4 do funil; opção A do desenho de 01/10).
--
-- Cada espaço do portfólio define os campos que quer guardar do lead, da oportunidade e da contratação
-- (`space_fields`), e o valor mora numa coluna `custom_data` (jsonb) da própria linha. Mesma empresa em dois espaços,
-- campos diferentes. Tipos copiados da Kalidash (CustomFieldType): TEXT, NUMBER, DATE, SELECT, MULTISELECT, BOOLEAN, LINK.
-- Campo não se apaga: desativa (is_active=false), e o valor que já existe continua na linha. Chave, tipo e entidade não
-- mudam depois de criados.
--
-- Semente: os quatro campos que o formulário do site já coleta (porte, funcionários, Instagram, site) e que hoje
-- viajam no começo da mensagem. Todos TEXT e opcionais: o texto vem livre do formulário e a semente nunca pode fazer o
-- Core recusar um lead.
--
-- EXPANSÃO, NÃO CONTRAÇÃO: uma tabela e duas colunas com padrão. Nada é apagado nem reescrito. Idempotente.
-- Pode rodar ANTES do deploy, junto com a 040, 041 e 042.

CREATE TABLE IF NOT EXISTS space_fields (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 space_id text NOT NULL REFERENCES products(id),
 entity text NOT NULL CHECK (entity IN ('lead', 'opportunity', 'engagement')),
 key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
 label text NOT NULL CHECK (length(label) BETWEEN 2 AND 80),
 type text NOT NULL CHECK (type IN ('TEXT', 'NUMBER', 'DATE', 'SELECT', 'MULTISELECT', 'BOOLEAN', 'LINK')),
 options jsonb,
 required boolean NOT NULL DEFAULT false,
 is_active boolean NOT NULL DEFAULT true,
 position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (space_id, entity, key),
 CHECK ((type IN ('SELECT', 'MULTISELECT')) = (options IS NOT NULL)),
 CHECK (options IS NULL OR (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) BETWEEN 1 AND 50))
);
CREATE INDEX IF NOT EXISTS space_fields_space_idx ON space_fields(space_id, entity, position);

ALTER TABLE commercial_leads
 ADD COLUMN IF NOT EXISTS custom_data jsonb NOT NULL DEFAULT '{}'
  CHECK (jsonb_typeof(custom_data) = 'object' AND pg_column_size(custom_data) <= 16384);
ALTER TABLE client_engagements
 ADD COLUMN IF NOT EXISTS custom_data jsonb NOT NULL DEFAULT '{}'
  CHECK (jsonb_typeof(custom_data) = 'object' AND pg_column_size(custom_data) <= 16384);
-- commercial_opportunities.custom_data já existe desde a 040.

INSERT INTO space_fields(space_id, entity, key, label, type, position)
SELECT 'sites', 'lead', f.key, f.label, 'TEXT', f.pos
  FROM (VALUES ('porte', 'Porte', 0), ('funcionarios', 'Funcionários', 1), ('instagram', 'Instagram', 2), ('site', 'Site', 3)) AS f(key, label, pos)
 WHERE EXISTS (SELECT 1 FROM products WHERE id = 'sites')
ON CONFLICT (space_id, entity, key) DO NOTHING;
