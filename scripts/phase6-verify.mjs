import { execFileSync } from 'node:child_process';

const remote = process.argv.includes('--remote');
const args = ['d1','execute','DB', ...(remote?['--remote']:['--local']), '--command', `
SELECT 'transaction_types' table_name, COUNT(*) row_count FROM transaction_types
UNION ALL SELECT 'workflow_definitions', COUNT(*) FROM workflow_definitions
UNION ALL SELECT 'workflow_stages', COUNT(*) FROM workflow_stages
UNION ALL SELECT 'transactions', COUNT(*) FROM transactions
UNION ALL SELECT 'transaction_stage_executions', COUNT(*) FROM transaction_stage_executions
UNION ALL SELECT 'transaction_actions', COUNT(*) FROM transaction_actions;
`];
try {
  execFileSync('npx', ['wrangler', ...args], {stdio:'inherit'});
} catch {
  process.exitCode = 1;
}
