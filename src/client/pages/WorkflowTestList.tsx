import { useEffect, useMemo, useState } from 'react';
import { Check, FileClock, PlayCircle, Plus, RefreshCw, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

type TestRun={id:string;typeId:string;typeName:string;status:'مسودة'|'قيد الاختبار'|'مكتملة'|'مرفوضة'|'ملغية';stageName:string;createdAt:string;updatedAt:string};
const STORAGE_KEY='hr_nexus_workflow_test_runs_v1';
function readRuns():TestRun[]{try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]')}catch{return []}}
function writeRuns(items:TestRun[]){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(items))}catch{}}

export function WorkflowTestList(){
 const navigate=useNavigate();const [types,setTypes]=useState<any[]>([]),[runs,setRuns]=useState<TestRun[]>([]),[selectedType,setSelectedType]=useState(''),[search,setSearch]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState('');
 async function load(){setLoading(true);setError('');try{const r=await api<any>('/api/workflows/admin/types');setTypes(r.items||[]);setRuns(readRuns());}catch{setError('تعذر تحميل بيئة الاختبار.')}finally{setLoading(false)}}
 useEffect(()=>{void load()},[]);
 const activeTypes=useMemo(()=>types.filter(x=>x.status==='active'&&(x.company_id===null||x.company_id===undefined)),[types]);
 const filtered=runs.filter(x=>(!selectedType||x.typeId===selectedType)&&(!search||`${x.typeName} ${x.stageName}`.includes(search)));
 function createRun(){const t=activeTypes.find(x=>x.id===selectedType)||activeTypes[0];if(!t)return;const now=new Date().toISOString();const run:TestRun={id:crypto.randomUUID(),typeId:t.id,typeName:t.name_ar,status:'مسودة',stageName:'لم تبدأ',createdAt:now,updatedAt:now};const next=[run,...runs];writeRuns(next);setRuns(next);navigate(`/platform/workflows/test/${t.id}?run=${run.id}`);}
 function clearAll(){writeRuns([]);setRuns([])}
 return <div className="studio-v13 test-home-v13">
  <div className="studio-hero-v13"><div><div className="eyebrow">استوديو سير العمل · بيئة اختبار معزولة</div><h1>اختبر القالب من البداية إلى النهاية.</h1><p>هذه بيئة محاكاة محلية. لا تنشئ موظفًا أو مستخدمًا أو معاملة حقيقية في D1، ولا تدخل نتائجها ضمن سجل الشركة.</p></div><div className="hero-actions-v13"><Link className="btn secondary" to="/platform/workflows"><ShieldCheck size={16}/>العودة إلى الاستوديو</Link><button className="btn primary" onClick={createRun} disabled={!activeTypes.length}><Plus size={16}/>بدء اختبار</button></div></div>
  <div className="test-commandbar-v13"><div><strong>{activeTypes.length}</strong><span>قوالب قابلة للاختبار</span></div><div><strong>{runs.filter(x=>x.status==='مسودة'||x.status==='قيد الاختبار').length}</strong><span>اختبارات مفتوحة</span></div><div><strong>{runs.filter(x=>['مكتملة','مرفوضة','ملغية'].includes(x.status)).length}</strong><span>نتائج</span></div><div className="test-spacer-v13"/><button className="btn secondary" onClick={clearAll} disabled={!runs.length}><Trash2 size={15}/>مسح الاختبارات المحلية</button><button className="icon-btn" onClick={()=>void load()}><RefreshCw size={16}/></button></div>
  {error&&<div className="studio-alert error">{error}</div>}
  <section className="studio-section-v13"><div className="section-head-v13"><div><span>القوالب</span><h2>اختر قالبًا لتجربته</h2><p>الاختبار يبدأ من مقدم الطلب ثم يمر على كل مرحلة وفق الإجابات والشروط.</p></div><div className="studio-search"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="ابحث في الاختبارات..."/></div></div><div className="test-template-strip-v13">{activeTypes.map((x:any)=><button className={`test-template-chip-v13 ${selectedType===x.id?'active':''}`} key={x.id} onClick={()=>setSelectedType(selectedType===x.id?'':x.id)}><span>{(x.name_ar||'م').slice(0,1)}</span><strong>{x.name_ar}</strong><small>الإصدار {x.workflow_version||'—'}</small></button>)}</div>
   {loading?<div className="panel-empty">جاري التحميل...</div>:filtered.length===0?<div className="empty-studio-v13"><FileClock size={32}/><strong>لا توجد جلسات اختبار</strong><span>اختر قالبًا واضغط «بدء اختبار» لإنشاء رحلة محاكاة جديدة.</span><button className="btn primary" disabled={!activeTypes.length} onClick={createRun}>بدء أول اختبار</button></div>:<div className="test-run-grid-v13">{filtered.map((x,i)=><article className="test-run-card-v13" key={x.id}><div className="test-run-top-v13"><span className="test-index-v13">اختبار {filtered.length-i}</span><span className={`status-pill ${x.status==='مكتملة'?'active':x.status==='مسودة'||x.status==='قيد الاختبار'?'draft':'muted'}`}>{x.status}</span></div><h3>{x.typeName}</h3><p>الموضع الحالي: <strong>{x.stageName}</strong></p><div className="test-run-meta-v13"><span>آخر تحديث</span><strong>{new Date(x.updatedAt).toLocaleString('ar-SA')}</strong></div><Link className="btn primary" to={`/platform/workflows/test/${x.typeId}?run=${x.id}`}><PlayCircle size={15}/>فتح رحلة الاختبار</Link></article>)}</div>}
  </section>
 </div>;
}
