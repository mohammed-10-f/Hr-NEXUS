import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronLeft, Clock3, PlayCircle, RotateCcw, ShieldCheck } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';

type WorkflowData={workflow:any;stages:any[];fields:any[];questions:any[];transitions:any[]};
type TestRun={id:string;typeId:string;typeName:string;status:string;stageName:string;createdAt:string;updatedAt:string};
const RUNS_KEY='hr_nexus_workflow_test_runs_v1';
function readRuns():TestRun[]{try{return JSON.parse(localStorage.getItem(RUNS_KEY)||'[]')}catch{return []}}
function writeRuns(items:TestRun[]){localStorage.setItem(RUNS_KEY,JSON.stringify(items));}
function updateRun(id:string,patch:Partial<TestRun>){const items=readRuns().map(x=>x.id===id?{...x,...patch,updatedAt:new Date().toISOString()}:x);writeRuns(items);}
const parse=(v:any,d:any)=>{try{return typeof v==='string'?(v?JSON.parse(v):d):v??d}catch{return d}};
function matches(c:any,data:any,answers:any){if(!c)return true;const source=String(c.source||'');const actual=source.startsWith('question.')?answers[source.slice(9)]:source.startsWith('field.')?data[source.slice(6)]:undefined;let expected=c.value;if(expected==='true')expected=true;else if(expected==='false')expected=false;switch(c.operator){case 'not_equals':return actual!==expected;case 'contains':return String(actual??'').includes(String(expected??''));case 'is_true':return actual===true||actual==='true';case 'is_false':return actual===false||actual==='false';case 'in':return Array.isArray(expected)&&expected.some((x:any)=>JSON.stringify(x)===JSON.stringify(actual));default:return JSON.stringify(actual)===JSON.stringify(expected)}}

function FieldInput({field,value,onChange}:{field:any;value:any;onChange:(value:any)=>void}){
 const options=Array.isArray(field.options)?field.options:[];
 if(field.field_type==='textarea')return <textarea rows={4} value={value??''} onChange={e=>onChange(e.target.value)}/>;
 if(field.field_type==='boolean')return <select value={value===undefined?'':String(value)} onChange={e=>onChange(e.target.value===''?undefined:e.target.value==='true')}><option value="">اختر...</option><option value="true">نعم</option><option value="false">لا</option></select>;
 if(field.field_type==='select')return <select value={value??''} onChange={e=>onChange(e.target.value)}><option value="">اختر...</option>{options.map((o:any,i:number)=><option key={i} value={String(o?.value??o)}>{String(o?.label_ar??o?.label??o?.value??o)}</option>)}</select>;
 if(field.field_type==='multiselect')return <select multiple value={Array.isArray(value)?value.map(String):[]} onChange={e=>onChange(Array.from(e.target.selectedOptions).map(x=>x.value))}>{options.map((o:any,i:number)=><option key={i} value={String(o?.value??o)}>{String(o?.label_ar??o?.label??o?.value??o)}</option>)}</select>;
 return <input type={field.field_type==='number'?'number':field.field_type==='date'?'date':field.field_type==='datetime'?'datetime-local':'text'} value={value??''} onChange={e=>onChange(field.field_type==='number'?(e.target.value===''?'':Number(e.target.value)):e.target.value)}/>;
}

export function WorkflowTestEnvironment(){
 const {typeId=''}=useParams();
 const [params]=useSearchParams();
 const runId=params.get('run')||'';
 const [type,setType]=useState<any>(null),[data,setData]=useState<WorkflowData|null>(null),[stageId,setStageId]=useState(''),[requesterData,setRequesterData]=useState<Record<string,any>>({}),[answers,setAnswers]=useState<Record<string,any>>({}),[history,setHistory]=useState<any[]>([]),[status,setStatus]=useState('قيد الإجراء'),[submitted,setSubmitted]=useState(false),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function load(){setLoading(true);setError('');try{
   const meta=await api<any>(`/api/workflows/admin/types/${typeId}`);setType(meta.type);
   const active=meta.workflow?.find((x:any)=>x.status==='active')||meta.workflow?.[0];
   if(!active){setData(null);setError('لا توجد نسخة Workflow لهذا النوع. أنشئ المسار من الاستوديو أولًا.');return;}
   const d=await api<any>(`/api/workflows/admin/workflows/${active.id}`);
   const normalized={workflow:d.workflow,stages:(d.stages||[]).map((x:any)=>({...x,config:parse(x.config_json,x.config||{})})),fields:(d.fields||[]).map((x:any)=>({...x,options:parse(x.options_json,x.options||[])})),questions:(d.questions||[]).map((x:any)=>({...x,options:parse(x.options_json,x.options||[])})),transitions:(d.transitions||[]).map((x:any)=>({...x,condition:parse(x.condition_json,x.condition||null)}))};
   setData(normalized);
   const first=normalized.stages.slice().sort((a:any,b:any)=>a.stage_order-b.stage_order)[0];
   setStageId(first?.id||'');setRequesterData({});setAnswers({});setStatus('قيد الإجراء');setSubmitted(false);
   setHistory(first?[{stageId:first.id,name:first.name_ar,at:new Date().toLocaleString('ar-SA'),status:'بانتظار التقديم'}]:[]);
   if(runId){const existing=readRuns().find(x=>x.id===runId);if(existing)updateRun(runId,{typeName:meta.type.name_ar,status:'مسودة',stageName:'بيانات مقدم الطلب'});}
 }catch{setError('تعذر تحميل نسخة Workflow للاختبار.')}finally{setLoading(false)}}
 useEffect(()=>{if(typeId)void load()},[typeId,runId]);
 const stages=useMemo(()=>data?.stages?.slice().sort((a:any,b:any)=>a.stage_order-b.stage_order)||[],[data]);
 const stage=stages.find(x=>x.id===stageId)||stages[0];
 const requesterFields=useMemo(()=>data?.fields.filter(x=>!x.stage_id)||[],[data]);
 const stageFields=useMemo(()=>data?.fields.filter(x=>x.stage_id===stage?.id)||[],[data,stage]);
 const stageQuestions=useMemo(()=>data?.questions.filter(x=>x.stage_id===stage?.id)||[],[data,stage]);
 const outgoing=data?.transitions.filter(x=>x.from_stage_id===stage?.id&&x.active).sort((a:any,b:any)=>a.sort_order-b.sort_order)||[];
 function reset(){setStageId(stages[0]?.id||'');setRequesterData({});setAnswers({});setStatus('قيد الإجراء');setSubmitted(false);setError('');setHistory(stages[0]?[{stageId:stages[0].id,name:stages[0].name_ar,at:new Date().toLocaleString('ar-SA'),status:'بانتظار التقديم'}]:[]);if(runId)updateRun(runId,{status:'مسودة',stageName:'بيانات مقدم الطلب'});}
 function submitRequester(){if(busy||submitted)return;setError('');for(const f of requesterFields){if(f.required&&(requesterData[f.field_key]===undefined||requesterData[f.field_key]===null||requesterData[f.field_key]==='')){setError(`أكمل الحقل المطلوب: ${f.label_ar}`);return;}}
   setSubmitted(true);setHistory(h=>h.map((x:any)=>({...x,status:'تم التقديم'})));if(runId)updateRun(runId,{status:'قيد الاختبار',stageName:stage?.name_ar||'المرحلة الأولى'});
 }
 function pass(){if(!stage||busy||status!=='قيد الإجراء'||!submitted)return;setError('');for(const f of stageFields){if(f.required&&(answers[f.field_key]===undefined||answers[f.field_key]===null||answers[f.field_key]==='')){setError(`أكمل الحقل المطلوب: ${f.label_ar}`);return}}for(const q of stageQuestions){if(q.required&&(answers[q.question_key]===undefined||answers[q.question_key]===null||answers[q.question_key]==='')){setError(`أكمل السؤال المطلوب: ${q.question_ar}`);return}}
   setBusy(true);const candidate=outgoing.find((t:any)=>t.action==='next'&&matches(t.condition,{...requesterData,...answers},answers));const terminal=outgoing.find((t:any)=>['complete','reject','cancel'].includes(t.action));
   setTimeout(()=>{if(candidate?.to_stage_id){const next=stages.find(x=>x.id===candidate.to_stage_id);if(!next){setError('المسار يشير إلى مرحلة غير موجودة.');setBusy(false);return;}setStageId(next.id);setHistory(h=>[...h,{stageId:next.id,name:next.name_ar,at:new Date().toLocaleString('ar-SA'),status:'نشطة',from:stage.name_ar}]);setAnswers({});if(runId)updateRun(runId,{status:'قيد الاختبار',stageName:next.name_ar});}else if(terminal){const label=terminal.action==='complete'?'مكتملة':terminal.action==='reject'?'مرفوضة':'ملغية';setStatus(label);setHistory(h=>[...h,{stageId:stage.id,name:stage.name_ar,at:new Date().toLocaleString('ar-SA'),status:label}]);if(runId)updateRun(runId,{status:label,stageName:stage.name_ar});}else setError('لا يوجد مسار صالح لهذه الإجابات. راجع شروط المرحلة في الاستوديو.');setBusy(false)},250);
 }
 if(loading)return <div className="panel-empty">جاري تحميل الاختبار...</div>;
 return <div className="workflow-builder-page">
  <div className="page-header"><div><div className="eyebrow">إدارة المنصة · بيئة الاختبار · {type?.name_ar||'معاملة'}</div><h1>اختبار المعاملة</h1><p>تبدأ المعاملة ببيانات مقدم الطلب، ثم تدخل بعدها في مراحل المسؤولين. الاختبار لا ينشئ معاملة حقيقية.</p></div><div className="header-actions"><Link className="btn secondary" to="/platform/workflows/test"><ChevronLeft size={16}/>العودة للمعاملات الاختبارية</Link><button className="btn secondary" onClick={reset}><RotateCcw size={16}/>إعادة إلى البداية</button></div></div>
  {error&&<div className="login-error page-error">{error}</div>}
  <section className="panel workflow-hero"><div><span className="workflow-kicker">#{runId?runId.slice(0,8).toUpperCase():'اختبار'}</span><h2>{type?.name_ar||'نوع المعاملة'}</h2><p>بيانات مقدم الطلب جزء ثابت من المعاملة، ولا تُعامل كمرحلة من مراحل سير العمل.</p></div><div className="workflow-health"><div><strong>{stages.length}</strong><span>مراحل</span></div><div><strong>{history.filter((x:any)=>x.status==='تم التقديم'||x.status==='نشطة'||['مكتملة','مرفوضة','ملغية'].includes(x.status)).length}</strong><span>خطوات منفذة</span></div><div><strong>{submitted?'✓':'1'}</strong><span>{submitted?(status==='قيد الإجراء'?'قيد المعالجة':status):'قبل التقديم'}</span></div></div></section>
  {!data?<div className="panel-empty">{error||'لا يوجد Workflow منشور لهذا النوع.'}</div>:<>
   <section className="panel requester-foundation-panel">
    <div className="panel-head"><div><span className="section-eyebrow">الجزء الأساسي</span><h3>بيانات مقدم الطلب</h3><p>هذه البيانات تُجمع مرة واحدة عند تقديم المعاملة، وتسبق جميع المراحل ولا تنتمي إلى أي مرحلة.</p></div><ShieldCheck size={19}/></div>
    {requesterFields.length===0?<div className="empty-soft">لا توجد عناصر إضافية لمقدم الطلب. يمكن تقديم المعاملة مباشرة إلى المرحلة الأولى.</div>:<div className="form-grid">{requesterFields.map((f:any)=><label className="form-field" key={f.id}><span>{f.label_ar}{f.required?' *':''}</span><FieldInput field={f} value={requesterData[f.field_key]} onChange={value=>setRequesterData(v=>({...v,[f.field_key]:value}))}/></label>)}</div>}
    {!submitted&&<div className="pass-action requester-submit-action"><div><strong>جاهز لتقديم الطلب؟</strong><span>بعد التقديم تبدأ المرحلة الأولى والمسؤول المحدد لها.</span></div><button className="btn primary pass-button" disabled={busy} onClick={submitRequester}>تقديم المعاملة للاختبار</button></div>}
    {submitted&&<div className="completed-state requester-submitted-state"><CheckCircle2 size={21}/><div><strong>تم تقديم المعاملة</strong><span>بيانات مقدم الطلب أصبحت ثابتة، والآن يبدأ تنفيذ مراحل المسؤولين.</span></div></div>}
   </section>
   <div className="workflow-studio-grid">
    <aside className="workflow-sidebar panel"><div className="panel-head"><div><h3>مراحل سير العمل</h3><p>{submitted?'المرحلة الحالية مظللة.':'تظهر المراحل بعد تقديم الطلب.'}</p></div><PlayCircle size={18}/></div>{stages.map((s:any,i:number)=><button key={s.id} disabled={!submitted||status!=='قيد الإجراء'||stage?.id!==s.id} className={`workflow-stage-nav ${stage?.id===s.id&&submitted?'active':''}`} onClick={()=>setStageId(s.id)}><span className="stage-number">{i+1}</span><span><strong>{s.name_ar}</strong><small>{s.responsible_type||'—'}</small></span><ChevronLeft size={15}/></button>)}</aside>
    <main className="workflow-main"><section className="panel stage-focus-card"><div className="stage-focus-head"><div><span className="stage-index">المرحلة {stage?.stage_order}</span><h3>{stage?.name_ar}</h3><p>المسؤول: {stage?.responsible_type||'غير محدد'} · المدة: {stage?.duration_minutes?`${stage.duration_minutes} دقيقة`:'غير محددة'}</p></div><div className="stage-tools"><span className={`badge ${status==='قيد الإجراء'?'warning':status==='مكتملة'?'success':status==='مرفوضة'?'danger':'neutral'}`}>{submitted?status:'بانتظار تقديم الطلب'}</span></div></div>
      {!submitted?<div className="empty-soft stage-locked-state">أكمل قسم «بيانات مقدم الطلب» أعلاه. لن تظهر حقول المرحلة الأولى لمقدم الطلب قبل التقديم.</div>:<>
       {stageFields.length>0&&<div className="transaction-form-block"><div className="block-label">بيانات هذه المرحلة</div>{stageFields.map((f:any)=><label className="form-field" key={f.id}><span>{f.label_ar}{f.required?' *':''}</span><FieldInput field={f} value={answers[f.field_key]} onChange={value=>setAnswers(v=>({...v,[f.field_key]:value}))}/></label>)}</div>}
       {stageQuestions.length>0&&<div className="transaction-form-block"><div className="block-label">الأسئلة والقرار</div>{stageQuestions.map((q:any)=><div className="decision-question" key={q.id}><span>{q.question_ar}{q.required?' *':''}</span>{q.question_type==='yes_no'?<div className="segmented"><button type="button" className={answers[q.question_key]===true?'selected':''} onClick={()=>setAnswers(v=>({...v,[q.question_key]:true}))}>نعم</button><button type="button" className={answers[q.question_key]===false?'selected':''} onClick={()=>setAnswers(v=>({...v,[q.question_key]:false}))}>لا</button></div>:q.question_type==='select'?<select value={answers[q.question_key]??''} onChange={e=>setAnswers(v=>({...v,[q.question_key]:e.target.value}))}><option value="">اختر...</option>{(q.options||[]).map((o:any,i:number)=><option key={i} value={String(o?.value??o)}>{String(o?.label_ar??o?.label??o?.value??o)}</option>)}</select>:<textarea value={answers[q.question_key]??''} onChange={e=>setAnswers(v=>({...v,[q.question_key]:e.target.value}))}/>}</div>)}</div>}
       <div className="pass-action"><div><strong>الإجراء التالي</strong><span>المحرك يحدد الوجهة تلقائيًا وفق الإجابات والشروط.</span></div><button className="btn primary pass-button" disabled={busy||status!=='قيد الإجراء'} onClick={pass}>{busy?'جارٍ التحقق...':status==='قيد الإجراء'?'تمرير المعاملة':status}</button></div>
      </>}
    </section></main>
    <aside className="workflow-quality panel"><div className="panel-head"><div><h3>سجل الاختبار</h3><p>حالة محلية للاختبار فقط.</p></div><Clock3 size={19}/></div>{history.map((h,i)=><div className={`journey-item ${h.status==='نشطة'?'active':''}`} key={`${h.stageId}-${i}`}><div className="journey-line"><span className="journey-dot"></span>{i<history.length-1&&<i/>}</div><div className="journey-content"><div><strong>{h.name}</strong><span className="journey-status">{h.status}</span></div><p>{h.from?`انتقلت من ${h.from}`:'بيانات مقدم الطلب'}</p><small>{h.at}</small></div></div>)}{status!=='قيد الإجراء'&&<div className="completed-state"><CheckCircle2 size={19}/><div><strong>انتهى الاختبار</strong><span>النتيجة: {status}</span></div></div>}<div className="quality-tip"><strong>حماية البيانات</strong><span>لا يتم إنشاء مستخدمين أو موظفين أو معاملات حقيقية من هذه البيئة.</span></div></aside>
   </div>
  </>}
 </div>
}
