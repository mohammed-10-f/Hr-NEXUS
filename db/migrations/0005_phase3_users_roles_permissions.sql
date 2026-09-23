-- HR Nexus Phase 3: users, roles, permissions management and scope foundation.
PRAGMA foreign_keys = ON;

ALTER TABLE roles ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled'));
ALTER TABLE role_permissions ADD COLUMN scope_value TEXT;
ALTER TABLE user_permissions ADD COLUMN scope_value TEXT;

CREATE INDEX IF NOT EXISTS idx_roles_company_status ON roles(company_id, status);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_permission ON user_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_company_users_employee ON company_users(company_id, employee_id);

INSERT OR IGNORE INTO permissions(id,resource,action,name_ar,name_en,description) VALUES
('users.view','users','view','عرض المستخدمين','View users','عرض مستخدمي الشركة'),
('users.create','users','create','إضافة مستخدم','Create users','إنشاء مستخدم داخل الشركة'),
('users.edit','users','edit','تعديل المستخدمين','Edit users','تعديل بيانات مستخدمي الشركة'),
('users.activate','users','activate','تفعيل المستخدمين','Activate users','تفعيل حساب مستخدم'),
('users.deactivate','users','deactivate','تعطيل المستخدمين','Deactivate users','تعطيل حساب مستخدم'),
('users.reset_password','users','reset_password','إعادة تعيين كلمات المرور','Reset passwords','إعادة تعيين كلمة مرور مستخدم'),
('roles.view','roles','view','عرض الأدوار','View roles','عرض أدوار الشركة'),
('roles.create','roles','create','إنشاء دور','Create roles','إنشاء دور جديد'),
('roles.edit','roles','edit','تعديل الدور','Edit roles','تعديل بيانات الدور'),
('roles.disable','roles','disable','تعطيل الدور','Disable roles','تعطيل دور دون حذفه'),
('permissions.manage','permissions','manage','إدارة الصلاحيات','Manage permissions','إدارة صلاحيات الأدوار والاستثناءات الفردية'),
('permissions.view','permissions','view','عرض الصلاحيات','View permissions','عرض كتالوج صلاحيات النظام');

-- Existing Company Admin roles are system roles and must retain broad Phase 2 authority.
INSERT OR IGNORE INTO role_permissions(role_id,permission_id,scope)
SELECT r.id,p.id,'company'
FROM roles r CROSS JOIN permissions p
WHERE r.code='company_admin' AND r.system_role=1;
