import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, Check, CheckCircle2, CircleAlert, Eye, Play, RotateCcw, ShieldCheck, SkipForward, UsersRound } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';

function empty(v:any){return v===undefined||v===null||v===''||(Array.isArray(v)&&v.length===0);}
function match(route:any,values:any,fields:any[]){
 if(!route?.condition)return true;
 const f=fields.find((x:any)=>x.id===route.condition.fieldId);const actual=values[f?.field_key||''];
 return (route.condition.values||[]).some((expected:any)=>{
  if(f?.field_type==='boolean')return String(actual)===String(expected);
  if(f?.field_type==='multiselect')return Array.isArray(actual)&&actual.map(String).includes(String(expected));
  return String(actual??'')===String(expected);
 });
}
const simulatedSystemValues:any={employee_number:'EMP-TEST-0015',full_name:'موظف الاختبار المحاكي',nationality:'سعودي',personal_phone:'05X XXX XXXX',personal_email:'employee@test.invalid',short_address:'الرياض · عنوان محاكاة',job_title:'أخصائي موارد بشرية',organization_unit:'إدارة الموارد البشرية',position:'أخصائي موارد بشرية',manager:'مدير إدارة الموارد البشرية',work_location:'المقر الرئيسي',actual_start_date:'2025-01-15',hire_date:'2025-01-01',employment_type:'دوام كامل',contract_type:'غير محدد المدة',contract_start_date:'2025-01-01',contract_end_date:'—',probation_end_date:'2025-07-14',basic_salary:'12,500',housing_allowance:'3,125',transport_allowance:'800',other_allowances:'500',gosi_number:'GOSI-TEST',insurance_provider:'مزود محاكاة'};
function systemValue(field:any){const source=String(field.config?.systemSource||'').split('.').slice(1).join('.');return simulatedSystemValues[source]??'بيانات محاكاة';}

export function WorkflowTestEnvironment(){
 const {typeId}=useParams<{typeId?:string}>();
 const [templates,setTemplates]=useState<any[]>([]),[data,setData]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[running,setRunning]=useState(false);
 const [values,setValues]=useState<Record<string,any>>({}),[stageId,setStageId]=useState(''),[history,setHistory]=useState<any[]>([]),[done,setDone]=useState<string|null>(null),[fieldErrors,setFieldErrors]=useState<Record<string,string>>({});
 useEffect(()=>{api<any>('/api/workflows/test/templates').then(r=>setTemplates(r.items||[])).catch(e=>setError(e.message||'تعذر التحميل.'));},[]);
 useEffect(()=>{if(typeId)load(typeId);},[typeId]);
 async function load(id:string){setBusy(true);setError('');try{const r=await api<any>(`/api/workflows/test/templates/${id}`);setData(r);setStageId(r.workflow.stages[0]?.id||'');setValues({});setHistory([]);setDone(null);setFieldErrors({});setRunning(false);}catch(e:any){setError(e.message||'تعذر فتح الاختبار.');}finally{setBusy(false);}}
 const w=data?.workflow;const stages=w?.stages||[];const fields=w?.fields||[];const requestFields=useMemo(()=>fields.filter((f:any)=>!f.stage_id&&!f.config?.systemSource).sort((a:any,b:any)=>a.sort_order-b.sort_order),[fields]);
 const requesterSystem=useMemo(()=>fields.filter((f:any)=>!f.stage_id&&f.config?.owner==='requester'&&f.config?.systemSource).sort((a:any,b:any)=>a.sort_order-b.sort_order),[fields]);
 const subjectSystem=useMemo(()=>fields.filter((f:any)=>!f.stage_id&&f.config?.owner==='subject'&&f.config?.systemSource).sort((a:any,b:any)=>a.sort_order-b.sort_order),[fields]);
 const current=stages.find((s:any)=>s.id===stageId);const currentFields=useMemo(()=>fields.filter((f:any)=>f.stage_id===stageId).sort((a:any,b:any)=>a.sort_order-b.sort_order),[fields,stageId]);
 function control(f:any){
  if(f.config?.systemSource)return <div className="wft-readonly"><span>{systemValue(f)}</span><em>من النظام · محاكاة</em></div>;
  const v=values[f.field_key]??'';
  const setter=(v:any)=>setValues(prev=>({...prev,[f.field_key]:v}));
  if(f.field_type==='textarea')return <textarea rows={4} value={v} onChange={e=>setter(e.target.value)} readOnly={Boolean(f.config?.displayOnly)}/>;
  if(f.field_type==='boolean')return <select value={v} onChange={e=>setter(e.target.value)}><option value="">اختر</option><option value="نعم">نعم</option><option value="لا">لا</option></select>;
  if(f.field_type==='select')return <select value={v} onChange={e=>setter(e.target.value)}><option value="">اختر</option>{(f.options||[]).map((x:any)=><option key={x} value={x}>{x}</option>)}</select>;
  if(f.field_type==='multiselect')return <select multiple value={Array.isArray(v)?v:[]} onChange={e=>setter(Array.from(e.target.selectedOptions).map((x:any)=>x.value))}>{(f.options||[]).map((x:any)=><option key={x} value={x}>{x}</option>)}</select>;
  const type=f.field_type==='number'?'number':f.field_type==='date'?'date':f.field_type==='datetime'?'datetime-local':'text';
  return <input type={type} value={v} readOnly={Boolean(f.config?.displayOnly)} onChange={e=>setter(e.target.value)}/>;
 }
 function validate(list:any[]){const errs:any={};for(const f of list)if(f.required&&!f.config?.displayOnly&&empty(values[f.field_key]))errs[f.field_key]='هذا الحقل مطلوب.';setFieldErrors(errs);return Object.keys(errs).length===0;}
 function start(){if(!validate(requestFields))return;setRunning(true);setStageId(stages[0]?.id||'');setHistory([{kind:'request',title:'أساس المعاملة',action:'تم بدء الاختبار'}]);}
 function pass(){
  if(!current||!validate(currentFields))return;
  const outgoing=(w.transitions||[]).filter((r:any)=>r.from_stage_id===current.id).sort((a:any,b:any)=>a.sort_order-b.sort_order);
  let route=outgoing.find((r:any)=>r.condition&&match(r,values,fields))||outgoing.find((r:any)=>!r.condition);
  let nextStageId=route?.to_stage_id||'';
  if(!route&&current.id!==stages[stages.length-1]?.id){nextStageId=stages[stages.findIndex((s:any)=>s.id===current.id)+1]?.id||'';route={action:'next',label_ar:'تمرير المعاملة',implicit:true};}
  setHistory(h=>[...h,{kind:'stage',title:current.name_ar,action:route?.label_ar||'تمرير المعاملة'}]);
  if(route?.action==='reject'){setDone('مرفوضة');return;}
  if(route?.action==='cancel'){setDone('ملغية');return;}
  if(route?.action==='return'){setStageId(nextStageId||stages[0]?.id);return;}
  if(nextStageId){setStageId(nextStageId);return;}
  if(current.id===stages[stages.length-1]?.id){setDone('مكتملة');return;}
  setError('لم يوجد انتقال صالح. عد إلى المصمم وافحص القالب.');
 }
 function reset(){setValues({});setHistory([]);setDone(null);setRunning(false);setStageId(stages[0]?.id||'');setFieldErrors({});setError('');}
 if(!typeId)return <div className="wf-test-page"><div className="page-header"><div><div className="eyebrow">استوديو سير العمل</div><h1>بيئة الاختبار</h1><p>محاكاة A → Z معزولة لا تكتب بيانات تشغيلية في D1.</p></div></div><div className="wf-test-library">{templates.length===0?<div className="wf-empty-state compact"><div className="wf-empty-icon"><Eye size={23}/></div><h3>لا توجد قوالب لاختبارها</h3><p>أنشئ قالبًا أولًا من الاستوديو.</p></div>:templates.map(t=><Link key={t.id} to={`/workflow-studio/test/${t.id}`} className="wf-test-template"><div><strong>{t.name_ar}</strong><span>{t.workflow_id?'مسودة متاحة':'لا توجد مسودة'}</span></div><ArrowLeft size={16}/></Link>)}</div></div>;
 if(busy&&!data)return <LoadingStateLike/>;
 if(!data)return <div className="wf-alert danger"><CircleAlert size={18}/>{error||'تعذر تحميل الاختبار.'}</div>;
 return <div className="wf-test-page"><div className="wf-builder-top"><div className="wf-back-row"><Link className="wf-back" to="/workflow-studio"><ArrowLeft size={17}/>استوديو سير العمل</Link><span>/</span><strong>بيئة الاختبار</strong></div><div className="wf-builder-actions"><Link className="btn" to={`/workflow-studio/${data.type.id}`}><ArrowLeft size={15}/>العودة للمصمم</Link><button className="btn" onClick={reset}><RotateCcw size={15}/>إعادة الاختبار</button></div></div>
  <section className="wf-test-hero"><div><div className="wf-hero-kicker"><Eye size={15}/> بيئة اختبار معزولة</div><h1>{data.type.name_ar}</h1><p>Preview ليس هذا الاختبار؛ هنا نحاكي سلوك المسار فعليًا من بداية الطلب حتى النتيجة النهائية، دون إنشاء معاملة حقيقية.</p></div><div className="wf-test-safe"><ShieldCheck size={18}/><span>لا كتابة في D1</span><small>لا مستخدمون · لا موظفون · لا معاملات</small></div></section>
  {error&&<div className="wf-alert danger"><CircleAlert size={18}/>{error}</div>}
  <div className="wf-test-shell"><aside className="wf-test-rail"><div className="wf-rail-card"><span className="wf-rail-label">مسار الاختبار</span><div className="wf-test-step done"><b>✓</b><div><strong>بيانات مقدم الطلب</strong><small>من النظام</small></div></div>{stages.map((s:any,i:number)=><div key={s.id} className={`wf-test-step ${stageId===s.id&&!done?'current':history.some(h=>h.title===s.name_ar)?'done':'pending'}`}><b>{history.some(h=>h.title===s.name_ar)?'✓':i+1}</b><div><strong>{s.name_ar}</strong><small>{s.responsible_type||'مسؤول غير محدد في المسودة'}</small></div></div>)}{done&&<div className="wf-test-step result"><b>✓</b><div><strong>{done}</strong><small>النهاية الفعلية للقالب</small></div></div>}</div></aside>
   <main className="wf-test-main">
    <div className="wf-test-surface"><div className="wf-surface-head"><div><span className="eyebrow">01 · أساس المعاملة</span><h2>بيانات لا يُطلب من الموظف كتابتها</h2></div><span className="badge info">محاكاة</span></div>
      <div className="wf-system-preview-grid">{[['requester','مقدم الطلب',requesterSystem],['subject','الموظف المعني',subjectSystem]].map(([owner,label,list]:any)=><div className="wf-preview-data" key={owner}><div className="wf-preview-data-head"><UsersRound size={16}/><div><strong>{label}</strong><span>{owner==='requester'?'موظف الاختبار المحاكي':subjectSystem.length?'موظف محاكى آخر':'نفس مقدم الطلب'}</span></div></div>{list.length?<div className="wf-preview-values">{list.map((f:any)=><div key={f.id}><span>{f.label_ar}</span><strong>{systemValue(f)}</strong></div>)}</div>:<div className="wf-inline-empty">لم يحدد المصمم بيانات نظام للعرض هنا.</div>}</div>)}</div>
      <div className="wf-request-area"><div className="wf-surface-head small"><div><span className="eyebrow">بيانات الطلب</span><h2>الأسئلة والعناصر التي صممها المسؤول</h2></div></div>{!running&&!done?(requestFields.length?<div className="wf-form-fields">{requestFields.map((f:any)=><TestField key={f.id} f={f} value={values[f.field_key]} error={fieldErrors[f.field_key]} control={control(f)}/>)}</div>:<div className="wf-inline-empty">لا توجد أسئلة على أساس المعاملة.</div>):<div className="wf-history-chip"><Check size={15}/>تم بدء مسار المعاملة. انتقل إلى المرحلة الأولى.</div>}{!running&&!done&&<button className="btn primary wf-wide-btn" onClick={start}><Play size={16}/>بدء مسار المعاملة</button>}</div>
    </div>
    {running&&!done&&current&&<section className="wf-test-surface current-stage"><div className="wf-current-stage-head"><div className="wf-stage-index">{current.stage_order}</div><div><span className="eyebrow">المرحلة الحالية</span><h2>{current.name_ar}</h2><p>{current.responsible_type?`المسؤول: ${current.responsible_type}`:'المسؤول غير محدد في المسودة'}</p></div></div>{currentFields.length?<div className="wf-form-fields">{currentFields.map((f:any)=><TestField key={f.id} f={f} value={values[f.field_key]} error={fieldErrors[f.field_key]} control={control(f)}/>)}</div>:<div className="wf-inline-empty">لا توجد عناصر مصممة لهذه المرحلة.</div>}<button className="btn primary wf-wide-btn" onClick={pass}><SkipForward size={16}/>{stages[stages.length-1]?.id===current.id?'تمرير المعاملة وإكمال القالب':'تمرير المعاملة'}</button></section>}
    {done&&<section className="wf-test-result-large"><div className="wf-result-icon"><CheckCircle2 size={28}/></div><span>نهاية المسار الفعلية</span><h2>{done}</h2><p>انتهت المحاكاة حسب ترتيب المراحل والمسارات المعرفة في القالب.</p><button className="btn primary" onClick={reset}><RotateCcw size={15}/>بدء اختبار جديد</button></section>}
    <section className="wf-test-surface wf-run-history"><div className="wf-surface-head small"><div><span className="eyebrow">سجل المحاكاة</span><h2>كيف تحرك المحرك؟</h2></div></div>{history.length?history.map((h,i)=><div className="wf-run-row" key={i}><span>{i+1}</span><strong>{h.title}</strong><em>{h.action}</em></div>):<div className="wf-inline-empty">سيظهر المسار هنا بمجرد بدء الاختبار.</div>}</section>
   </main>
  </div>
 </div>;
}
function TestField({f,error,control}:{f:any;value:any;error?:string;control:any}){return <label className={`wf-form-field ${error?'has-error':''}`}><div><span>{f.label_ar}</span>{f.required&&!f.config?.displayOnly&&<b>*</b>}{f.config?.displayOnly&&<small>عرض فقط</small>}</div>{control}{error&&<em>{error}</em>}</label>}
function LoadingStateLike(){return <div className="wf-empty-state compact"><div className="wf-empty-icon"><Eye size={23}/></div><h3>جاري تجهيز بيئة الاختبار…</h3></div>}
