import { Construction } from 'lucide-react';
export function ComingSoon({title='هذه الوحدة'}:{title?:string}){return <div className="center-page"><div className="state-icon"><Construction size={24}/></div><h1>{title}</h1><p>هذه الوحدة موجودة في خارطة المنصة لكنها غير مفعلة في Phase 1.</p><span className="badge neutral">سيتم تنفيذها في مرحلة لاحقة</span></div>}
