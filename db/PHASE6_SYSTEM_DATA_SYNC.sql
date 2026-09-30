-- HR Nexus Phase 6.1 — System Data Catalog sync
-- Target database: hr-nexus
-- Non-destructive. Creates only the two Phase 6 selection tables if absent.
-- Also represented by migration 0012_phase6_schema_compatibility.sql for normal deploys.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workflow_system_fields (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('requester','target')),
  source_key TEXT NOT NULL,
  label_ar TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workflow_id) REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  UNIQUE(workflow_id,scope,source_key)
);
CREATE INDEX IF NOT EXISTS idx_workflow_system_fields_workflow_scope ON workflow_system_fields(workflow_id,scope,sort_order);

CREATE TABLE IF NOT EXISTS workflow_request_settings (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL UNIQUE,
  target_employee_enabled INTEGER NOT NULL DEFAULT 0 CHECK (target_employee_enabled IN (0,1)),
  target_employee_required INTEGER NOT NULL DEFAULT 0 CHECK (target_employee_required IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workflow_id) REFERENCES workflow_definitions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_workflow_request_settings_workflow ON workflow_request_settings(workflow_id);
