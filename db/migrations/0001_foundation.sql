-- HR Nexus Phase 1 foundation migration.
-- Non-destructive: creates only HR Nexus tables if absent. No DROP/DELETE/ALTER of legacy objects.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  employee_id TEXT,
  login_identifier TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','locked')),
  last_login_at TEXT,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  employee_number TEXT NOT NULL,
  first_name TEXT NOT NULL,
  father_name TEXT,
  grandfather_name TEXT,
  family_name TEXT,
  english_name TEXT,
  gender TEXT,
  date_of_birth TEXT,
  nationality TEXT,
  marital_status TEXT,
  identity_type TEXT,
  national_id TEXT,
  identity_expiry TEXT,
  identity_issue_date TEXT,
  identity_issuing_authority TEXT,
  mobile TEXT,
  email TEXT,
  short_address TEXT,
  join_date TEXT,
  job_title TEXT,
  organization_unit_id TEXT,
  manager_employee_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','leave','terminated')),
  bank_name TEXT,
  iban TEXT,
  photo_url TEXT,
  internal_extension TEXT,
  previous_employee_number TEXT,
  notes TEXT,
  passport_number TEXT,
  passport_issue_date TEXT,
  passport_expiry TEXT,
  custom_fields_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  FOREIGN KEY (manager_employee_id) REFERENCES employees(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS organization_units (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  parent_id TEXT,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  level_name TEXT NOT NULL,
  code TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  FOREIGN KEY (parent_id) REFERENCES organization_units(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  organization_unit_id TEXT,
  parent_position_id TEXT,
  title_ar TEXT NOT NULL,
  title_en TEXT,
  code TEXT,
  status TEXT NOT NULL DEFAULT 'vacant' CHECK (status IN ('occupied','vacant','frozen','inactive')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_unit_id) REFERENCES organization_units(id) ON DELETE SET NULL,
  FOREIGN KEY (parent_position_id) REFERENCES positions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS employee_positions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  position_id TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 1,
  valid_from TEXT,
  valid_to TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  code TEXT NOT NULL,
  system_role INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  resource TEXT NOT NULL,
  action TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(resource, action)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'company',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  effect TEXT NOT NULL CHECK (effect IN ('allow','deny')),
  scope TEXT NOT NULL DEFAULT 'company',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, permission_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  ip_hash TEXT,
  user_agent_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  body_ar TEXT,
  type TEXT NOT NULL DEFAULT 'info',
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  resource_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_users_tenant_login ON users(tenant_id, login_identifier);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_tenant_login ON users(tenant_id, login_identifier);
CREATE INDEX IF NOT EXISTS idx_employees_tenant_status ON employees(tenant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_tenant_number ON employees(tenant_id, employee_number);
CREATE INDEX IF NOT EXISTS idx_employees_tenant_national_id ON employees(tenant_id, national_id);
CREATE INDEX IF NOT EXISTS idx_employees_org ON employees(tenant_id, organization_unit_id);
CREATE INDEX IF NOT EXISTS idx_org_units_tenant_parent ON organization_units(tenant_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_positions_tenant_org ON positions(tenant_id, organization_unit_id);
CREATE INDEX IF NOT EXISTS idx_employee_positions_employee ON employee_positions(tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant_user ON sessions(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(tenant_id, user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created ON audit_logs(tenant_id, created_at);

INSERT OR IGNORE INTO roles(id, tenant_id, name_ar, name_en, code, system_role) VALUES
('role-super-admin', NULL, 'مدير المنصة', 'Platform Super Admin', 'super_admin', 1),
('role-company-admin', NULL, 'مدير الشركة', 'Company Admin', 'company_admin', 1);

INSERT OR IGNORE INTO permissions(id, resource, action, name_ar, name_en) VALUES
('dashboard.view','dashboard','view','عرض الرئيسية','View dashboard'),
('employees.view','employees','view','عرض الموظفين','View employees'),
('employees.create','employees','create','إضافة موظف','Create employee'),
('employees.edit','employees','edit','تعديل الموظفين','Edit employees'),
('organization.view','organization','view','عرض الهيكل التنظيمي','View organization'),
('salary.view','salary','view','عرض الراتب','View salary'),
('transactions.view','transactions','view','عرض المعاملات','View transactions'),
('leaves.create','leaves','create','إنشاء إجازة','Create leave'),
('leaves.approve','leaves','approve','اعتماد الإجازة','Approve leave'),
('permissions.manage','permissions','manage','إدارة الصلاحيات','Manage permissions');
