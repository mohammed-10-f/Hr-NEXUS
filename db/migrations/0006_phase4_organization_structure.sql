-- HR Nexus Phase 4: real organization structure, positions and management hierarchy.
-- Preserve all existing tables/data. This migration only extends the current D1 schema.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  organization_unit_id TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  title_en TEXT,
  code TEXT,
  status TEXT NOT NULL DEFAULT 'vacant' CHECK (status IN ('vacant','occupied','frozen')),
  manager_position_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_unit_id) REFERENCES organization_units(id) ON DELETE RESTRICT,
  FOREIGN KEY (manager_position_id) REFERENCES positions(id) ON DELETE SET NULL,
  CHECK (manager_position_id IS NULL OR manager_position_id <> id)
);

CREATE INDEX IF NOT EXISTS idx_positions_company_unit ON positions(company_id, organization_unit_id);
CREATE INDEX IF NOT EXISTS idx_positions_company_status ON positions(company_id, status);
CREATE INDEX IF NOT EXISTS idx_positions_manager ON positions(company_id, manager_position_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_company_code
  ON positions(company_id, code)
  WHERE code IS NOT NULL AND TRIM(code) <> '';

-- Parent units must stay inside the same tenant and cannot point to themselves.
CREATE TRIGGER IF NOT EXISTS trg_org_unit_parent_company_insert
BEFORE INSERT ON organization_units
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NEW.parent_id = NEW.id THEN RAISE(ABORT, 'ORG_PARENT_SELF')
    WHEN NOT EXISTS (
      SELECT 1 FROM organization_units
      WHERE id = NEW.parent_id AND company_id = NEW.company_id
    ) THEN RAISE(ABORT, 'ORG_PARENT_COMPANY_MISMATCH')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_org_unit_parent_company_update
BEFORE UPDATE OF parent_id, company_id ON organization_units
WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NEW.parent_id = NEW.id THEN RAISE(ABORT, 'ORG_PARENT_SELF')
    WHEN NOT EXISTS (
      SELECT 1 FROM organization_units
      WHERE id = NEW.parent_id AND company_id = NEW.company_id
    ) THEN RAISE(ABORT, 'ORG_PARENT_COMPANY_MISMATCH')
  END;
END;

-- A position may only reference a unit/manager belonging to the same company.
CREATE TRIGGER IF NOT EXISTS trg_position_company_refs_insert
BEFORE INSERT ON positions
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM organization_units
      WHERE id = NEW.organization_unit_id AND company_id = NEW.company_id
    ) THEN RAISE(ABORT, 'ORG_POSITION_UNIT_COMPANY_MISMATCH')
    WHEN NEW.manager_position_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM positions
      WHERE id = NEW.manager_position_id AND company_id = NEW.company_id
    ) THEN RAISE(ABORT, 'ORG_MANAGER_COMPANY_MISMATCH')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_position_company_refs_update
BEFORE UPDATE OF organization_unit_id, manager_position_id, company_id ON positions
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM organization_units
      WHERE id = NEW.organization_unit_id AND company_id = NEW.company_id
    ) THEN RAISE(ABORT, 'ORG_POSITION_UNIT_COMPANY_MISMATCH')
    WHEN NEW.manager_position_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM positions
      WHERE id = NEW.manager_position_id AND company_id = NEW.company_id
    ) THEN RAISE(ABORT, 'ORG_MANAGER_COMPANY_MISMATCH')
  END;
END;

INSERT OR IGNORE INTO permissions(id,resource,action,name_ar,name_en,description) VALUES
('organization.create','organization','create','إنشاء وحدة تنظيمية','Create organization unit','إنشاء وحدة تنظيمية داخل الشركة'),
('organization.edit','organization','edit','تعديل الوحدة التنظيمية','Edit organization unit','تعديل بيانات الوحدة وحالتها'),
('organization.move','organization','move','نقل الوحدة التنظيمية','Move organization unit','نقل الوحدة إلى أب تنظيمي آخر داخل الشركة'),
('organization.manage_positions','organization','manage_positions','إدارة المناصب','Manage positions','إنشاء وتعديل وإدارة المناصب الوظيفية'),
('organization.manage_managers','organization','manage_managers','إدارة المديرين','Manage managers','تعيين وتغيير العلاقات الإدارية للمناصب'),
('organization.export','organization','export','تصدير الهيكل التنظيمي','Export organization','تصدير بيانات الهيكل التنظيمي');

-- Existing system Company Admin roles retain their broad authority and receive the new
-- Phase 4 permissions without changing or recreating the role itself.
INSERT OR IGNORE INTO role_permissions(role_id,permission_id,scope)
SELECT r.id,p.id,'company'
FROM roles r CROSS JOIN permissions p
WHERE r.code='company_admin' AND r.system_role=1
  AND p.resource='organization';
