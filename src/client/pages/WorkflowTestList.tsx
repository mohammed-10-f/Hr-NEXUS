import { useEffect, useMemo, useState } from 'react';
import { FileClock, PlayCircle, Plus, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

type TestRun={id:string;typeId:string;typeName:string;status:'مسودة'|'قيد الاختبار'|'مكتملة'|'مرفوضة'|'ملغية';stageName:string;createdAt:string;updatedAt:string};
const STORAGE_KEY='hr_nexus_workflow_test_runs_v1';
function readRuns():TestRun[]{try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]')}catch{return []}}
function writeRuns(items:TestRun[]){localStorage.setItem(STORAGE_KEY,JSON.stringify(items));}

export function WorkflowTestList(){
 const navigate=useNavigate();
 const [types,setTypes]=useState<any[]>([]),[runs,setRuns]=useState<TestRun[]>([]),[selectedType,setSelectedType]=useState(''),[search,setSearch]=useState(''),[status,setStatus]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState('');
 async function load(){setLoading(true);setError('');try{const r=await api<any>('/api/workflows/admin/types');setTypes(r.items||[]);setRuns(readRuns());}catch{setError('تعذر تحميل بيئة الاختبار.')}finally{setLoading(false)}}
 useEffect(()=>{void load()},[]);
 const activeTypes=useMemo(()=>types.filter(x=>x.status==='active' && (x.company_id===null || x.company_id===undefined)),[types]);
 const filtered=runs.filter(x=>(!selectedType||x.typeId===selectedType)&&(!status||x.status===status)&&(!search||`${x.typeName} ${x.stageName}`.includes(search)));
 function createRun(){const t=activeTypes.find(x=>x.id===selectedType)||activeTypes[0];if(!t)return;const now=new Date().toISOString();const id=crypto.randomUUID();const run:TestRun={id,typeId:t.id,typeName:t.name_ar,status:'مسودة',stageName:'لم تبدأ',createdAt:now,updatedAt:now};const next=[run,...runs];writeRuns(next);setRuns(next);navigate(`/platform/workflows/test/${t.id}?run=${id}`);}
 function clearFinished(){const next=runs.filter(x=>x.status==='مسودة'||x.status==='قيد الاختبار');writeRuns(next);setRuns(next);}
 return <div>
  <div className="page-header"><div><div className="eyebrow">إدارة المنصة · بيئة الاختبار</div><h1>المعاملات الاختبارية</h1><p>أنشئ اختبارات معزولة لسير العمل، تابع المسودات والنتائج، ثم افتح أي اختبار لإكمال الرحلة.</p></div><div className="header-actions"><Link className="btn secondary" to="/platform/workflows"><ShieldCheck size={16}/>استوديو سير العمل</Link><button className="btn primary" onClick={createRun} disabled={!activeTypes.length}><Plus size={16}/>اختبار جديد</button></div></div>
  {error&&<div className="login-error page-error">{error}</div>}
  <section className="panel workflow-hero"><div><span className="workflow-kicker">Sandbox</span><h2>بيئة اختبار مستقلة</h2><p>الاختبارات لا تنشئ مستخدمين أو موظفين أو معاملات حقيقية في D1. حالة الاختبار محفوظة محليًا على جهازك فقط.</p></div><div className="workflow-health"><div><strong>{activeTypes.length}</strong><span>قوالب جاهزة</span></div><div><strong>{runs.filter(x=>x.status==='مسودة').length}</strong><span>مسودات</span></div><div><strong>{runs.filter(x=>['مكتملة','مرفوضة','ملغية'].includes(x.status)).length}</strong><span>نتائج</span></div></div></section>
  <section className="panel"><div className="panel-head"><div><h3>المعاملات الاختبارية</h3><p>كل سطر يمثل رحلة اختبار مستقلة.</p></div><div className="header-actions"><button className="btn secondary" onClick={clearFinished} disabled={!runs.some(x=>['مكتملة','مرفوضة','ملغية'].includes(x.status))}>مسح النتائج القديمة</button><button className="icon-btn" onClick={()=>void load()}><RefreshCw size={16}/></button></div></div>
   <div className="filter-bar"><div className="search-field"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="البحث في الاختبارات"/></div><div className="filter-select"><span>نوع المعاملة</span><select value={selectedType} onChange={e=>setSelectedType(e.target.value)}><option value="">كل الأنواع</option>{activeTypes.map(x=><option key={x.id} value={x.id}>{x.name_ar}</option>)}</select></div><div className="filter-select"><span>الحالة</span><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">كل الحالات</option><option>مسودة</option><option>قيد الاختبار</option><option>مكتملة</option><option>مرفوضة</option><option>ملغية</option></select></div></div>
   {loading?<div className="panel-empty">جاري التحميل...</div>:filtered.length===0?<div className="panel-empty"><FileClock size={28}/><h3>لا توجد معاملات اختبار</h3><p>اختر نوعًا من أنواع المعاملات ثم اضغط «اختبار جديد».</p></div>:<div className="table-wrap"><table><thead><tr><th>الاختبار</th><th>نوع المعاملة</th><th>المرحلة</th><th>الحالة</th><th>آخر تحديث</th><th>إجراء</th></tr></thead><tbody>{filtered.map(x=><tr key={x.id}><td><strong>#{x.id.slice(0,8).toUpperCase()}</strong><div className="mono">اختبار معزول</div></td><td>{x.typeName}</td><td>{x.stageName}</td><td><span className={`badge ${x.status==='مكتملة'?'success':x.status==='مرفوضة'?'danger':x.status==='قيد الاختبار'?'warning':'neutral'}`}>{x.status}</span></td><td>{new Date(x.updatedAt).toLocaleString('ar-SA')}</td><td><Link className="table-link" to={`/platform/workflows/test/${x.typeId}?run=${x.id}`}><PlayCircle size={14}/> فتح الاختبار</Link></td></tr>)}</tbody></table></div>}
  </section>
 </div>;
}
