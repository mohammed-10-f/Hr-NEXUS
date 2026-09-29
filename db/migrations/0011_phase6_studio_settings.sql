-- Phase 6 Studio settings. No Phase 1-5 tables/data are modified.
-- Stores only workflow-definition-level design choices that do not belong in a field/stage.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workflow_settings (
  workflow_id TEXT PRIMARY KEY,
  subject_mode TEXT NOT NULL DEFAULT 'requester'
    CHECK (subject_mode IN ('requester','different_employee')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workflow_id) REFERENCES workflow_definitions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workflow_settings_mode
  ON workflow_settings(subject_mode);
