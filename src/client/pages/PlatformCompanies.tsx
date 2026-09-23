import { useEffect, useState } from 'react';
import { Building2, LogIn, Plus, Search, ShieldCheck, X, LoaderCircle, CheckCircle2, Clock3, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
type Company={id:string;company_identifier:string;legal_name:string;display_name:string;management_status:'active'|'inactive';has_company_admin:number};
export function PlatformCompanies(){
  const [items,setItems]=useState<Company[]>([]),[loading,setLoading]=useState(true),[reason,setReason]=useState('متابعة ودعم الشركة'),[search,setSearch]=useState(''),[status,setStatus]=useState('');
 const [request,setRequest]=useState<{company:Company;id:string;state:'pending'|'approved'|'rejected'|'expired'|'revoked'|'error'}|null>(null);
  async function load(){setLoading(true);try{const q=new URLSearchParams();if(search)q.set('search',search);if(status)q.set('status',status);setItems((await api<{items:Company[]}>(`/api/platform/companies${q.toString()?`?${q}`:''}`)).items)}finally{setLoading(false)}}
  useEffect(()=>{const t=setTimeout(load,250);return()=>clearTimeout(t)},[search,status]);
  async function enter(company:Company){
    if(request)return;
    try{
      const r=await api<any>(`/api/platform/companies/${company.id}/access-request`,{method:'POST',body:JSON.stringify({reason})});
      if(r.status==='approved'){window.location.assign('/');return}
      const id=r.requestId;
      setRequest({company,id,state:'pending'});
      let stopped=false;
      const poll=async()=>{
        if(stopped)return;
        try{
          const x=await api<any>(`/api/platform/access-requests/${id}`);
          const state=x.request.status as any;
          if(state==='approved'){stopped=true;setRequest(v=>v?{...v,state:'approved'}:v);setTimeout(()=>window.location.assign('/'),500);return}
          if(['rejected','expired','revoked'].includes(state)){stopped=true;setRequest(v=>v?{...v,state}:v);return}
        }catch{}
        if(!stopped)setTimeout(poll,2000);
      };
      setTimeout(poll,1500);
      setTimeout(()=>{if(!stopped){stopped=true;setRequest(v=>v?{...v,state:'error'}:v)}},10*60*1000);
    }catch(err){setRequest({company,id:'',state:'error'});}
  }
  function closeRequest(){setRequest(null)}
  return <div><div className="page-header"><div><div className="eyebrow">إدارة المنصة</div><h1>الشركات</h1><p>إدارة الشركات والوصول المؤقت إلى بيئاتها.</p></div><div className="header-actions"><div className="header-status"><ShieldCheck size={16}/> مدير المنصة</div><Link className="btn primary" to="/platform/companies/new"><Plus size={16}/> إضافة شركة</Link></div></div>
    <section className="panel"><div className="panel-head"><div><h3>الشركات المسجلة</h3><p>هوية مدير المنصة مستقلة عن أي شركة.</p></div></div>
      <div className="filter-bar"><div className="search-field"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="البحث باسم الشركة أو المعرّف"/></div><div className="filter-select"><span>الحالة</span><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">الكل</option><option value="active">نشطة</option><option value="inactive">غير نشطة</option></select></div></div>
      <div className="access-reason"><label>سبب الدخول <input value={reason} onChange={e=>setReason(e.target.value)} /></label></div>
      {loading?<div className="panel-empty">جاري تحميل الشركات...</div>:items.length===0?<div className="panel-empty">لا توجد شركات مطابقة.</div>:
      <div className="table-wrap"><table><thead><tr><th>الشركة</th><th>المعرّف</th><th>الحالة</th><th>مدير الشركة</th><th>الإدارة</th><th>الدخول</th></tr></thead><tbody>{items.map(c=><tr key={c.id}><td><strong>{c.display_name}</strong><div>{c.legal_name}</div></td><td className="mono">{c.company_identifier}</td><td><span className={`badge ${c.management_status==='active'?'success':'danger'}`}>{c.management_status==='active'?'نشطة':'غير نشطة'}</span></td><td>{c.has_company_admin?'مفعّل':'لا يوجد'}</td><td><Link className="table-link" to={`/platform/companies/${c.id}`}>التفاصيل</Link></td><td><button disabled={c.management_status!=='active'} className="table-link" onClick={()=>enter(c)}><LogIn size={15}/> دخول للشركة</button></td></tr>)}</tbody></table></div>}
    </section>
    {request&&<div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="access-modal">
        <button className="modal-close" onClick={closeRequest} aria-label="إغلاق"><X size={18}/></button>
        {request.state==='pending'&&<><div className="modal-icon pending"><Clock3 size={24}/></div><h3>طلب الدخول قيد الانتظار</h3><p>تم إرسال طلب الدخول إلى مدير <strong>{request.company.display_name}</strong>. ستدخل إلى بيئة الشركة تلقائيًا بعد الموافقة.</p><div className="modal-progress"><span></span></div><small>يمكنك متابعة عملك في هذه الصفحة، وسيتم الانتقال تلقائيًا عند الموافقة.</small></>}
        {request.state==='approved'&&<><div className="modal-icon success"><CheckCircle2 size={25}/></div><h3>تمت الموافقة</h3><p>تمت الموافقة على طلب الدخول. جارٍ فتح بيئة الشركة...</p></>}
        {request.state==='rejected'&&<><div className="modal-icon danger"><AlertCircle size={25}/></div><h3>تم رفض طلب الدخول</h3><p>قام مدير الشركة برفض طلب الوصول إلى بيئة الشركة.</p><button className="btn primary" onClick={closeRequest}>إغلاق</button></>}
        {(request.state==='expired'||request.state==='revoked')&&<><div className="modal-icon danger"><AlertCircle size={25}/></div><h3>انتهى طلب الدخول</h3><p>لم يعد طلب الوصول صالحًا. يمكنك إنشاء طلب جديد من قائمة الشركات.</p><button className="btn primary" onClick={closeRequest}>إغلاق</button></>}
        {request.state==='error'&&<><div className="modal-icon danger"><AlertCircle size={25}/></div><h3>تعذر متابعة الطلب</h3><p>تعذر إكمال طلب الدخول. يمكنك إغلاق النافذة والمحاولة مرة أخرى.</p><button className="btn primary" onClick={closeRequest}>إغلاق</button></>}
      </div>
    </div>}
  </div>
}
