# Phase 6 — Workflow Engine (rebuilt)

Phase 6 is implemented as a generic Workflow/Transaction foundation.

## Studio
- قوالب المعاملات
- إنشاء/فتح/تعديل المسودة
- مراحل ديناميكية محفوظة بترتيب قاعدة البيانات
- بيانات مقدم الطلب خارج المراحل
- عناصر موحدة للأسئلة والبيانات والقرارات
- مسار افتراضي تلقائي
- مسارات شرطية تعتمد على عناصر معرفة مسبقًا
- مسؤوليات مبنية على أدوار/صلاحيات/هيكل الموظف، وليس Username ثابت
- فحص قبل الاعتماد
- Preview/Test separated
- Test is isolated and never writes transactions, employees, users or history

## Final-stage rule
There is no special "last stage". Passing the final configured stage marks a future real transaction as `مكتملة`.

## Database
Existing Phase 6 migration history is retained for safe deployment history. The rebuilt implementation adds only non-destructive indexes/reference permissions in `0010_phase6_rebuilt_engine.sql`.

## Security
Studio/Test endpoints require authenticated Super Admin access. Company transaction UI is intentionally not exposed in this phase.

## Error handling
API failures return a public error code, reference ID and Arabic message; SQL/stack traces are logged server-side only.


## Phase 6 Reset

The Super Admin cleanup action resets all Phase 6 transaction/workflow data to an empty state: transaction types, company mappings, workflow definitions, stages, fields, questions, conditions, transitions, runtime transactions, sequences, executions, answers, actions, feedback, and attachments. It also removes only Phase 6 workflow/transaction audit records. It does not delete the Phase 6 schema, permission definitions, or any Phase 1–5 data.
