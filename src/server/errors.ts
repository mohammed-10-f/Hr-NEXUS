import type { Context } from 'hono';
import type { Env } from './env';

export const ERROR_CATALOG = {
  'ORG-001': 'البيانات المدخلة غير صحيحة.',
  'ORG-002': 'العنصر المطلوب غير موجود.',
  'ORG-003': 'الوحدة الأب غير صالحة.',
  'ORG-004': 'لا يمكن إنشاء علاقة دائرية في الهيكل التنظيمي.',
  'ORG-005': 'لا يمكن استخدام سجل من شركة أخرى.',
  'ORG-006': 'بيانات المنصب غير صالحة.',
  'ORG-007': 'لا يمكن إنشاء علاقة إدارية دائرية.',
  'ORG-008': 'رمز المنصب مستخدم مسبقًا داخل الشركة.',
  'ORG-009': 'لا يمكن تعطيل/تغيير هذه الوحدة قبل معالجة المناصب المرتبطة.',
  'ORG-010': 'لا تملك الصلاحية المطلوبة.',
  'DB-001': 'تعذر حفظ التغيير. استخدم رقم المرجع عند التواصل مع الدعم.'
} as const;

export type AppErrorCode = keyof typeof ERROR_CATALOG;

export function errorResponse(c: Context<Env>, code: AppErrorCode, status: 400|403|404|409|500, details?: unknown) {
  const referenceId = crypto.randomUUID();
  console.error('HR_NEXUS_ERROR', { referenceId, code, path: c.req.path, details });
  return c.json({ error: code, referenceId, message: ERROR_CATALOG[code] }, status);
}
