PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS transaction_delegations (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  stage_execution_id TEXT NOT NULL,
  from_employee_id TEXT,
  to_employee_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  FOREIGN KEY (stage_execution_id) REFERENCES transaction_stage_executions(id) ON DELETE CASCADE,
  FOREIGN KEY (from_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (to_employee_id) REFERENCES employees(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_transaction_delegations_active ON transaction_delegations(transaction_id,status);
