-- Preserve the exact stage definition and the answers visible when each stage was processed.
ALTER TABLE transaction_stage_executions ADD COLUMN stage_snapshot_json TEXT;
ALTER TABLE transaction_stage_executions ADD COLUMN answers_snapshot_json TEXT;
