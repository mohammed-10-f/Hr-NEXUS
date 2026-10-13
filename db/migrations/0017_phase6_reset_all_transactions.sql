-- HR Nexus Phase 6: full reset of transaction data and experimental Studio templates.
-- IMPORTANT: Phase 1–5 data is not touched by this migration.
DELETE FROM transaction_answer_history;
DELETE FROM transaction_delegations;
DELETE FROM transaction_answers;
DELETE FROM transaction_actions;
DELETE FROM transaction_feedback;
DELETE FROM transaction_attachments;
DELETE FROM transaction_stage_executions;
DELETE FROM transactions;
DELETE FROM transaction_sequences;
DELETE FROM workflow_company_stage_assignments;
DELETE FROM workflow_company_settings;
DELETE FROM transaction_type_companies;
DELETE FROM workflow_questions;
DELETE FROM workflow_conditions;
DELETE FROM workflow_transitions;
DELETE FROM workflow_fields;
DELETE FROM workflow_stages;
DELETE FROM workflow_system_fields;
DELETE FROM workflow_request_settings;
DELETE FROM workflow_settings;
DELETE FROM workflow_definitions;
DELETE FROM transaction_types;

-- Remove Phase 6 transaction/workflow notifications and audit records only.
DELETE FROM notifications
WHERE type LIKE 'transaction_%'
   OR type LIKE 'workflow_transaction_%'
   OR type LIKE 'workflow_%';

DELETE FROM audit_logs
WHERE resource IN ('transaction','workflow')
   OR action LIKE 'transaction_%'
   OR action LIKE 'workflow_%';
