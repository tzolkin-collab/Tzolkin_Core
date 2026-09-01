-- Metadados somente: nunca armazenar env, tokens, payloads ou logs.
CREATE TABLE platform_operations (
 id uuid PRIMARY KEY,
 target_id text NOT NULL,
 action text NOT NULL,
 actor text NOT NULL DEFAULT 'local-operator',
 status text NOT NULL CHECK(status IN ('started','accepted','unknown','rejected')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
