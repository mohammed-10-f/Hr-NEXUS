-- Phase 6 rebuilt engine: non-destructive schema guard.
-- This migration only creates missing Phase 6 indexes/metadata structures.
-- It does not alter or delete Phase 1-5 data.
PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_workflow_fields_workflow_stage_order
  ON workflow_fields(workflow_id,stage_id,sort_order);

CREATE INDEX IF NOT EXISTS idx_workflow_transitions_workflow_from_order
  ON workflow_transitions(workflow_id,from_stage_id,sort_order);

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_type_status_version
  ON workflow_definitions(transaction_type_id,status,version);

CREATE INDEX IF NOT EXISTS idx_transaction_actions_company_created
  ON transaction_actions(company_id,created_at);

CREATE INDEX IF NOT EXISTS idx_transaction_stage_executions_transaction_order
  ON transaction_stage_executions(transaction_id,execution_order);

CREATE INDEX IF NOT EXISTS idx_transactions_company_number
  ON transactions(company_id,transaction_number);

-- Reference permissions required by the Phase 6 authorization model.
INSERT OR IGNORE INTO permissions(id,resource,action,name_ar,name_en,description) VALUES
('workflow.view','workflow','view','عرض استوديو سير العمل','View workflow studio','عرض قوالب سير العمل'),
('workflow.create','workflow','create','إنشاء قالب سير عمل','Create workflow template','إنشاء قالب سير العمل'),
('workflow.edit','workflow','edit','تعديل قالب سير عمل','Edit workflow template','تعديل مسودة سير العمل'),
('workflow.manage','workflow','manage','إدارة سير العمل','Manage workflows','الفحص والاعتماد وإدارة القوالب'),
('transaction.create','transaction','create','إنشاء معاملة','Create transaction','الأساس البرمجي لإنشاء المعاملات'),
('transaction.view','transaction','view','عرض المعاملات','View transactions','الأساس البرمجي لعرض المعاملات'),
('transaction.search','transaction','search','البحث عن معاملة','Search transactions','البحث برقم المعاملة'),
('transaction.process','transaction','process','معالجة المعاملات','Process transactions','معالجة المرحلة الحالية'),
('transaction.cancel','transaction','cancel','إلغاء المعاملة','Cancel transaction','إلغاء المعاملة'),
('transaction.reject','transaction','reject','رفض المعاملة','Reject transaction','رفض المعاملة'),
('transaction.return','transaction','return','إرجاع المعاملة','Return transaction','إرجاع المعاملة لمرحلة سابقة');
