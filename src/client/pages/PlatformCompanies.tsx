import { useEffect, useState } from 'react';
import { Building2, LogIn, Plus, Search, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
type Company={id:string;company_identifier:string;legal_name:string;display_name:string;management_status:'active'|'inactive';has_company_admin:number};
export function PlatformCompanies(){
  const [items,setItems]=useState<Company[]>([]),[loading,setLoading]=useState(true),[reason,setReason]=useState('متابعة ودعم الشركة'),[search,setSearch]=useState(''),[status,setStatus]=useState('');
  async function load(){setLoading(true);try{const q=new URLSearchParams();if(search)q.set('search',search);if(status)q.set('status',status);setItems((await api<{items:Company[]}>(`/api/platform/companies${q.toString()?`?${q}`:''}`)).items)}finally{setLoading(false)}}
  useEffect(()=>{const t=setTimeout(load,250);return()=>clearTimeout(t)},[search,status]);
  async function enter(company:Company){
    try{
      const r=await api<any>(`/api/platform/companies/${company.id}/access-request`,{method:'POST',body:JSON.stringify({reason})});
      if(r.status==='approved'){window.location.href='/';return}
      const id=r.requestId;
      const poll=setInterval(async()=>{try{const x=await api<any>(`/api/platform/access-requests/${id}`);if(x.request.status==='approved'){clearInterval(poll);window.location.href='/'}if(['rejected','expired','revoked'].includes(x.request.status)){clearInterval(poll);alert(x.request.status==='rejected'?'تم رفض طلب الدخول.':'انتهى طلب الدخول.')}}catch{}},2500);
      setTimeout(()=>clearInterval(poll),10*60*1000);
      alert('تم إرسال الطلب إلى مدير الشركة. سيتم الدخول تلقائيًا بعد الموافقة.');
    }catch(err){alert(err instanceof Error&&err.message==='COMPANY_INACTIVE'?'الشركة غير نشطة ولا يمكن الدخول إلى بيئتها.':'تعذر إنشاء طلب الدخول.')}
  }
  return <div><div className="page-header"><div><div className="eyebrow">إدارة المنصة</div><h1>الشركات</h1><p>إدارة الشركات والوصول المؤقت إلى بيئاتها.</p></div><div className="header-actions"><div className="header-status"><ShieldCheck size={16}/> مدير المنصة</div><Link className="btn primary" to="/platform/companies/new"><Plus size={16}/> إضافة شركة</Link></div></div>
    <section className="panel"><div className="panel-head"><div><h3>الشركات المسجلة</h3><p>هوية مدير المنصة مستقلة عن أي شركة.</p></div></div>
      <div className="filter-bar"><div className="search-field"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="البحث باسم الشركة أو المعرّف"/></div><div className="filter-select"><span>الحالة</span><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">الكل</option><option value="active">نشطة</option><option value="inactive">غير نشطة</option></select></div></div>
      <div className="access-reason"><label>سبب الدخول <input value={reason} onChange={e=>setReason(e.target.value)} /></label></div>
      {loading?<div className="panel-empty">جاري تحميل الشركات...</div>:items.length===0?<div className="panel-empty">لا توجد شركات مطابقة.</div>:
      <div className="table-wrap"><table><thead><tr><th>الشركة</th><th>المعرّف</th><th>الحالة</th><th>مدير الشركة</th><th>الإدارة</th><th>الدخول</th></tr></thead><tbody>{items.map(c=><tr key={c.id}><td><strong>{c.display_name}</strong><div>{c.legal_name}</div></td><td className="mono">{c.company_identifier}</td><td><span className={`badge ${c.management_status==='active'?'success':'danger'}`}>{c.management_status==='active'?'نشطة':'غير نشطة'}</span></td><td>{c.has_company_admin?'مفعّل':'لا يوجد'}</td><td><Link className="table-link" to={`/platform/companies/${c.id}`}>التفاصيل</Link></td><td><button disabled={c.management_status!=='active'} className="table-link" onClick={()=>enter(c)}><LogIn size={15}/> دخول للشركة</button></td></tr>)}</tbody></table></div>}
    </section>
  </div>
}
