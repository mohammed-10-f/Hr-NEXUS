-- HR Nexus Phase 6 — final non-destructive D1 synchronization
-- Target database: hr-nexus
-- Safe for manual execution after Phase 1-5.
-- Does not DROP/DELETE Phase 1-5 data and does not create a new D1.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS transaction_types (
  id TEXT PRIMARY KEY, company_id TEXT, name_ar TEXT NOT NULL, name_en TEXT,
  description TEXT, allowed_submitters_json TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_by TEXT, updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_transaction_types_scope_name
  ON transaction_types(COALESCE(company_id,'__GLOBAL__'),name_ar);
CREATE INDEX IF NOT EXISTS idx_transaction_types_company_status ON transaction_types(company_id,status);

CREATE TABLE IF NOT EXISTS transaction_type_companies (
  transaction_type_id TEXT NOT NULL, company_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(transaction_type_id,company_id),
  FOREIGN KEY(transaction_type_id) REFERENCES transaction_types(id) ON DELETE CASCADE,
  FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_transaction_type_companies_company ON transaction_type_companies(company_id,active);

CREATE TABLE IF NOT EXISTS workflow_definitions (
  id TEXT PRIMARY KEY, transaction_type_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  description TEXT, allowed_submitters_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','inactive')),
  created_by TEXT, updated_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(transaction_type_id) REFERENCES transaction_types(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_workflow_active_type ON workflow_definitions(transaction_type_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_workflow_type_status_version ON workflow_definitions(transaction_type_id,status,version);

CREATE TABLE IF NOT EXISTS workflow_stages (
  id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, name_ar TEXT NOT NULL, name_en TEXT,
  stage_order INTEGER NOT NULL, responsible_type TEXT NOT NULL DEFAULT 'company_admin',
  responsible_value TEXT, duration_minutes INTEGER, config_json TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workflow_id) REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  UNIQUE(workflow_id,stage_order)
);
CREATE INDEX IF NOT EXISTS idx_workflow_stages_workflow_order ON workflow_stages(workflow_id,stage_order);

CREATE TABLE IF NOT EXISTS workflow_fields (
  id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, stage_id TEXT,
  field_key TEXT NOT NULL, label_ar TEXT NOT NULL, label_en TEXT,
  field_type TEXT NOT NULL CHECK(field_type IN ('text','textarea','number','date','datetime','boolean','select','multiselect','employee','organization_unit','position','user')),
  required INTEGER NOT NULL DEFAULT 0 CHECK(required IN (0,1)),
  options_json TEXT, config_json TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workflow_id) REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  FOREIGN KEY(stage_id) REFERENCES workflow_stages(id) ON DELETE SET NULL,
  UNIQUE(workflow_id,field_key)
);
CREATE INDEX IF NOT EXISTS idx_workflow_fields_workflow_stage_order ON workflow_fields(workflow_id,stage_id,sort_order);
CREATE TABLE IF NOT EXISTS workflow_questions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  stage_id TEXT,
  question_key TEXT NOT NULL,
  question_ar TEXT NOT NULL,
  question_en TEXT,
  question_type TEXT NOT NULL CHECK(question_type IN ('text','yes_no','select','notes')),
  required INTEGER NOT NULL DEFAULT 0 CHECK(required IN (0,1)),
  options_json TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workflow_id) REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  FOREIGN KEY(stage_id) REFERENCES workflow_stages(id) ON DELETE CASCADE,
  UNIQUE(workflow_id,question_key)
);
CREATE INDEX IF NOT EXISTS idx_workflow_questions_stage ON workflow_questions(stage_id,sort_order);

CREATE TABLE IF NOT EXISTS workflow_conditions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  stage_id TEXT,
  source_type TEXT NOT NULL CHECK(source_type IN ('field','question')),
  source_id TEXT NOT NULL,
  operator TEXT NOT NULL,
  expected_value TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workflow_id) REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  FOREIGN KEY(stage_id) REFERENCES workflow_stages(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_workflow_conditions_stage ON workflow_conditions(stage_id);


CREATE TABLE IF NOT EXISTS workflow_transitions (
  id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, from_stage_id TEXT NOT NULL,
  to_stage_id TEXT,
  action TEXT NOT NULL CHECK(action IN ('next','return','complete','reject','cancel')),
  label_ar TEXT NOT NULL, condition_json TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workflow_id) REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  FOREIGN KEY(from_stage_id) REFERENCES workflow_stages(id) ON DELETE CASCADE,
  FOREIGN KEY(to_stage_id) REFERENCES workflow_stages(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_transitions_workflow_from_order ON workflow_transitions(workflow_id,from_stage_id,sort_order);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL, transaction_number INTEGER NOT NULL,
  transaction_type_id TEXT NOT NULL, workflow_id TEXT NOT NULL,
  requester_user_id TEXT, employee_id TEXT,
  status TEXT NOT NULL DEFAULT 'قيد الإجراء' CHECK(status IN ('قيد الإجراء','مكتملة','ملغية','مرفوضة')),
  current_stage_id TEXT, data_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  FOREIGN KEY(transaction_type_id) REFERENCES transaction_types(id) ON DELETE RESTRICT,
  FOREIGN KEY(workflow_id) REFERENCES workflow_definitions(id) ON DELETE RESTRICT,
  FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
  FOREIGN KEY(current_stage_id) REFERENCES workflow_stages(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_transactions_company_number ON transactions(company_id,transaction_number);
CREATE INDEX IF NOT EXISTS idx_transactions_company_status ON transactions(company_id,status,updated_at);

CREATE TABLE IF NOT EXISTS transaction_sequences (
  company_id TEXT PRIMARY KEY, next_number INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS transaction_stage_executions (
  id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL, stage_id TEXT NOT NULL,
  execution_order INTEGER NOT NULL, started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_at TEXT, completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','returned','rejected','cancelled')),
  acted_by TEXT, return_reason TEXT, stage_snapshot_json TEXT, answers_snapshot_json TEXT,
  FOREIGN KEY(transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  FOREIGN KEY(stage_id) REFERENCES workflow_stages(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_transaction_stage_history ON transaction_stage_executions(transaction_id,execution_order);

CREATE TABLE IF NOT EXISTS transaction_answers (
  id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL,
  field_id TEXT, question_id TEXT, value_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  FOREIGN KEY(field_id) REFERENCES workflow_fields(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_transaction_answer_field ON transaction_answers(transaction_id,field_id) WHERE field_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_transaction_answer_question ON transaction_answers(transaction_id,question_id) WHERE question_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS transaction_actions (
  id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL, company_id TEXT NOT NULL,
  actor_user_id TEXT, action TEXT NOT NULL, from_stage_id TEXT, to_stage_id TEXT,
  reason TEXT, metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  FOREIGN KEY(from_stage_id) REFERENCES workflow_stages(id) ON DELETE SET NULL,
  FOREIGN KEY(to_stage_id) REFERENCES workflow_stages(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_transaction_actions_tx ON transaction_actions(transaction_id,created_at);
CREATE INDEX IF NOT EXISTS idx_transaction_actions_company_created ON transaction_actions(company_id,created_at);

CREATE TABLE IF NOT EXISTS transaction_feedback (
  id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL, stage_id TEXT NOT NULL,
  employee_id TEXT, user_id TEXT, feedback TEXT NOT NULL, context_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  FOREIGN KEY(stage_id) REFERENCES workflow_stages(id) ON DELETE RESTRICT,
  FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS transaction_attachments (
  id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL, stage_id TEXT,
  storage_key TEXT NOT NULL, file_name TEXT NOT NULL, content_type TEXT,
  size_bytes INTEGER, uploaded_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  FOREIGN KEY(stage_id) REFERENCES workflow_stages(id) ON DELETE SET NULL
);

INSERT OR IGNORE INTO permissions(id,resource,action,name_ar,name_en,description) VALUES
('workflow.view','workflow','view','عرض استوديو سير العمل','View workflow studio','عرض قوالب سير العمل'),
('workflow.create','workflow','create','إنشاء قالب سير عمل','Create workflow template','إنشاء قالب سير العمل'),
('workflow.edit','workflow','edit','تعديل قالب سير عمل','Edit workflow template','تعديل مسودة سير العمل'),
('workflow.manage','workflow','manage','إدارة سير العمل','Manage workflows','الفحص والاعتماد وإدارة القوالب'),
('transaction.create','transaction','create','إنشاء معاملة','Create transaction','الأساس البرمجي لإنشاء المعاملات'),
('transaction.view','transaction','view','عرض المعاملات','View transactions','الأساس البرمجي لعرض المعاملات'),
('transaction.search','transaction','search','البحث عن معاملة','Search transactions','البحث برقم المعاملة'),
('transaction.process','transaction','process','معالجة المعاملات','Process transactions','معالجة المرحلة الحالية'),
('transaction.cancel','transaction','cancel','إلغاء المعاملة','Cancel transaction','إلغاء المعاملة'),
('transaction.reject','transaction','reject','رفض المعاملة','Reject transaction','رفض المعاملة'),
('transaction.return','transaction','return','إرجاع المعاملة','Return transaction','إرجاع المعاملة لمرحلة سابقة'),
('transaction.feedback','transaction','feedback','ملاحظات الموظف','Employee feedback','إضافة ملاحظات الموظف ضمن سير العمل'),
('transaction.attach','transaction','attach','مرفقات المعاملة','Transaction attachments','إدارة مرفقات المعاملة');

CREATE TABLE IF NOT EXISTS workflow_settings (
  workflow_id TEXT PRIMARY KEY,
  subject_mode TEXT NOT NULL DEFAULT 'requester' CHECK(subject_mode IN ('requester','different_employee')),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workflow_id) REFERENCES workflow_definitions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_workflow_settings_mode ON workflow_settings(subject_mode);

-- Phase 6.1: selected system-data fields and requester/target settings.
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


-- Phase 6.2: schema compatibility guard.
-- Safe on an existing hr-nexus D1; CREATE IF NOT EXISTS only.
CREATE TABLE IF NOT EXISTS workflow_system_fields (
  id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('requester','target')),
  source_key TEXT NOT NULL, label_ar TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workflow_id) REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  UNIQUE(workflow_id,scope,source_key)
);
CREATE INDEX IF NOT EXISTS idx_workflow_system_fields_workflow_scope ON workflow_system_fields(workflow_id,scope,sort_order);

CREATE TABLE IF NOT EXISTS workflow_request_settings (
  id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL UNIQUE,
  target_employee_enabled INTEGER NOT NULL DEFAULT 0 CHECK (target_employee_enabled IN (0,1)),
  target_employee_required INTEGER NOT NULL DEFAULT 0 CHECK (target_employee_required IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workflow_id) REFERENCES workflow_definitions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_workflow_request_settings_workflow ON workflow_request_settings(workflow_id);
