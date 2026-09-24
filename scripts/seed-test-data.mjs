#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args=process.argv.slice(2);
const remote=args.includes('--remote');
const password=process.env.HR_NEXUS_TEST_PASSWORD || 'Mm123456';

function hash(pw){
  const salt=crypto.randomUUID();
  const iterations=100000;
  const derived=crypto.pbkdf2Sync(pw,Buffer.from(salt),iterations,32,'sha256').toString('base64');
  return `pbkdf2$${iterations}$${salt}$${derived}`;
}
const now=Date.now();
const ids={
  a:crypto.randomUUID(), b:crypto.randomUUID(),
  adminA:crypto.randomUUID(), adminB:crypto.randomUUID(),
  userA:crypto.randomUUID(), userB:crypto.randomUUID(),
  roleA:crypto.randomUUID(), roleB:crypto.randomUUID(), empRoleA:crypto.randomUUID(), empRoleB:crypto.randomUUID(),
  empA:crypto.randomUUID(), empB:crypto.randomUUID(),
  super:crypto.randomUUID()
};
const hashA=hash(password);
const sql=`
INSERT OR REPLACE INTO companies(id,company_identifier,legal_name,display_name,status) VALUES
('${ids.a}','A001','شركة اختبار ألف','Company A','active'),
('${ids.b}','A002','شركة اختبار باء','Company B','active');

INSERT OR REPLACE INTO platform_users(id,username,display_name,password_hash,status) VALUES
('${ids.super}','superadmin','مدير المنصة التجريبي','${hashA}','active');

INSERT OR REPLACE INTO roles(id,company_id,name_ar,name_en,code,system_role) VALUES
('${ids.roleA}','${ids.a}','مدير الشركة','Company Admin','company_admin',1),
('${ids.roleB}','${ids.b}','مدير الشركة','Company Admin','company_admin',1),
('${ids.empRoleA}','${ids.a}','موظف','Employee','employee',0),
('${ids.empRoleB}','${ids.b}','موظف','Employee','employee',0);

INSERT OR REPLACE INTO company_users(id,company_id,username,password_hash,must_change_password,status) VALUES
('${ids.adminA}','${ids.a}','1234567890','${hashA}',1,'active'),
('${ids.adminB}','${ids.b}','2234567890','${hashA}',1,'active'),
('${ids.userA}','${ids.a}','1001','${hashA}',1,'active'),
('${ids.userB}','${ids.b}','2001','${hashA}',1,'active');

INSERT OR REPLACE INTO user_roles(company_user_id,role_id) VALUES
('${ids.adminA}','${ids.roleA}'),('${ids.adminB}','${ids.roleB}'),
('${ids.userA}','${ids.empRoleA}'),('${ids.userB}','${ids.empRoleB}');
INSERT OR IGNORE INTO role_permissions(role_id,permission_id,scope) SELECT '${ids.roleA}',id,'company' FROM permissions;
INSERT OR IGNORE INTO role_permissions(role_id,permission_id,scope) SELECT '${ids.roleB}',id,'company' FROM permissions;
INSERT OR IGNORE INTO role_permissions(role_id,permission_id,scope) SELECT '${ids.empRoleA}',id,'company' FROM permissions WHERE id IN ('dashboard.view','employees.view','organization.view');
INSERT OR IGNORE INTO role_permissions(role_id,permission_id,scope) SELECT '${ids.empRoleB}',id,'company' FROM permissions WHERE id IN ('dashboard.view','employees.view','organization.view');

INSERT OR REPLACE INTO employees(id,company_id,employee_number,first_name,family_name,job_title,status,join_date,national_id) VALUES
('${ids.empA}','${ids.a}','1001','موظف','ألف','موظف اختبار','active','2026-01-01','1000000001'),
('${ids.empB}','${ids.b}','2001','موظف','باء','موظف اختبار','active','2026-01-01','2000000001');

UPDATE company_users SET employee_id='${ids.empA}' WHERE id='${ids.userA}';
UPDATE company_users SET employee_id='${ids.empB}' WHERE id='${ids.userB}';
`;
const file=path.join(os.tmpdir(),`hr-nexus-seed-${now}.sql`);
fs.writeFileSync(file,sql);
try{
  const flags=['d1','execute','hr-nexus',remote?'--remote':'--local',`--file=${file}`];
  execFileSync(process.platform==='win32'?'npx.cmd':'npx',['wrangler',...flags],{stdio:'inherit'});
  console.log(`Seeded Phase 2 test data. Test password: ${password}`);
  console.log('Super Admin: superadmin');
  console.log('Company A Admin: A001 / 1234567890');
  console.log('Company B Admin: A002 / 2234567890');
  console.log('Company A Employee: A001 / 1001');
  console.log('Company B Employee: A002 / 2001');
} finally { try{fs.unlinkSync(file)}catch{} }
