import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, CircleAlert, Clock3, GitBranch, Plus, Save, ShieldCheck, Trash2, Workflow as WorkflowIcon, Eye, Play } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { ErrorState, LoadingState } from '../components/State';

type Field={id:string;stageId:string|null;fieldKey:string;labelAr:string;fieldType:string;required:boolean;displayOnly:boolean;options:string[];sortOrder:number};
type Stage={id:string;nameAr:string;responsibleType:string;responsibleValue:string;durationMinutes:number|null;stageOrder:number};
type Route={id:string;fromStageId:string;toStageId:string|null;action:string;labelAr:string;condition:any;sortOrder:number;active:boolean};
type Template={id:string;name_ar:string;description:string|null;status:string;latest_version:number|null;draft_id:string|null;stage_count:number};

const fieldTypes:any={text:'نص',textarea:'ملاحظات',number:'رقم',date:'تاريخ',datetime:'تاريخ ووقت',boolean:'نعم / لا',select:'اختيار واحد',multiselect:'اختيارات متعددة'};
const responsibility:any={direct_manager:'المدير المباشر',position_holder:'شاغل المنصب',department_manager:'مدير الإدارة',role:'دور وظيفي',permission:'صاحب صلاحية',company_admin:'مدير الشركة',employee_owner:'الموظف المعني'};
const actions:any={next:'تمرير إلى مرحلة',return:'إرجاع إلى مرحلة',reject:'رفض',cancel:'إلغاء',complete:'إكمال'};
const uid=()=>crypto.randomUUID();
const blankStage=(n:number):Stage=>({id:uid(),nameAr:`المرحلة ${n}`,responsibleType:'company_admin',responsibleValue:'',durationMinutes:null,stageOrder:n});
const blankField=(stageId:string|null,n:number):Field=>({id:uid(),stageId,fieldKey:`field_${n}`,labelAr:'',fieldType:'text',required:false,displayOnly:false,options:[],sortOrder:n});

function errorText(e:any,fallback:string){return [e?.message||fallback,e?.code?`رمز الخطأ: ${e.code}`:'',e?.referenceId?`رقم المرجع: ${e.referenceId}`:''].filter(Boolean).join(' — ');}

export function WorkflowAdmin(){
 const {typeId}=useParams<{typeId?:string}>(); const nav=useNavigate();
 const [templates,setTemplates]=useState<Template[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [type,setType]=useState<any>(null),[workflow,setWorkflow]=useState<any>(null),[stages,setStages]=useState<Stage[]>([]),[fields,setFields]=useState<Field[]>([]),[routes,setRoutes]=useState<Route[]>([]);
 const [selected,setSelected]=useState(''),[name,setName]=useState(''),[description,setDescription]=useState(''),[submitters,setSubmitters]=useState<string[]>(['self']);
 const [saving,setSaving]=useState(false),[validation,setValidation]=useState<any>(null),[notice,setNotice]=useState('');
 const stageRefs=useRef<Record<string,HTMLDivElement|null>>({});

 async function loadList(){setLoading(true);try{setTemplates((await api<any>('/api/workflows/admin/types')).items||[]);}catch(e){setError(errorText(e,'تعذر تحميل قوالب المعاملات.'));}finally{setLoading(false);}}
 useEffect(()=>{void loadList();},[]);
 async function open(id:string){
  setLoading(true);setError('');
  try{
   let r=await api<any>(`/api/workflows/admin/types/${id}`);
   if(!r.workflow||r.workflow.workflow.status!=='draft'){const d=await api<any>(`/api/workflows/admin/types/${id}/new-draft`,{method:'POST'});r=await api<any>(`/api/workflows/admin/types/${id}?workflowId=${d.id}`);}
   hydrate(r.type,r.workflow);
  }catch(e){setError(errorText(e,'تعذر فتح القالب.'));}finally{setLoading(false);}
 }
 function hydrate(t:any,w:any){
  setType(t);setWorkflow(w.workflow);setName(t.name_ar||'');setDescription(w.workflow.description||t.description||'');setSubmitters(w.workflow.allowed_submitters||['self']);
  const ss=w.stages.map((x:any,i:number)=>({id:x.id,nameAr:x.name_ar,responsibleType:x.responsible_type,responsibleValue:x.responsible_value||'',durationMinutes:x.duration_minutes===null?null:Number(x.duration_minutes),stageOrder:i+1}));
  setStages(ss);setSelected(ss[0]?.id||'');
  setFields(w.fields.map((x:any)=>({id:x.id,stageId:x.stage_id||null,fieldKey:x.field_key,labelAr:x.label_ar,fieldType:x.field_type,required:Boolean(x.required),displayOnly:Boolean(x.config?.displayOnly),options:x.options||[],sortOrder:Number(x.sort_order||0)})));
  setRoutes(w.transitions.map((x:any)=>({id:x.id,fromStageId:x.from_stage_id,toStageId:x.to_stage_id||null,action:x.action,labelAr:x.label_ar,condition:x.condition||null,sortOrder:Number(x.sort_order||0),active:Boolean(x.active)})));
  setValidation(null);setNotice('');
 }
 useEffect(()=>{if(typeId&&typeId!=='new')void open(typeId);},[typeId]);

 async function cleanupTransactions(){
  const ok=window.confirm('سيتم حذف جميع بيانات Phase 6 المتعلقة بالمعاملات بالكامل: القوالب، إصدارات سير العمل، المراحل، الأسئلة، الحقول، الشروط، المسارات، المعاملات، الإجابات، التنفيذ، الإجراءات، Feedback، المرفقات، والأرقام التسلسلية، إضافة إلى سجلات التدقيق الخاصة بـPhase 6. لن يتم حذف الشركات أو المستخدمين أو الموظفين أو الهيكل التنظيمي أو صلاحيات النظام أو أي بيانات Phase 1–5. بعد التنفيذ سيكون استوديو سير العمل فارغًا وكأنه لم يُستخدم من قبل. هل تريد المتابعة؟');
  if(!ok)return;
  setLoading(true);setError('');setNotice('');
  try{
   const r=await api<any>('/api/workflows/admin/transactions/cleanup',{method:'POST'});
   setNotice('تم تنظيف جميع بيانات المعاملات وقوالب سير العمل. استوديو سير العمل الآن فارغ وجاهز للبدء من الصفر.');
   await loadList();
  }catch(e){setError(errorText(e,'تعذر تنظيف بيانات المعاملات.'));}
  finally{setLoading(false);}
 }
 async function create(){
  const n=window.prompt('اسم المعاملة');
  if(!n?.trim())return;
  try{const r=await api<any>('/api/workflows/admin/types',{method:'POST',body:JSON.stringify({nameAr:n.trim(),description:null,allowedSubmitters:['self']})});nav(`/workflow-studio/${r.id}`);}catch(e){setError(errorText(e,'تعذر إنشاء القالب.'));}
 }
 function addStage(){const s=blankStage(stages.length+1);setStages([...stages,s]);setSelected(s.id);}
 function removeStage(id:string){
  if(stages.length===1)return;
  const remaining=stages.filter(s=>s.id!==id).map((s,i)=>({...s,stageOrder:i+1}));
  setStages(remaining);setFields(fs=>fs.map(f=>f.stageId===id?{...f,stageId:null}:f));setRoutes(rs=>rs.filter(r=>r.fromStageId!==id&&r.toStageId!==id));setSelected(remaining[0].id);
 }
 function addField(stageId:string|null){const n=fields.length+1;setFields([...fields,blankField(stageId,n)]);}
 function removeField(id:string){setFields(fields.filter(f=>f.id!==id));setRoutes(routes.map(r=>r.condition?.fieldId===id?{...r,condition:null}:r));}
 function moveStage(index:number,dir:number){
  const j=index+dir;if(j<0||j>=stages.length)return;
  const a=[...stages];[a[index],a[j]]=[a[j],a[index]];setStages(a.map((s,i)=>({...s,stageOrder:i+1})));
 }
 function addRoute(stageId:string){
  const idx=stages.findIndex(s=>s.id===stageId);const next=stages[idx+1]?.id||null;
  if(!next)return;
  setRoutes([...routes,{id:uid(),fromStageId:stageId,toStageId:next,action:'next',labelAr:'تمرير المعاملة',condition:null,sortOrder:routes.filter(r=>r.fromStageId===stageId).length,active:true}]);
 }
 function scrollTo(id:string){setSelected(id);requestAnimationFrame(()=>stageRefs.current[id]?.scrollIntoView({behavior:'smooth',block:'start'}));}
 async function save(runValidation=false){
  if(!type||!workflow)return;
  setSaving(true);setNotice('');setError('');
  try{
   const r=await api<any>(`/api/workflows/admin/workflows/${workflow.id}`,{method:'PUT',body:JSON.stringify({transactionTypeId:type.id,nameAr:name,description,allowedSubmitters:submitters,stages,fields,transitions:routes})});
   setValidation(r.validation);
   setNotice('تم حفظ المسودة.');
   if(runValidation){const v=await api<any>(`/api/workflows/admin/workflows/${workflow.id}/validate`,{method:'POST'});setValidation(v);}
   await loadList();
  }catch(e){setError(errorText(e,'تعذر حفظ المسودة.'));}finally{setSaving(false);}
 }
 async function validate(){if(!workflow)return;await save(true);}
 async function publish(){
  if(!workflow)return;setSaving(true);setError('');setNotice('');
  try{const v=await api<any>(`/api/workflows/admin/workflows/${workflow.id}/validate`,{method:'POST'});setValidation(v);if(!v.valid){setError('لا يمكن الاعتماد قبل إصلاح أخطاء التحقق.');return;}await api(`/api/workflows/admin/workflows/${workflow.id}/publish`,{method:'POST'});setNotice('تم اعتماد القالب.');await loadList();}catch(e){setError(errorText(e,'تعذر اعتماد القالب.'));}finally{setSaving(false);}
 }
 if(!typeId)return <TemplateList templates={templates} loading={loading} error={error} onCreate={create} onOpen={open} onCleanup={cleanupTransactions}/>;
 if(loading&&!type)return <LoadingState/>;
 if(!type||!workflow)return <ErrorState/>;
 return <div className="workflow-studio">
  <div className="page-header"><div><div className="eyebrow">استوديو سير العمل</div><h1>{name||type.name_ar}</h1><p>تصميم المعاملة من بيانات مقدم الطلب إلى آخر مرحلة فعلية.</p></div><div className="workflow-actions"><button className="btn" onClick={()=>nav('/workflow-studio')}><WorkflowIcon size={16}/>القوالب</button><Link className="btn" to={`/workflow-studio/test/${type.id}`}><Play size={16}/>اختبار</Link></div></div>
  {error&&<div className="wf-alert danger"><CircleAlert size={18}/><span>{error}</span></div>}{notice&&<div className="wf-alert success"><CheckCircle2 size={18}/><span>{notice}</span></div>}
  <div className="wf-builder-grid">
   <aside className="wf-sidebar">
    <div className="panel"><div className="panel-head"><div><h3>أساس المعاملة</h3><p>بيانات مقدم الطلب ليست مرحلة.</p></div></div>
      <label className="wf-label">اسم المعاملة<input value={name} onChange={e=>setName(e.target.value)}/></label>
      <label className="wf-label">الوصف<textarea rows={3} value={description} onChange={e=>setDescription(e.target.value)}/></label>
      <div className="wf-label"><span>من يستطيع التقديم</span><select value={submitters[0]||'self'} onChange={e=>setSubmitters([e.target.value])}><option value="self">الموظف</option><option value="company_admin">مدير الشركة</option></select></div>
      <div className="wf-requester"><strong>بيانات مقدم الطلب</strong><span>تُستدعى من بيانات الموظف والحساب عند التشغيل.</span></div>
      <button className="btn" onClick={()=>addField(null)}><Plus size={15}/>إضافة سؤال/بيان</button>
      <FieldList fields={fields.filter(f=>!f.stageId)} onChange={setFields} onRemove={removeField}/>
    </div>
    <div className="panel"><div className="panel-head"><div><h3>المراحل</h3><p>{stages.length} مراحل فعلية</p></div><button className="btn primary" onClick={addStage}><Plus size={15}/>مرحلة</button></div>
      <div className="wf-stage-nav">{stages.map((s,i)=><button key={s.id} className={selected===s.id?'active':''} onClick={()=>scrollTo(s.id)}><span>{i+1}</span>{s.nameAr}</button>)}</div>
    </div>
   </aside>
   <main className="wf-canvas">
    <div className="wf-flow-head"><div><strong>بيانات مقدم الطلب</strong><span>تُعرض تلقائيًا ولا تُعامل كمرحلة.</span></div><div className="wf-arrow">↓</div><div><strong>أسئلة / بيانات الطلب</strong><span>عناصر أنشأها المصمم فقط.</span></div></div>
    {stages.map((s,i)=><div key={s.id} ref={el=>{stageRefs.current[s.id]=el}} className="wf-stage-card">
      <div className="wf-stage-title"><div><span className="wf-step">{i+1}</span><div><input className="wf-stage-name" value={s.nameAr} onChange={e=>setStages(stages.map(x=>x.id===s.id?{...x,nameAr:e.target.value}:x))}/><small>المرحلة الفعلية رقم {i+1}</small></div></div><div className="wf-stage-tools"><button className="icon-btn" disabled={i===0} onClick={()=>moveStage(i,-1)}><ArrowUp size={16}/></button><button className="icon-btn" disabled={i===stages.length-1} onClick={()=>moveStage(i,1)}><ArrowDown size={16}/></button><button className="icon-btn" disabled={stages.length===1} onClick={()=>removeStage(s.id)}><Trash2 size={16}/></button></div></div>
      <div className="wf-stage-settings">
       <label className="wf-label">المسؤول<select value={s.responsibleType} onChange={e=>setStages(stages.map(x=>x.id===s.id?{...x,responsibleType:e.target.value}:x))}>{Object.entries(responsibility).map(([k,v])=><option key={k} value={k}>{v as string}</option>)}</select></label>
       {['role','permission'].includes(s.responsibleType)&&<label className="wf-label">القيمة<input value={s.responsibleValue} placeholder="اسم الدور/الصلاحية" onChange={e=>setStages(stages.map(x=>x.id===s.id?{...x,responsibleValue:e.target.value}:x))}/></label>}
       <label className="wf-label">مدة المرحلة (دقيقة)<input type="number" min="1" value={s.durationMinutes??''} onChange={e=>setStages(stages.map(x=>x.id===s.id?{...x,durationMinutes:e.target.value?Number(e.target.value):null}:x))}/></label>
      </div>
      <div className="wf-section-head"><div><strong>عناصر المرحلة</strong><span>السؤال يمكن أن يصبح قرارًا للمسار.</span></div><button className="btn" onClick={()=>addField(s.id)}><Plus size={14}/>إضافة سؤال</button></div>
      <FieldList fields={fields.filter(f=>f.stageId===s.id)} onChange={setFields} onRemove={removeField}/>
      {i<stages.length-1&&<RouteEditor stage={s} stages={stages} fields={fields} routes={routes.filter(r=>r.fromStageId===s.id)} onAdd={()=>addRoute(s.id)} onChange={r=>setRoutes(routes.map(x=>x.id===r.id?r:x))} onRemove={id=>setRoutes(routes.filter(x=>x.id!==id))}/>}
      {i===stages.length-1&&<div className="wf-complete-note"><CheckCircle2 size={18}/><span>عند تمرير هذه المرحلة بنجاح تصبح المعاملة «مكتملة» تلقائيًا. لا توجد مرحلة إضافية.</span></div>}
    </div>)}
   </main>
  </div>
  <div className="wf-bottom-bar"><div>{validation&&<ValidationSummary validation={validation} onJump={scrollTo}/>}</div><div className="workflow-actions"><button className="btn" disabled={saving} onClick={()=>save(false)}><Save size={16}/>حفظ المسودة</button><button className="btn" disabled={saving} onClick={validate}><ShieldCheck size={16}/>فحص</button><button className="btn primary" disabled={saving} onClick={publish}><CheckCircle2 size={16}/>اعتماد</button></div></div>
 </div>
}

function TemplateList({templates,loading,error,onCreate,onOpen,onCleanup}:{templates:Template[];loading:boolean;error:string;onCreate:()=>void;onOpen:(id:string)=>void;onCleanup:()=>void}){
 return <div><div className="page-header"><div><div className="eyebrow">استوديو سير العمل</div><h1>قوالب المعاملات</h1><p>إنشاء وتصميم وفحص قوالب سير العمل.</p></div><div className="workflow-actions"><button className="btn" onClick={onCleanup}><Trash2 size={16}/>تنظيف جميع بيانات المعاملات</button><button className="btn primary" onClick={onCreate}><Plus size={16}/>إنشاء قالب</button></div></div>{error&&<div className="wf-alert danger">{error}</div>}{loading?<LoadingState/>:<div className="table-card"><div className="table-head"><h2>القوالب</h2><span>{templates.length} قالب</span></div><div className="table-wrap"><table><thead><tr><th>المعاملة</th><th>الحالة</th><th>الإصدار</th><th>المراحل</th><th>إجراء</th></tr></thead><tbody>{templates.map(t=><tr key={t.id}><td><strong>{t.name_ar}</strong></td><td><span className={`badge ${t.status==='active'?'success':'warning'}`}>{t.status==='active'?'معتمد':'مسودة'}</span></td><td>{t.latest_version??1}</td><td>{t.stage_count||0}</td><td><button className="btn" onClick={()=>onOpen(t.id)}>فتح القالب</button></td></tr>)}</tbody></table>{!templates.length&&<div className="panel-empty">لا توجد قوالب بعد.</div>}</div></div>}</div>
}

function FieldList({fields,onChange,onRemove}:{fields:Field[];onChange:(v:Field[])=>void;onRemove:(id:string)=>void}){
 return <div className="wf-fields">{fields.map((f,i)=><div className="wf-field" key={f.id}>
  <div className="wf-field-main"><input value={f.labelAr} placeholder="اسم السؤال/العنصر" onChange={e=>onChange(onChangeField(fields,f.id,{labelAr:e.target.value}))}/><select value={f.fieldType} onChange={e=>onChange(onChangeField(fields,f.id,{fieldType:e.target.value}))}>{Object.entries(fieldTypes).map(([k,v])=><option key={k} value={k}>{v as string}</option>)}</select></div>
  <div className="wf-field-options"><label><input type="checkbox" checked={f.required} onChange={e=>onChange(onChangeField(fields,f.id,{required:e.target.checked}))}/> مطلوب</label><label><input type="checkbox" checked={f.displayOnly} onChange={e=>onChange(onChangeField(fields,f.id,{displayOnly:e.target.checked,required:e.target.checked?false:f.required}))}/> عرض فقط</label><span className="wf-key">{f.fieldKey}</span><button className="icon-btn" onClick={()=>onRemove(f.id)}><Trash2 size={14}/></button></div>
  {(f.fieldType==='select'||f.fieldType==='multiselect')&&<input className="wf-options-input" value={f.options.join('، ')} placeholder="الخيارات مفصولة بفاصلة" onChange={e=>onChange(onChangeField(fields,f.id,{options:e.target.value.split(/[,،\n]/).map(x=>x.trim()).filter(Boolean)}))}/>}
 </div>)}</div>
}
function onChangeField(fields:Field[],id:string,patch:Partial<Field>){return fields.map(f=>f.id===id?{...f,...patch}:f);}
function RouteEditor({stage,stages,fields,routes,onAdd,onChange,onRemove}:{stage:Stage;stages:Stage[];fields:Field[];routes:Route[];onAdd:()=>void;onChange:(r:Route)=>void;onRemove:(id:string)=>void}){
 return <div className="wf-routes"><div className="wf-section-head"><div><strong><GitBranch size={15}/> المسارات</strong><span>بدون شرط = المسار الافتراضي.</span></div><button className="btn" onClick={onAdd} disabled={!stages[stages.findIndex(s=>s.id===stage.id)+1]}><Plus size={14}/>مسار</button></div>{routes.map(r=><div className="wf-route" key={r.id}>
  <select value={r.action} onChange={e=>onChange({...r,action:e.target.value})}>{Object.entries(actions).map(([k,v])=><option key={k} value={k}>{v as string}</option>)}</select>
  {['next','return'].includes(r.action)&&<select value={r.toStageId||''} onChange={e=>onChange({...r,toStageId:e.target.value||null})}>{stages.map((s,i)=><option key={s.id} value={s.id}>{i+1} — {s.nameAr}</option>)}</select>}
  <input value={r.labelAr} onChange={e=>onChange({...r,labelAr:e.target.value})} placeholder="اسم الإجراء"/>
  <select value={r.condition?.fieldId||''} onChange={e=>{const f=e.target.value;onChange({...r,condition:f?{fieldId:f,operator:'equals',values:['نعم']}:null})}}><option value="">بدون شرط (افتراضي)</option>{fields.filter(f=>f.id&&((f.stageId&&stages.findIndex(s=>s.id===f.stageId)<=stages.findIndex(s=>s.id===stage.id)))).map(f=><option key={f.id} value={f.id}>إذا كانت: {f.labelAr||f.fieldKey}</option>)}</select>
  {r.condition&&<input value={r.condition.values?.join('، ')||''} onChange={e=>onChange({...r,condition:{...r.condition,values:e.target.value.split(/[,،]/).map(x=>x.trim()).filter(Boolean)}})} placeholder="القيمة المتوقعة"/>}
  <button className="icon-btn" onClick={()=>onRemove(r.id)}><Trash2 size={14}/></button>
 </div>)}</div>
}
function ValidationSummary({validation,onJump}:{validation:any;onJump:(id:string)=>void}){
 const errs=validation.errors||[],warn=validation.warnings||[];
 return <div className="wf-validation"><span className={errs.length?'danger-dot':'ok-dot'}>{errs.length?`${errs.length} أخطاء`:'✓ صالح'}</span>{warn.length>0&&<span className="warn-dot">{warn.length} تحذير</span>}{errs.slice(0,3).map((e:any,i:number)=><button key={i} onClick={()=>onJump(e.stageId||'')}>{e.message}</button>)}</div>
}
