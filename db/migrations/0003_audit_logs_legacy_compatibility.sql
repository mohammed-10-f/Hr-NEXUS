-- HR Nexus compatibility migration.
-- The Phase 2 audit_logs schema already contains these columns.
-- Keep this migration non-destructive and index-only so fresh and existing
-- Phase 2 databases do not fail on duplicate ALTER COLUMN operations.
PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_audit_logs_company_created
  ON audit_logs(company_id, created_at);
