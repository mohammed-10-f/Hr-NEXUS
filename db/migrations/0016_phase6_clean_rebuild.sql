-- HR Nexus Phase 6 clean rebuild.
-- IMPORTANT: Phase 6 only. Phase 1-5 tables/data are not touched.
-- This migration intentionally removes the failed Phase 6 definitions/runtime
-- so the rebuilt Studio starts from a deterministic empty Phase 6 state.
PRAGMA foreign_keys = OFF;

DELETE FROM transaction_delegations;
DELETE FROM transaction_answer_history;
DELETE FROM transaction_answers;
DELETE FROM transaction_actions;
DELETE FROM transaction_stage_executions;
DELETE FROM transactions;
DELETE FROM transaction_sequences;
DELETE FROM workflow_company_stage_assignments;
DELETE FROM workflow_company_settings;
DELETE FROM workflow_transitions;
DELETE FROM workflow_questions;
DELETE FROM workflow_fields;
DELETE FROM workflow_system_fields;
DELETE FROM workflow_request_settings;
DELETE FROM workflow_stages;
DELETE FROM workflow_definitions;
DELETE FROM transaction_type_companies;
DELETE FROM transaction_types;

PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO permissions(id,resource,action,name_ar,name_en,description) VALUES
('workflow.view','workflow','view','عرض استوديو سير العمل','View workflow studio','عرض قوالب سير العمل'),
('workflow.create','workflow','create','إنشاء معاملة','Create workflow template','إنشاء قالب معاملة'),
('workflow.edit','workflow','edit','تعديل معاملة','Edit workflow template','تعديل مسودة المعاملة'),
('workflow.manage','workflow','manage','إدارة المعاملة','Manage workflow template','فحص واعتماد وإدارة المعاملة'),
('transaction.create','transaction','create','إنشاء معاملة تشغيلية','Create transaction','إنشاء معاملة تشغيلية'),
('transaction.view','transaction','view','عرض المعاملات التشغيلية','View transactions','عرض المعاملات ضمن نطاق الشركة'),
('transaction.search','transaction','search','البحث عن المعاملات','Search transactions','البحث عن المعاملات'),
('transaction.process','transaction','process','معالجة المعاملات','Process transactions','تنفيذ مراحل المعاملة'),
('transaction.cancel','transaction','cancel','إلغاء المعاملة','Cancel transaction','إلغاء المعاملة'),
('transaction.reject','transaction','reject','رفض المعاملة','Reject transaction','رفض المعاملة'),
('transaction.return','transaction','return','إرجاع المعاملة','Return transaction','إرجاع المعاملة'),
('workflow.company_manage','workflow','company_manage','إدارة تفعيل المعاملات للشركة','Manage company workflow activation','تفعيل المعاملة وتحديد مقدمي الطلب ومسؤولي المراحل');
