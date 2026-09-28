import { Building2, ChevronLeft, RefreshCw, Search, Workflow } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

export function CompanyTransactions(){
 const [items,setItems]=useState<any[]>([]),[search,setSearch]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState('');
 async function load(){setLoading(true);setError('');try{const d=await api<any>('/api/workflows/admin/company-transactions');setItems(d.items||[]);}catch{setError('تعذر تحميل معاملات الشركات.')}finally{setLoading(false)}}
 useEffect(()=>{void load()},[]);
 const filtered=useMemo(()=>items.filter(x=>!search||`${x.display_name} ${x.company_identifier}`.toLowerCase().includes(search.toLowerCase())),[items,search]);
 return <div>
  <div className="page-header"><div><div className="eyebrow">سير العمل · معاملات الشركات</div><h1>معاملات الشركات</h1><p>اختر شركة للوصول إلى أنواع المعاملات المنشورة والمعاملات الفعلية داخلها.</p></div><div className="header-actions"><Link className="btn secondary" to="/platform/workflows"><Workflow size={16}/>استوديو سير العمل</Link><button className="icon-btn" onClick={()=>void load()}><RefreshCw size={16}/></button></div></div>
  {error&&<div className="login-error page-error">{error}</div>}
  <section className="panel workflow-hero"><div><span className="workflow-kicker">Company Operations</span><h2>اختر الشركة</h2><p>كل شركة تعمل على نسخة مستقلة من سير العمل. تعديل نسخة شركة لا يغيّر نسخ الشركات الأخرى.</p></div><div className="workflow-health"><div><strong>{items.length}</strong><span>شركات</span></div><div><strong>{items.reduce((n,x)=>n+Number(x.type_count||0),0)}</strong><span>أنواع معاملات</span></div><div><strong>{items.reduce((n,x)=>n+Number(x.transaction_count||0),0)}</strong><span>معاملات</span></div></div></section>
  <section className="panel"><div className="panel-head"><div><h3>الشركات المسجلة</h3><p>ادخل على الشركة ثم اختر نوع المعاملة أو راجع المعاملات الفعلية.</p></div><Building2 size={19}/></div>
   <div className="filter-bar"><div className="search-field"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="ابحث باسم الشركة أو المعرف"/></div></div>
   {loading?<div className="panel-empty">جاري التحميل...</div>:filtered.length===0?<div className="panel-empty">لا توجد شركات مطابقة.</div>:<div className="table-wrap"><table><thead><tr><th>الشركة</th><th>المعرف</th><th>أنواع المعاملات</th><th>المعاملات</th><th>إجراء</th></tr></thead><tbody>{filtered.map(x=><tr key={x.id}><td><strong>{x.display_name}</strong></td><td className="mono">{x.company_identifier}</td><td>{x.type_count||0}</td><td>{x.transaction_count||0}</td><td><Link className="table-link" to={`/platform/company-transactions/${x.id}`}><span>فتح الشركة</span><ChevronLeft size={14}/></Link></td></tr>)}</tbody></table></div>}
  </section>
 </div>;
}
