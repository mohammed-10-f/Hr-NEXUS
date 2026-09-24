# HR Nexus Error Catalog — Phase 4

| Code | Meaning | HTTP | User-safe message |
|---|---|---:|---|
| ORG-001 | Invalid organization input | 400 | البيانات المدخلة غير صحيحة. |
| ORG-002 | Organization record not found in current company | 404 | العنصر المطلوب غير موجود. |
| ORG-003 | Invalid parent organization unit | 400 | الوحدة الأب غير صالحة. |
| ORG-004 | Circular organization hierarchy | 409 | لا يمكن إنشاء علاقة دائرية في الهيكل التنظيمي. |
| ORG-005 | Cross-company organization reference | 403 | لا يمكن استخدام سجل من شركة أخرى. |
| ORG-006 | Invalid position reference | 400 | بيانات المنصب غير صالحة. |
| ORG-007 | Circular management relationship | 409 | لا يمكن إنشاء علاقة إدارية دائرية. |
| ORG-008 | Duplicate position code | 409 | رمز المنصب مستخدم مسبقًا داخل الشركة. |
| ORG-009 | Unit contains positions | 409 | لا يمكن تعطيل/تغيير هذه الوحدة قبل معالجة المناصب المرتبطة. |
| ORG-010 | Organization permission denied | 403 | لا تملك الصلاحية المطلوبة. |
| DB-001 | Database operation failed | 500 | تعذر حفظ التغيير. استخدم رقم المرجع عند التواصل مع الدعم. |
