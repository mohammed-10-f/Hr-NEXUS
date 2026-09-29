import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { audit } from '../audit';
import { errorResponse } from '../errors';
import { requireAuthentication, requirePasswordChanged, requireSuperAdmin } from '../middleware/session';

const app = new Hono<Env>();
app.use('/admin/*', requireAuthentication, requirePasswordChanged, requireSuperAdmin);
app.use('/test/*', requireAuthentication, requirePasswordChanged, requireSuperAdmin);

const fieldTypes = ['text','textarea','number','date','datetime','boolean','select','multiselect'] as const;
const responsibilityTypes = ['direct_manager','position_holder','department_manager','role','permission','company_admin','employee_owner'] as const;
const actions = ['next','return','reject','cancel','complete'] as const;

const typeSchema = z.object({
  nameAr: z.string().trim().min(1).max(180),
  description: z.string().trim().max(1000).optional().nullable(),
  allowedSubmitters: z.array(z.string().min(1).max(120)).min(1).max(20)
});
const fieldSchema = z.object({
  id: z.string().uuid().optional(),
  stageId: z.string().uuid().nullable(),
  fieldKey: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_]{1,80}$/),
  labelAr: z.string().trim().min(1).max(180),
  fieldType: z.enum(fieldTypes),
  required: z.boolean(),
  displayOnly: z.boolean(),
  options: z.array(z.string().trim().min(1).max(160)).max(50),
  sortOrder: z.number().int().min(0).max(10000)
});
const stageSchema = z.object({
  id: z.string().uuid().optional(),
  nameAr: z.string().trim().min(1).max(180),
  responsibleType: z.enum(responsibilityTypes),
  responsibleValue: z.string().trim().max(180).nullable(),
  durationMinutes: z.number().int().min(1).max(525600).nullable()
});
const conditionSchema = z.object({
  fieldId: z.string().uuid(),
  operator: z.enum(['equals','not_equals','contains','is_true','is_false','in']),
  values: z.array(z.string()).min(1).max(20)
});
const transitionSchema = z.object({
  id: z.string().uuid().optional(),
  fromStageId: z.string().uuid(),
  toStageId: z.string().uuid().nullable(),
  action: z.enum(actions),
  labelAr: z.string().trim().min(1).max(120),
  condition: conditionSchema.nullable(),
  sortOrder: z.number().int().min(0).max(10000),
  active: z.boolean()
});
const workflowSchema = z.object({
  transactionTypeId: z.string().uuid(),
  nameAr: z.string().trim().min(1).max(180).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  allowedSubmitters: z.array(z.string().min(1).max(120)).min(1).max(20),
  stages: z.array(stageSchema).min(1).max(100),
  fields: z.array(fieldSchema).max(1000),
  transitions: z.array(transitionSchema).max(1000)
});

const safeJson = (value: any, fallback: any) => {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
};
const actorId = (c: any) => c.get('session')?.platformUserId ?? null;

function validationResult() {
  return { valid: true, errors: [] as any[], warnings: [] as any[] };
}

async function loadWorkflow(c: any, workflowId: string) {
  const workflow = await c.env.DB.prepare(`
    SELECT wd.*, tt.name_ar name_ar, tt.name_en name_en, tt.status type_status
    FROM workflow_definitions wd
    JOIN transaction_types tt ON tt.id=wd.transaction_type_id AND tt.company_id IS NULL
    WHERE wd.id=?
  `).bind(workflowId).first<any>();
  if (!workflow) return null;
  const [stages, fields, transitions] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM workflow_stages WHERE workflow_id=? AND active=1 ORDER BY stage_order`).bind(workflowId).all<any>(),
    c.env.DB.prepare(`SELECT * FROM workflow_fields WHERE workflow_id=? AND active=1 ORDER BY CASE WHEN stage_id IS NULL THEN 0 ELSE 1 END,stage_id,sort_order,id`).bind(workflowId).all<any>(),
    c.env.DB.prepare(`SELECT * FROM workflow_transitions WHERE workflow_id=? AND active=1 ORDER BY from_stage_id,sort_order,id`).bind(workflowId).all<any>()
  ]);
  return {
    workflow: {...workflow, allowed_submitters:safeJson(workflow.allowed_submitters_json,[])},
    stages: stages.results.map((s:any)=>({...s, config:safeJson(s.config_json,{})})),
    fields: fields.results.map((f:any)=>({...f, options:safeJson(f.options_json,[]), config:safeJson(f.config_json,{})})),
    transitions: transitions.results.map((t:any)=>({...t, condition:safeJson(t.condition_json,null)}))
  };
}

async function getType(c:any,id:string) {
  return c.env.DB.prepare(`SELECT * FROM transaction_types WHERE id=? AND company_id IS NULL`).bind(id).first<any>();
}

function validateModel(data:{allowedSubmitters:string[];stages:any[];fields:any[];transitions:any[]}) {
  const out=validationResult();
  const stages=[...data.stages].sort((a,b)=>Number(a.stageOrder??a.stage_order)-Number(b.stageOrder??b.stage_order));
  if (!data.allowedSubmitters?.length) out.errors.push({code:'SUBMITTERS',message:'حدد من يستطيع تقديم المعاملة.'});
  if (!stages.length) out.errors.push({code:'NO_STAGES',message:'أضف مرحلة واحدة على الأقل.'});
  const stageIds=new Set<string>();
  stages.forEach((s,i)=>{
    const id=s.id;
    if(!id || stageIds.has(id)) out.errors.push({code:'STAGE_ID',message:'يوجد تكرار غير صالح في مراحل المعاملة.',stageId:id});
    stageIds.add(id);
    if(!String(s.nameAr??s.name_ar??'').trim()) out.errors.push({code:'STAGE_NAME',message:'اسم المرحلة مطلوب.',stageId:id});
    if(!s.responsibleType && !s.responsible_type) out.errors.push({code:'RESPONSIBLE',message:'حدد مسؤول المرحلة.',stageId:id});
    const rt=s.responsibleType??s.responsible_type;
    if(['role','permission'].includes(rt) && !String(s.responsibleValue??s.responsible_value??'').trim())
      out.errors.push({code:'RESPONSIBLE_VALUE',message:'حدد الدور أو الصلاحية المطلوبة لمسؤول المرحلة.',stageId:id});
  });
  const keys=new Set<string>();
  const fieldById=new Map<string,any>();
  data.fields.forEach((f:any)=>{
    const id=f.id, key=f.fieldKey??f.field_key;
    if(id) fieldById.set(id,f);
    if(keys.has(key)) out.errors.push({code:'DUPLICATE_KEY',message:'مفتاح العنصر مكرر.',fieldId:id});
    keys.add(key);
    if(!String(f.labelAr??f.label_ar??'').trim()) out.errors.push({code:'FIELD_LABEL',message:'اسم العنصر مطلوب.',fieldId:id,stageId:f.stageId??f.stage_id??undefined});
    const sid=f.stageId??f.stage_id??null;
    if(sid && !stageIds.has(sid)) out.errors.push({code:'FIELD_STAGE',message:'العنصر مرتبط بمرحلة غير موجودة.',fieldId:id});
    if((f.required===true || Number(f.required)===1) && (f.displayOnly===true || f.config?.displayOnly===true)) out.errors.push({code:'READONLY_REQUIRED',message:'العنصر للعرض فقط ولا يمكن أن يكون مطلوبًا.',fieldId:id});
    if(['select','multiselect'].includes(f.fieldType??f.field_type) && !(f.options??[]).length) out.errors.push({code:'OPTIONS',message:'أضف خيارات العنصر.',fieldId:id});
  });
  const stageIndex=new Map(stages.map((s:any,i)=>[s.id,i]));
  data.transitions.forEach((t:any)=>{
    if(!stageIds.has(t.fromStageId??t.from_stage_id)) out.errors.push({code:'FROM_STAGE',message:'المسار مرتبط بمرحلة غير موجودة.',transitionId:t.id});
    if(t.toStageId && !stageIds.has(t.toStageId)) out.errors.push({code:'TO_STAGE',message:'وجهة المسار غير موجودة.',transitionId:t.id});
    const action=t.action;
    if(['next','return'].includes(action) && !t.toStageId) out.errors.push({code:'TARGET',message:'حدد المرحلة المستهدفة.',transitionId:t.id});
    if(action==='next' && t.toStageId && (stageIndex.get(t.toStageId)??-1) <= (stageIndex.get(t.fromStageId)??-1))
      out.errors.push({code:'FORWARD',message:'الانتقال يجب أن يتجه إلى مرحلة لاحقة.',transitionId:t.id});
    if(action==='return' && t.toStageId && (stageIndex.get(t.toStageId)??999) >= (stageIndex.get(t.fromStageId)??-1))
      out.errors.push({code:'RETURN_DIRECTION',message:'الإرجاع يجب أن يتجه إلى مرحلة سابقة.',transitionId:t.id});
    if(t.condition){
      if(!fieldById.has(t.condition.fieldId)) out.errors.push({code:'CONDITION_SOURCE',message:'مصدر الشرط غير موجود.',transitionId:t.id});
      const source=fieldById.get(t.condition.fieldId);
      if(source){
        const sid=source.stageId??source.stage_id??null;
        if(sid && (stageIndex.get(sid)??0)>(stageIndex.get(t.fromStageId)??0))
          out.errors.push({code:'CONDITION_FUTURE',message:'لا يمكن أن يعتمد الشرط على عنصر من مرحلة لم تُنفذ بعد.',transitionId:t.id});
      }
    }
  });
  stages.forEach((s:any,i:number)=>{
    if(i===stages.length-1) return;
    const outgoing=data.transitions.filter((t:any)=>t.fromStageId===s.id && t.active!==false && t.action!=='return' && t.action!=='reject' && t.action!=='cancel');
    const conditional=outgoing.filter((t:any)=>t.condition);
    if(conditional.length && !outgoing.some((t:any)=>!t.condition))
      out.errors.push({code:'DEFAULT_ROUTE',message:'المسارات المشروطة تحتاج مسارًا افتراضيًا.',stageId:s.id});
  });
  if(out.errors.length) out.valid=false;
  else out.warnings.push({code:'DEFAULT_FLOW',message:'المراحل المتتالية تستخدم الانتقال الافتراضي تلقائيًا عند عدم وجود شرط.'});
  return out;
}

function normalizePayload(data:any) {
  const stageIds=data.stages.map((s:any)=>s.id??crypto.randomUUID());
  const stageMap=new Map<string,string>();
  data.stages.forEach((s:any,i:number)=>{ if(s.id) stageMap.set(s.id,stageIds[i]); });
  const stages=data.stages.map((s:any,i:number)=>({...s,id:stageIds[i],stageOrder:i+1}));
  const fields=data.fields.map((f:any,i:number)=>({...f,id:f.id??crypto.randomUUID(),stageId:f.stageId?stageMap.get(f.stageId)??f.stageId:null,sortOrder:i}));
  const transitions=data.transitions.map((t:any,i:number)=>({...t,id:t.id??crypto.randomUUID(),fromStageId:stageMap.get(t.fromStageId)??t.fromStageId,toStageId:t.toStageId?stageMap.get(t.toStageId)??t.toStageId:null,sortOrder:i}));
  return {stages,fields,transitions};
}

app.get('/admin/types', async c=>{
  const rows=await c.env.DB.prepare(`
    SELECT tt.id,tt.name_ar,tt.description,tt.status,tt.updated_at,
      (SELECT MAX(version) FROM workflow_definitions w WHERE w.transaction_type_id=tt.id) latest_version,
      (SELECT id FROM workflow_definitions w WHERE w.transaction_type_id=tt.id AND w.status='draft' ORDER BY version DESC LIMIT 1) draft_id,
      (SELECT COUNT(*) FROM workflow_stages s JOIN workflow_definitions w ON w.id=s.workflow_id WHERE w.transaction_type_id=tt.id AND w.status='draft' AND s.active=1) stage_count
    FROM transaction_types tt WHERE tt.company_id IS NULL ORDER BY tt.updated_at DESC,tt.name_ar
  `).all<any>();
  return c.json({items:rows.results});
});

app.post('/admin/types', async c=>{
  const parsed=typeSchema.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return errorResponse(c,'WORKFLOW-001',400);
  const d=parsed.data;
  const duplicate=await c.env.DB.prepare(`SELECT id FROM transaction_types WHERE company_id IS NULL AND TRIM(name_ar)=TRIM(?)`).bind(d.nameAr).first();
  if(duplicate)return errorResponse(c,'WORKFLOW-007',409);
  const typeId=crypto.randomUUID(),workflowId=crypto.randomUUID(),stageId=crypto.randomUUID(),actor=actorId(c);
  try{
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO transaction_types(id,company_id,name_ar,description,allowed_submitters_json,status,created_by,updated_by) VALUES(?,?,?,? ,?,'inactive',?,?)`).bind(typeId,null,d.nameAr,d.description??null,JSON.stringify(d.allowedSubmitters),actor,actor),
      c.env.DB.prepare(`INSERT INTO workflow_definitions(id,transaction_type_id,version,description,allowed_submitters_json,status,created_by,updated_by) VALUES(?,?,?,?,?,'draft',?,?)`).bind(workflowId,typeId,1,d.description??null,JSON.stringify(d.allowedSubmitters),actor,actor),
      c.env.DB.prepare(`INSERT INTO workflow_stages(id,workflow_id,name_ar,stage_order,responsible_type,active) VALUES(?,?,?,?,?,1)`).bind(stageId,workflowId,'المرحلة 1',1,'company_admin')
    ]);
  }catch(e){return errorResponse(c,'WORKFLOW-005',500,e);}
  await audit(c,'workflow_template_created','workflow',workflowId,{transactionTypeId:typeId});
  return c.json({ok:true,id:typeId,workflowId},201);
});

app.get('/admin/types/:id', async c=>{
  const type=await getType(c,c.req.param('id'));
  if(!type)return errorResponse(c,'WORKFLOW-003',404);
  let workflowId=c.req.query('workflowId')||'';
  if(!workflowId) workflowId=(await c.env.DB.prepare(`SELECT id FROM workflow_definitions WHERE transaction_type_id=? AND status='draft' ORDER BY version DESC LIMIT 1`).bind(type.id).first<any>())?.id||'';
  if(!workflowId) workflowId=(await c.env.DB.prepare(`SELECT id FROM workflow_definitions WHERE transaction_type_id=? ORDER BY version DESC LIMIT 1`).bind(type.id).first<any>())?.id||'';
  return c.json({type,workflow:workflowId?await loadWorkflow(c,workflowId):null});
});

app.get('/admin/workflows/:id', async c=>{
  const w=await loadWorkflow(c,c.req.param('id'));
  if(!w)return errorResponse(c,'WORKFLOW-003',404);
  return c.json(w);
});

app.put('/admin/workflows/:id', async c=>{
  const workflowId=c.req.param('id');
  const parsed=workflowSchema.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return errorResponse(c,'WORKFLOW-001',400);
  const existing=await c.env.DB.prepare(`
    SELECT wd.*,tt.company_id type_company_id FROM workflow_definitions wd
    JOIN transaction_types tt ON tt.id=wd.transaction_type_id
    WHERE wd.id=? AND tt.company_id IS NULL
  `).bind(workflowId).first<any>();
  if(!existing)return errorResponse(c,'WORKFLOW-003',404);
  if(existing.status!=='draft')return errorResponse(c,'WORKFLOW-004',409);
  if(existing.transaction_type_id!==parsed.data.transactionTypeId)return errorResponse(c,'WORKFLOW-001',400);

  const normalized=normalizePayload(parsed.data);
  const validation=validateModel({...normalized,allowedSubmitters:parsed.data.allowedSubmitters});
  const actor=actorId(c);
  try{
    const oldStages=(await c.env.DB.prepare(`SELECT id FROM workflow_stages WHERE workflow_id=?`).bind(workflowId).all<any>()).results;
    const oldFields=(await c.env.DB.prepare(`SELECT id FROM workflow_fields WHERE workflow_id=?`).bind(workflowId).all<any>()).results;
    const oldIds=new Set(normalized.stages.map((s:any)=>s.id));
    const oldFieldIds=new Set(normalized.fields.map((f:any)=>f.id));
    const statements:D1PreparedStatement[]=[
      ...oldStages.map((s:any,i:number)=>c.env.DB.prepare(`UPDATE workflow_stages SET stage_order=? WHERE id=? AND workflow_id=?`).bind(-100000-i,s.id,workflowId)),
      ...oldFields.filter((f:any)=>!oldFieldIds.has(f.id)).map((f:any)=>c.env.DB.prepare(`UPDATE workflow_fields SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workflow_id=?`).bind(f.id,workflowId)),
      ...oldStages.filter((s:any)=>!oldIds.has(s.id)).map((s:any,i:number)=>c.env.DB.prepare(`UPDATE workflow_stages SET active=0,stage_order=? WHERE id=? AND workflow_id=?`).bind(-200000-i,s.id,workflowId)),
      c.env.DB.prepare(`UPDATE transaction_types SET name_ar=COALESCE(?,name_ar),description=?,allowed_submitters_json=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND company_id IS NULL`).bind(parsed.data.nameAr??null,parsed.data.description??null,JSON.stringify(parsed.data.allowedSubmitters),actor,existing.transaction_type_id),
      c.env.DB.prepare(`UPDATE workflow_definitions SET description=?,allowed_submitters_json=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(parsed.data.description??null,JSON.stringify(parsed.data.allowedSubmitters),actor,workflowId),
      c.env.DB.prepare(`DELETE FROM workflow_transitions WHERE workflow_id=?`).bind(workflowId)
    ];
    for(const s of normalized.stages){
      statements.push(c.env.DB.prepare(`
        INSERT INTO workflow_stages(id,workflow_id,name_ar,name_en,stage_order,responsible_type,responsible_value,duration_minutes,config_json,active)
        VALUES(?,?,?,?,?,?,?,?,?,1)
        ON CONFLICT(id) DO UPDATE SET name_ar=excluded.name_ar,name_en=excluded.name_en,stage_order=excluded.stage_order,responsible_type=excluded.responsible_type,responsible_value=excluded.responsible_value,duration_minutes=excluded.duration_minutes,active=1,updated_at=CURRENT_TIMESTAMP
      `).bind(s.id,workflowId,s.nameAr,null,s.stageOrder,s.responsibleType,s.responsibleValue??null,s.durationMinutes??null,JSON.stringify({})));
    }
    for(const f of normalized.fields){
      const config={displayOnly:Boolean(f.displayOnly)};
      statements.push(c.env.DB.prepare(`
        INSERT INTO workflow_fields(id,workflow_id,stage_id,field_key,label_ar,label_en,field_type,required,options_json,config_json,sort_order,active)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,1)
        ON CONFLICT(id) DO UPDATE SET stage_id=excluded.stage_id,field_key=excluded.field_key,label_ar=excluded.label_ar,field_type=excluded.field_type,required=excluded.required,options_json=excluded.options_json,config_json=excluded.config_json,sort_order=excluded.sort_order,active=1,updated_at=CURRENT_TIMESTAMP
      `).bind(f.id,workflowId,f.stageId??null,f.fieldKey,f.labelAr,null,f.fieldType,f.required?1:0,JSON.stringify(f.options||[]),JSON.stringify(config),f.sortOrder));
    }
    for(const t of normalized.transitions){
      statements.push(c.env.DB.prepare(`INSERT INTO workflow_transitions(id,workflow_id,from_stage_id,to_stage_id,action,label_ar,condition_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,?)`)
        .bind(t.id,workflowId,t.fromStageId,t.toStageId??null,t.action,t.labelAr,t.condition?JSON.stringify(t.condition):null,t.sortOrder,t.active?1:0));
    }
    await c.env.DB.batch(statements);
  }catch(e){return errorResponse(c,'WORKFLOW-005',500,e);}
  await audit(c,'workflow_draft_saved','workflow',workflowId,{validationErrors:validation.errors.length,stageCount:normalized.stages.length,fieldCount:normalized.fields.length});
  return c.json({ok:true,validation});
});

app.post('/admin/workflows/:id/validate', async c=>{
  const w=await loadWorkflow(c,c.req.param('id'));
  if(!w)return errorResponse(c,'WORKFLOW-003',404);
  return c.json(validateModel({allowedSubmitters:w.workflow.allowed_submitters,stages:w.stages,fields:w.fields,transitions:w.transitions}));
});

app.post('/admin/workflows/:id/publish', async c=>{
  const id=c.req.param('id');
  const w=await loadWorkflow(c,id);
  if(!w)return errorResponse(c,'WORKFLOW-003',404);
  if(w.workflow.status!=='draft')return errorResponse(c,'WORKFLOW-004',409);
  const validation=validateModel({allowedSubmitters:w.workflow.allowed_submitters,stages:w.stages,fields:w.fields,transitions:w.transitions});
  if(!validation.valid)return c.json({error:'WORKFLOW_VALIDATION',referenceId:crypto.randomUUID(),message:'لا يمكن اعتماد القالب قبل إصلاح أخطاء التحقق.',validation},400);
  try{
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE workflow_definitions SET status='inactive',updated_at=CURRENT_TIMESTAMP WHERE transaction_type_id=? AND status='active'`).bind(w.workflow.transaction_type_id),
      c.env.DB.prepare(`UPDATE workflow_definitions SET status='active',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(actorId(c),id),
      c.env.DB.prepare(`UPDATE transaction_types SET status='active',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(actorId(c),w.workflow.transaction_type_id)
    ]);
  }catch(e){return errorResponse(c,'WORKFLOW-005',500,e);}
  await audit(c,'workflow_published','workflow',id,{version:w.workflow.version});
  return c.json({ok:true,status:'active'});
});

app.post('/admin/workflows/:id/deactivate', async c=>{
  const w=await loadWorkflow(c,c.req.param('id'));
  if(!w)return errorResponse(c,'WORKFLOW-003',404);
  try{
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE workflow_definitions SET status='inactive',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(actorId(c),id),
      c.env.DB.prepare(`UPDATE transaction_types SET status='inactive',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(actorId(c),w.workflow.transaction_type_id)
    ]);
  }catch(e){return errorResponse(c,'WORKFLOW-005',500,e);}
  await audit(c,'workflow_deactivated','workflow',id,{});
  return c.json({ok:true});
});

/* Isolated test environment: it only reads a draft and returns its definition.
   It never inserts employees, users, transactions, answers or history into D1. */
app.post('/admin/transactions/cleanup', async c=>{
  /* Super Admin only. Full Phase 6 data reset: runtime transactions AND workflow
     templates/definitions/questions/stages/routes/conditions. Schema and Phase 1-5
     entities remain untouched. No cleanup audit row is created because the purpose
     of this action is to leave the transaction/workflow data layer empty. */
  const tables = [
    'transaction_attachments',
    'transaction_feedback',
    'transaction_actions',
    'transaction_answers',
    'transaction_stage_executions',
    'transactions',
    'transaction_sequences',
    'workflow_transitions',
    'workflow_conditions',
    'workflow_questions',
    'workflow_fields',
    'workflow_stages',
    'workflow_definitions',
    'transaction_type_companies',
    'transaction_types'
  ];
  try{
    const counts = await Promise.all(tables.map(async table=>{
      const row=await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<any>();
      return [table,Number(row?.count||0)] as const;
    }));
    await c.env.DB.batch(tables.map(table=>c.env.DB.prepare(`DELETE FROM ${table}`)));

    /* Remove only Phase 6 audit records. The audit_logs table itself and all
       Phase 1-5 audit history remain intact. */
    await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM audit_logs WHERE resource IN ('workflow','workflow_engine','transaction') OR action LIKE 'workflow_%' OR action LIKE 'transaction_%'`),
      c.env.DB.prepare(`DELETE FROM audit_logs WHERE action IN ('workflow_template_created','workflow_draft_saved','workflow_published','workflow_deactivated','transaction_test_data_cleaned')`)
    ]);

    return c.json({
      ok:true,
      reset:true,
      message:'تم تنظيف جميع بيانات Phase 6 الخاصة بالمعاملات وقوالب سير العمل. قاعدة البيانات جاهزة للبدء من الصفر.',
      deleted: Object.fromEntries(counts)
    });
  }catch(e){
    return errorResponse(c,'PHASE6-RESET-001',500,e);
  }
});

app.get('/test/templates', async c=>{
  const rows=await c.env.DB.prepare(`
    SELECT tt.id,tt.name_ar,tt.status,
      (SELECT id FROM workflow_definitions w WHERE w.transaction_type_id=tt.id AND w.status='draft' ORDER BY version DESC LIMIT 1) workflow_id
    FROM transaction_types tt WHERE tt.company_id IS NULL ORDER BY tt.updated_at DESC,tt.name_ar
  `).all<any>();
  return c.json({items:rows.results});
});
app.get('/test/templates/:id', async c=>{
  const type=await getType(c,c.req.param('id'));
  if(!type)return errorResponse(c,'WORKFLOW-003',404);
  const workflowId=(await c.env.DB.prepare(`SELECT id FROM workflow_definitions WHERE transaction_type_id=? AND status='draft' ORDER BY version DESC LIMIT 1`).bind(type.id).first<any>())?.id;
  if(!workflowId)return errorResponse(c,'WORKFLOW-003',404);
  const workflow=await loadWorkflow(c,workflowId);
  if(!workflow)return errorResponse(c,'WORKFLOW-003',404);
  const validation=validateModel({allowedSubmitters:workflow.workflow.allowed_submitters,stages:workflow.stages,fields:workflow.fields,transitions:workflow.transitions});
  return c.json({type,workflow,validation,testRequester:{name:'بيئة الاختبار',employeeNumber:'TEST-REQUESTER',jobTitle:'بيانات محاكاة',organizationUnit:'بيئة الاختبار',position:'بيئة الاختبار',manager:'بيئة الاختبار'}});
});

export default app;
