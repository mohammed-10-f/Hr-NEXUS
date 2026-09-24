-- HR Nexus Phase 5: Employee Master Data.
-- Non-destructive extension of the existing employees model.
PRAGMA foreign_keys = ON;

ALTER TABLE employees ADD COLUMN nationality TEXT;
ALTER TABLE employees ADD COLUMN gender TEXT;
ALTER TABLE employees ADD COLUMN date_of_birth TEXT;
ALTER TABLE employees ADD COLUMN personal_phone TEXT;
ALTER TABLE employees ADD COLUMN personal_email TEXT;
ALTER TABLE employees ADD COLUMN short_address TEXT;
ALTER TABLE employees ADD COLUMN photo_url TEXT;
ALTER TABLE employees ADD COLUMN identity_type TEXT;
ALTER TABLE employees ADD COLUMN identity_issue_date TEXT;
ALTER TABLE employees ADD COLUMN identity_issuer TEXT;
ALTER TABLE employees ADD COLUMN passport_number TEXT;
ALTER TABLE employees ADD COLUMN passport_issue_date TEXT;
ALTER TABLE employees ADD COLUMN passport_expiry_date TEXT;
ALTER TABLE employees ADD COLUMN actual_start_date TEXT;
ALTER TABLE employees ADD COLUMN position_id TEXT;
ALTER TABLE employees ADD COLUMN work_location TEXT;
ALTER TABLE employees ADD COLUMN employment_type TEXT;
ALTER TABLE employees ADD COLUMN contract_type TEXT;
ALTER TABLE employees ADD COLUMN contract_start_date TEXT;
ALTER TABLE employees ADD COLUMN contract_end_date TEXT;
ALTER TABLE employees ADD COLUMN contract_auto_renew INTEGER NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN probation_days INTEGER NOT NULL DEFAULT 180;
ALTER TABLE employees ADD COLUMN probation_extension_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE employees ADD COLUMN probation_end_date TEXT;
ALTER TABLE employees ADD COLUMN probation_result TEXT;
ALTER TABLE employees ADD COLUMN probation_decision_at TEXT;
ALTER TABLE employees ADD COLUMN leave_policy_id TEXT;
ALTER TABLE employees ADD COLUMN gosi_number TEXT;
ALTER TABLE employees ADD COLUMN residency_classification TEXT;
ALTER TABLE employees ADD COLUMN insurance_profile TEXT;
ALTER TABLE employees ADD COLUMN professional_hazard INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS employee_contract_types (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  UNIQUE(company_id, code)
);

CREATE TABLE IF NOT EXISTS leave_policies (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  UNIQUE(company_id, code)
);

CREATE TABLE IF NOT EXISTS employee_salary_history (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  basic_salary NUMERIC NOT NULL DEFAULT 0,
  housing_allowance NUMERIC NOT NULL DEFAULT 0,
  transport_allowance NUMERIC NOT NULL DEFAULT 0,
  other_allowances NUMERIC NOT NULL DEFAULT 0,
  effective_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS employee_bank_accounts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  iban TEXT NOT NULL,
  account_holder_name TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS employee_statutory_profiles (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  gosi_number TEXT,
  insurance_number TEXT,
  insurance_provider TEXT,
  insurance_class TEXT,
  professional_hazard INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
  UNIQUE(employee_id)
);

CREATE TABLE IF NOT EXISTS employee_leave_balances (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  leave_type TEXT NOT NULL,
  balance_days NUMERIC NOT NULL DEFAULT 0,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS employee_career_history (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  change_type TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  organization_unit_id TEXT,
  position_id TEXT,
  job_title TEXT,
  manager_employee_id TEXT,
  salary_history_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS employee_field_definitions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  label_ar TEXT NOT NULL,
  label_en TEXT,
  field_type TEXT NOT NULL,
  options_json TEXT,
  required INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  UNIQUE(company_id, field_key)
);

CREATE TABLE IF NOT EXISTS employee_field_values (
  employee_id TEXT NOT NULL,
  field_definition_id TEXT NOT NULL,
  value_text TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(employee_id, field_definition_id),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
  FOREIGN KEY (field_definition_id) REFERENCES employee_field_definitions(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_employees_company_national_id ON employees(company_id, national_id);
CREATE INDEX IF NOT EXISTS idx_employees_company_org ON employees(company_id, organization_unit_id);
CREATE INDEX IF NOT EXISTS idx_employees_company_position ON employees(company_id, position_id);
CREATE INDEX IF NOT EXISTS idx_employees_company_join_date ON employees(company_id, actual_start_date);
CREATE INDEX IF NOT EXISTS idx_salary_employee_effective ON employee_salary_history(company_id, employee_id, effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_bank_employee ON employee_bank_accounts(company_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_employee ON employee_leave_balances(company_id, employee_id, effective_from);
CREATE INDEX IF NOT EXISTS idx_career_employee_date ON employee_career_history(company_id, employee_id, effective_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_one_active_per_employee ON employee_bank_accounts(employee_id) WHERE active=1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_active_position ON employees(company_id, position_id) WHERE position_id IS NOT NULL AND status <> 'terminated';

-- Cross-tenant employee references are rejected at the database layer.
CREATE TRIGGER IF NOT EXISTS trg_employee_company_refs_insert
BEFORE INSERT ON employees
BEGIN
  SELECT CASE
    WHEN NEW.organization_unit_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM organization_units WHERE id=NEW.organization_unit_id AND company_id=NEW.company_id
    ) THEN RAISE(ABORT, 'EMP_ORG_COMPANY_MISMATCH')
    WHEN NEW.position_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM positions WHERE id=NEW.position_id AND company_id=NEW.company_id
    ) THEN RAISE(ABORT, 'EMP_POSITION_COMPANY_MISMATCH')
    WHEN NEW.manager_employee_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM employees WHERE id=NEW.manager_employee_id AND company_id=NEW.company_id
    ) THEN RAISE(ABORT, 'EMP_MANAGER_COMPANY_MISMATCH')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_employee_company_refs_update
BEFORE UPDATE OF company_id, organization_unit_id, position_id, manager_employee_id ON employees
BEGIN
  SELECT CASE
    WHEN NEW.organization_unit_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM organization_units WHERE id=NEW.organization_unit_id AND company_id=NEW.company_id
    ) THEN RAISE(ABORT, 'EMP_ORG_COMPANY_MISMATCH')
    WHEN NEW.position_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM positions WHERE id=NEW.position_id AND company_id=NEW.company_id
    ) THEN RAISE(ABORT, 'EMP_POSITION_COMPANY_MISMATCH')
    WHEN NEW.manager_employee_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM employees WHERE id=NEW.manager_employee_id AND company_id=NEW.company_id
    ) THEN RAISE(ABORT, 'EMP_MANAGER_COMPANY_MISMATCH')
  END;
END;

INSERT OR IGNORE INTO permissions(id,resource,action,name_ar,name_en,description) VALUES
('employee.view','employee','view','عرض الموظفين','View employees','عرض بيانات الموظفين ضمن النطاق المصرح'),
('employee.create','employee','create','إضافة موظف','Create employee','إنشاء سجل موظف'),
('employee.edit','employee','edit','تعديل الموظف','Edit employee','تعديل بيانات الموظف'),
('employee.view_salary','employee','view_salary','عرض الراتب','View salary','عرض بيانات الراتب وتاريخه'),
('employee.edit_salary','employee','edit_salary','تعديل الراتب','Edit salary','إضافة وتعديل سجلات الراتب'),
('employee.view_identity','employee','view_identity','عرض الهوية','View identity','عرض بيانات الهوية والجواز'),
('employee.view_gosi','employee','view_gosi','عرض التأمينات','View GOSI/Insurance','عرض بيانات التأمينات والتأمين'),
('employee.view_bank','employee','view_bank','عرض البنك','View bank','عرض بيانات الحساب البنكي'),
('employee.view_sensitive_data','employee','view_sensitive_data','عرض البيانات الحساسة','View sensitive data','عرض البيانات الشخصية الحساسة'),
('employee.export','employee','export','تصدير الموظفين','Export employees','تصدير بيانات الموظفين'),
('employee.manage_custom_fields','employee','manage_custom_fields','إدارة الحقول المخصصة','Manage custom fields','إدارة حقول الموظف القابلة للتهيئة'),
('employee.manage_contract_types','employee','manage_contract_types','إدارة أنواع العقود','Manage contract types','إدارة أنواع العقود الخاصة بالشركة');

INSERT OR IGNORE INTO role_permissions(role_id,permission_id,scope)
SELECT r.id,p.id,'company'
FROM roles r CROSS JOIN permissions p
WHERE r.code='company_admin' AND r.system_role=1 AND p.resource='employee';

-- Reference data only; no employee/demo records are created.
INSERT OR IGNORE INTO employee_contract_types(id,company_id,code,name_ar,name_en,sort_order)
SELECT lower(hex(randomblob(16))),c.id,'fixed','محدد المدة','Fixed term',10 FROM companies c;
INSERT OR IGNORE INTO employee_contract_types(id,company_id,code,name_ar,name_en,sort_order)
SELECT lower(hex(randomblob(16))),c.id,'unlimited','غير محدد المدة','Unlimited',20 FROM companies c;
INSERT OR IGNORE INTO employee_contract_types(id,company_id,code,name_ar,name_en,sort_order)
SELECT lower(hex(randomblob(16))),c.id,'part_time','دوام جزئي','Part time',30 FROM companies c;
INSERT OR IGNORE INTO employee_contract_types(id,company_id,code,name_ar,name_en,sort_order)
SELECT lower(hex(randomblob(16))),c.id,'cooperative_training','تدريب تعاوني','Cooperative training',40 FROM companies c;
INSERT OR IGNORE INTO employee_contract_types(id,company_id,code,name_ar,name_en,sort_order)
SELECT lower(hex(randomblob(16))),c.id,'tamheer','تمهير','Tamheer',50 FROM companies c;
