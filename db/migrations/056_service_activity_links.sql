-- Item 3 e 6: TASK com link para o GitHub, Meta Ads, etc, e vínculo com produto.
-- Tabela de vínculos externos
-- Escrita em 2026-10-07. APLICADA apenas sob demanda do dono.

CREATE TABLE service_activity_links (
  id uuid PRIMARY KEY,
  activity_id uuid NOT NULL REFERENCES service_activities(id) ON DELETE CASCADE,
  system text NOT NULL CHECK (system IN ('github', 'meta', 'google', 'linkedin', 'other')),
  external_id text NOT NULL,
  url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX service_activity_links_activity ON service_activity_links(activity_id);
