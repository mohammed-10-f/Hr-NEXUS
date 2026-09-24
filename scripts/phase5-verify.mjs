import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const root = new URL('..', import.meta.url).pathname;
const migration = fs.readFileSync(new URL('../db/migrations/0007_phase5_employee_master_data.sql', import.meta.url), 'utf8');
const required = [
  'employee_contract_types','leave_policies','employee_salary_history','employee_bank_accounts','employee_statutory_profiles','employee_leave_balances','employee_career_history','employee_field_definitions','employee_field_values',
  'employee.view','employee.create','employee.edit','employee.view_salary','employee.edit_salary','employee.view_identity','employee.view_gosi','employee.view_bank','employee.view_sensitive_data','employee.export'
];
for (const item of required) if (!migration.includes(item)) throw new Error(`PHASE5_MISSING_${item}`);
execFileSync('npx',['tsc','--noEmit'],{cwd:root,stdio:'inherit'});
console.log('PHASE5_STATIC_OK');
