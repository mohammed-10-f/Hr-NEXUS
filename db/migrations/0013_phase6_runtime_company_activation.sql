PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workflow_company_settings (
  workflow_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
  allowed_submitters_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workflow_id, company_id),
  FOREIGN KEY (workflow_id) REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_workflow_company_settings_company ON workflow_company_settings(company_id,active);

CREATE TABLE IF NOT EXISTS workflow_company_stage_assignments (
  workflow_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  employee_ids_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workflow_id, stage_id, company_id),
  FOREIGN KEY (workflow_id) REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  FOREIGN KEY (stage_id) REFERENCES workflow_stages(id) ON DELETE CASCADE,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_workflow_company_stage_company ON workflow_company_stage_assignments(company_id,workflow_id);

INSERT OR IGNORE INTO permissions(id,resource,action,name_ar,name_en,description)
VALUES
('workflow.company_manage','workflow','company_manage','إدارة تفعيل المعاملات للشركة','Manage company workflow activation','تفعيل المعاملة وتحديد من يحق له التقديم ومسؤولي المراحل');
