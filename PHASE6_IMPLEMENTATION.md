# HR Nexus — Phase 6

## Scope of this build

Phase 6 is rebuilt as a generic Workflow / Transaction Engine foundation, with the first approved product surface intentionally limited to:

- استوديو سير العمل
- بيئة الاختبار المعزولة

## Product model

A transaction template is global and does not belong to a company.

The creation model is:

مقدم الطلب + بيانات المعاملة
→ تقديم المعاملة
→ المرحلة الأولى
→ المرحلة التالية حسب المسار
→ المرحلة الأخيرة

Requester data is not a workflow stage.

Each workflow stage has its own responsibility, duration, elements, and configured paths. Questions and decisions are represented by the same unified element model.

The user-facing stage action is one primary action: **تمرير المعاملة**. The configured workflow determines the resulting route.

Required data is validated before submit/pass and is shown beside the exact missing element.

No automatic "ملاحظة إضافية" element exists. Notes appear only when the template creator adds a notes element.

Conditional routing is represented as:

**حقل الشرط → القيم → الأثر → الوجهة**

The Studio blocks invalid routes before approval.

## Test environment

The test environment reads a template definition but executes only in browser memory. It does not create a user, employee, transaction, transaction number, attachment, audit row, or other transactional D1 record.

## Company transactions

Company Transactions are intentionally locked and are not exposed by the current UI or Phase 6 routes. They will be implemented only after Studio + Test are approved.

## Preservation

Phase 1–5 application code and data are preserved. No existing company, user, employee, organization, position, or valid historical data is deleted.

The Phase 6 migration is non-destructive and uses the existing `hr-nexus` D1.
