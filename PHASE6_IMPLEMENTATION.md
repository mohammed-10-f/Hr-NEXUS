# HR Nexus — Phase 6

## Scope of this build

Phase 6 is rebuilt as a generic Workflow / Transaction Engine foundation, with the first approved product surface intentionally limited to:

- استوديو سير العمل
- بيئة الاختبار المعزولة

## Product model

A transaction template is global and does not belong to a company.

The creation model is:

بيانات مقدم الطلب (من بيانات النظام عند التشغيل الحقيقي) + أسئلة وبيانات الطلب
→ تقديم المعاملة
→ المرحلة 1
→ المرحلة التالية حسب المسار
→ آخر مرحلة معرفة في تعريف سير العمل المحدد
→ حالة المعاملة: مكتملة عند تنفيذ أثر الإغلاق كمكتملة

بيانات مقدم الطلب ليست مرحلة ولا يكتبها المستخدم يدويًا في التشغيل الحقيقي؛ تُستدعى من بيانات الحساب والموظف المرتبط.

Each workflow stage has its own responsibility, duration, questions/decisions, and configured paths. السؤال والقرار يستخدمان نموذج العنصر نفسه؛ نوع الإجابة هو الذي يحدد إمكانية استخدام الإجابة في المسار.

The user-facing stage action is one primary action: **تمرير المعاملة**. The configured workflow determines the resulting route.

Required data is validated before submit/pass and is shown beside the exact missing element.

No automatic "ملاحظة إضافية" element exists. Notes appear only when the template creator adds a notes element.

Conditional routing is represented as:

**حقل الشرط → القيم → الأثر → الوجهة**

The Studio blocks invalid routes before approval.

## Test environment

The test environment reads a template definition but executes only in browser memory. It shows the requester section at the top, then every workflow stage in order. The requester name/number entered there are simulation inputs only and are never written to D1; the production transaction path will source requester data from the authenticated user and linked Phase 5 employee record.

## Company transactions

Company Transactions are intentionally locked and are not exposed by the current UI or Phase 6 routes. They will be implemented only after Studio + Test are approved.

## Preservation

Phase 1–5 application code and data are preserved. No existing company, user, employee, organization, position, or valid historical data is deleted.

The Phase 6 migration is non-destructive and uses the existing `hr-nexus` D1.
