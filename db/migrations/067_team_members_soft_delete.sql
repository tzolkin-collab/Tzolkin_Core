-- 067 — Soft delete em team_members para compatibilidade com role de runtime sem DELETE.
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS removed_at timestamptz;
CREATE INDEX IF NOT EXISTS team_members_active_idx ON team_members(team_id) WHERE removed_at IS NULL;
