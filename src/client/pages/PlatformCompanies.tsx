import { useEffect, useState } from 'react';
import { Building2, LogIn, Plus, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
type Company={id:string;company_identifier:string;legal_name:string;display_name:string;status:string;has_company_admin:number};
export function PlatformCompanies(){
  const [items,setItems]=useState<Company[]>([]),[loading,setLoading]=useState(true),[reason,setReason]=useState('متابعة ودعم الشركة');
  async function load(){setLoading(true);try{setItems((await api<{items:Company[]}>('/api/platform/companies')).items)}finally{setLoading(false)}}
  useEffect(()=>{load()},[]);
  async function enter(company:Company){
    const r=await api<any>(`/api/platform/companies/${company.id}/access-request`,{method:'POST',body:JSON.stringify({reason})});
    if(r.status==='approved'){window.location.href='/';return}
    const id=r.requestId;
    const poll=setInterval(async()=>{try{const x=await api<any>(`/api/platform/access-requests/${id}`);if(x.request.status==='approved'){clearInterval(poll);window.location.href='/'}if(['rejected','expired','revoked'].includes(x.request.status)){clearInterval(poll);alert('تم رفض أو انتهاء طلب الدخول.')}}catch{}},2500);
    setTimeout(()=>clearInterval(poll),10*60*1000);
    alert('تم إرسال الطلب إلى مدير الشركة. سيتم الدخول تلقائياً بعد الموافقة.');
  }
  return <div><div className="page-header"><div><div className="eyebrow">إدارة المنصة</div><h1>الشركات</h1><p>إدارة المستأجرين والدخول المؤقت إلى بيئات الشركات.</p></div><div className="header-status"><ShieldCheck size={16}/> مدير المنصة</div></div>
    <section className="panel"><div className="panel-head"><div><h3>الشركات المسجلة</h3><p>هوية مدير المنصة تبقى مستقلة عن أي شركة.</p></div></div>
      <div className="access-reason"><label>سبب الدخول <input value={reason} onChange={e=>setReason(e.target.value)} /></label></div>
      {loading?<div className="panel-empty">جاري تحميل الشركات...</div>:items.length===0?<div className="panel-empty">لا توجد شركات.</div>:
      <div className="table-wrap"><table><thead><tr><th>الشركة</th><th>المعرّف</th><th>الحالة</th><th>مدير الشركة</th><th></th></tr></thead><tbody>{items.map(c=><tr key={c.id}><td><strong>{c.display_name}</strong><div>{c.legal_name}</div></td><td className="mono">{c.company_identifier}</td><td>{c.status}</td><td>{c.has_company_admin?'مفعّل':'لا يوجد'}</td><td><button className="table-link" onClick={()=>enter(c)}><LogIn size={15}/> دخول للشركة</button></td></tr>)}</tbody></table></div>}
    </section>
  </div>
}
