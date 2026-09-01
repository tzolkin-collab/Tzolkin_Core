ALTER TABLE audit_events ADD COLUMN actor_subject text;
ALTER TABLE audit_events ADD COLUMN actor_email text;
ALTER TABLE audit_events ADD CONSTRAINT audit_actor_pair CHECK(
 (actor_subject IS NULL AND actor_email IS NULL) OR
 (actor_subject IS NOT NULL AND length(actor_subject) BETWEEN 1 AND 300 AND (actor_email IS NULL OR length(actor_email) BETWEEN 3 AND 320))
);
CREATE INDEX audit_events_actor_created_idx ON audit_events(actor_subject,created_at DESC) WHERE actor_subject IS NOT NULL;
