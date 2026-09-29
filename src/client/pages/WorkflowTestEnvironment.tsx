import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, CheckCircle2, CircleAlert, Clock3, Play, RotateCcw, ShieldCheck, UserRound, Workflow as WorkflowIcon } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';

type Field={id:string;stage_id:string|null;field_key:string;label_ar:string;field_type:string;required:number;options:string[];sort_order:number};
type Stage={id:string;name_ar:string;stage_order:number;responsible_type:string;responsible_value:string|null;duration_minutes:number|null;config:any};
type Route={id:string;from_stage_id:string;to_stage_id:string|null;action:'next'|'return'|'complete'|'reject'|'cancel';condition:{fieldKey:string;values:any[]}|null;sort_order:number};
type Template={id:string;name_ar:string;status:string;latest_version:number|null;active_version:number|null;draft_id:string|null};

const responsibilityLabels:Record<string,string>={employee_owner:'الموظف المرتبط',direct_manager:'المدير المباشر',department_manager:'مدير الإدارة',position_holder:'شاغل المنصب',role:'دور وظيفي',permission:'حامل صلاحية',company_admin:'مدير الشركة',specific_user:'مستخدم محدد'};
const actionLabels:Record<string,string>={next:'انتقل',return:'ارجع',complete:'مكتملة',reject:'مرفوضة',cancel:'ملغاة'};
const fieldTypeLabels:Record<string,string>={text:'نص',textarea:'نص طويل',number:'رقم',date:'تاريخ',datetime:'تاريخ ووقت',boolean:'نعم / لا',select:'اختيار واحد',multiselect:'اختيارات متعددة',employee:'موظف',organization_unit:'وحدة تنظيمية',position:'منصب',user:'مستخدم'};
function display(value:any){if(value===null||value===undefined||value==='')return '—';if(value===true||value==='true')return 'نعم';if(value===false||value==='false')return 'لا';if(Array.isArray(value))return value.join('، ');return String(value);}
function equals(actual:any,expected:any,type?:string){if(type==='multiselect'){const a=Array.isArray(actual)?actual.map(String):[];return expected.some((v:any)=>a.includes(String(v)));}if(type==='number')return Number(actual)===Number(expected);if(type==='boolean')return Boolean(actual)===(String(expected)==='نعم'||expected===true||String(expected)==='true');return String(actual??'')===String(expected??'');}
function routeMatches(route:Route,values:Record<string,any>,fields:Field[]){if(!route.condition)return true;const field=fields.find(f=>f.field_key===route.condition?.fieldKey);const actual=values[route.condition.fieldKey];return route.condition.values.some(v=>equals(actual,v,field?.field_type));}
function renderField(field:Field,value:any,onChange:(v:any)=>void,error?:string){
  const common={value:value??'',onChange:(e:any)=>onChange(e.target.value)};
  const selectOptions=field.options||[];
  return <label className={`sim-field ${error?'has-error':''}`} key={field.id}><span>{field.label_ar}{field.required?' *':''}</span>{field.field_type==='textarea'?<textarea {...common} rows={4}/>:field.field_type==='boolean'?<select value={value??''} onChange={e=>onChange(e.target.value)}><option value="">اختر</option><option value="نعم">نعم</option><option value="لا">لا</option></select>:field.field_type==='select'?<select value={value??''} onChange={e=>onChange(e.target.value)}><option value="">اختر</option>{selectOptions.map(o=><option key={o} value={o}>{o}</option>)}</select>:field.field_type==='multiselect'?<select multiple value={Array.isArray(value)?value:[]} onChange={e=>onChange(Array.from(e.target.selectedOptions).map((o:any)=>o.value))}>{selectOptions.map(o=><option key={o} value={o}>{o}</option>)}</select>:field.field_type==='number'?<input type="number" {...common}/>:field.field_type==='date'?<input type="date" {...common}/>:field.field_type==='datetime'?<input type="datetime-local" {...common}/>:field.field_type==='employee'?<input dir="ltr" {...common} placeholder="رقم الموظف"/>:<input {...common}/>} {error&&<small className="sim-field-error">{error}</small>}</label>;
}

export function WorkflowTestEnvironment(){
  const params=useParams<{typeId?:string}>();const navigate=useNavigate();
  const [templates,setTemplates]=useState<Template[]>([]),[listLoading,setListLoading]=useState(true);
  const [type,setType]=useState<any>(null),[workflow,setWorkflow]=useState<any>(null),[validation,setValidation]=useState<any>(null),[pageLoading,setPageLoading]=useState(Boolean(params.typeId)),[error,setError]=useState('');
  const [started,setStarted]=useState(false),[finished,setFinished]=useState<string|null>(null),[stageId,setStageId]=useState('');
  const [requesterName,setRequesterName]=useState(''),[requesterEmployeeNumber,setRequesterEmployeeNumber]=useState(''),[values,setValues]=useState<Record<string,any>>({}),[fieldErrors,setFieldErrors]=useState<Record<string,string>>({});
  const [history,setHistory]=useState<Array<{stageId:string;answers:Array<{label:string;value:any}>;action:string}>>([]);
  const [feedbackOpen,setFeedbackOpen]=useState(false),[feedbackText,setFeedbackText]=useState('');

  useEffect(()=>{api<{items:Template[]}>('/api/workflows/test/templates').then(r=>setTemplates(r.items||[])).catch(()=>setTemplates([])).finally(()=>setListLoading(false));},[]);
  async function loadType(id:string){
    setPageLoading(true);setError('');
    try{const r=await api<any>(`/api/workflows/test/templates/${id}`);setType(r.type);setWorkflow(r.workflow);setValidation(r.validation);setStageId(r.workflow?.stages?.[0]?.id||'');resetLocal(r.workflow?.stages?.[0]?.id||'');}
    catch{setError('تعذر فتح بيئة الاختبار.');}finally{setPageLoading(false);}
  }
  function resetLocal(firstStage?:string){setStarted(false);setFinished(null);setStageId(firstStage||workflow?.stages?.[0]?.id||'');setRequesterName('');setRequesterEmployeeNumber('');setValues({});setFieldErrors({});setHistory([]);setFeedbackOpen(false);setFeedbackText('');}
  useEffect(()=>{if(params.typeId)void loadType(params.typeId);},[params.typeId]);

  const stages:Stage[]=workflow?.stages||[];const fields:Field[]=workflow?.fields||[];const routes:Route[]=workflow?.transitions||[];
  const currentStage=stages.find(s=>s.id===stageId);const requestFields=useMemo(()=>fields.filter(f=>!f.stage_id).sort((a,b)=>a.sort_order-b.sort_order),[fields]);const currentFields=useMemo(()=>fields.filter(f=>f.stage_id===stageId).sort((a,b)=>a.sort_order-b.sort_order),[fields,stageId]);const currentRoutes=useMemo(()=>routes.filter(r=>r.from_stage_id===stageId).sort((a,b)=>a.sort_order-b.sort_order),[routes,stageId]);
  function missing(list:Field[]){const errs:Record<string,string>={};for(const f of list){const v=values[f.field_key];const empty=v===undefined||v===null||v===''||(Array.isArray(v)&&v.length===0);if(f.required&&empty)errs[f.field_key]='هذا الحقل مطلوب.';}setFieldErrors(errs);return errs;}
  function submit(){
    const errs=missing(requestFields);if(!requesterName.trim()){errs.__requester='اسم مقدم الطلب مطلوب.';setFieldErrors({...errs});return;}if(Object.keys(errs).length)return;
    setStarted(true);setFieldErrors({});setStageId(stages[0]?.id||'');
  }
  function chooseRoute(){
    const conditional=currentRoutes.filter(r=>r.condition&&routeMatches(r,values,fields));
    return conditional[0]||currentRoutes.find(r=>!r.condition)||null;
  }
  function pass(){
    if(!currentStage)return;const errs=missing(currentFields);if(Object.keys(errs).length)return;
    const route=chooseRoute();if(!route){setError('هذا القالب غير مكتمل. عُد إلى الاستوديو لإكمال مساره.');return;}
    const answers=currentFields.map(f=>({label:f.label_ar,value:values[f.field_key]}));
    setHistory(h=>[...h,{stageId:currentStage.id,answers,action:actionLabels[route.action]}]);
    if(route.action!=='next'&&route.action!=='return'){setFinished(actionLabels[route.action]);setFieldErrors({});return;}
    if(route.to_stage_id){setStageId(route.to_stage_id);setFieldErrors({});setFeedbackOpen(false);setFeedbackText('');}
  }
  if(!params.typeId)return <div className="workflow-test-page"><div className="page-header"><div><div className="eyebrow">استوديو سير العمل</div><h1>بيئة الاختبار</h1><p>اختبار حقيقي للمسار داخل المتصفح دون إنشاء معاملة.</p></div><Link className="btn secondary" to="/workflow-studio"><ArrowLeft size={15}/> الاستوديو</Link></div><section className="test-template-board panel"><div className="panel-head"><div><span className="eyebrow">اختبار معزول</span><h2>اختر قالبًا</h2><p>المحاكاة لا تحفظ مستخدمين أو موظفين أو معاملات في D1.</p></div><span className="badge info"><ShieldCheck size={13}/> بيئة آمنة</span></div>{listLoading?<div className="panel-empty">جاري التحميل...</div>:templates.length===0?<div className="panel-empty">لا توجد قوالب.</div>:<div className="test-template-list">{templates.map(t=><button className="test-template-card" key={t.id} onClick={()=>navigate(`/workflow-studio/test/${t.id}`)}><span className="test-template-icon"><WorkflowIcon size={19}/></span><div><strong>{t.name_ar}</strong><small>{t.active_version?`معتمد · النسخة ${t.active_version}`:'مسودة'}</small></div><Play size={16}/></button>)}</div>}</section></div>;
  if(pageLoading||!workflow||!type)return <div className="workflow-test-page"><section className="test-state panel"><CircleAlert size={22}/><h3>{error||'جاري تجهيز الاختبار'}</h3></section></div>;

  const invalid=validation&&!validation.valid;
  return <div className="workflow-test-page">
    <div className="page-header workflow-test-header"><div><div className="eyebrow">بيئة الاختبار</div><h1>{type.name_ar}</h1><p>المحاكاة لا تنشئ سجلًا حقيقيًا.</p></div><div className="header-actions"><Link className="btn secondary" to="/workflow-studio/test"><ArrowLeft size={15}/> القوالب</Link><Link className="btn secondary" to={`/workflow-studio/${type.id}`}>الاستوديو</Link>{(started||finished)&&<button className="btn secondary" onClick={()=>resetLocal()}><RotateCcw size={15}/> إعادة الاختبار</button>}</div></div>
    {invalid?<section className="test-not-ready panel"><CircleAlert size={24}/><h2>القالب غير جاهز للاختبار</h2><p>أكمل إعداد المسار في الاستوديو أولًا.</p><Link className="btn primary" to={`/workflow-studio/${type.id}`}>فتح الاستوديو</Link></section>:
    <>
      <div className="test-flow-rail"><div className="test-flow-base"><span className="test-flow-step fixed"><b>١</b><strong>مقدم الطلب</strong><small>بيانات المعاملة</small></span>{stages.map((s,i)=><span className={`test-flow-step ${finished?(i<=stages.findIndex(x=>x.id===stageId)?'done':'pending'):started?(i<stages.findIndex(x=>x.id===stageId)?'done':i===stages.findIndex(x=>x.id===stageId)?'current':'pending'):'pending'}`} key={s.id}><b>{i+1}</b><strong>{s.name_ar}</strong><small>{responsibilityLabels[s.responsible_type]||s.responsible_value||'مسؤول المرحلة'}</small></span>)}</div></div>
      {!started&&!finished&&<section className="test-request-card panel"><div className="test-section-heading"><div><span className="eyebrow">بداية المعاملة</span><h2>مقدم الطلب وبيانات الطلب</h2><p>تُعبّأ مرة واحدة، ثم تبدأ مراحل المعالجة.</p></div><span className="badge info"><ShieldCheck size={13}/> محاكاة</span></div><div className="requester-system-row"><div><span>مقدم الطلب</span><strong>{requesterName||'سيُحدد هنا'}</strong></div><div><span>الرقم الوظيفي</span><strong dir="ltr">{requesterEmployeeNumber||'—'}</strong></div><div><span>الموظف المرتبط</span><strong>{requestFields.some(f=>f.field_type==='employee')?'عنصر اختياري في بيانات الطلب':'مقدم الطلب افتراضيًا'}</strong></div></div><div className="sim-grid"><label className={`sim-field ${fieldErrors.__requester?'has-error':''}`}><span>اسم مقدم الطلب *</span><input value={requesterName} onChange={e=>setRequesterName(e.target.value)}/>{fieldErrors.__requester&&<small className="sim-field-error">{fieldErrors.__requester}</small>}</label><label className="sim-field"><span>الرقم الوظيفي</span><input dir="ltr" value={requesterEmployeeNumber} onChange={e=>setRequesterEmployeeNumber(e.target.value)} placeholder="رقم الموظف فقط"/></label>{requestFields.map(f=>renderField(f,values[f.field_key],v=>setValues(x=>({...x,[f.field_key]:v})),fieldErrors[f.field_key]))}</div><div className="test-submit-row"><button className="btn primary large" onClick={submit}><Play size={16}/> تقديم المعاملة</button></div></section>}
      {started&&!finished&&currentStage&&<section className="test-stage-card panel"><div className="test-stage-heading"><div className="test-stage-number">{currentStage.stage_order}</div><div><span>المرحلة الحالية</span><h2>{currentStage.name_ar}</h2><p><UserRound size={14}/> {responsibilityLabels[currentStage.responsible_type]||currentStage.responsible_value||'مسؤول المرحلة'}</p></div><div className="stage-duration">{currentStage.duration_minutes?<><Clock3 size={14}/> {currentStage.duration_minutes} دقيقة</>:'بدون مدة'}</div></div><div className="stage-question-list">{currentFields.map(f=>renderField(f,values[f.field_key],v=>setValues(x=>({...x,[f.field_key]:v})),fieldErrors[f.field_key]))}</div>{currentStage.config?.employeeFeedback&&<div className="inline-feedback"><button className="feedback-toggle" onClick={()=>setFeedbackOpen(v=>!v)}>{feedbackOpen?'إخفاء ملاحظات الموظف':'طلب ملاحظات الموظف'}</button>{feedbackOpen&&<div className="feedback-inline-box"><input value={feedbackText} onChange={e=>setFeedbackText(e.target.value)} placeholder="اكتب الملاحظة المطلوبة"/><button className="btn secondary" onClick={()=>setFeedbackOpen(false)}><Check size={14}/> حفظ</button></div>}</div>}<div className="stage-pass-row"><div><span>بعد التمرير سيحدد النظام الخطوة التالية تلقائيًا.</span></div><button className="btn primary large" onClick={pass}>تمرير المعاملة</button></div></section>}
      {history.length>0&&<section className="test-history panel"><div className="panel-head"><div><span className="eyebrow">التسلسل</span><h3>ما تم في الاختبار</h3></div></div><div className="history-flow">{history.map((h,i)=>{const s=stages.find(x=>x.id===h.stageId);return <div className="history-stage" key={`${h.stageId}-${i}`}><div className="history-marker">{i+1}</div><div className="history-card"><div className="history-card-head"><strong>{s?.name_ar}</strong><span>{h.action}</span></div><div className="history-answer-list">{h.answers.filter(a=>a.value!==undefined&&a.value!=='').map(a=><div key={a.label}><span>{a.label}</span><b>{display(a.value)}</b></div>)}</div></div></div>})}</div></section>}
      {finished&&<section className={`test-finished panel ${finished==='مكتملة'?'success':''}`}><div className="finished-icon"><CheckCircle2 size={31}/></div><span className="eyebrow">نهاية المحاكاة</span><h2>المعاملة {finished}</h2><p>تم تنفيذ المسار داخل بيئة الاختبار فقط.</p><div className="finished-actions"><button className="btn secondary" onClick={()=>resetLocal()}><RotateCcw size={15}/> إعادة الاختبار</button><Link className="btn primary" to={`/workflow-studio/${type.id}`}>العودة للاستوديو</Link></div></section>}
    </>}
    {error&&!invalid&&<div className="form-error workflow-inline-error">{error}</div>}
  </div>;
}
