CREATE TABLE service_activities (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 category text NOT NULL CHECK(category IN ('mentoria','consultoria','software','educacional','outro')),
 kind text NOT NULL CHECK(kind IN ('sessao','entregavel','feature','tarefa')),
 title text NOT NULL CHECK(length(title) BETWEEN 2 AND 160),
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL CHECK(ends_at > starts_at),
 status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','done','cancelled')),
 revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_activities_schedule ON service_activities(starts_at,ends_at);
CREATE INDEX service_activities_tenant ON service_activities(tenant_id,starts_at);
CREATE TABLE service_time_logs (
 id uuid PRIMARY KEY,
 activity_id uuid NOT NULL REFERENCES service_activities(id),
 minutes integer NOT NULL CHECK(minutes BETWEEN 1 AND 1440),
 worked_on date NOT NULL,
 note text NOT NULL CHECK(length(note) BETWEEN 2 AND 500),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_time_logs_activity ON service_time_logs(activity_id,worked_on);
CREATE TABLE service_activity_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 activity_id uuid NOT NULL REFERENCES service_activities(id),
 action text NOT NULL,
 actor text NOT NULL,
 details jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
