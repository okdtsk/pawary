CREATE TABLE IF NOT EXISTS security_audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  occurred_at INTEGER NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  category TEXT NOT NULL,
  operation TEXT,
  status INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS security_audit_time_idx ON security_audit_events (occurred_at);
CREATE INDEX IF NOT EXISTS security_audit_actor_time_idx ON security_audit_events (actor_id, occurred_at);
