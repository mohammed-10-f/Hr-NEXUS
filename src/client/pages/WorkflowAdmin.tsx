import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, CheckCircle2, CircleAlert, Clock3, GitBranch, GripVertical, Layers3, Plus, Save, ShieldCheck, Trash2, Workflow as WorkflowIcon, X, Play, UserRound } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { ErrorState, LoadingState } from '../components/State';

type FieldType='text'|'textarea'|'number'|'date'|'datetime'|'boolean'|'select'|'multiselect'|'employee'|'organization_unit'|'position'|'user';
type RespType='employee_owner'|'direct_manager'|'department_manager'|'position_holder'|'role'|'permission'|'company_admin'|'specific_user';
type ActionType='next'|'return'|'complete'|'reject'|'cancel';
type Field={id:string;stageId:string|null;fieldKey:string;labelAr:string;labelEn:string;fieldType:FieldType;required:boolean;options:string[];sortOrder:number;active:boolean;config?:Record<string,any>;displayOnly?:boolean};
type Stage={id:string;nameAr:string;nameEn:string;stageOrder:number;responsibleType:RespType;responsibleValue:string;durationMinutes:number|null;employeeFeedback:boolean};
type Route={id:string;fromStageId:string;toStageId:string|null;action:ActionType;condition:{fieldKey:string;values:string[]}|null;sortOrder:number};
type ValidationItem={message:string;stageId?:string;fieldKey?:string;transitionId?:string};
type Template={id:string;name_ar:string;description:string|null;status:'active'|'inactive';latest_version:number|null;active_version:number|null;draft_id:string|null;stage_count?:number;requester_field_count?:number};

const fieldLabels:Record<FieldType,string>={text:'نص',textarea:'نص طويل',number:'رقم',date:'تاريخ',datetime:'تاريخ ووقت',boolean:'نعم / لا',select:'اختيار واحد',multiselect:'اختيارات متعددة',employee:'موظف',organization_unit:'وحدة تنظيمية',position:'منصب',user:'مستخدم'};
const respLabels:Record<RespType,string>={employee_owner:'الموظف المرتبط',direct_manager:'المدير المباشر',department_manager:'مدير الإدارة',position_holder:'شاغل المنصب',role:'دور وظيفي',permission:'حامل صلاحية',company_admin:'مدير الشركة',specific_user:'مستخدم محدد'};
const actionLabels:Record<ActionType,string>={next:'انتقل إلى المرحلة المحددة',return:'ارجع إلى المرحلة المحددة',complete:'تُغلق كمكتملة',reject:'تُغلق كمرفوضة',cancel:'تُغلق كملغاة'};

const newId=()=>crypto.randomUUID();
function slugKey(label:string,index:number){
  const normalized=label.trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
  return normalized?`${normalized}_${index+1}`:`element_${index+1}`;
}
function blankField(stageId:string|null,order:number):Field{return{id:newId(),stageId,fieldKey:slugKey('',order),labelAr:'',labelEn:'',fieldType:'text',required:false,options:[],sortOrder:order,active:true};}
function blankStage(order:number):Stage{return{id:newId(),nameAr:`المرحلة ${order}`,nameEn:`Stage ${order}`,stageOrder:order,responsibleType:'company_admin',responsibleValue:'',durationMinutes:null,employeeFeedback:false};}
function blankRoute(fromStageId:string,action:ActionType,toStageId:string|null,sortOrder:number):Route{return{id:newId(),fromStageId,toStageId,action,condition:null,sortOrder};}
function parseOptions(value:string){return value.split(/[,،\n]/).map(x=>x.trim()).filter(Boolean);}
function ordered<T extends {sortOrder:number}>(items:T[]){return [...items].sort((a,b)=>a.sortOrder-b.sortOrder);}

export function WorkflowAdmin(){
  const params=useParams<{typeId?:string}>();
  const navigate=useNavigate();
  const [templates,setTemplates]=useState<Template[]>([]);
  const [listLoading,setListLoading]=useState(true),[listError,setListError]=useState(false);
  const [mode,setMode]=useState<'list'|'create'|'builder'>(params.typeId==='new'?'create':params.typeId?'builder':'list');
  const [type,setType]=useState<any>(null),[workflow,setWorkflow]=useState<any>(null),[loading,setLoading]=useState(false);
  const [error,setError]=useState(''),[saving,setSaving]=useState(false),[approving,setApproving]=useState(false);
  const [validation,setValidation]=useState<{valid:boolean;errors:ValidationItem[];warnings:ValidationItem[]}|null>(null);
  const [selectedStage,setSelectedStage]=useState('');
  const [nameAr,setNameAr]=useState(''),[nameEn,setNameEn]=useState(''),[description,setDescription]=useState('');
  const [submitters,setSubmitters]=useState<string[]>(['self']);
  const [stages,setStages]=useState<Stage[]>([]),[fields,setFields]=useState<Field[]>([]),[routes,setRoutes]=useState<Route[]>([]);
  const stageRefs=useRef<Record<string,HTMLElement|null>>({});
  const loadedTypeRef=useRef('');

  async function loadTemplates(){
    setListLoading(true);setListError(false);
    try{const r=await api<{items:Template[]}>('/api/workflows/admin/types');setTemplates(r.items||[]);}catch{setListError(true);}finally{setListLoading(false);}
  }
  useEffect(()=>{void loadTemplates();},[]);

  function hydrate(t:any,w:any){
    setType(t);setWorkflow(w);
    const wd=w.workflow;
    setNameAr(t.name_ar||'');setNameEn(t.name_en||'');setDescription(wd.description||t.description||'');setSubmitters(wd.allowed_submitters||['self']);
    const ss=(w.stages||[]).map((s:any)=>({id:s.id,nameAr:s.name_ar,nameEn:s.name_en||'',stageOrder:Number(s.stage_order),responsibleType:s.responsible_type,responsibleValue:s.responsible_value||'',durationMinutes:s.duration_minutes===null?null:Number(s.duration_minutes),employeeFeedback:Boolean(s.config?.employeeFeedback)}));
    const ff=(w.fields||[]).map((f:any)=>({id:f.id,stageId:f.stage_id||null,fieldKey:f.field_key,labelAr:f.label_ar,labelEn:f.label_en||'',fieldType:f.field_type,required:Boolean(f.required),options:Array.isArray(f.options)?f.options.map((v:any)=>String(v)):[],sortOrder:Number(f.sort_order||0),active:Boolean(f.active),config:f.config&&typeof f.config==='object'?f.config:{},displayOnly:Boolean(f.config?.displayOnly)}));
    const rr=(w.transitions||[]).map((r:any)=>({id:r.id||newId(),fromStageId:r.from_stage_id,toStageId:r.to_stage_id||null,action:r.action,condition:r.condition?{fieldKey:r.condition.fieldKey,values:Array.isArray(r.condition.values)?r.condition.values.map((v:any)=>String(v)):[]}:null,sortOrder:Number(r.sort_order||0)}));
    setStages(ss);setFields(ff);setRoutes(rr);setSelectedStage(ss[0]?.id||'');setValidation(null);
  }
  async function openType(typeId:string){
    if(loadedTypeRef.current===typeId&&workflow)return;
    loadedTypeRef.current=typeId;setLoading(true);setError('');
    try{
      let r=await api<any>(`/api/workflows/admin/types/${typeId}`);
      if(!r.workflow||r.workflow.workflow.status!=='draft'){
        const draft=await api<any>(`/api/workflows/admin/types/${typeId}/new-draft`,{method:'POST'});
        r=await api<any>(`/api/workflows/admin/types/${typeId}?workflowId=${draft.id}`);
      }
      hydrate(r.type,r.workflow);setMode('builder');
    }catch(e){setError(e instanceof Error?e.message:'تعذر فتح القالب.');}
    finally{setLoading(false);}
  }
  useEffect(()=>{
    if(params.typeId==='new'){setMode('create');setType(null);setWorkflow(null);loadedTypeRef.current='';return;}
    if(params.typeId){setMode('builder');void openType(params.typeId);return;}
    setMode('list');setType(null);setWorkflow(null);loadedTypeRef.current='';
  },[params.typeId]);

  function addStage(){
    const oldStages=[...stages];
    const newStage=blankStage(oldStages.length+1);
    const nextStages=[...oldStages,newStage].map((stage,i)=>({...stage,stageOrder:i+1}));
    const oldLast=oldStages[oldStages.length-1];
    setStages(nextStages);
    setRoutes(current=>{
      let next=current;
      if(oldLast){
        const oldRoutes=current.filter(r=>r.fromStageId===oldLast.id);
        const defaultTerminal=oldRoutes.find(r=>!r.condition&&['complete','reject','cancel'].includes(r.action));
        const hasForward=oldRoutes.some(r=>r.action==='next'&&r.toStageId);
        if(defaultTerminal){
          next=next.map(r=>r.id===defaultTerminal.id?{...r,action:'next',toStageId:newStage.id}:r);
        }else if(!hasForward){
          next=[...next,blankRoute(oldLast.id,'next',newStage.id,oldRoutes.length)];
        }
      }
      const newStageHasDefault=next.some(r=>r.fromStageId===newStage.id&&!r.condition);
      if(!newStageHasDefault){
        next=[...next,blankRoute(newStage.id,'complete',null,next.filter(r=>r.fromStageId===newStage.id).length)];
      }
      return next;
    });
    setSelectedStage(newStage.id);
    setValidation(null);
  }
  function removeStage(stageId:string){
    if(stages.length<=1)return;
    setStages(prev=>prev.filter(s=>s.id!==stageId).map((s,i)=>({...s,stageOrder:i+1})));
    setRoutes(prev=>prev.filter(r=>r.fromStageId!==stageId&&r.toStageId!==stageId));
    setFields(prev=>prev.filter(f=>f.stageId!==stageId));
    setSelectedStage(prev=>prev===stageId?stages.find(s=>s.id!==stageId)?.id||'':prev);
    setValidation(null);
  }
  function moveStage(stageId:string,dir:-1|1){
    setStages(prev=>{const idx=prev.findIndex(s=>s.id===stageId),ni=idx+dir;if(idx<0||ni<0||ni>=prev.length)return prev;const copy=[...prev];[copy[idx],copy[ni]]=[copy[ni],copy[idx]];return copy.map((s,i)=>({...s,stageOrder:i+1}));});
    setValidation(null);
  }
  function addField(stageId:string|null){setFields(prev=>[...prev,blankField(stageId,prev.filter(f=>f.stageId===stageId).length)]);setValidation(null);}
  function updateField(id:string,patch:Partial<Field>){setFields(prev=>prev.map(f=>f.id===id?{...f,...patch}:f));setValidation(null);}
  function removeField(id:string){
    const removedKey=fields.find(f=>f.id===id)?.fieldKey;
    setFields(prev=>prev.filter(f=>f.id!==id));
    if(removedKey)setRoutes(prev=>prev.map(r=>r.condition?.fieldKey===removedKey?{...r,condition:null}:r));
    setValidation(null);
  }
  function addRoute(stageId:string){
    const stage=stages.find(s=>s.id===stageId);if(!stage)return;
    const nextStage=stages.find(s=>s.stageOrder===stage.stageOrder+1);
    const previousStage=stages.find(s=>s.stageOrder===stage.stageOrder-1);
    const action:ActionType=nextStage?'next':previousStage?'complete':'complete';
    const target=action==='next'?nextStage?.id:null;
    setRoutes(prev=>[...prev,blankRoute(stageId,action,target,prev.filter(r=>r.fromStageId===stageId).length)]);setValidation(null);
  }
  function updateRoute(id:string,patch:Partial<Route>){setRoutes(prev=>prev.map(r=>r.id===id?{...r,...patch}:r));setValidation(null);}
  function removeRoute(id:string){setRoutes(prev=>prev.filter(r=>r.id!==id));setValidation(null);}

  const requestFields=useMemo(()=>ordered(fields.filter(f=>f.stageId===null)),[fields]);
  const currentStage=stages.find(s=>s.id===selectedStage)||stages[0];
  const currentFields=useMemo(()=>currentStage?ordered(fields.filter(f=>f.stageId===currentStage.id)):[],[fields,currentStage?.id]);
  const sourceFields=useMemo(()=>{
    if(!currentStage)return [];
    return ordered(fields.filter(f=>{
      if(f.stageId===null)return true;
      const source=stages.find(s=>s.id===f.stageId);return Boolean(source&&source.stageOrder<=currentStage.stageOrder);
    }));
  },[fields,stages,currentStage?.id]);

  function uniqueFieldKey(label:string,ignoreId?:string){
    const base=slugKey(label,fields.length);let candidate=base;let n=2;
    while(fields.some(f=>f.id!==ignoreId&&f.fieldKey===candidate)){candidate=`${base}_${n++}`;}
    return candidate;
  }
  function onLabelChange(field:Field,value:string){
    const patch:Partial<Field>={labelAr:value};
    if(/^element_\d+$/.test(field.fieldKey)||/^field_\d+$/.test(field.fieldKey))patch.fieldKey=uniqueFieldKey(value,field.id);
    updateField(field.id,patch);
  }

  function validateLocal(){
    const errors:ValidationItem[]=[];const warnings:ValidationItem[]=[];const keys=new Set<string>();
    if(!nameAr.trim())errors.push({message:'اسم المعاملة مطلوب.'});
    if(!submitters.length)errors.push({message:'حدد من يمكنه تقديم المعاملة.'});
    if(!stages.length)errors.push({message:'أضف مرحلة واحدة على الأقل.'});
    stages.forEach((s,i)=>{if(s.stageOrder!==i+1)errors.push({message:'ترتيب المراحل غير متسلسل.',stageId:s.id});if(!s.nameAr.trim())errors.push({message:'اسم المرحلة مطلوب.',stageId:s.id});if(['role','permission','specific_user'].includes(s.responsibleType)&&!s.responsibleValue.trim())errors.push({message:'حدد قيمة المسؤول عن هذه المرحلة.',stageId:s.id});});
    fields.forEach(f=>{
      if(!keys.has(f.fieldKey))keys.add(f.fieldKey);else errors.push({message:'يوجد عنصر مكرر داخليًا.',stageId:f.stageId||undefined,fieldKey:f.fieldKey});
      if(!f.labelAr.trim())errors.push({message:'اسم العنصر مطلوب.',stageId:f.stageId||undefined,fieldKey:f.fieldKey});
      if(!/^[A-Za-z][A-Za-z0-9_]{1,80}$/.test(f.fieldKey))errors.push({message:'تعريف داخلي غير صالح لهذا العنصر.',stageId:f.stageId||undefined,fieldKey:f.fieldKey});
      if(['select','multiselect'].includes(f.fieldType)&&!f.options.length)errors.push({message:'أضف قيم الاختيار لهذا العنصر.',stageId:f.stageId||undefined,fieldKey:f.fieldKey});
    });
    stages.forEach((s,i)=>{
      const rs=routes.filter(r=>r.fromStageId===s.id);
      if(!rs.length)errors.push({message:'حدد أثر تمرير للمرحلة.',stageId:s.id});
      if(i<stages.length-1&&!rs.some(r=>r.action==='next'&&r.toStageId&&!r.condition))errors.push({message:'حدد مسارًا افتراضيًا إلى المرحلة التالية.',stageId:s.id});
      if(i===stages.length-1&&!rs.some(r=>['complete','reject','cancel'].includes(r.action)&&!r.condition))errors.push({message:'حدد أثرًا نهائيًا افتراضيًا لهذه المرحلة.',stageId:s.id});
      const defaults=rs.filter(r=>!r.condition);
      if(defaults.length>1)errors.push({message:'يجب أن يكون للمرحلة مسار افتراضي واحد فقط.',stageId:s.id});
      if(rs.some(r=>Boolean(r.condition))&&!defaults.length)errors.push({message:i<stages.length-1?'أضف مسارًا افتراضيًا لأن المسارات المشروطة تحتاج مسارًا احتياطيًا.':'أضف أثرًا نهائيًا افتراضيًا لأن المسارات المشروطة تحتاج مسارًا احتياطيًا.',stageId:s.id});
      rs.forEach(r=>{
        if(['next','return'].includes(r.action)&&!r.toStageId)errors.push({message:r.action==='next'?'حدد المرحلة التالية.':'حدد مرحلة الرجوع.',stageId:s.id,transitionId:r.id});
        if(r.toStageId===s.id)errors.push({message:'لا يمكن أن يعود المسار إلى المرحلة نفسها.',stageId:s.id,transitionId:r.id});
        const targetOrder=r.toStageId?stages.find(x=>x.id===r.toStageId)?.stageOrder||0:0;
        if(r.action==='next'&&targetOrder<=s.stageOrder)errors.push({message:'المسار يجب أن يتجه إلى مرحلة لاحقة.',stageId:s.id,transitionId:r.id});
        if(r.action==='return'&&targetOrder>=s.stageOrder)errors.push({message:'الرجوع يجب أن يتجه إلى مرحلة سابقة.',stageId:s.id,transitionId:r.id});
        if(s.stageOrder===stages.length&&r.action==='next')errors.push({message:'لا يمكن لهذا المسار الانتقال دون مرحلة تالية محددة.',stageId:s.id,transitionId:r.id});
        if(r.condition){
          if(!r.condition.fieldKey)errors.push({message:'حدد حقل الشرط.',stageId:s.id,transitionId:r.id});
          if(!r.condition.values.length)errors.push({message:'حدد قيمة الشرط.',stageId:s.id,transitionId:r.id});
          const source=fields.find(f=>f.fieldKey===r.condition?.fieldKey);
          if(!source)errors.push({message:'حقل الشرط غير موجود.',stageId:s.id,transitionId:r.id});
          else if(source.stageId){const sourceOrder=stages.find(x=>x.id===source.stageId)?.stageOrder||999;if(sourceOrder>s.stageOrder)errors.push({message:'لا يمكن أن يعتمد الشرط على مرحلة لاحقة.',stageId:s.id,transitionId:r.id});}
          if(source&&['select','multiselect'].includes(source.fieldType)&&r.condition.values.some(v=>!source.options.includes(String(v))))errors.push({message:'إحدى قيم الشرط غير موجودة ضمن الخيارات.',stageId:s.id,transitionId:r.id});
        }
      });
    });
    const result={valid:errors.length===0,errors,warnings};setValidation(result);return result;
  }
  async function loadServerValidation(){
    if(!workflow)return;try{const r=await api<any>(`/api/workflows/admin/workflows/${workflow.workflow.id}/validate`);setValidation(r);}catch{setValidation(validateLocal());}
  }
  function scrollToIssue(item:ValidationItem){if(item.stageId){setSelectedStage(item.stageId);requestAnimationFrame(()=>stageRefs.current[item.stageId!]?.scrollIntoView({behavior:'smooth',block:'center'}));}}
  function buildPayload(){
    return {
      transactionTypeId:type.id,description:description.trim()||null,allowedSubmitters:submitters,
      stages:stages.map((s,i)=>({id:s.id,nameAr:s.nameAr,nameEn:s.nameEn||null,stageOrder:i+1,responsibleType:s.responsibleType,responsibleValue:['employee_owner','direct_manager','department_manager','position_holder','company_admin'].includes(s.responsibleType)?null:(s.responsibleValue||null),durationMinutes:s.durationMinutes,config:{employeeFeedback:s.employeeFeedback},active:true})),
      fields:fields.map((f,i)=>({id:f.id,stageId:f.stageId,fieldKey:f.fieldKey,labelAr:f.labelAr,labelEn:f.labelEn||null,fieldType:f.fieldType,required:Boolean(f.displayOnly)?false:f.required,options:f.options,config:{...(f.config||{}),requestSection:f.stageId===null,displayOnly:Boolean(f.displayOnly)},sortOrder:i,active:true})),
      transitions:routes.map((r,i)=>({id:r.id,fromStageId:r.fromStageId,toStageId:r.toStageId,action:r.action,labelAr:actionLabels[r.action],condition:r.condition,sortOrder:i,active:true})),
    };
  }
  async function save(requireValid=false):Promise<boolean>{
    if(!workflow||!type)return false;
    setError('');const local=validateLocal();setValidation(local);
    if(requireValid&&!local.valid){scrollToIssue(local.errors[0]);return false;}
    setSaving(true);
    try{
      const payload=buildPayload();
      const r0=await api<any>(`/api/workflows/admin/workflows/${workflow.workflow.id}`,{method:'PUT',body:JSON.stringify({...payload,nameAr:nameAr.trim(),nameEn:nameEn.trim()||null})});
      const r=await api<any>(`/api/workflows/admin/types/${type.id}?workflowId=${workflow.workflow.id}`);hydrate(r.type,r.workflow);
      if(r0?.validation)setValidation(r0.validation);
      return true;
    }catch(e){setError(e instanceof Error?e.message:'تعذر حفظ المسودة.');return false;}
    finally{setSaving(false);}
  }
  async function approve(){
    if(!workflow||approving)return;setError('');
    const ok=await save(true);if(!ok)return;
    setApproving(true);
    try{await api(`/api/workflows/admin/workflows/${workflow.workflow.id}/approve`,{method:'POST'});await loadTemplates();const r=await api<any>(`/api/workflows/admin/types/${type.id}?workflowId=${workflow.workflow.id}`);hydrate(r.type,r.workflow);setWorkflow((w:any)=>w?{...w,workflow:{...w.workflow,status:'active'}}:w);}
    catch(e){setError(e instanceof Error?e.message:'تعذر اعتماد النسخة.');}
    finally{setApproving(false);}
  }
  const [newTypeName,setNewTypeName]=useState(''),[newTypeDescription,setNewTypeDescription]=useState(''),[newSubmitters,setNewSubmitters]=useState<string[]>(['self']);
  function toggleNewSubmitter(k:string){setNewSubmitters(v=>v.includes(k)?v.filter(x=>x!==k):[...v,k]);}
  async function submitCreate(){
    if(newTypeName.trim().length<2||!newSubmitters.length)return;setError('');
    try{const r=await api<any>('/api/workflows/admin/types',{method:'POST',body:JSON.stringify({nameAr:newTypeName.trim(),description:newTypeDescription.trim()||null,allowedSubmitters:newSubmitters})});setNewTypeName('');setNewTypeDescription('');setNewSubmitters(['self']);navigate(`/workflow-studio/${r.id}`);}
    catch(e){setError(e instanceof Error?e.message:'تعذر إنشاء القالب.');}
  }

  if(mode==='list')return <div className="workflow-studio-page">
    <div className="page-header"><div><div className="eyebrow">استوديو سير العمل</div><h1>قوالب المعاملات</h1><p>إدارة وتعريف قوالب سير العمل.</p></div><button className="btn primary" onClick={()=>navigate('/workflow-studio/new')}><Plus size={16}/> قالب جديد</button></div>
    {listLoading?<LoadingState/>:listError?<ErrorState/>:templates.length===0?<section className="studio-empty panel"><div className="studio-empty-icon"><WorkflowIcon size={25}/></div><h3>ابدأ أول قالب</h3><p>سيظهر كل قالب هنا مع حالته ونسخته.</p><button className="btn primary" onClick={()=>navigate('/workflow-studio/new')}><Plus size={15}/> إنشاء قالب</button></section>:
      <section className="studio-template-board"><div className="studio-board-head"><div><span className="eyebrow">بيئة التصميم</span><h2>قوالب المعاملات</h2></div><span className="studio-count">{templates.length} قالب</span></div><div className="template-grid">{templates.map(t=><article className="template-card" key={t.id}><div className="template-card-top"><div className="template-symbol"><WorkflowIcon size={20}/></div><span className={`badge ${t.active_version?'success':'warning'}`}>{t.active_version?'معتمد':'مسودة'}</span></div><h3>{t.name_ar}</h3>{t.description&&<p>{t.description}</p>}<div className="template-stats"><div><strong>{t.stage_count??0}</strong><span>مراحل</span></div><div><strong>{t.requester_field_count??0}</strong><span>عناصر الطلب</span></div><div><strong>{t.latest_version??1}</strong><span>النسخة</span></div></div><div className="template-actions"><button className="btn secondary" onClick={()=>{loadedTypeRef.current='';navigate(`/workflow-studio/${t.id}`)}}>فتح الاستوديو</button><button className="btn primary" onClick={()=>navigate(`/workflow-studio/test/${t.id}`)}><Play size={14}/> اختبار</button></div></article>)}</div></section>}
  </div>;

  if(mode==='create')return <div className="workflow-studio-page">
    <div className="page-header"><div><div className="eyebrow">استوديو سير العمل</div><h1>قالب جديد</h1></div><Link className="btn secondary" to="/workflow-studio"><X size={15}/> إلغاء</Link></div>
    <section className="create-template-card panel"><div className="create-template-intro"><div className="create-template-icon"><Layers3 size={23}/></div><div><h2>ابدأ من أساس المعاملة</h2><p>بعد الإنشاء تنتقل مباشرة إلى إعداد المرحلة الأولى.</p></div></div><div className="studio-form-grid"><label className="studio-field"><span>اسم المعاملة *</span><input autoFocus value={newTypeName} onChange={e=>setNewTypeName(e.target.value)} placeholder="مثال: طلب تغيير المسمى الوظيفي"/></label><label className="studio-field studio-wide"><span>الوصف <em>اختياري</em></span><textarea value={newTypeDescription} onChange={e=>setNewTypeDescription(e.target.value)} rows={3} placeholder="وصف مختصر لطبيعة المعاملة"/></label></div><div className="create-submitters"><div><strong>مَن يمكنه تقديم المعاملة؟</strong><span>يمكن تعديل ذلك لاحقًا.</span></div><div className="submitter-choice-grid compact"><Submitter checked={newSubmitters.includes('self')} label="مقدم الطلب" onClick={()=>toggleNewSubmitter('self')}/><Submitter checked={newSubmitters.includes('company_admin')} label="مدير الشركة" onClick={()=>toggleNewSubmitter('company_admin')}/><Submitter checked={newSubmitters.includes('permission:transaction.create')} label="حامل صلاحية الإنشاء" onClick={()=>toggleNewSubmitter('permission:transaction.create')}/></div></div>{error&&<div className="form-error workflow-inline-error">{error}</div>}<div className="create-page-actions"><Link className="btn secondary" to="/workflow-studio">إلغاء</Link><button className="btn primary" disabled={newTypeName.trim().length<2||!newSubmitters.length} onClick={submitCreate}><Check size={16}/> إنشاء والانتقال للمرحلة الأولى</button></div></section>
  </div>;

  if(loading||!workflow||!type||!currentStage)return <div className="workflow-studio-page"><LoadingState/></div>;

  return <div className="workflow-studio-page">
    <div className="page-header workflow-studio-header"><div><div className="eyebrow">استوديو سير العمل</div><h1>{nameAr}</h1><p>نسخة {workflow.workflow.version} · {workflow.workflow.status==='active'?'معتمدة':'قيد البناء'}</p></div><div className="header-actions"><Link className="btn secondary" to="/workflow-studio"><X size={15}/> القوالب</Link><button className="btn secondary" onClick={()=>navigate(`/workflow-studio/test/${type.id}`)}><Play size={15}/> اختبار</button><button className="btn primary" onClick={approve} disabled={saving||approving||workflow.workflow.status!=='draft'}><CheckCircle2 size={15}/>{approving?'اعتماد...':'اعتماد النسخة'}</button></div></div>
    {error&&<div className="form-error workflow-inline-error">{error}</div>}

    <section className="studio-flow-intro panel"><div className="flow-intro-main"><div className="flow-intro-icon"><WorkflowIcon size={22}/></div><div><span>ترتيب المعاملة</span><strong>بيانات الطلب أولًا، ثم مراحل المعالجة</strong><p>بيانات مقدم الطلب والطلب ليست مرحلة. تبدأ المراحل فقط بعد تقديم المعاملة.</p></div></div><div className="flow-intro-actions"><span className="badge info"><ShieldCheck size={13}/> قالب عام</span><span className="badge muted">النسخة {workflow.workflow.version}</span></div></section>

    <section className="panel studio-request-panel"><div className="panel-head"><div><span className="eyebrow">الأساس</span><h3>بيانات مقدم الطلب وأسئلة الطلب</h3><p>بيانات مقدم الطلب الأساسية تُستدعى تلقائيًا من بيانات النظام عند تقديم المعاملة، ثم تأتي الأسئلة التي يجيب عنها مقدم الطلب.</p></div><button className="btn secondary" onClick={()=>addField(null)}><Plus size={15}/> إضافة عنصر</button></div><div className="requester-system-grid"><div><UserRound size={17}/><div><span>اسم مقدم الطلب</span><strong>من حساب المستخدم والموظف المرتبط</strong></div></div><div><UserRound size={17}/><div><span>الرقم الوظيفي</span><strong>يُعرض بالرقم الوظيفي الحقيقي</strong></div></div><div><Layers3 size={17}/><div><span>البيانات التنظيمية</span><strong>المسمى · الوحدة · المنصب · المدير المباشر</strong></div></div></div><div className="studio-system-note">هذه البيانات نظامية للعرض وليست حقول إدخال. يضيف المصمم أدناه فقط أسئلة وبيانات الطلب التي يحتاج مقدم الطلب للإجابة عنها.</div><FieldEditor fields={requestFields} onUpdate={updateField} onLabelChange={onLabelChange} onRemove={removeField}/></section>

    <div className="studio-layout">
      <aside className="studio-stage-panel panel"><div className="panel-head"><div><span className="eyebrow">المعالجة</span><h3>مراحل المعاملة</h3><p>{stages.length} مراحل</p></div><button className="btn secondary icon-only" onClick={addStage} title="إضافة مرحلة"><Plus size={16}/></button></div><div className="stage-list">{stages.map(s=><button key={s.id} className={`stage-list-item ${selectedStage===s.id?'active':''}`} onClick={()=>setSelectedStage(s.id)}><span className="stage-list-number">{s.stageOrder}</span><div><strong>{s.nameAr}</strong><span>{respLabels[s.responsibleType]}</span></div><GripVertical size={15}/></button>)}</div><button className="stage-add-full" onClick={addStage}><Plus size={15}/> إضافة مرحلة</button></aside>

      <main className="studio-editor-column" ref={el=>{if(el&&currentStage)stageRefs.current[currentStage.id]=el}}>
        <section className="stage-editor-head panel"><div className="stage-head-main"><div className="stage-number-large">{currentStage.stageOrder}</div><div><span>ترتيب {currentStage.stageOrder}</span><h2>{currentStage.nameAr}</h2><p>{respLabels[currentStage.responsibleType]}</p></div></div><div className="stage-head-actions"><button className="icon-btn compact" onClick={()=>moveStage(currentStage.id,-1)} disabled={currentStage.stageOrder===1} title="أعلى"><ArrowUp size={15}/></button><button className="icon-btn compact" onClick={()=>moveStage(currentStage.id,1)} disabled={currentStage.stageOrder===stages.length} title="أسفل"><ArrowDown size={15}/></button><button className="icon-btn compact danger-icon" onClick={()=>removeStage(currentStage.id)} disabled={stages.length===1} title="حذف المرحلة"><Trash2 size={15}/></button></div></section>

        <section className="panel stage-settings"><div className="panel-head"><div><h3>تعريف المرحلة</h3><span>من المسؤول؟ وما المدة؟</span></div></div><div className="studio-form-grid stage-settings-grid"><label className="studio-field"><span>اسم المرحلة *</span><input value={currentStage.nameAr} onChange={e=>setStages(v=>v.map(s=>s.id===currentStage.id?{...s,nameAr:e.target.value}:s))}/></label><label className="studio-field"><span>المسؤول *</span><select value={currentStage.responsibleType} onChange={e=>setStages(v=>v.map(s=>s.id===currentStage.id?{...s,responsibleType:e.target.value as RespType,responsibleValue:''}:s))}>{Object.entries(respLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>{!['employee_owner','direct_manager','department_manager','position_holder','company_admin'].includes(currentStage.responsibleType)&&<label className="studio-field"><span>{currentStage.responsibleType==='role'?'الدور':currentStage.responsibleType==='permission'?'الصلاحية':'المستخدم المحدد'}</span><input value={currentStage.responsibleValue} onChange={e=>setStages(v=>v.map(s=>s.id===currentStage.id?{...s,responsibleValue:e.target.value}:s))}/></label>}<label className="studio-field"><span>مدة المرحلة</span><div className="unit-input"><input type="number" min={1} value={currentStage.durationMinutes??''} onChange={e=>setStages(v=>v.map(s=>s.id===currentStage.id?{...s,durationMinutes:e.target.value?Number(e.target.value):null}:s))}/><em>دقيقة</em></div></label></div><label className="toggle-row"><input type="checkbox" checked={currentStage.employeeFeedback} onChange={e=>setStages(v=>v.map(s=>s.id===currentStage.id?{...s,employeeFeedback:e.target.checked}:s))}/><span><strong>طلب ملاحظات الموظف عند الحاجة</strong><small>اختياري داخل هذه المرحلة، وليس عنصرًا يظهر تلقائيًا.</small></span></label></section>

        <section className="panel stage-elements" id={`stage-${currentStage.id}`}><div className="panel-head"><div><span className="eyebrow">المحتوى</span><h3>أسئلة وقرارات المرحلة</h3><p>السؤال وإجابته هما القرار الذي يعتمد عليه المسار عند الحاجة.</p></div><button className="btn secondary" onClick={()=>addField(currentStage.id)}><Plus size={15}/> إضافة سؤال / قرار</button></div><FieldEditor fields={currentFields} onUpdate={updateField} onLabelChange={onLabelChange} onRemove={removeField}/></section>

        <section className="panel route-panel"><div className="panel-head"><div><span className="eyebrow">المسار</span><h3>ماذا يحدث عند تمرير المرحلة؟</h3><p>الشرط · القيم · الأثر</p></div><button className="btn secondary" onClick={()=>addRoute(currentStage.id)}><Plus size={15}/> إضافة مسار</button></div><div className="route-table-head"><span>الشرط</span><span>القيم</span><span>الأثر</span><span>الوجهة</span><span></span></div><div className="route-list">{ordered(routes.filter(r=>r.fromStageId===currentStage.id)).map(route=><RouteRow key={route.id} route={route} stage={currentStage} stages={stages} fields={sourceFields} onUpdate={updateRoute} onRemove={removeRoute}/>)}</div>{routes.filter(r=>r.fromStageId===currentStage.id).length===0&&<div className="route-empty">أضف مسارًا واحدًا على الأقل.</div>}</section>
      </main>
    </div>

    <section className="panel submitters-panel"><div className="panel-head"><div><span className="eyebrow">صلاحية التقديم</span><h3>من يمكنه تقديم المعاملة؟</h3></div></div><div className="submitter-choice-grid"><Submitter checked={submitters.includes('self')} label="مقدم الطلب" onClick={()=>setSubmitters(v=>v.includes('self')?v.filter(x=>x!=='self'):[...v,'self'])}/><Submitter checked={submitters.includes('company_admin')} label="مدير الشركة" onClick={()=>setSubmitters(v=>v.includes('company_admin')?v.filter(x=>x!=='company_admin'):[...v,'company_admin'])}/><Submitter checked={submitters.includes('permission:transaction.create')} label="حامل صلاحية الإنشاء" onClick={()=>setSubmitters(v=>v.includes('permission:transaction.create')?v.filter(x=>x!=='permission:transaction.create'):[...v,'permission:transaction.create'])}/></div></section>

    <section className="panel validation-panel"><div className="panel-head"><div><span className="eyebrow">جودة النسخة</span><h3>التحقق قبل الاعتماد</h3><p>أي خطأ مانع يحدد لك مكانه مباشرة.</p></div><button className="btn secondary" onClick={loadServerValidation}><GitBranch size={15}/> فحص النسخة</button></div>{validation?<div className="validation-dashboard"><div className={`validation-summary ${validation.valid?'valid':'invalid'}`}>{validation.valid?<CheckCircle2 size={19}/>:<CircleAlert size={19}/>}<div><strong>{validation.valid?'النسخة جاهزة للاعتماد':'توجد نقاط تحتاج معالجة'}</strong><span>{validation.valid?`${validation.warnings.length} تنبيهات غير مانعة`: `${validation.errors.length} عناصر مانعة`}</span></div></div>{validation.errors.length>0&&<div className="validation-list">{validation.errors.map((item,i)=><button key={`${item.message}-${i}`} className="validation-item error" onClick={()=>scrollToIssue(item)}><CircleAlert size={15}/><span>{item.message}</span></button>)}</div>}{validation.warnings.length>0&&<div className="validation-list">{validation.warnings.map((item,i)=><div key={i} className="validation-item warning"><CircleAlert size={15}/><span>{item.message}</span></div>)}</div>}</div>:<div className="validation-idle"><CheckCircle2 size={17}/><span>فحص النسخة متاح قبل الاعتماد.</span></div>}</section>

    <div className="studio-savebar"><div><strong>{workflow.workflow.status==='active'?'نسخة معتمدة':'مسودة'}</strong><span>النسخة {workflow.workflow.version}</span></div><div><button className="btn secondary" onClick={save} disabled={saving}>{saving?<Clock3 size={15}/>:<Save size={15}/>} حفظ المسودة</button><button className="btn primary" onClick={approve} disabled={saving||approving}>{approving?<Clock3 size={15}/>:<CheckCircle2 size={15}/>} اعتماد النسخة</button></div></div>
  </div>;
}

function Submitter({checked,label,onClick}:{checked:boolean;label:string;onClick:()=>void}){return <button type="button" className={`studio-choice ${checked?'checked':''}`} onClick={onClick}><span className="choice-check">{checked&&<Check size={13}/>}</span><span>{label}</span></button>}

function FieldEditor({fields,onUpdate,onLabelChange,onRemove}:{fields:Field[];onUpdate:(id:string,p:Partial<Field>)=>void;onLabelChange:(field:Field,value:string)=>void;onRemove:(id:string)=>void}){
  const sorted=ordered(fields);
  if(!sorted.length)return <div className="field-editor-empty"><div className="field-empty-icon"><Layers3 size={18}/></div><span>أضف أول عنصر لهذا القسم.</span></div>;
  return <div className="field-list">{sorted.map((f,index)=><div className="field-config-card" key={f.id}><div className="field-index">{index+1}</div><div className="field-config-main"><label><span>السؤال / البيان *</span><input value={f.labelAr} onChange={e=>onLabelChange(f,e.target.value)} placeholder="مثال: هل توافق على الطلب؟"/></label><label><span>نوع الإجابة</span><select value={f.fieldType} onChange={e=>onUpdate(f.id,{fieldType:e.target.value as FieldType,options:[]})}>{Object.entries(fieldLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>{['select','multiselect'].includes(f.fieldType)&&<label className="field-config-wide"><span>القيم</span><input value={f.options.join('، ')} onChange={e=>onUpdate(f.id,{options:parseOptions(e.target.value)})} placeholder="قيمة، قيمة، قيمة"/></label>}{f.fieldType==='employee'&&f.stageId===null&&<span className="field-special-tag">يُستخدم لاختيار الموظف المرتبط. عند تركه دون اختيار يكون مقدم الطلب هو الافتراضي.</span>}<span className="field-editor-hint">إذا كان النوع نعم / لا أو اختيارًا، فالإجابة يمكن استخدامها كقرار لتحديد المسار.</span></div><div className="field-config-side"><label className="field-required-toggle"><input type="checkbox" checked={f.required} disabled={Boolean(f.displayOnly)} onChange={e=>onUpdate(f.id,{required:e.target.checked})}/><span>مطلوب</span></label><label className="field-required-toggle"><input type="checkbox" checked={Boolean(f.displayOnly)} onChange={e=>onUpdate(f.id,{displayOnly:e.target.checked,required:e.target.checked?false:f.required})}/><span>عرض فقط</span></label><button className="icon-btn compact danger-icon" onClick={()=>onRemove(f.id)} title="حذف العنصر"><Trash2 size={15}/></button></div></div>)}</div>
}

function RouteRow({route,stage,stages,fields,onUpdate,onRemove}:{route:Route;stage:Stage;stages:Stage[];fields:Field[];onUpdate:(id:string,p:Partial<Route>)=>void;onRemove:(id:string)=>void}){
  const conditional=Boolean(route.condition);
  const source=fields.find(f=>f.fieldKey===route.condition?.fieldKey);
  const targets=route.action==='return'?stages.filter(s=>s.stageOrder<stage.stageOrder):stages.filter(s=>s.stageOrder>stage.stageOrder);
  const defaultValue=source?.fieldType==='boolean'?(route.condition?.values?.[0]||'نعم'):(route.condition?.values?.[0]||'');
  function changeAction(action:ActionType){
    const to=action==='next'?stages.find(s=>s.stageOrder===stage.stageOrder+1)?.id||null:action==='return'?stages.find(s=>s.stageOrder===stage.stageOrder-1)?.id||null:null;
    onUpdate(route.id,{action,toStageId:to});
  }
  function toggleCondition(){onUpdate(route.id,{condition:conditional?null:{fieldKey:fields[0]?.fieldKey||'',values:[source?.fieldType==='boolean'?'نعم':source?.options?.[0]||'']}})}
  return <div className="route-row">
    <div className="route-condition-cell"><button type="button" className={`condition-toggle ${conditional?'on':''}`} onClick={toggleCondition}>{conditional?'مشروط':'افتراضي'}</button>{conditional&&<select value={route.condition?.fieldKey||''} onChange={e=>{const f=fields.find(x=>x.fieldKey===e.target.value);onUpdate(route.id,{condition:{fieldKey:e.target.value,values:[f?.fieldType==='boolean'?'نعم':f?.options?.[0]||'']}})}}><option value="">حقل الشرط</option>{fields.map(f=><option key={f.id} value={f.fieldKey}>{f.labelAr}</option>)}</select>}</div>
    <div className="route-value-cell">{conditional?(source?.fieldType==='boolean'?<select value={defaultValue} onChange={e=>onUpdate(route.id,{condition:{fieldKey:route.condition?.fieldKey||'',values:[e.target.value]}})}><option value="نعم">نعم</option><option value="لا">لا</option></select>:source&&['select','multiselect'].includes(source.fieldType)?<select value={defaultValue} onChange={e=>onUpdate(route.id,{condition:{fieldKey:route.condition?.fieldKey||'',values:[e.target.value]}})}><option value="">القيمة</option>{source.options.map(o=><option key={o} value={o}>{o}</option>)}</select>:<input value={defaultValue} onChange={e=>onUpdate(route.id,{condition:{fieldKey:route.condition?.fieldKey||'',values:[e.target.value]}})} placeholder="القيمة"/>):<span className="route-default-label">يمر وفق المسار الافتراضي</span>}</div>
    <div className="route-effect-cell"><select value={route.action} onChange={e=>changeAction(e.target.value as ActionType)}>{Object.entries(actionLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
    <div className="route-target-cell">{['next','return'].includes(route.action)?<select value={route.toStageId||''} onChange={e=>onUpdate(route.id,{toStageId:e.target.value||null})}><option value="">الوجهة</option>{targets.map(s=><option key={s.id} value={s.id}>{s.stageOrder}. {s.nameAr}</option>)}</select>:<span className="terminal-route">نهاية المعاملة</span>}</div>
    <button className="icon-btn compact danger-icon route-remove" onClick={()=>onRemove(route.id)} title="حذف المسار"><Trash2 size={14}/></button>
  </div>
}
