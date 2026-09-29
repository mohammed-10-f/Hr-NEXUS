import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, CheckCircle2, ChevronDown, Clock3, FileText, History, MessageSquare, Paperclip, ShieldCheck, UserRound } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';

const statusMap:any={'قيد الإجراء':['قيد الإجراء','warning'],'مكتملة':['مكتملة','success'],'ملغية':['ملغية','neutral'],'مرفوضة':['مرفوضة','danger']};
const responsibleLabel=(type:string)=>({company_admin:'مدير الشركة',manager:'المدير المباشر',position_holder:'شاغل المنصب',department_manager:'مدير الإدارة',role:'الدور المحدد',user:'المستخدم المحدد',permission:'صاحب الصلاحية'} as any)[type]||type||'—';
const parseMeta=(value:any)=>{try{return value?JSON.parse(value):{}}catch{return {}}};
const displayValue=(value:any)=>value===undefined||value===null||value===''?'—':typeof value==='boolean'?(value?'نعم':'لا'):Array.isArray(value)?value.join('، '):typeof value==='object'?JSON.stringify(value):String(value);

function fieldDefs(d:any, stageId:string|null){
 const fields=(d.workflow?.fields||[]).filter((f:any)=>f.stage_id===stageId);
 const legacy=(d.workflow?.questions||[]).filter((q:any)=>q.stage_id===stageId).map((q:any)=>({id:q.id,field_key:q.question_key,label_ar:q.question_ar,field_type:q.question_type==='yes_no'?'boolean':q.question_type==='notes'?'textarea':q.question_type==='select'?'select':'text',required:Boolean(q.required),options:q.options||[]}));
 return [...fields,...legacy];
}
function initials(name:string){return (name||'م').trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('');}

export function TransactionDetail(){
 const {id}=useParams();
 const [d,setD]=useState<any>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [reason,setReason]=useState('');const [answers,setAnswers]=useState<any>({});
 async function load(){try{const x=await api<any>(`/api/workflows/transactions/${id}`);setD(x);const initial:any={};for(const a of x.answers||[]){const key=a.question_key||a.field_key;if(key)initial[key]=a.value;}setAnswers(initial);}catch{setError('تعذر تحميل المعاملة.')} }
 useEffect(()=>{void load()},[id]);
 const t=d?.transaction;
 const stages=useMemo(()=>[...(d?.workflow?.stages||[])].sort((a:any,b:any)=>Number(a.stage_order)-Number(b.stage_order)),[d]);
 const currentIndex=useMemo(()=>stages.findIndex((s:any)=>s.id===t?.current_stage_id),[stages,t]);
 const current=currentIndex>=0?stages[currentIndex]:null;
 const activeExec=d?.history?.find((x:any)=>x.status==='active');
 const canAct=t?.status==='قيد الإجراء'&&Boolean(current);
 const stageFields=useMemo(()=>fieldDefs(d,current?.id||null),[d,current]);
 const requesterFields=useMemo(()=>fieldDefs(d,null),[d]);
 const previousStages=useMemo(()=>stages.filter((s:any)=>Number(s.stage_order)<Number(current?.stage_order||999)),[stages,current]);
 const nextStages=useMemo(()=>stages.filter((s:any)=>Number(s.stage_order)>Number(current?.stage_order||0)),[stages,current]);
 const overdue=Boolean(activeExec?.is_overdue);
 const done=!canAct;
 const answerMap=useMemo(()=>{const m:any={...answers};for(const a of d?.answers||[]){const key=a.question_key||a.field_key;if(key&&m[key]===undefined)m[key]=a.value;}return m},[d,answers]);
 async function pass(){if(!canAct)return;setBusy(true);setError('');try{await api(`/api/workflows/transactions/${id}/action`,{method:'POST',body:JSON.stringify({action:'next',toStageId:null,answers:answerMap,reason:reason||null})});setReason('');await load();}catch(e){setError(e instanceof Error&&e.message==='TRANSACTION-004'?'أكمل الحقول المطلوبة أولًا.':e instanceof Error?e.message:'تعذر تمرير المعاملة.')}finally{setBusy(false)}}
 async function feedback(){if(!reason.trim())return;try{await api(`/api/workflows/transactions/${id}/feedback`,{method:'POST',body:JSON.stringify({feedback:reason})});setReason('');await load();}catch(e){setError(e instanceof Error?e.message:'تعذر حفظ الملاحظة.')}}
 if(error&&!d)return <div className="transaction-empty-state"><ShieldCheck size={24}/><strong>{error}</strong><Link className="btn secondary" to="/transactions">العودة للمعاملات</Link></div>;
 if(!d)return <div className="transaction-loading"><div className="loading-orb"></div><strong>جاري تجهيز المعاملة</strong><span>نحضر بيانات الطلب ورحلة المعالجة...</span></div>;
 const requester=t.requester_employee_name||t.requester_username||'مستخدم النظام';
 const requesterInfo=[['الرقم الوظيفي',t.requester_employee_number],['المسمى الوظيفي',t.requester_job_title],['الإدارة',t.requester_department],['الموظف المعني',t.employee_name||'نفس مقدم الطلب']];
 const requestRows=requesterFields.map((f:any)=>{const a=(d.answers||[]).find((x:any)=>(x.field_key||x.question_key)===f.field_key);let value=a?.value;if(f.field_type==='employee')value=t.employee_name||'نفس مقدم الطلب';return {...f,value};});
 const historyByStage:any={};(d.actions||[]).forEach((a:any)=>{const m=parseMeta(a.metadata_json);const sid=m.stageId||a.from_stage_id;if(sid)historyByStage[sid]=historyByStage[sid]||[];if(sid)historyByStage[sid].push({...a,meta:m});});
 return <div className="transaction-experience">
   <header className="tx-hero">
     <div className="tx-hero-main">
       <Link className="tx-back" to="/transactions"><ArrowRight size={15}/>المعاملات</Link>
       <div className="tx-kicker">{t.transaction_type_name}</div>
       <div className="tx-title-row"><h1>{t.transaction_type_name}</h1><span className={`tx-status ${statusMap[t.status]?.[1]||'neutral'}`}>{t.status}</span></div>
       <p>معاملة <strong>#{t.transaction_number}</strong> · أنشئت {t.created_at}</p>
     </div>
     <div className="tx-hero-meta"><div className="tx-number-block"><span>رقم المعاملة</span><strong>#{t.transaction_number}</strong></div><div className="tx-owner"><span className="tx-avatar">{initials(requester)}</span><div><small>مقدم الطلب</small><strong>{requester}</strong></div></div></div>
   </header>

   <section className="tx-progress-card">
     <div className="tx-progress-head"><div><span>رحلة المعاملة</span><strong>{current?`المرحلة ${current.stage_order} من ${stages.length}`:'اكتملت الرحلة'}</strong></div><div className={overdue?'tx-sla overdue':'tx-sla'}><Clock3 size={15}/><span>{overdue?'متأخرة':'ضمن المدة'}</span>{activeExec?.due_at&&<small>الاستحقاق {activeExec.due_at}</small>}</div></div>
     <div className="tx-rail">
       {stages.map((s:any,i:number)=>{const history=d.history?.find((h:any)=>h.stage_id===s.id);const state=t.status!=='قيد الإجراء'&&i<=currentIndex?'done':i<currentIndex?'done':i===currentIndex?'current':'upcoming';return <div className={`tx-rail-step ${state}`} key={s.id}><div className="tx-rail-node">{state==='done'?<Check size={13}/>:s.stage_order}</div><div className="tx-rail-copy"><strong>{s.name_ar}</strong><span>{responsibleLabel(s.responsible_type)}</span>{history?.completed_at&&<small>{history.completed_at}</small>}</div>{i<stages.length-1&&<i/>}</div>})}
     </div>
   </section>

   <section className="tx-section tx-requester-section">
     <div className="tx-section-heading"><div className="tx-section-icon"><UserRound size={18}/></div><div><span>صاحب المعاملة</span><h2>بيانات مقدم الطلب</h2><p>بيانات موثوقة من ملف الموظف، للعرض فقط.</p></div><ShieldCheck size={17}/></div>
     <div className="tx-profile-strip"><div className="tx-profile-avatar">{initials(requester)}</div><div className="tx-profile-name"><strong>{requester}</strong><span>{t.requester_job_title||'—'}</span></div><div className="tx-profile-grid">{requesterInfo.map(([label,value])=><div key={label}><small>{label}</small><strong>{value||'—'}</strong></div>)}</div></div>
   </section>

   <section className="tx-section">
     <div className="tx-section-heading"><div className="tx-section-icon"><FileText size={18}/></div><div><span>بداية الرحلة</span><h2>بيانات الطلب</h2><p>المعلومات التي أدخلها مقدم الطلب قبل بدء المراحل.</p></div></div>
     {requestRows.length?<div className="tx-data-grid">{requestRows.map((f:any)=><div className="tx-data-item" key={f.id}><small>{f.label_ar}</small><strong>{displayValue(f.value)}</strong></div>)}</div>:<div className="tx-empty-inline">لا توجد حقول مخصصة في بداية الطلب.</div>}
   </section>

   <section className="tx-work-section">
     <div className="tx-work-heading"><div><span>العمل الحالي</span><h2>{done?'رحلة المعاملة':'المرحلة الحالية'}</h2><p>{done?'راجع ما تم تنفيذه في المراحل السابقة وسجل المعاملة الكامل.':'هذه المساحة تخص المسؤول الحالي فقط؛ أما المراحل السابقة فتبقى للقراءة.'}</p></div>{current&&<div className="tx-current-chip"><span>المسؤول الحالي</span><strong>{responsibleLabel(current.responsible_type)}</strong></div>}</div>

     {previousStages.length>0&&<div className="tx-history-stack"><div className="tx-subheading"><History size={16}/><div><strong>ما تم إنجازه</strong><span>سجل المراحل السابقة محفوظ كما تم تنفيذه.</span></div></div>{previousStages.map((s:any)=>{const h=d.history?.find((x:any)=>x.stage_id===s.id);const defs=fieldDefs(d,s.id);const acts=historyByStage[s.id]||[];const latest=acts[acts.length-1];const snap={...(latest?.meta?.dataSnapshot||{}),...(latest?.meta?.answersSnapshot||{})};return <details className="tx-stage-record" key={s.id}><summary><span className="tx-stage-check"><CheckCircle2 size={15}/></span><div><strong>المرحلة {s.stage_order} · {s.name_ar}</strong><span>{responsibleLabel(s.responsible_type)} · {h?.completed_at||'مكتملة'}</span></div><ChevronDown size={16}/></summary><div className="tx-stage-record-body"><div className="tx-readonly-grid">{defs.map((f:any)=><div key={f.id}><small>{f.label_ar}</small><strong>{displayValue(snap[f.field_key])}</strong></div>)}</div>{latest?.reason&&<div className="tx-note-readonly"><span>ملاحظة</span><p>{latest.reason}</p></div>}</div></details>})}</div>}

     {current&&<div className={`tx-current-work ${done?'readonly':''}`}>
       <div className="tx-current-header"><div className="tx-current-number">{current.stage_order}</div><div><span>المرحلة {current.stage_order}</span><h3>{current.name_ar}</h3><p>{responsibleLabel(current.responsible_type)}{current.duration_minutes?` · مدة المرحلة ${current.duration_minutes} دقيقة`:''}</p></div>{overdue&&<span className="tx-overdue-badge">متأخرة</span>}</div>
       {stageFields.length>0&&<div className="tx-current-fields"><div className="tx-subheading"><FileText size={16}/><div><strong>حقول المرحلة</strong><span>البيانات التي يحتاجها مسؤول هذه المرحلة لاتخاذ الإجراء.</span></div></div><div className="tx-form-grid">{stageFields.map((f:any)=><label className="tx-form-field" key={f.id}><span>{f.label_ar}{f.required?' *':''}</span>{f.field_type==='textarea'?<textarea rows={4} disabled={done} value={answerMap[f.field_key]??''} onChange={e=>setAnswers({...answerMap,[f.field_key]:e.target.value})}/>:f.field_type==='boolean'?<div className="tx-choice-group"><button type="button" disabled={done} className={answerMap[f.field_key]===true?'selected':''} onClick={()=>setAnswers({...answerMap,[f.field_key]:true})}>نعم</button><button type="button" disabled={done} className={answerMap[f.field_key]===false?'selected':''} onClick={()=>setAnswers({...answerMap,[f.field_key]:false})}>لا</button></div>:f.field_type==='select'?<select disabled={done} value={answerMap[f.field_key]??''} onChange={e=>setAnswers({...answerMap,[f.field_key]:e.target.value})}><option value="">اختر</option>{(f.options||[]).map((o:any)=><option key={String(o.value??o)} value={String(o.value??o)}>{String(o.label_ar??o.label??o.value??o)}</option>)}</select>:<input disabled={done} type={f.field_type==='date'?'date':f.field_type==='number'?'number':'text'} value={answerMap[f.field_key]??''} onChange={e=>setAnswers({...answerMap,[f.field_key]:f.field_type==='number'?Number(e.target.value):e.target.value})}/>}</label>)}</div></div>}
       {canAct&&<><label className="tx-form-field tx-note-field"><span>ملاحظة المرحلة <small>(اختياري)</small></span><textarea rows={3} value={reason} onChange={e=>setReason(e.target.value)} placeholder="أضف توضيحًا يحتاجه من يتابع المعاملة..."/></label><div className="tx-pass-bar"><div><strong>جاهز للانتقال؟</strong><span>المحرك سيطبق المسار المحدد في القالب ويحدد المرحلة التالية تلقائيًا.</span></div><button className="tx-pass-button" disabled={busy} onClick={()=>void pass()}><Check size={17}/>{busy?'جارٍ تمرير المعاملة...':'تمرير المعاملة'}</button></div></>}
       {done&&<div className="tx-readonly-banner"><CheckCircle2 size={18}/><div><strong>لا يوجد إجراء مطلوب في هذه المرحلة</strong><span>تم حفظها ضمن سجل المعاملة.</span></div></div>}
     </div>}
   </section>

   {nextStages.length>0&&canAct&&<section className="tx-next-preview"><div><span>بعد التمرير</span><strong>المراحل التالية</strong></div><div className="tx-next-list">{nextStages.slice(0,3).map((s:any)=><div key={s.id}><b>{s.stage_order}</b><span>{s.name_ar}</span><small>{responsibleLabel(s.responsible_type)}</small></div>)}</div></section>}

   <section className="tx-section tx-record-section"><div className="tx-section-heading"><div className="tx-section-icon"><History size={18}/></div><div><span>السجل الرسمي</span><h2>سجل المعاملة</h2><p>التسلسل الزمني للإجراءات والتنقلات والملاحظات.</p></div></div><div className="tx-action-timeline">{(d.actions||[]).map((a:any,i:number)=><div className="tx-action-item" key={a.id}><div className="tx-action-dot">{i===0?<FileText size={12}/>:<Check size={12}/>}</div><div><strong>{a.action==='created'?'إنشاء المعاملة':a.action==='next'?'تمرير المعاملة':a.action==='return'?'إرجاع المعاملة':a.action==='complete'?'إكمال المعاملة':a.action==='reject'?'رفض المعاملة':a.action==='cancel'?'إلغاء المعاملة':a.action}</strong><span>{a.created_at}</span>{a.reason&&<p>{a.reason}</p>}</div></div>)}</div></section>

   {(d.attachments||[]).length>0&&<section className="tx-section"><div className="tx-section-heading"><div className="tx-section-icon"><Paperclip size={18}/></div><div><span>الملفات</span><h2>مرفقات المعاملة</h2><p>المرفقات تبقى مرتبطة بالمعاملة وبالسياق الذي أضيفت فيه.</p></div></div><div className="tx-files-grid">{d.attachments.map((a:any)=><div className="tx-file-card" key={a.id}><Paperclip size={16}/><div><strong>{a.file_name}</strong><span>{a.content_type||'ملف'} · {a.size_bytes?`${Math.round(a.size_bytes/1024)} KB`:'—'}</span></div></div>)}</div></section>}

   {current?.config?.employeeFeedback&&<section className="tx-section"><div className="tx-section-heading"><div className="tx-section-icon"><MessageSquare size={18}/></div><div><span>تواصل المرحلة</span><h2>ملاحظات الموظفين</h2><p>ملاحظات فرعية لا تغيّر الحالة الرئيسية للمعاملة.</p></div></div><div className="tx-feedback-box"><textarea rows={3} value={reason} onChange={e=>setReason(e.target.value)} placeholder="اكتب ملاحظة..."/><button className="btn secondary" onClick={()=>void feedback()}>إضافة ملاحظة</button></div>{(d.feedback||[]).map((x:any)=><div className="tx-feedback-item" key={x.id}><strong>{x.feedback}</strong><span>{x.created_at}</span></div>)}</section>}
 </div>;
}
