import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, CircleAlert, Play, RotateCcw, ShieldCheck } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';

function empty(v:any){return v===undefined||v===null||v===''||(Array.isArray(v)&&v.length===0);}
function match(route:any,values:any,fields:any[]){
 if(!route.condition)return true;
 const f=fields.find((x:any)=>x.id===route.condition.fieldId);const actual=values[f?.fieldKey];
 return (route.condition.values||[]).some((expected:any)=>{
  if(f?.fieldType==='boolean')return String(actual)===String(expected);
  if(f?.fieldType==='multiselect')return Array.isArray(actual)&&actual.map(String).includes(String(expected));
  return String(actual??'')===String(expected);
 });
}
export function WorkflowTestEnvironment(){
 const {typeId}=useParams<{typeId?:string}>();
 const [templates,setTemplates]=useState<any[]>([]),[data,setData]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [values,setValues]=useState<Record<string,any>>({}),[stageId,setStageId]=useState(''),[history,setHistory]=useState<any[]>([]),[done,setDone]=useState<string|null>(null),[fieldErrors,setFieldErrors]=useState<Record<string,string>>({});
 useEffect(()=>{api<any>('/api/workflows/test/templates').then(r=>setTemplates(r.items||[])).catch(e=>setError(e.message||'تعذر التحميل.'));},[]);
 useEffect(()=>{if(typeId)load(typeId);},[typeId]);
 async function load(id:string){setBusy(true);setError('');try{const r=await api<any>(`/api/workflows/test/templates/${id}`);setData(r);setStageId(r.workflow.stages[0]?.id||'');setValues({});setHistory([]);setDone(null);setFieldErrors({});}catch(e:any){setError(e.message||'تعذر فتح الاختبار.');}finally{setBusy(false);}}
 const w=data?.workflow;const stages=w?.stages||[];const fields=w?.fields||[];const current=stages.find((s:any)=>s.id===stageId);const currentFields=useMemo(()=>fields.filter((f:any)=>f.stage_id===stageId).sort((a:any,b:any)=>a.sort_order-b.sort_order),[fields,stageId]);const requestFields=useMemo(()=>fields.filter((f:any)=>!f.stage_id).sort((a:any,b:any)=>a.sort_order-b.sort_order),[fields]);
 function control(f:any){
  const v=values[f.field_key]??'';
  if(f.field_type==='textarea')return <textarea rows={4} value={v} readOnly={Boolean(f.config?.displayOnly)} onChange={e=>setValues({...values,[f.field_key]:e.target.value})}/>;
  if(f.field_type==='boolean')return <select value={v} onChange={e=>setValues({...values,[f.field_key]:e.target.value})}><option value="">اختر</option><option value="نعم">نعم</option><option value="لا">لا</option></select>;
  if(f.field_type==='select')return <select value={v} onChange={e=>setValues({...values,[f.field_key]:e.target.value})}><option value="">اختر</option>{(f.options||[]).map((x:any)=><option key={x}>{x}</option>)}</select>;
  if(f.field_type==='multiselect')return <select multiple value={Array.isArray(v)?v:[]} onChange={e=>setValues({...values,[f.field_key]:Array.from(e.target.selectedOptions).map((x:any)=>x.value)})}>{(f.options||[]).map((x:any)=><option key={x}>{x}</option>)}</select>;
  const type=f.field_type==='number'?'number':f.field_type==='date'?'date':f.field_type==='datetime'?'datetime-local':'text';
  return <input type={type} value={v} readOnly={Boolean(f.config?.displayOnly)} onChange={e=>setValues({...values,[f.field_key]:e.target.value})}/>;
 }
 function validate(list:any[]){const errs:any={};for(const f of list)if(f.required&&!f.config?.displayOnly&&empty(values[f.field_key]))errs[f.field_key]='هذا الحقل مطلوب.';setFieldErrors(errs);return Object.keys(errs).length===0;}
 function start(){if(!validate(requestFields))return;setStageId(stages[0]?.id||'');setHistory([{kind:'request',title:'بيانات الطلب',values:{...values}}]);}
 function pass(){
  if(!current||!validate(currentFields))return;
  const outgoing=(w.transitions||[]).filter((r:any)=>r.from_stage_id===current.id).sort((a:any,b:any)=>a.sort_order-b.sort_order);
  const route=outgoing.find((r:any)=>r.condition&&match(r,values,fields))||outgoing.find((r:any)=>!r.condition);
  const next=route?.to_stage_id?stages.find((s:any)=>s.id===route.to_stage_id):null;
  setHistory(h=>[...h,{kind:'stage',title:current.name_ar,action:route?.action||'تمرير المعاملة',values:{...values}}]);
  if(route?.action==='reject'){setDone('مرفوضة');return;}
  if(route?.action==='cancel'){setDone('ملغية');return;}
  if(route?.action==='return'){setStageId(route.to_stage_id||stages[0]?.id);return;}
  if(next){setStageId(next.id);return;}
  if(stages[stages.length-1]?.id===current.id){setDone('مكتملة');return;}
  setError('لم يوجد مسار صالح. أصلح ذلك في فحص الاستوديو.');
 }
 function reset(){setValues({});setHistory([]);setDone(null);setStageId(stages[0]?.id||'');setFieldErrors({});setError('');}
 if(!typeId)return <div><div className="page-header"><div><div className="eyebrow">استوديو سير العمل</div><h1>بيئة الاختبار</h1><p>محاكاة معزولة لسلوك القالب دون إنشاء بيانات حقيقية.</p></div></div><div className="table-card"><div className="table-wrap"><table><thead><tr><th>المعاملة</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>{templates.map(t=><tr key={t.id}><td><strong>{t.name_ar}</strong></td><td>{t.workflow_id?'جاهز للاختبار':'لا توجد مسودة'}</td><td>{t.workflow_id&&<Link className="btn" to={`/workflow-studio/test/${t.id}`}>فتح الاختبار</Link>}</td></tr>)}</tbody></table></div></div></div>;
 if(busy&&!data)return <div className="panel-empty">جاري تحميل بيئة الاختبار...</div>;
 if(!data)return <div className="panel-empty">{error||'تعذر تحميل الاختبار.'}</div>;
 return <div className="workflow-test"><div className="page-header"><div><div className="eyebrow">بيئة الاختبار</div><h1>{data.type.name_ar}</h1><p>هذه المحاكاة لا تنشئ مستخدمين أو موظفين أو معاملات أو سجلات تاريخية في D1.</p></div><div className="workflow-actions"><Link className="btn" to={`/workflow-studio/${data.type.id}`}><ArrowLeft size={15}/>العودة للمصمم</Link><button className="btn" onClick={reset}><RotateCcw size={15}/>إعادة الاختبار</button></div></div>
 {error&&<div className="wf-alert danger"><CircleAlert size={18}/>{error}</div>}
 {!done&&<div className="wf-test-grid"><aside className="panel"><h3>مسار الاختبار</h3><div className="wf-test-timeline"><div className="done-step"><CheckCircle2 size={16}/>بيانات مقدم الطلب</div>{stages.map((s:any,i:number)=><div key={s.id} className={stageId===s.id?'current-step':history.some(h=>h.title===s.name_ar)?'done-step':'pending-step'}><span>{i+1}</span>{s.name_ar}</div>)}</div></aside>
 <main className="panel"><div className="wf-test-requester"><div><strong>مقدم الطلب</strong><span>{data.testRequester.name}</span></div><div><strong>رقم الموظف</strong><span>{data.testRequester.employeeNumber}</span></div><div><strong>المسمى</strong><span>{data.testRequester.jobTitle}</span></div><div><strong>الوحدة</strong><span>{data.testRequester.organizationUnit}</span></div></div>
 {history.length===0?<><div className="wf-test-section"><h3>أسئلة / بيانات الطلب</h3>{requestFields.length?requestFields.map((f:any)=><TestField key={f.id} f={f} value={values[f.field_key]} error={fieldErrors[f.field_key]} control={control(f)}/>):<p className="muted">لم يضف المصمم أي عنصر. لا توجد حقول تلقائية.</p>}</div><button className="btn primary" onClick={start}><Play size={16}/>بدء مسار المعاملة</button></>:current&&<><div className="wf-test-stage-head"><span className="wf-step">{current.stage_order}</span><div><h2>{current.name_ar}</h2><p>المسؤول: {current.responsible_type}</p></div></div>{currentFields.map((f:any)=><TestField key={f.id} f={f} value={values[f.field_key]} error={fieldErrors[f.field_key]} control={control(f)}/>) }<button className="btn primary" onClick={pass}><ShieldCheck size={16}/>تمرير المعاملة</button></>}</main></div>}
 {done&&<div className="panel wf-test-result"><CheckCircle2 size={34}/><h2>{done}</h2><p>انتهت المحاكاة دون كتابة معاملة حقيقية في قاعدة البيانات.</p><button className="btn" onClick={reset}><RotateCcw size={15}/>إعادة الاختبار</button></div>}
 <div className="panel wf-history"><h3>سجل المحاكاة</h3>{history.length?history.map((h,i)=><div key={i}><span>{i+1}</span><strong>{h.title}</strong><em>{h.action||'بيانات الطلب'}</em></div>):<span className="muted">سيظهر مسار الاختبار هنا.</span>}</div>
 </div>
}
function TestField({f,error,control}:{f:any;value:any;error?:string;control:any}){return <label className={`wf-test-field ${error?'has-error':''}`}><span>{f.label_ar}{f.required?' *':''}{f.config?.displayOnly?' · عرض فقط':''}</span>{control}{error&&<small>{error}</small>}</label>}
