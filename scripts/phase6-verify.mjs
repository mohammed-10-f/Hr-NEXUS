import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const must = (condition, message) => { if (!condition) throw new Error(message); };

const studio = read('src/client/pages/WorkflowAdmin.tsx');
const test = read('src/client/pages/WorkflowTestEnvironment.tsx');
const routes = read('src/server/routes/workflows.ts');
const main = read('src/client/main.tsx');
const shell = read('src/client/components/AppShell.tsx');

must(main.includes('/workflow-studio'), 'Studio route missing');
must(main.includes('/workflow-studio/test'), 'Test route missing');
must(!main.includes('/transactions'), 'Company transaction route must not be exposed');
must(shell.includes("label:'استوديو سير العمل'"), 'Studio navigation missing');
must(!shell.includes('معاملات الشركات'), 'Company transaction wording must not be exposed in navigation');
must(!studio.includes('المرحلة الأخيرة'), 'Forbidden final-stage label found');
must(!test.includes('المرحلة الأخيرة'), 'Forbidden final-stage label found in test');
must(!studio.includes('WORKFLOW-006'), 'Legacy workflow implementation leaked into UI');
must(routes.includes("status IN ('draft','active','inactive')") || routes.includes("status='draft'"), 'Draft workflow support missing');
must(routes.includes('validateModel'), 'Server validation missing');
must(routes.includes('workflow_published'), 'Publish audit missing');
must(routes.includes('requireSuperAdmin'), 'Server-side Studio authorization missing');
must(routes.includes('c.env.DB.batch'), 'Atomic D1 batch save missing');
must(routes.includes('condition.fieldId'), 'Condition source must be a defined field');
must(routes.includes('test/templates'), 'Isolated test API missing');
must(studio.includes('staticText'), 'Display-only static text support missing');
must(studio.includes('إضافة نص للعرض'), 'Studio static-text creation control missing');
must(studio.includes('السماح بالتمرير لموظف آخر'), 'Optional delegation capability missing');
must(!studio.includes('DELEGATE_REQUIRED'), 'Delegation must not require an employee field');
must(test.includes('Super Admin'), 'Test executor must be Super Admin');
must(test.includes('تمرير لموظف آخر') && test.includes('اختياري'), 'Test optional delegation UI missing');
must(test.includes('simulatedEmployees'), 'Test employee picker must remain isolated simulation data');
must(!routes.includes("app.post('/transactions'"), 'Company transaction API must not be exposed in Phase 6 UI service');
must(fs.existsSync(path.join(root,'db/migrations/0010_phase6_rebuilt_engine.sql')), 'Phase 6 migration missing');

console.log('PASS: Phase 6 structural verification');
console.log('PASS: Studio/Test routes only; company transaction UI/API route not exposed');
console.log('PASS: server validation + atomic draft save + publish audit + Super Admin guard');
console.log('PASS: no final-stage pseudo-stage label');
console.log('PASS: static text + optional delegation + Super Admin isolated test semantics');
