import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, CircleAlert, Play, RotateCcw, ShieldCheck, UserRound, UsersRound, Workflow as WorkflowIcon, X } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { resolveTransition } from '../../shared/workflowEngine';

const simulatedEmployees = [
  { id:'sim-001', employeeNumber:'SIM-001', label:'أحمد — موظف اختبار' },
  { id:'sim-002', employeeNumber:'SIM-002', label:'سارة — موظفة اختبار' },
  { id:'sim-003', employeeNumber:'SIM-003', label:'خالد — موظف اختبار' }
];
const simulatedRequester = {
  employee_number:'SIM-0001',full_name:'موظف الاختبار',job_title:'المسمى الوظيفي المحاكى',
  organization_unit:'الوحدة التنظيمية المحاكاة',position:'المنصب المحاكى',direct_manager:'المدير المباشر المحاكى',
  actual_start_date:'2026-01-01',join_date:'2026-01-01',basic_salary:'25,000',housing_allowance:'6,000',transport_allowance:'2,000',
  other_allowances:'1,000',contract_type:'غير محدد المدة',work_location:'المقر الرئيسي',nationality:'سعودي',
};
const simulatedValue=(key:string)=>String((simulatedRequester as Record<string,string>)[key]??'قيمة محاكاة');
const empty=(v:any)=>v===undefined||v===null||v===''||(Array.isArray(v)&&!v.length);

export function WorkflowTestEnvironment(){
  const {typeId}=useParams<{typeId?:string}>();
  const [params]=useSearchParams();
  const workflowId=params.get('workflowId')||'';
  const [templates,setTemplates]=useState<any[]>([]),[data,setData]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [values,setValues]=useState<Record<string,any>>({}),[stageId,setStageId]=useState(''),[history,setHistory]=useState<any[]>([]),[done,setDone]=useState<string|null>(null),[errors,setErrors]=useState<Record<string,string>>({});
  const [targetEmployee,setTargetEmployee]=useState('');
  const [delegation,setDelegation]=useState<{stageId:string;employeeId:string;employeeLabel:string}|null>(null);
  const [showDelegationPicker,setShowDelegationPicker]=useState(false);

  useEffect(()=>{ if(!typeId) api<any>('/api/workflows/test/templates').then(r=>setTemplates(r.items||[])).catch(e=>setError(e.message||'تعذر تحميل القوالب.')); },[typeId]);
  useEffect(()=>{ if(typeId) void load(typeId,workflowId); },[typeId,workflowId]);
  async function load(id:string,wfId=''){
    setBusy(true);setError('');
    try{ const q=wfId?`?workflowId=${encodeURIComponent(wfId)}`:'';const r=await api<any>(`/api/workflows/test/templates/${id}${q}`);setData(r);setStageId(r.workflow.stages[0]?.id||'');setValues({});setHistory([]);setDone(null);setErrors({});setTargetEmployee('');setDelegation(null);setShowDelegationPicker(false); }
    catch(e:any){setError(e.message||'تعذر تحميل الاختبار.');}finally{setBusy(false);}
  }
  const w=data?.workflow;const stages=w?.stages||[];const fields=w?.fields||[];const current=stages.find((s:any)=>s.id===stageId);
  const requestFields=useMemo(()=>fields.filter((f:any)=>!f.stage_id).sort((a:any,b:any)=>a.sort_order-b.sort_order),[fields]);
  const currentFields=useMemo(()=>fields.filter((f:any)=>f.stage_id===stageId).sort((a:any,b:any)=>a.sort_order-b.sort_order),[fields,stageId]);
  const requesterSystem=(data?.systemFields||[]).filter((x:any)=>x.scope==='requester').sort((a:any,b:any)=>a.sort_order-b.sort_order);
  const targetSystem=(data?.systemFields||[]).filter((x:any)=>x.scope==='target').sort((a:any,b:any)=>a.sort_order-b.sort_order);
  const currentResolution=current?resolveTransition(stages,w.transitions||[],current.id,values,fields):null;
  const currentActionLabel=({next:'تمرير المعاملة',return:'إرجاع المعاملة',reject:'رفض المعاملة',cancel:'إلغاء المعاملة',complete:'إكمال المعاملة'} as Record<string,string>)[String((currentResolution as any)?.route?.action||'next')]||'تنفيذ الإجراء';

  function setVal(key:string,value:any){setValues(v=>({...v,[key]:value}));setErrors(e=>{const n={...e};delete n[key];return n;});}
  function control(f:any){
    const v=values[f.field_key]??'';
    if(f.config?.displayOnly)return <div className="sim-static-block"><strong>{f.label_ar}</strong><p>{f.config?.staticText||'نص للعرض فقط'}</p></div>;
    if(f.field_type==='textarea')return <textarea rows={4} value={v} onChange={e=>setVal(f.field_key,e.target.value)} />;
    if(f.field_type==='boolean')return <select value={v} onChange={e=>setVal(f.field_key,e.target.value)}><option value="">اختر</option><option value="نعم">نعم</option><option value="لا">لا</option></select>;
    if(f.field_type==='select')return <select value={v} onChange={e=>setVal(f.field_key,e.target.value)}><option value="">اختر</option>{(f.options||[]).map((x:any)=><option key={x} value={x}>{x}</option>)}</select>;
    if(f.field_type==='multiselect')return <select multiple value={Array.isArray(v)?v:[]} onChange={e=>setVal(f.field_key,Array.from(e.target.selectedOptions).map(o=>o.value))}>{(f.options||[]).map((x:any)=><option key={x} value={x}>{x}</option>)}</select>;
    if(f.field_type==='employee')return <select value={v} onChange={e=>setVal(f.field_key,e.target.value)}><option value="">اختر موظفًا من بيئة الاختبار</option>{simulatedEmployees.map(e=><option key={e.id} value={e.id}>{e.employeeNumber} — {e.label}</option>)}</select>;
    if(f.field_type==='organization_unit')return <select value={v} onChange={e=>setVal(f.field_key,e.target.value)}><option value="">اختر وحدة</option><option value="sim-hq">الإدارة الرئيسية — محاكاة</option><option value="sim-hr">الموارد البشرية — محاكاة</option></select>;
    if(f.field_type==='position')return <select value={v} onChange={e=>setVal(f.field_key,e.target.value)}><option value="">اختر منصبًا</option><option value="sim-pos-1">أخصائي موارد بشرية — محاكاة</option><option value="sim-pos-2">مدير إدارة — محاكاة</option></select>;
    if(f.field_type==='user')return <select value={v} onChange={e=>setVal(f.field_key,e.target.value)}><option value="">اختر مستخدمًا</option><option value="sim-user-super">مدير النظام — Super Admin</option></select>;
    const inputType=f.field_type==='number'?'number':f.field_type==='date'?'date':f.field_type==='datetime'?'datetime-local':'text';
    return <input type={inputType} value={v} onChange={e=>setVal(f.field_key,e.target.value)} />;
  }
  function validate(list:any[],target=false){
    const e:Record<string,string>={};for(const f of list){if(f.config?.displayOnly)continue;if(f.required&&empty(values[f.field_key]))e[f.field_key]='هذا الحقل مطلوب.';}
    if(target&&w?.requestSettings?.targetEmployeeRequired&&!targetEmployee)e.__targetEmployee='اختيار الموظف المعني مطلوب.';
    setErrors(e);return !Object.keys(e).length;
  }
  function start(){if(!validate(requestFields,true))return;setStageId(stages[0]?.id||'');setHistory([{kind:'request',title:'أساس المعاملة',action:'بدء الاختبار'}]);}
  function requestDelegation(){ if(!current)return; setShowDelegationPicker(true); }
  function confirmDelegation(){
    if(!current||!targetEmployee)return;
    const emp=simulatedEmployees.find(e=>e.id===targetEmployee)||simulatedEmployees[0];
    setDelegation({stageId:current.id,employeeId:emp.id,employeeLabel:`${emp.employeeNumber} — ${emp.label}`});
    setShowDelegationPicker(false);setHistory(h=>[...h,{kind:'delegation',title:current.name_ar,action:`تمرير اختياري إلى ${emp.employeeNumber}` }]);
  }
  function finishDelegation(){if(!delegation)return;setHistory(h=>[...h,{kind:'delegation_return',title:delegation.employeeLabel,action:`اكتملت المهمة وعادت إلى ${current?.name_ar}` }]);setDelegation(null);}
  function pass(){
    if(!current||!validate(currentFields))return;
    const result=resolveTransition(stages,w.transitions||[],current.id,values,fields) as any;const route=result.route;
    setHistory(h=>[...h,{kind:'stage',title:current.name_ar,action:route?.label_ar||'تمرير المعاملة',decision:result.decision}]);
    if(route?.action==='reject'){setDone('مرفوضة');return;}if(route?.action==='cancel'){setDone('ملغية');return;}if(route?.action==='complete'){setDone('مكتملة');return;}
    if(route?.action==='return'){setStageId(route.to_stage_id||stages[0]?.id);return;}
    if(route?.to_stage_id){setStageId(route.to_stage_id);return;}
    setDone('مكتملة');
  }
  function reset(){setValues({});setHistory([]);setDone(null);setStageId(stages[0]?.id||'');setErrors({});setError('');setTargetEmployee('');setDelegation(null);setShowDelegationPicker(false);}

  if(!typeId)return <div className="workflow-test premium-studio wow-studio"><section className="wf-hero compact"><div className="wf-hero-copy"><div className="wf-kicker">ISOLATED TEST ENVIRONMENT</div><div className="wf-hero-title-row"><span className="wf-hero-symbol"><Play size={26}/></span><div><h1>اختبار A–Z</h1><p>محاكاة كاملة للقالب دون إنشاء معاملات أو موظفين أو مستخدمين في D1.</p></div></div></div></section><section className="wf-card wf-section-card"><div className="wf-section-title"><div className="wf-title-number">01</div><div className="wf-title-copy"><span className="wf-kicker soft">TEMPLATES</span><h2>اختر قالبًا للاختبار</h2><p>في بيئة الاختبار، كل المراحل تُنفذ بواسطة <strong>مدير النظام — Super Admin</strong>.</p></div></div><div className="test-template-list">{templates.map(t=><Link key={t.id} className="test-template-card" to={`/workflow-studio/test/${t.id}${t.workflow_id?`?workflowId=${encodeURIComponent(t.workflow_id)}`:''}`}><span className="test-template-icon"><Play size={15}/></span><div><strong>{t.name_ar}</strong><small>{t.workflow_id?'مسودة جاهزة للاختبار':'لا توجد مسودة'}</small></div><ArrowLeft size={14}/></Link>)}{!templates.length&&!busy&&<div className="field-editor-empty">لا توجد قوالب للاختبار بعد.</div>}</div></section></div>;
  if(busy&&!data)return <div className="premium-studio"><div className="test-state panel">جارٍ تجهيز بيئة الاختبار...</div></div>;
  if(!data)return <div className="premium-studio"><div className="test-state panel">{error||'تعذر تحميل الاختبار.'}</div></div>;

  return <div className="workflow-test premium-studio wow-studio">
    <section className="wf-hero compact"><div className="wf-hero-copy"><div className="wf-crumb"><Link to="/workflow-studio">استوديو سير العمل</Link><ArrowLeft size={13}/><span>اختبار A–Z</span></div><div className="wf-hero-title-row"><span className="wf-hero-symbol"><Play size={27}/></span><div><div className="wf-kicker">ISOLATED TEST ENVIRONMENT</div><h1>{data.type.name_ar}</h1><p>المعاملات في الاختبار غير حقيقية، وكل خطوة تُنفذ تحت هوية <strong>مدير النظام — Super Admin</strong> فقط.</p></div></div></div><div className="wf-hero-actions"><span className="wf-status active"><span/>اختبار معزول</span><span className="wf-ghost"><ShieldCheck size={15}/>منفذ الاختبار: Super Admin</span><Link className="wf-ghost" to={`/workflow-studio/${data.type.id}`}><ArrowLeft size={15}/>المصمم</Link><button className="wf-ghost" onClick={reset}><RotateCcw size={15}/>إعادة الاختبار</button></div></section>
    {error&&<div className="wf-alert-v2 danger"><CircleAlert size={18}/><span>{error}</span><button onClick={()=>setError('')}><X size={15}/></button></div>}
    <section className="wf-card test-assignment-banner"><div><span className="wf-kicker soft">TEST ASSIGNMENT</span><h3>كل مراحل هذا الاختبار مسندة إلى مدير النظام — Super Admin</h3><p>نحاكي المسؤوليات الفعلية فقط لتشغيل A–Z بسهولة. لا يتم تغيير مسؤوليات القالب ولا يتم إنشاء تعيينات حقيقية.</p></div><span className="wf-status-pill active"><span/>لا كتابة إلى D1</span></section>
    <div className="test-flow-rail panel"><div className="test-flow-base"><div className="test-flow-step fixed"><b><UserRound size={12}/></b><strong>بيانات مقدم الطلب</strong><small>{requesterSystem.length} بيانات</small></div><div className="test-flow-step fixed"><b>02</b><strong>بيانات الطلب</strong><small>{requestFields.length} عناصر</small></div>{stages.map((s:any,i:number)=><div key={s.id} className={`test-flow-step ${current?.id===s.id?'current':history.some(h=>h.title===s.name_ar)?'done':'pending'}`}><b>{String(i+1).padStart(2,'0')}</b><strong>{s.name_ar}</strong><small>{i===stages.length-1?'اكتمال بعد النجاح':'مرحلة فعلية'}</small></div>)}</div></div>
    {!done&&<>
      <section className="wf-card wf-section-card test-request-card"><div className="wf-section-title"><div className="wf-title-number">01</div><div className="wf-title-copy"><span className="wf-kicker soft">SYSTEM DATA</span><h2>بيانات مقدم الطلب</h2><p>قيم محاكاة للعرض فقط؛ في التشغيل الحقيقي تُجلب من سجل Phase 5 للمستخدم المسجل.</p></div><span className="wf-status-pill active"><span/>قراءة فقط</span></div><div className="requester-system-row">{requesterSystem.length?requesterSystem.map((x:any)=><div key={x.id||x.source_key}><span>{x.label_ar}</span><strong>{simulatedValue(x.source_key)}</strong></div>):<div className="field-editor-empty">لم يختر المصمم بيانات نظامية.</div>}</div>{w.requestSettings?.targetEmployeeEnabled&&<div className="target-preview"><div><UsersRound size={16}/><strong>الموظف المعني</strong></div><div className="target-preview-controls"><span>{targetSystem.length} بيانات · {w.requestSettings.targetEmployeeRequired?'مطلوب':'اختياري'}</span><select value={targetEmployee} onChange={e=>setTargetEmployee(e.target.value)}><option value="">اختر موظفًا في بيئة الاختبار</option>{simulatedEmployees.map(e=><option key={e.id} value={e.id}>{e.employeeNumber} — {e.label}</option>)}</select>{errors.__targetEmployee&&<small className="sim-field-error">{errors.__targetEmployee}</small>}</div></div>}</section>
      <section className="wf-card wf-section-card test-stage-card"><div className="wf-section-title"><div className="wf-title-number">02</div><div className="wf-title-copy"><span className="wf-kicker soft">REQUEST DATA</span><h2>أسئلة / بيانات الطلب</h2><p>يظهر هنا فقط ما صممه المسؤول. النصوص للعرض فقط، والحقول القابلة للإجابة يمكن أن تدخل في الشروط.</p></div></div>{history.length===0?<div className="stage-question-list">{requestFields.length?requestFields.map((f:any)=><TestField key={f.id} f={f} value={values[f.field_key]} error={errors[f.field_key]} control={control(f)}/>):<div className="field-editor-empty">لا توجد أسئلة في أساس المعاملة.</div>}</div>:<div className="stage-locked-preview">تم بدء الاختبار وانتقلت المحاكاة إلى <strong>{current?.name_ar}</strong>.</div>}{history.length===0&&<div className="stage-pass-row"><span>سيحمل المحرك القيم إلى المراحل التالية ويفحص الشروط تلقائيًا.</span><button className="wf-primary-action" onClick={start}><Play size={15}/>بدء المسار</button></div>}</section>
      {current&&history.length>0&&!delegation&&<section className="wf-card wf-section-card test-stage-card is-current"><div className="test-stage-heading"><div><div className="wf-kicker soft">CURRENT STAGE</div><h2>{current.name_ar}</h2><p><ShieldCheck size={13}/> تنفيذ الاختبار: <strong>مدير النظام — Super Admin</strong></p></div>{current.duration_minutes&&<span className="stage-duration">{current.duration_minutes} دقيقة</span>}</div><div className="stage-question-list">{currentFields.length?currentFields.map((f:any)=><TestField key={f.id} f={f} value={values[f.field_key]} error={errors[f.field_key]} control={control(f)}/>):<div className="field-editor-empty">لا توجد عناصر في هذه المرحلة.</div>}</div><div className="stage-pass-row"><span>المسار الافتراضي أو الشرطي سيحدده المحرك بناءً على قيم الاختبار.</span><div className="wf-title-actions">{current.config?.delegate?.enabled&&<button className="wf-secondary-action" onClick={requestDelegation}><UsersRound size={15}/>تمرير لموظف آخر <em>اختياري</em></button>}<button className="wf-primary-action" onClick={pass}><CheckCircle2 size={15}/>{currentActionLabel}</button></div></div></section>}
      {delegation&&<section className="wf-card wf-section-card test-delegation-card"><div className="wf-section-title"><div className="wf-title-number">↗</div><div className="wf-title-copy"><span className="wf-kicker soft">OPTIONAL DELEGATION</span><h2>مهمة فرعية لدى {delegation.employeeLabel}</h2><p>هذه مهمة محاكاة فقط. عند إكمال الموظف للمهمة، يعود التنفيذ تلقائيًا إلى <strong>{current?.name_ar}</strong>.</p></div><span className="wf-status-pill active"><span/>اختياري</span></div><div className="delegation-return-banner"><UsersRound size={19}/><div><strong>التنفيذ الآن لدى الموظف المختار</strong><span>لن يتم تغيير المرحلة الأصلية.</span></div><button className="wf-primary-action" onClick={finishDelegation}><CheckCircle2 size={15}/>إكمال المهمة والعودة</button></div></section>}
    </>}
    {done&&<section className="wf-card wf-test-result"><span className="finished-icon"><CheckCircle2 size={30}/></span><div><div className="wf-kicker soft">TEST RESULT</div><h2>{done}</h2><p>اكتملت محاكاة A–Z. لم تُنشأ معاملة حقيقية ولم تُكتب بيانات إلى D1.</p></div><button className="wf-secondary-action" onClick={reset}><RotateCcw size={15}/>إعادة الاختبار</button></section>}
    <section className="wf-card test-history"><div className="wf-section-title"><div className="wf-title-number">03</div><div className="wf-title-copy"><span className="wf-kicker soft">TRACE</span><h2>سجل المحاكاة</h2><p>ترتيب التنفيذ الفعلي داخل الاختبار.</p></div></div>{history.length?<div className="history-flow">{history.map((h,i)=><div className="history-stage" key={i}><span className="history-marker">{i+1}</span><div className="history-card"><div className="history-card-head"><strong>{h.title}</strong><span>{h.action}</span></div>{h.decision&&<small>نوع الانتقال: {h.decision}</small>}</div></div>)}</div>:<div className="history-empty">سيظهر المسار بعد بدء الاختبار.</div>}</section>
    {showDelegationPicker&&current&&<div className="wf-picker-backdrop" onMouseDown={e=>e.currentTarget===e.target&&setShowDelegationPicker(false)}><aside className="wf-picker small"><div className="wf-picker-head"><div><span className="wf-kicker soft">OPTIONAL ACTION</span><h2>تمرير لموظف آخر</h2><p>هذا الاختيار اختياري؛ يمكنك إلغاءه والاستمرار في المرحلة.</p></div><button className="wf-icon-action" onClick={()=>setShowDelegationPicker(false)}><X size={18}/></button></div><div className="wf-picker-body"><label className="wf-input-group"><span>الموظف المستلم</span><select value={targetEmployee} onChange={e=>setTargetEmployee(e.target.value)}><option value="">اختر موظفًا</option>{simulatedEmployees.map(e=><option key={e.id} value={e.id}>{e.employeeNumber} — {e.label}</option>)}</select></label><div className="wf-picker-intro"><ShieldCheck size={15}/><span>في الاختبار لا يتم إنشاء حساب أو تعيين فعلي؛ هذه محاكاة لانتقال المهمة فقط.</span></div></div><div className="wf-picker-footer"><button className="wf-secondary-action" onClick={()=>setShowDelegationPicker(false)}>إلغاء</button><button className="wf-primary-action" disabled={!targetEmployee} onClick={confirmDelegation}>تمرير المهمة</button></div></aside></div>}
  </div>;
}
function TestField({f,error,control}:{f:any;value:any;error?:string;control:any}){return <label className={`sim-field ${error?'has-error':''}`}><span>{f.config?.displayOnly?<>{f.label_ar} · عرض فقط</>:<>{f.label_ar}{f.required?' *':''}</>}</span>{control}{error&&<small className="sim-field-error">{error}</small>}</label>;}