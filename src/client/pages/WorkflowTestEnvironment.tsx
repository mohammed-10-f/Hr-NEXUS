import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, CheckCircle2, CircleAlert, Clock3, Play, RotateCcw, ShieldCheck, UserRound, Workflow as WorkflowIcon } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';

type Field={id:string;stage_id:string|null;field_key:string;label_ar:string;field_type:string;required:number;options:string[];sort_order:number;config?:any};
type Stage={id:string;name_ar:string;stage_order:number;responsible_type:string;responsible_value:string|null;duration_minutes:number|null;config:any};
type Route={id:string;from_stage_id:string;to_stage_id:string|null;action:'next'|'return'|'complete'|'reject'|'cancel';condition:{fieldKey:string;values:any[]}|null;sort_order:number};
type Template={id:string;name_ar:string;status:string;latest_version:number|null;active_version:number|null;draft_id:string|null};

const responsibilityLabels:Record<string,string>={employee_owner:'الموظف المرتبط',direct_manager:'المدير المباشر',department_manager:'مدير الإدارة',position_holder:'شاغل المنصب',role:'دور وظيفي',permission:'حامل صلاحية',company_admin:'مدير الشركة',specific_user:'مستخدم محدد'};
const actionLabels:Record<string,string>={next:'انتقل',return:'ارجع',complete:'مكتملة',reject:'مرفوضة',cancel:'ملغاة'};
const fieldTypeLabels:Record<string,string>={text:'نص',textarea:'نص طويل',number:'رقم',date:'تاريخ',datetime:'تاريخ ووقت',boolean:'نعم / لا',select:'اختيار واحد',multiselect:'اختيارات متعددة',employee:'موظف',organization_unit:'وحدة تنظيمية',position:'منصب',user:'مستخدم'};
function display(value:any){if(value===null||value===undefined||value==='')return '—';if(value===true||value==='true')return 'نعم';if(value===false||value==='false')return 'لا';if(Array.isArray(value))return value.join('، ');return String(value);}
function equals(actual:any,expected:any,type?:string){if(type==='multiselect'){const a=Array.isArray(actual)?actual.map(String):[];return expected.some((v:any)=>a.includes(String(v)));}if(type==='number')return Number(actual)===Number(expected);if(type==='boolean')return Boolean(actual)===(String(expected)==='نعم'||expected===true||String(expected)==='true');return String(actual??'')===String(expected??'');}
function routeMatches(route:Route,values:Record<string,any>,fields:Field[]){if(!route.condition)return true;const field=fields.find(f=>f.field_key===route.condition?.fieldKey);const actual=values[route.condition.fieldKey];return route.condition.values.some(v=>equals(actual,v,field?.field_type));}
function LockIconFallback(){return <span className="stage-lock-mark" aria-hidden="true">○</span>}
function renderField(field:Field,value:any,onChange:(v:any)=>void,error?:string){
  const common={value:value??'',onChange:(e:any)=>onChange(e.target.value)};
  const selectOptions=field.options||[];
  const readOnly=Boolean(field.config?.displayOnly);
  const control=field.field_type==='textarea'?<textarea {...common} rows={4} readOnly={readOnly}/>:field.field_type==='boolean'?<select disabled={readOnly} value={value??''} onChange={e=>onChange(e.target.value)}><option value="">اختر</option><option value="نعم">نعم</option><option value="لا">لا</option></select>:field.field_type==='select'?<select disabled={readOnly} value={value??''} onChange={e=>onChange(e.target.value)}><option value="">اختر</option>{selectOptions.map(o=><option key={o} value={o}>{o}</option>)}</select>:field.field_type==='multiselect'?<select disabled={readOnly} multiple value={Array.isArray(value)?value:[]} onChange={e=>onChange(Array.from(e.target.selectedOptions).map((o:any)=>o.value))}>{selectOptions.map(o=><option key={o} value={o}>{o}</option>)}</select>:field.field_type==='number'?<input type="number" {...common} readOnly={readOnly}/>:field.field_type==='date'?<input type="date" {...common} readOnly={readOnly}/>:field.field_type==='datetime'?<input type="datetime-local" {...common} readOnly={readOnly}/>:field.field_type==='employee'?<input dir="ltr" {...common} placeholder="رقم الموظف" readOnly={readOnly}/>:<input {...common} readOnly={readOnly}/>;
  return <label className={`sim-field ${error?'has-error':''} ${readOnly?'readonly':''}`} key={field.id}><span>{field.label_ar}{field.required?' *':''}{readOnly?' · عرض فقط':''}</span>{control}{error&&<small className="sim-field-error">{error}</small>}</label>;
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
  const currentIndex=currentStage?stages.findIndex(s=>s.id===currentStage.id):-1;
  const readOnlyRequester=requesterName||'لم يُحدد بعد';
  const renderReadOnlyField=(field:Field)=><div className="sim-field readonly" key={field.id}><span>{field.label_ar}{field.required?' *':''}</span><div className="sim-readonly-value">{display(values[field.field_key])}</div></div>;

  return <div className="workflow-test-page">
    <div className="page-header workflow-test-header"><div><div className="eyebrow">بيئة الاختبار</div><h1>{type.name_ar}</h1><p>المحاكاة تعمل داخل المتصفح فقط ولا تنشئ معاملة أو مستخدمًا أو موظفًا في D1.</p></div><div className="header-actions"><Link className="btn secondary" to="/workflow-studio/test"><ArrowLeft size={15}/> القوالب</Link><Link className="btn secondary" to={`/workflow-studio/${type.id}`}>الاستوديو</Link>{(started||finished)&&<button className="btn secondary" onClick={()=>resetLocal()}><RotateCcw size={15}/> إعادة الاختبار</button>}</div></div>
    {invalid?<section className="test-not-ready panel"><CircleAlert size={24}/><h2>القالب غير جاهز للاختبار</h2><p>أكمل إعداد المسارات والأسئلة في الاستوديو أولًا.</p><Link className="btn primary" to={`/workflow-studio/${type.id}`}>فتح الاستوديو</Link></section>:
    <>
      <div className="test-flow-rail"><div className="test-flow-base"><span className={`test-flow-step fixed ${started||finished?'done':''}`}><b>•</b><strong>بيانات مقدم الطلب</strong><small>تُستدعى في التشغيل الحقيقي من بيانات النظام</small></span>{stages.map((stage,i)=>{const done=started||finished?i<currentIndex||Boolean(finished):false;const current=started&&!finished&&stage.id===stageId;return <span className={`test-flow-step ${done?'done':current?'current':'pending'}`} key={stage.id}><b>{i+1}</b><strong>{stage.name_ar}</strong><small>{responsibilityLabels[stage.responsible_type]||stage.responsible_value||'مسؤول المرحلة'}</small></span>})}</div></div>

      <section className="test-request-card panel">
        <div className="test-section-heading"><div><span className="eyebrow">أساس المعاملة</span><h2>بيانات مقدم الطلب وأسئلة الطلب</h2><p>بيانات مقدم الطلب أساسية من النظام، ثم يجيب مقدم الطلب على الأسئلة والبيانات التي صممها Super Admin.</p></div><span className="badge info"><ShieldCheck size={13}/> محاكاة</span></div>
        <div className="requester-system-row"><div><span>اسم مقدم الطلب</span><strong>{readOnlyRequester}</strong></div><div><span>الرقم الوظيفي</span><strong dir="ltr">{requesterEmployeeNumber||'—'}</strong></div><div><span>البيانات التنظيمية</span><strong>تُستدعى من بيانات الموظف المرتبط في التشغيل الحقيقي</strong></div></div>
        {!started&&!finished?<>
          <div className="test-simulation-note">هذه الشاشة لا تكتب في قاعدة البيانات. الاسم والرقم التاليان مخصصان لمحاكاة مقدم الطلب داخل المتصفح فقط؛ في المعاملة الفعلية يحددهما النظام من جلسة المستخدم وبيانات الموظف.</div>
          <div className="sim-grid"><label className={`sim-field ${fieldErrors.__requester?'has-error':''}`}><span>اسم مقدم الطلب في المحاكاة *</span><input value={requesterName} onChange={e=>setRequesterName(e.target.value)}/>{fieldErrors.__requester&&<small className="sim-field-error">{fieldErrors.__requester}</small>}</label><label className="sim-field"><span>الرقم الوظيفي في المحاكاة</span><input dir="ltr" value={requesterEmployeeNumber} onChange={e=>setRequesterEmployeeNumber(e.target.value)} placeholder="رقم الموظف"/></label>{requestFields.map(f=>renderField(f,values[f.field_key],v=>setValues(x=>({...x,[f.field_key]:v})),fieldErrors[f.field_key]))}</div>
          <div className="test-submit-row"><button className="btn primary large" onClick={submit}><Play size={16}/> تقديم المعاملة</button></div>
        </>:<div className="sim-grid"> <div className="sim-field readonly"><span>مقدم الطلب</span><div className="sim-readonly-value">{readOnlyRequester}</div></div><div className="sim-field readonly"><span>الرقم الوظيفي</span><div className="sim-readonly-value" dir="ltr">{requesterEmployeeNumber||'—'}</div></div>{requestFields.map(renderReadOnlyField)}</div>}
      </section>

      <section className="test-stage-stack">
        {stages.map((stage,i)=>{
          const isCurrent=started&&!finished&&stage.id===stageId;
          const stageHistory=history.filter(h=>h.stageId===stage.id);
          const wasVisited=stageHistory.length>0;
          const isFuture=!isCurrent&&!wasVisited&&started&&!finished;
          const isBeforeStart=!started&&!finished;
          return <article className={`test-stage-card panel ${isCurrent?'is-current':''} ${wasVisited&&!isCurrent?'is-complete':''}`} key={stage.id}>
            <div className="test-stage-heading"><div className="test-stage-number">{stage.stage_order}</div><div><span>{isCurrent?'المرحلة الحالية':wasVisited?'تم تنفيذها':isBeforeStart?'المرحلة في المسار':'المرحلة التالية'}</span><h2>{stage.name_ar}</h2><p><UserRound size={14}/> {responsibilityLabels[stage.responsible_type]||stage.responsible_value||'مسؤول المرحلة'}</p></div><div className="stage-duration">{stage.duration_minutes?<><Clock3 size={14}/> {stage.duration_minutes} دقيقة</>:'بدون مدة'}</div></div>

            {isCurrent?<>
              <div className="stage-question-list"><div className="stage-content-heading"><strong>أسئلة وقرارات المرحلة</strong><span>الإجابة هي البيانات التي يستخدمها المسار عند وجود شرط.</span></div>{currentFields.map(f=>renderField(f,values[f.field_key],v=>setValues(x=>({...x,[f.field_key]:v})),fieldErrors[f.field_key]))}</div>
              {stage.config?.employeeFeedback&&<div className="inline-feedback"><button className="feedback-toggle" onClick={()=>setFeedbackOpen(v=>!v)}>{feedbackOpen?'إخفاء ملاحظات الموظف':'طلب ملاحظات الموظف'}</button>{feedbackOpen&&<div className="feedback-inline-box"><input value={feedbackText} onChange={e=>setFeedbackText(e.target.value)} placeholder="اكتب الملاحظة المطلوبة"/><button className="btn secondary" onClick={()=>setFeedbackOpen(false)}><Check size={14}/> حفظ</button></div>}</div>}
              <div className="stage-pass-row"><div><span>بعد التمرير يحدد النظام الوجهة من المسارات المعرّفة.</span></div><button className="btn primary large" onClick={pass}>تمرير المعاملة</button></div>
            </>:wasVisited?<div className="stage-history-content">{stageHistory.map((h,idx)=><div className="stage-history-entry" key={`${h.stageId}-${idx}`}><div className="stage-history-entry-head"><strong>تنفيذ {idx+1}</strong><span>{h.action}</span></div><div className="history-answer-list">{h.answers.filter(a=>a.value!==undefined&&a.value!=='').map(a=><div key={a.label}><span>{a.label}</span><b>{display(a.value)}</b></div>)}</div></div>)}</div>
            :<div className="stage-locked-preview"><LockIconFallback/><span>{started&&!finished?'لم تصل المعاملة إلى هذه المرحلة بعد.':'لن تُنفذ هذه المرحلة حتى يتم تقديم المعاملة ثم تمرير المسار إليها.'}</span></div>}
          </article>;
        })}
      </section>

      {finished&&<section className={`test-finished panel ${finished==='مكتملة'?'success':''}`}><div className="finished-icon"><CheckCircle2 size={31}/></div><span className="eyebrow">نتيجة الاختبار</span><h2>المعاملة {finished}</h2><p>انتهى المسار داخل بيئة الاختبار فقط. لا يوجد سجل حقيقي في قاعدة البيانات.</p><div className="finished-actions"><button className="btn secondary" onClick={()=>resetLocal()}><RotateCcw size={15}/> إعادة الاختبار</button><Link className="btn primary" to={`/workflow-studio/${type.id}`}>العودة للاستوديو</Link></div></section>}
    </>}
    {error&&!invalid&&<div className="form-error workflow-inline-error">{error}</div>}
  </div>;

}
