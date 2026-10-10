PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS transaction_answer_history (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  execution_id TEXT,
  field_id TEXT,
  question_id TEXT,
  value_json TEXT,
  actor_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
  FOREIGN KEY (execution_id) REFERENCES transaction_stage_executions(id) ON DELETE SET NULL,
  FOREIGN KEY (field_id) REFERENCES workflow_fields(id) ON DELETE RESTRICT,
  FOREIGN KEY (question_id) REFERENCES workflow_questions(id) ON DELETE RESTRICT,
  CHECK ((field_id IS NOT NULL AND question_id IS NULL) OR (field_id IS NULL AND question_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_transaction_answer_history_tx_created ON transaction_answer_history(transaction_id,created_at,id);
CREATE INDEX IF NOT EXISTS idx_transaction_answer_history_execution ON transaction_answer_history(execution_id,created_at,id);
