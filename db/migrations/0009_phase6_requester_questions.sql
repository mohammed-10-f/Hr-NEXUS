-- Phase 6: requester questions are workflow questions too, but are not tied to a processing stage.
-- Existing question rows are copied unchanged; only stage_id becomes nullable.
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS workflow_questions_v2 (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  stage_id TEXT,
  question_key TEXT NOT NULL,
  question_ar TEXT NOT NULL,
  question_en TEXT,
  question_type TEXT NOT NULL CHECK (question_type IN ('text','yes_no','select','notes')),
  required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0,1)),
  options_json TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workflow_id) REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  FOREIGN KEY (stage_id) REFERENCES workflow_stages(id) ON DELETE CASCADE,
  UNIQUE(workflow_id,question_key)
);

INSERT INTO workflow_questions_v2(id,workflow_id,stage_id,question_key,question_ar,question_en,question_type,required,options_json,sort_order,active,created_at)
SELECT id,workflow_id,stage_id,question_key,question_ar,question_en,question_type,required,options_json,sort_order,active,created_at
FROM workflow_questions;

DROP TABLE workflow_questions;
ALTER TABLE workflow_questions_v2 RENAME TO workflow_questions;
CREATE INDEX IF NOT EXISTS idx_workflow_questions_stage ON workflow_questions(stage_id,sort_order);
PRAGMA foreign_keys = ON;
