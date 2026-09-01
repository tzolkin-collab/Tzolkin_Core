-- Internal treasury only. Never exposed through tenant or service authentication.
CREATE TABLE finance_snapshots (
 key text PRIMARY KEY,
 payload jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
