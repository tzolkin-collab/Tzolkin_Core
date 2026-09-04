ALTER TABLE operator_auth_flows
  ADD COLUMN IF NOT EXISTS consumed_at timestamptz;

CREATE INDEX IF NOT EXISTS operator_auth_flows_active_idx
  ON operator_auth_flows(expires_at)
  WHERE consumed_at IS NULL;
