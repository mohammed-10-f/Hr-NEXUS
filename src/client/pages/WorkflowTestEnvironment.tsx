import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, CircleAlert, Eye, Play, RotateCcw, ShieldCheck, UserRound, UsersRound, Workflow as WorkflowIcon } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { resolveTransition, getStageDelegation } from '../../shared/workflowEngine';

const sampleEmployees=[
 {id:'employee-demo-001',label:'موظف محاكاة — أحمد'},
 {id:'employee-demo-002',label:'موظف محاكاة — سارة'},
 {id:'employee-demo-003',label:'موظف محاكاة — خالد'}
];
const sampleValue=(key:string)=>({employee_number:'EMP-TEST-001',full_name:'بيانات محاكاة — موظف الاختبار',national_id:'••••••••',nationality:'سعودي',gender:'—',date_of_birth:'—',personal_phone:'05XXXXXXXX',personal_email:'test@example.invalid',short_address:'—',job_title:'بيانات محاكاة',actual_start_date:'2026-01-01',join_date:'2026-01-01',work_location:'—',employment_type:'—',contract_type:'—',contract_start_date:'2026-01-01',contract_end_date:'—',organization_unit:'الوحدة التنظيمية (محاكاة)',position:'المنصب (محاكاة)',direct_manager:'المدير المباشر (محاكاة)',basic_salary:'—',housing_allowance:'—',transport_allowance:'—',other_allowances:'—',gosi_number:'—',residency_classification:'—'} as Record<string,string>)[key]||'قيمة محاكاة';

export function WorkflowTestEnvironment(){
 const {typeId}=useParams<{typeId?:string}>();
 const [templates,setTemplates]=useState<any[]>([]),[data,setData]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [values,setValues]=useState<Record<string,any>>({}),[stageId,setStageId]=useState(''),[history,setHistory]=useState<any[]>([]),[done,setDone]=useState<string|null>(null),[fieldErrors,setFieldErrors]=useState<Record<string,string>>({});
 const [targetEmployee,setTargetEmployee]=useState('');
 const [delegationPending,setDelegationPending]=useState<any>(null);
 const [delegatedStages,setDelegatedStages]=useState<Set<string>>(new Set());
 useEffect(()=>{api<any>('/api/workflows/test/templates').then(r=>setTemplates(r.items||[])).catch(e=>setError(e.message||'تعذر التحميل.'));},[]);
 useEffect(()=>{if(typeId)load(typeId);},[typeId]);
 async function load(id:string){setBusy(true);setError('');try{const r=await api<any>(`/api/workflows/test/templates/${id}`);setData(r);setStageId(r.workflow.stages[0]?.id||'');setValues({});setHistory([]);setDone(null);setFieldErrors({});setTargetEmployee('');setDelegationPending(null);setDelegatedStages(new Set());}catch(e:any){setError(e.message||'تعذر فتح الاختبار.');}finally{setBusy(false);}}
 const w=data?.workflow; const stages=w?.stages||[]; const fields=w?.fields||[]; const current=stages.find((s:any)=>s.id===stageId); const currentFields=useMemo(()=>fields.filter((f:any)=>f.stage_id===stageId).sort((a:any,b:any)=>a.sort_order-b.sort_order),[fields,stageId]); const requestFields=useMemo(()=>fields.filter((f:any)=>!f.stage_id).sort((a:any,b:any)=>a.sort_order-b.sort_order),[fields]); const requesterSystem=(data?.systemFields||[]).filter((x:any)=>x.scope==='requester').sort((a:any,b:any)=>a.sort_order-b.sort_order); const targetSystem=(data?.systemFields||[]).filter((x:any)=>x.scope==='target').sort((a:any,b:any)=>a.sort_order-b.sort_order);
 function control(f:any){
  const v=values[f.field_key]??'';
  const set=(value:any)=>setValues(prev=>({...prev,[f.field_key]:value}));
  if(f.field_type==='textarea')return <textarea rows={4} value={v} readOnly={Boolean(f.config?.displayOnly)} onChange={e=>set(e.target.value)}/>;
  if(f.field_type==='boolean')return <select value={v} onChange={e=>set(e.target.value)}><option value="">اختر</option><option value="نعم">نعم</option><option value="لا">لا</option></select>;
  if(f.field_type==='select')return <select value={v} onChange={e=>set(e.target.value)}><option value="">اختر</option>{(f.options||[]).map((x:any)=><option key={x}>{x}</option>)}</select>;
  if(f.field_type==='multiselect')return <select multiple value={Array.isArray(v)?v:[]} onChange={e=>set(Array.from(e.target.selectedOptions).map((x:any)=>x.value))}>{(f.options||[]).map((x:any)=><option key={x}>{x}</option>)}</select>;
  if(f.field_type==='employee')return <select value={v} onChange={e=>set(e.target.value)}><option value="">اختر موظفًا</option>{sampleEmployees.map(e=><option key={e.id} value={e.id}>{e.label}</option>)}</select>;
  if(f.field_type==='organization_unit')return <select value={v} onChange={e=>set(e.target.value)}><option value="">اختر وحدة تنظيمية</option><option value="demo-hq">الإدارة الرئيسية (محاكاة)</option><option value="demo-hr">الموارد البشرية (محاكاة)</option></select>;
  if(f.field_type==='position')return <select value={v} onChange={e=>set(e.target.value)}><option value="">اختر منصبًا</option><option value="demo-position-1">أخصائي موارد بشرية (محاكاة)</option><option value="demo-position-2">مدير إدارة (محاكاة)</option></select>;
  if(f.field_type==='user')return <select value={v} onChange={e=>set(e.target.value)}><option value="">اختر مستخدمًا</option><option value="demo-user-1">مستخدم محاكاة</option></select>;
  const type=f.field_type==='number'?'number':f.field_type==='date'?'date':f.field_type==='datetime'?'datetime-local':'text';
  return <input type={type} value={v} readOnly={Boolean(f.config?.displayOnly)} onChange={e=>set(e.target.value)}/>;
 }

 function validate(list:any[],includeTarget=false){const errs:any={};for(const f of list)if(f.required&&!f.config?.displayOnly&&empty(values[f.field_key]))errs[f.field_key]='هذا الحقل مطلوب.';if(includeTarget&&data?.requestSettings?.targetEmployeeRequired&&!targetEmployee)errs.__targetEmployee='اختيار الموظف المعني مطلوب.';setFieldErrors(errs);return !Object.keys(errs).length;}
 function start(){if(!validate(requestFields,true))return;setStageId(stages[0]?.id||'');setHistory([{kind:'request',title:'بيانات الطلب',action:'بدء المسار',values:{...values},targetEmployee}]);}
 function finishDelegation(){if(!delegationPending)return;const pending=delegationPending;setHistory(h=>[...h,{kind:'delegation_return',title:current?.name_ar||'المرحلة الحالية',action:'عاد من الموظف المفوض',values:{...values}}]);setDelegationPending(null);setDelegatedStages(prev=>{const next=new Set(prev);next.add(pending.stageId);return next;});}
 function pass(){
  if(!current||!validate(currentFields))return;
  const delegation=getStageDelegation(current,fields,values);
  if(delegation?.enabled&&!delegatedStages.has(current.id)){
    const employeeLabel=sampleEmployees.find(e=>e.id===delegation.employeeId)?.label||'الموظف المحدد';
    const employeeField=fields.find((f:any)=>f.id===delegation.fieldId);
    if(!delegation.valid){setFieldErrors(prev=>({...prev,[employeeField?.field_key||'__delegateEmployee']:'اختر الموظف الذي ستُمرر إليه المعاملة.'}));return;}
    setDelegationPending({stageId:current.id,employeeId:delegation.employeeId,employeeLabel});
    setHistory(h=>[...h,{kind:'delegation',title:current.name_ar,action:`تمرير لموظف آخر: ${employeeLabel}`,values:{...values}}]);
    return;
  }
  const result=resolveTransition(stages,w.transitions||[],current.id,values,fields);
  const route=result.route as any;
  setHistory(h=>[...h,{kind:'stage',title:current.name_ar,action:route?.label_ar||'تمرير المعاملة',values:{...values},decision:result.decision}]);
  if(route?.action==='reject'){setDone('مرفوضة');return;}
  if(route?.action==='cancel'){setDone('ملغية');return;}
  if(route?.action==='complete'){setDone('مكتملة');return;}
  if(route?.action==='return'){setStageId(route.to_stage_id||stages[0]?.id);return;}
  if(route?.to_stage_id){setStageId(route.to_stage_id);return;}
  setError('لم يجد المحرك مسارًا صالحًا. شغّل فحص القالب من المصمم.');
 }
 function reset(){setValues({});setHistory([]);setDone(null);setStageId(stages[0]?.id||'');setFieldErrors({});setError('');setTargetEmployee('');setDelegationPending(null);setDelegatedStages(new Set());}

 if(!typeId)return <div className="premium-studio"><div className="studio-flow-intro panel"><div className="flow-intro-main"><span className="flow-intro-icon"><WorkflowIcon size={20}/></span><div><span>استوديو سير العمل</span><strong>بيئة الاختبار A–Z</strong><p>محاكاة معزولة لسلوك القالب دون كتابة معاملات أو موظفين أو مستخدمين في D1.</p></div></div></div><div className="test-template-board panel"><div className="panel-head"><div><h3>القوالب القابلة للاختبار</h3><p>هذه القائمة من القوالب الحقيقية الموجودة في الاستوديو.</p></div></div><div className="test-template-list">{templates.map(t=><Link key={t.id} className="test-template-card" to={`/workflow-studio/test/${t.id}`}><span className="test-template-icon"><Play size={15}/></span><div><strong>{t.name_ar}</strong><small>{t.workflow_id?'مسودة جاهزة للاختبار':'لا توجد مسودة'}</small></div><ArrowLeft size={14}/></Link>)}</div></div></div>;
 if(busy&&!data)return <div className="premium-studio"><div className="test-state panel">جارٍ تجهيز بيئة الاختبار...</div></div>;
 if(!data)return <div className="premium-studio"><div className="test-state panel">{error||'تعذر تحميل الاختبار.'}</div></div>;
 return <div className="workflow-test premium-studio wow-studio"><section className="wf-hero compact"><div className="wf-hero-copy"><div className="wf-crumb"><Link to="/workflow-studio">استوديو سير العمل</Link><ArrowLeft size={13}/><span>بيئة الاختبار A–Z</span></div><div className="wf-hero-title-row"><span className="wf-hero-symbol"><Play size={27}/></span><div><div className="wf-kicker">ISOLATED TEST ENVIRONMENT</div><h1>{data.type.name_ar}</h1><p>محاكاة فعلية لسلوك القالب من البداية إلى النهاية دون إنشاء مستخدمين أو موظفين أو معاملات حقيقية في D1.</p></div></div></div><div className="wf-hero-actions"><span className="wf-status active"><span/>محاكاة معزولة</span><Link className="wf-ghost" to={`/workflow-studio/${data.type.id}`}><ArrowLeft size={15}/>المصمم</Link><button className="wf-ghost" onClick={reset}><RotateCcw size={15}/>إعادة الاختبار</button></div></section>
 {error&&<div className="wf-alert danger"><CircleAlert size={18}/>{error}</div>}
 <div className="test-flow-rail panel"><div className="test-flow-base"><div className="test-flow-step fixed"><b><UserRound size={12}/></b><strong>بيانات مقدم الطلب</strong><small>{requesterSystem.length} بيانات نظامية</small></div><div className="test-flow-step fixed"><b>2</b><strong>أسئلة / بيانات الطلب</strong><small>{requestFields.length} عناصر</small></div>{stages.map((s:any,i:number)=><div key={s.id} className={`test-flow-step ${stageId===s.id?'current':history.some(h=>h.title===s.name_ar)?'done':'pending'}`}><b>{i+1}</b><strong>{s.name_ar}</strong><small>{i===stages.length-1?'اكتمال بعد النجاح':'مرحلة فعلية'}</small></div>)}</div></div>
 {!done&&<><section className="panel test-request-card"><div className="test-section-heading"><div><div className="eyebrow">بيانات النظام</div><h2>بيانات مقدم الطلب</h2><p>القيم أدناه محاكاة للعرض؛ مصدرها في التشغيل الحقيقي هو ملف الموظف في Phase 5.</p></div><span className="badge info">قراءة فقط</span></div><div className="requester-system-row">{requesterSystem.length?requesterSystem.map((x:any)=><div key={x.id||x.source_key}><span>{x.label_ar}</span><strong>{sampleValue(x.source_key)}</strong></div>):<div className="field-editor-empty">لم يختر المصمم أي بيانات نظامية لمقدم الطلب.</div>}</div>{data.requestSettings?.targetEmployeeEnabled&&<div className="target-preview"><div><UsersRound size={16}/><strong>الموظف المعني</strong></div><div className="target-preview-controls"><span>{targetSystem.length} بيانات نظامية · {data.requestSettings?.targetEmployeeRequired?'مطلوب':'اختياري'}</span><select value={targetEmployee} onChange={e=>{setTargetEmployee(e.target.value);setFieldErrors(prev=>{const n={...prev};delete n.__targetEmployee;return n;});}}><option value="">اختر موظفًا في بيئة الاختبار</option>{sampleEmployees.map(e=><option key={e.id} value={e.id}>{e.label}</option>)}</select>{fieldErrors.__targetEmployee&&<small className="sim-field-error">{fieldErrors.__targetEmployee}</small>}</div></div>}</section>
 <section className="panel test-stage-card"><div className="test-section-heading"><div><div className="eyebrow">بيانات الطلب</div><h2>أسئلة / بيانات الطلب</h2><p>لا تظهر أي خانة لم يصممها المسؤول.</p></div></div>{history.length===0?<div className="stage-question-list">{requestFields.length?requestFields.map((f:any)=><TestField key={f.id} f={f} value={values[f.field_key]} error={fieldErrors[f.field_key]} control={control(f)}/>):<div className="field-editor-empty">لا توجد أسئلة في أساس المعاملة.</div>}</div>:<div className="stage-locked-preview">تم إرسال بيانات الطلب. انتقلت المحاكاة إلى <strong>{current?.name_ar}</strong>.</div>}{history.length===0&&<div className="stage-pass-row"><span>بعد الإرسال ينتقل الاختبار إلى المرحلة الأولى.</span><button className="btn primary" onClick={start}><Play size={15}/>بدء المسار</button></div>}</section>
 {delegationPending&&<section className="panel test-delegation-card"><div className="test-section-heading"><div><div className="eyebrow">مهمة فرعية</div><h2>المعاملة لدى {delegationPending.employeeLabel}</h2><p>محاكاة معزولة لتمرير المعاملة إلى الموظف المحدد. عند إكماله للمهمة تعود تلقائيًا إلى {current?.name_ar} لاستكمالها.</p></div><span className="badge info">لا تُنشئ بيانات فعلية</span></div><div className="delegation-return-banner"><UsersRound size={18}/><span>الموظف المفوض يعالج المهمة ثم يعود التنفيذ إلى المرحلة الأصلية.</span><button className="btn primary" onClick={finishDelegation}><CheckCircle2 size={15}/>إكمال مهمة الموظف والعودة للمرحلة</button></div></section>}{current&&history.length>0&&!delegationPending&&<section className="panel test-stage-card is-current"><div className="test-stage-heading"><span className="test-stage-number">{current.stage_order}</span><div><div className="eyebrow">المرحلة الحالية</div><h2>{current.name_ar}</h2><p><ShieldCheck size={12}/> المسؤول: {current.responsible_type}</p></div>{current.duration_minutes&&<span className="stage-duration">{current.duration_minutes} دقيقة</span>}</div><div className="stage-question-list">{currentFields.length?currentFields.map((f:any)=><TestField key={f.id} f={f} value={values[f.field_key]} error={fieldErrors[f.field_key]} control={control(f)}/>):<div className="field-editor-empty">لا توجد عناصر في هذه المرحلة.</div>}</div><div className="stage-pass-row"><span>ينفّذ المحرك القرار والمسار المحدد في القالب.</span><button className="btn primary" onClick={pass}><ShieldCheck size={15}/>تمرير المعاملة</button></div></section>}
 </>}
 {done&&<div className="panel wf-test-result"><span className="finished-icon"><CheckCircle2 size={28}/></span><h2>{done}</h2><p>انتهت محاكاة A–Z دون إنشاء معاملة حقيقية.</p><button className="btn" onClick={reset}><RotateCcw size={15}/>إعادة الاختبار</button></div>}
 <div className="panel test-history"><h3>سجل المحاكاة</h3>{history.length?<div className="history-flow">{history.map((h,i)=><div className="history-stage" key={i}><span className="history-marker">{i+1}</span><div className="history-card"><div className="history-card-head"><strong>{h.title}</strong><span>{h.action||'بيانات الطلب'}</span></div></div></div>)}</div>:<div className="history-empty">سيظهر المسار هنا بعد بدء الاختبار.</div>}</div></div>;
}
function TestField({f,error,control}:{f:any;value:any;error?:string;control:any}){return <label className={`sim-field ${error?'has-error':''}`}><span>{f.label_ar}{f.required?' *':''}{f.config?.displayOnly?' · عرض فقط':''}</span>{control}{error&&<small className="sim-field-error">{error}</small>}</label>}
