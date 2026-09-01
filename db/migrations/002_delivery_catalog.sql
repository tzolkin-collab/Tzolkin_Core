-- Cadastro técnico separado de clientes, contratos e estado observado de deploy.
CREATE TABLE delivery_projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 specification jsonb NOT NULL CHECK(jsonb_typeof(specification) = 'object'),
 revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX delivery_repository_unique ON delivery_projects ((specification->>'repository_id'))
 WHERE specification->>'repository_id' IS NOT NULL;
CREATE TABLE delivery_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES delivery_projects(id),
 revision integer NOT NULL,
 actor text NOT NULL DEFAULT 'local-operator',
 before_specification jsonb,
 after_specification jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
