-- Compatibility migration for databases created from 0001_foundation.sql.
-- The later audit schema used CREATE TABLE IF NOT EXISTS, which does not alter
-- an already-existing audit_logs table. Add only the missing columns safely.
PRAGMA foreign_keys = ON;

ALTER TABLE audit_logs ADD COLUMN company_id TEXT;
ALTER TABLE audit_logs ADD COLUMN actor_type TEXT NOT NULL DEFAULT 'company';
ALTER TABLE audit_logs ADD COLUMN actor_platform_user_id TEXT;
ALTER TABLE audit_logs ADD COLUMN actor_company_user_id TEXT;
ALTER TABLE audit_logs ADD COLUMN user_agent_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_logs_company_created
  ON audit_logs(company_id, created_at);
