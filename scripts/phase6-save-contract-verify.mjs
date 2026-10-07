import fs from 'node:fs';

const frontend = fs.readFileSync('src/client/pages/WorkflowAdmin.tsx','utf8');
const backend = fs.readFileSync('src/server/routes/workflows.ts','utf8');
const worker = fs.readFileSync('src/worker.ts','utf8');

const checks = [
  ['frontend sends delegate.employeeFieldId', frontend.includes('employeeFieldId: s.delegateFieldId || null')],
  ['backend delegate.employeeFieldId is optional', backend.includes("employeeFieldId: z.string().uuid().nullable().optional()")],
  ['health exposes Phase 6 build fingerprint', worker.includes("phase:6,build:BUILD_ID")],
  ['workflow save endpoint exists', backend.includes("app.put('/admin/workflows/:id'")],
];

let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
  ok &&= pass;
}
process.exit(ok ? 0 : 1);
