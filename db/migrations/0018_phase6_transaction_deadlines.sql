-- Phase 6: preserve a first-class delayed/deadline state per stage execution.
-- Additive only; Phase 1-5 tables/data are untouched.
ALTER TABLE transaction_stage_executions ADD COLUMN delayed_at TEXT;
CREATE INDEX IF NOT EXISTS idx_transaction_stage_delayed ON transaction_stage_executions(status, delayed_at, due_at);
