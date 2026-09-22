import { AlertCircle, Database, LoaderCircle, ShieldX } from 'lucide-react';
export function EmptyState({title='لا توجد بيانات',description='لا توجد سجلات لعرضها حالياً.'}:{title?:string;description?:string}){return <div className="state-card"><div className="state-icon"><Database size={22}/></div><h3>{title}</h3><p>{description}</p></div>}
export function LoadingState(){return <div className="state-card"><div className="state-icon"><LoaderCircle className="spin" size={22}/></div><h3>جاري التحميل</h3><p>يتم جلب البيانات بأمان.</p></div>}
export function ErrorState(){return <div className="state-card"><div className="state-icon danger"><AlertCircle size={22}/></div><h3>تعذر تحميل البيانات</h3><p>حدث خطأ أثناء الاتصال بالخدمة. حاول مرة أخرى.</p></div>}
export function ForbiddenState(){return <div className="state-card"><div className="state-icon danger"><ShieldX size={22}/></div><h3>لا تملك الصلاحية</h3><p>ليس لديك صلاحية للوصول إلى هذا المورد.</p></div>}
