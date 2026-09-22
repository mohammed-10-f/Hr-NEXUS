-- HR Nexus Phase 2: authentication, multi-tenancy and platform company access.
-- Fresh D1 schema. This migration intentionally defines only the Phase 2 foundation.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  company_identifier TEXT NOT NULL UNIQUE,
  legal_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS platform_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','locked')),
  last_login_at TEXT,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS company_users (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  username TEXT NOT NULL,
  employee_id TEXT,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1 CHECK (must_change_password IN (0,1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','locked')),
  last_login_at TEXT,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  UNIQUE(company_id, username)
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  company_id TEXT,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  code TEXT NOT NULL,
  system_role INTEGER NOT NULL DEFAULT 0 CHECK (system_role IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
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
  company_user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(company_user_id, role_id),
  FOREIGN KEY (company_user_id) REFERENCES company_users(id) ON DELETE CASCADE,
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
  company_user_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  effect TEXT NOT NULL CHECK (effect IN ('allow','deny')),
  scope TEXT NOT NULL DEFAULT 'company',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(company_user_id, permission_id),
  FOREIGN KEY (company_user_id) REFERENCES company_users(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  session_type TEXT NOT NULL CHECK (session_type IN ('platform','company')),
  platform_user_id TEXT,
  company_user_id TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  ip_hash TEXT,
  user_agent_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (platform_user_id) REFERENCES platform_users(id) ON DELETE CASCADE,
  FOREIGN KEY (company_user_id) REFERENCES company_users(id) ON DELETE CASCADE,
  CHECK (
    (session_type='platform' AND platform_user_id IS NOT NULL AND company_user_id IS NULL)
    OR
    (session_type='company' AND platform_user_id IS NULL AND company_user_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS company_access_requests (
  id TEXT PRIMARY KEY,
  super_admin_user_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TEXT,
  rejected_at TEXT,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','revoked')),
  reason TEXT NOT NULL,
  approved_by TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (super_admin_user_id) REFERENCES platform_users(id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  FOREIGN KEY (approved_by) REFERENCES company_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS company_access_sessions (
  id TEXT PRIMARY KEY,
  request_id TEXT,
  super_admin_user_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  ip_hash TEXT,
  user_agent_hash TEXT,
  FOREIGN KEY (request_id) REFERENCES company_access_requests(id) ON DELETE SET NULL,
  FOREIGN KEY (super_admin_user_id) REFERENCES platform_users(id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  company_id TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('platform_user','company_user','system')),
  actor_platform_user_id TEXT,
  actor_company_user_id TEXT,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  resource_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  ip_hash TEXT,
  user_agent_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
  FOREIGN KEY (actor_platform_user_id) REFERENCES platform_users(id) ON DELETE SET NULL,
  FOREIGN KEY (actor_company_user_id) REFERENCES company_users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  body_ar TEXT,
  type TEXT NOT NULL DEFAULT 'info',
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES company_users(id) ON DELETE CASCADE
);

-- Phase 2 only needs employee data as a protected tenant-isolation test surface.
CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  employee_number TEXT NOT NULL,
  first_name TEXT NOT NULL,
  father_name TEXT,
  family_name TEXT,
  job_title TEXT,
  organization_unit_id TEXT,
  manager_employee_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','leave','terminated')),
  join_date TEXT,
  national_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  FOREIGN KEY (manager_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  UNIQUE(company_id, employee_number)
);

CREATE TABLE IF NOT EXISTS organization_units (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  parent_id TEXT,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  level_name TEXT NOT NULL,
  code TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  FOREIGN KEY (parent_id) REFERENCES organization_units(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_company_users_company ON company_users(company_id);
CREATE INDEX IF NOT EXISTS idx_company_users_login ON company_users(company_id, username);
CREATE INDEX IF NOT EXISTS idx_roles_company ON roles(company_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_access_requests_company_status ON company_access_requests(company_id, status);
CREATE INDEX IF NOT EXISTS idx_access_requests_admin ON company_access_requests(super_admin_user_id, status);
CREATE INDEX IF NOT EXISTS idx_access_sessions_token ON company_access_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_access_sessions_expiry ON company_access_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_company_created ON audit_logs(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(company_id, user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_employees_company_status ON employees(company_id, status);
CREATE INDEX IF NOT EXISTS idx_org_company_parent ON organization_units(company_id, parent_id);

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
('permissions.manage','permissions','manage','إدارة الصلاحيات','Manage permissions'),
('company_access.review','company_access','review','مراجعة دخول مدير المنصة','Review platform access requests');

CREATE TRIGGER IF NOT EXISTS trg_company_admin_role_check
BEFORE INSERT ON user_roles
BEGIN
  SELECT CASE
    WHEN (SELECT company_id FROM roles WHERE id = NEW.role_id) IS NOT NULL
     AND (SELECT company_id FROM company_users WHERE id = NEW.company_user_id) != (SELECT company_id FROM roles WHERE id = NEW.role_id)
    THEN RAISE(ABORT, 'ROLE_COMPANY_MISMATCH')
  END;
END;
