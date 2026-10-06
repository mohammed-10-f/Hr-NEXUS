import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { audit } from '../audit';
import { errorResponse } from '../errors';
import { requireAuthentication, requirePasswordChanged, requireSuperAdmin } from '../middleware/session';

const app = new Hono<Env>();
app.use('/admin/*', requireAuthentication, requirePasswordChanged, requireSuperAdmin);
app.use('/test/*', requireAuthentication, requirePasswordChanged, requireSuperAdmin);

const fieldTypes = ['text','textarea','number','date','datetime','boolean','select','multiselect','employee','organization_unit','position','user'] as const;
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
  staticText: z.string().trim().max(5000).optional().default(''),
  sortOrder: z.number().int().min(0).max(10000)
});
const stageSchema = z.object({
  id: z.string().uuid().optional(),
  nameAr: z.string().trim().min(1).max(180),
  responsibleType: z.enum(responsibilityTypes),
  responsibleValue: z.string().trim().max(180).nullable(),
  durationMinutes: z.number().int().min(1).max(525600).nullable(),
  config: z.object({
    delegate: z.object({ enabled: z.boolean(), employeeFieldId: z.string().uuid().nullable() }).optional()
  }).optional()
});
const conditionSchema = z.object({
  fieldId: z.string().uuid(),
  operator: z.enum(['equals','not_equals','contains','is_true','is_false','in','is_empty','is_not_empty']),
  values: z.array(z.string()).max(20)
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
const systemFieldSchema = z.object({ sourceKey: z.string().trim().min(1).max(120), scope: z.enum(['requester','target']), labelAr: z.string().trim().min(1).max(180), sortOrder: z.number().int().min(0).max(1000) });
const workflowSchema = z.object({
  transactionTypeId: z.string().uuid(),
  nameAr: z.string().trim().min(1).max(180).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  allowedSubmitters: z.array(z.string().min(1).max(120)).min(1).max(20),
  stages: z.array(stageSchema).min(1).max(100).optional(),
  fields: z.array(fieldSchema).max(1000).optional().default([]),
  transitions: z.array(transitionSchema).max(1000).optional().default([]),
  systemFields: z.array(systemFieldSchema).max(200).optional().default([]),
  targetEmployeeEnabled: z.boolean(),
  targetEmployeeRequired: z.boolean()
});
const systemFieldKeys = new Set(['employee_number','full_name','national_id','nationality','gender','date_of_birth','personal_phone','personal_email','short_address','job_title','organization_unit','position','direct_manager','work_location','employment_type','contract_type','contract_start_date','contract_end_date','actual_start_date','join_date','basic_salary','housing_allowance','transport_allowance','other_allowances','gosi_number','residency_classification']);

const safeJson = (value: any, fallback: any) => {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
};
const actorId = (c: any) => c.get('session')?.platformUserId ?? null;

async function ensurePhase6AuxTables(c:any){
  /* Remote D1s may have the original Phase 6 migrations applied without the
     newer system-data tables. Keep this guard additive and Phase-6-only so a
     normal Draft save cannot fail just because the optional catalog extension
     is one migration behind. */
  await c.env.DB.batch([
    c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS workflow_system_fields (
      id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('requester','target')),
      source_key TEXT NOT NULL, label_ar TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workflow_id) REFERENCES workflow_definitions(id) ON DELETE CASCADE,
      UNIQUE(workflow_id,scope,source_key)
    )`),
    c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_workflow_system_fields_workflow_scope ON workflow_system_fields(workflow_id,scope,sort_order)`),
    c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS workflow_request_settings (
      id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL UNIQUE,
      target_employee_enabled INTEGER NOT NULL DEFAULT 0 CHECK (target_employee_enabled IN (0,1)),
      target_employee_required INTEGER NOT NULL DEFAULT 0 CHECK (target_employee_required IN (0,1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workflow_id) REFERENCES workflow_definitions(id) ON DELETE CASCADE
    )`),
    c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_workflow_request_settings_workflow ON workflow_request_settings(workflow_id)`)
  ]);
}

async function tableExists(c:any, table:string){
  const row=await c.env.DB.prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`).bind(table).first<any>();
  return Boolean(row?.ok);
}

function workflowDbError(c:any,error:unknown){
  const referenceId=crypto.randomUUID();
  const raw=String(error||'');
  let message='تعذر حفظ التغيير في قالب سير العمل.';
  let code:'WORKFLOW-005'|'WORKFLOW-009'='WORKFLOW-005';
  if(/no such table:\s*workflow_(system_fields|request_settings)/i.test(raw)){
    code='WORKFLOW-009';
    message='قاعدة بيانات Phase 6 غير متزامنة مع نسخة التطبيق الحالية. طبّق آخر Migration الخاصة بـPhase 6 ثم أعد المحاولة.';
  } else if(/UNIQUE constraint failed/i.test(raw)){
    message='يوجد تعارض في أحد عناصر القالب. راجع أسماء العناصر أو ترتيبها ثم أعد الحفظ.';
  } else if(/FOREIGN KEY constraint failed/i.test(raw)){
    message='يوجد ارتباط غير صالح بين مرحلة أو عنصر أو مسار. افتح فحص القالب لإظهار الموضع المتأثر.';
  } else if(/CHECK constraint failed/i.test(raw)){
    message='إحدى قيم إعدادات سير العمل غير مسموحة. راجع مسؤول المرحلة أو نوع الإجراء أو نوع العنصر.';
  }
  console.error('HR_NEXUS_WORKFLOW_DB', {referenceId,code,path:c.req.path});
  return c.json({error:code,referenceId,message},500);
}

function validationResult() {
  return { valid: true, errors: [] as any[], warnings: [] as any[] };
}

async function loadWorkflow(c: any, workflowId: string) {
  await ensurePhase6AuxTables(c);
  const workflow = await c.env.DB.prepare(`
    SELECT wd.*, tt.name_ar name_ar, tt.name_en name_en, tt.status type_status
    FROM workflow_definitions wd
    JOIN transaction_types tt ON tt.id=wd.transaction_type_id AND tt.company_id IS NULL
    WHERE wd.id=?
  `).bind(workflowId).first<any>();
  if (!workflow) return null;
  const [stages, fields, transitions, systemFields, requestSettings] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM workflow_stages WHERE workflow_id=? AND active=1 ORDER BY stage_order`).bind(workflowId).all<any>(),
    c.env.DB.prepare(`SELECT * FROM workflow_fields WHERE workflow_id=? AND active=1 ORDER BY CASE WHEN stage_id IS NULL THEN 0 ELSE 1 END,stage_id,sort_order,id`).bind(workflowId).all<any>(),
    c.env.DB.prepare(`SELECT * FROM workflow_transitions WHERE workflow_id=? AND active=1 ORDER BY from_stage_id,sort_order,id`).bind(workflowId).all<any>(),
    c.env.DB.prepare(`SELECT * FROM workflow_system_fields WHERE workflow_id=? AND active=1 ORDER BY scope,sort_order,id`).bind(workflowId).all<any>(),
    c.env.DB.prepare(`SELECT * FROM workflow_request_settings WHERE workflow_id=? LIMIT 1`).bind(workflowId).first<any>()
  ]);
  return {
    workflow: {...workflow, allowed_submitters:safeJson(workflow.allowed_submitters_json,[])},
    stages: stages.results.map((s:any)=>({...s, config:safeJson(s.config_json,{})})),
    fields: fields.results.map((f:any)=>({...f, options:safeJson(f.options_json,[]), config:safeJson(f.config_json,{})})),
    transitions: transitions.results.map((t:any)=>({...t, condition:safeJson(t.condition_json,null)})),
    systemFields: systemFields.results,
    requestSettings: {
      targetEmployeeEnabled: Boolean(requestSettings?.target_employee_enabled) || systemFields.results.some((x:any)=>x.scope==='target'),
      targetEmployeeRequired: Boolean(requestSettings?.target_employee_required)
    }
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
  stages.forEach((s:any)=>{
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
  const stageIndex=new Map(stages.map((s:any,i:number)=>[s.id,i]));
  // Delegation is an optional stage capability. It is intentionally not coupled to any required field.
  data.transitions.forEach((t:any)=>{
    const from=t.fromStageId??t.from_stage_id;
    const to=t.toStageId??t.to_stage_id??null;
    if(!stageIds.has(from)) out.errors.push({code:'FROM_STAGE',message:'المسار مرتبط بمرحلة غير موجودة.',transitionId:t.id});
    if(to && !stageIds.has(to)) out.errors.push({code:'TO_STAGE',message:'وجهة المسار غير موجودة.',transitionId:t.id});
    const action=t.action;
    if(action==='next' && !to) out.errors.push({code:'TARGET',message:'حدد المرحلة التالية للمسار.',transitionId:t.id});
    if(action==='return' && !to) out.errors.push({code:'TARGET',message:'حدد المرحلة التي ستعود إليها المعاملة.',transitionId:t.id});
    if(action==='next' && to && (stageIndex.get(to)??-1) <= (stageIndex.get(from)??-1)) out.errors.push({code:'FORWARD',message:'تمرير المعاملة يجب أن يتجه إلى مرحلة لاحقة.',transitionId:t.id});
    if(action==='return' && to && (stageIndex.get(to)??999) >= (stageIndex.get(from)??-1)) out.errors.push({code:'RETURN_DIRECTION',message:'الإرجاع يجب أن يتجه إلى مرحلة سابقة.',transitionId:t.id});
    if(t.condition){
      if(!fieldById.has(t.condition.fieldId)) out.errors.push({code:'CONDITION_SOURCE',message:'مصدر الشرط غير موجود.',transitionId:t.id});
      const source=fieldById.get(t.condition.fieldId);
      if(source){
        const sid=source.stageId??source.stage_id??null;
        if(sid && (stageIndex.get(sid)??0)>(stageIndex.get(from)??0)) out.errors.push({code:'CONDITION_FUTURE',message:'لا يمكن أن يعتمد الشرط على عنصر من مرحلة لم تُنفذ بعد.',transitionId:t.id});
      }
      if(['is_true','is_false','is_empty','is_not_empty'].includes(t.condition.operator) && (t.condition.values||[]).length) out.warnings.push({code:'CONDITION_VALUE_IGNORED',message:'هذا النوع من الشروط لا يحتاج قيمة؛ سيعتمد القرار على حالة الحقل فقط.',transitionId:t.id});
      if(!['is_true','is_false','is_empty','is_not_empty'].includes(t.condition.operator) && !(t.condition.values||[]).length) out.errors.push({code:'CONDITION_VALUE',message:'حدد القيمة التي سيقارن بها الشرط.',transitionId:t.id});
    }
  });
  if(out.errors.length) out.valid=false;
  else out.warnings.push({code:'DEFAULT_FLOW',message:'بدون شرط مطابق، ينتقل المحرك تلقائيًا للمرحلة التالية، وفي آخر مرحلة يكتمل الطلب.'});
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


app.get('/admin/catalog', async c=>{
  const [roles,permissions]=await Promise.all([
    c.env.DB.prepare(`SELECT code,MIN(name_ar) name_ar FROM roles WHERE status='active' AND code IS NOT NULL GROUP BY code ORDER BY name_ar`).all<any>(),
    c.env.DB.prepare(`SELECT id,name_ar FROM permissions ORDER BY resource,action`).all<any>()
  ]);
  const systemFields=[
    ['employee_number','الرقم الوظيفي','identity','text',false,'رقم الموظف المعتمد في ملف الموظف.',null],
    ['full_name','اسم الموظف الكامل','identity','text',false,'الاسم الكامل من سجل الموظف.',null],
    ['national_id','رقم الهوية / الإقامة','identity','text',true,'بيانات الهوية من ملف الموظف.','employee.view_identity'],
    ['nationality','الجنسية','identity','text',false,'الجنسية المسجلة في ملف الموظف.',null],
    ['gender','الجنس','identity','text',false,'الجنس المسجل في ملف الموظف.',null],
    ['date_of_birth','تاريخ الميلاد','identity','date',false,'تاريخ الميلاد من ملف الموظف.',null],
    ['personal_phone','الهاتف الشخصي','identity','text',true,'رقم الهاتف الشخصي.','employee.view_sensitive_data'],
    ['personal_email','البريد الشخصي','identity','text',true,'البريد الشخصي.','employee.view_sensitive_data'],
    ['short_address','العنوان المختصر','identity','text',true,'العنوان المختصر.','employee.view_sensitive_data'],
    ['job_title','المسمى الوظيفي','employment','text',false,'المسمى الوظيفي الحالي.',null],
    ['actual_start_date','تاريخ المباشرة الفعلية','employment','date',false,'تاريخ المباشرة الفعلية.',null],
    ['join_date','تاريخ الالتحاق','employment','date',false,'تاريخ الالتحاق بالشركة.',null],
    ['work_location','موقع العمل','employment','text',false,'موقع العمل المسجل.',null],
    ['employment_type','نوع التوظيف','employment','text',false,'نوع التوظيف.',null],
    ['contract_type','نوع العقد','employment','text',false,'نوع العقد.',null],
    ['contract_start_date','بداية العقد','employment','date',false,'تاريخ بداية العقد.',null],
    ['contract_end_date','نهاية العقد','employment','date',false,'تاريخ نهاية العقد.',null],
    ['organization_unit','الوحدة التنظيمية','organization','text',false,'الوحدة التنظيمية من Phase 4.',null],
    ['position','المنصب / الشاغر الوظيفي','organization','text',false,'المنصب المرتبط من Phase 4.',null],
    ['direct_manager','المدير المباشر','organization','text',false,'المدير المباشر من ملف الموظف.',null],
    ['basic_salary','الراتب الأساسي','salary','number',true,'آخر راتب أساسي فعّال من سجل الرواتب.','employee.view_salary'],
    ['housing_allowance','بدل السكن','salary','number',true,'آخر بدل سكن فعّال.','employee.view_salary'],
    ['transport_allowance','بدل النقل','salary','number',true,'آخر بدل نقل فعّال.','employee.view_salary'],
    ['other_allowances','بدلات أخرى','salary','number',true,'إجمالي البدلات الأخرى في سجل الراتب.','employee.view_salary'],
    ['gosi_number','رقم التأمينات','statutory','text',true,'رقم التأمينات المسجل.','employee.view_gosi'],
    ['residency_classification','تصنيف الإقامة','statutory','text',true,'تصنيف الإقامة المسجل.','employee.view_identity']
  ].map(([sourceKey,labelAr,group,type,sensitive,description,permission])=>({sourceKey,labelAr,group,type,sensitive,description,permission}));
  return c.json({systemFields,roles:roles.results.map((r:any)=>({code:r.code,nameAr:r.name_ar})),permissions:permissions.results});
});

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
  await ensurePhase6AuxTables(c);
  const parsed=typeSchema.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success){ const referenceId=crypto.randomUUID(); console.error('HR_NEXUS_WORKFLOW_INPUT', {referenceId,path:c.req.path,issues:parsed.error.issues}); return c.json({error:'WORKFLOW-001',referenceId,message:'يوجد حقل أو إعداد غير مكتمل في النموذج. افتح المشكلة المحددة داخل المصمم ثم صححها قبل الحفظ.',details:parsed.error.issues.map(i=>({path:i.path,message:i.message}))},400); }
  const d=parsed.data;
  const duplicate=await c.env.DB.prepare(`SELECT id FROM transaction_types WHERE company_id IS NULL AND TRIM(name_ar)=TRIM(?)`).bind(d.nameAr).first();
  if(duplicate)return errorResponse(c,'WORKFLOW-007',409);
  const typeId=crypto.randomUUID(),workflowId=crypto.randomUUID(),stageId=crypto.randomUUID(),actor=actorId(c);
  try{
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO transaction_types(id,company_id,name_ar,description,allowed_submitters_json,status,created_by,updated_by) VALUES(?,?,?,? ,?,'inactive',?,?)`).bind(typeId,null,d.nameAr,d.description??null,JSON.stringify(d.allowedSubmitters),actor,actor),
      c.env.DB.prepare(`INSERT INTO workflow_definitions(id,transaction_type_id,version,description,allowed_submitters_json,status,created_by,updated_by) VALUES(?,?,?,?,?,'draft',?,?)`).bind(workflowId,typeId,1,d.description??null,JSON.stringify(d.allowedSubmitters),actor,actor),
      c.env.DB.prepare(`INSERT INTO workflow_stages(id,workflow_id,name_ar,stage_order,responsible_type,active) VALUES(?,?,?,?,?,1)`).bind(stageId,workflowId,'المرحلة 1',1,'company_admin'),
      c.env.DB.prepare(`INSERT INTO workflow_request_settings(id,workflow_id,target_employee_enabled,target_employee_required) VALUES(?,?,0,0)`).bind(crypto.randomUUID(),workflowId)
    ]);
  }catch(e){return workflowDbError(c,e);}
  let auditRecorded=true;
  try { await audit(c,'workflow_template_created','workflow',workflowId,{transactionTypeId:typeId}); }
  catch (auditError) { auditRecorded=false; console.error('HR_NEXUS_WORKFLOW_AUDIT_FAILED',{path:c.req.path,workflowId,error:String(auditError)}); }
  return c.json({ok:true,id:typeId,workflowId,auditRecorded},201);
});


app.post('/admin/types/:id/new-draft', async c=>{
  await ensurePhase6AuxTables(c);
  const type=await getType(c,c.req.param('id'));
  if(!type)return errorResponse(c,'WORKFLOW-003',404);
  const existing=await c.env.DB.prepare(`SELECT id FROM workflow_definitions WHERE transaction_type_id=? AND status='draft' ORDER BY version DESC LIMIT 1`).bind(type.id).first<any>();
  if(existing)return c.json({ok:true,id:existing.id});
  const current=await c.env.DB.prepare(`SELECT MAX(version) version FROM workflow_definitions WHERE transaction_type_id=?`).bind(type.id).first<any>();
  const version=Number(current?.version||0)+1;
  const workflowId=crypto.randomUUID(),stageId=crypto.randomUUID(),actor=actorId(c);
  try{
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO workflow_definitions(id,transaction_type_id,version,description,allowed_submitters_json,status,created_by,updated_by) VALUES(?,?,?,?,?,'draft',?,?)`).bind(workflowId,type.id,version,type.description||null,type.allowed_submitters_json||'[]',actor,actor),
      c.env.DB.prepare(`INSERT INTO workflow_stages(id,workflow_id,name_ar,stage_order,responsible_type,active) VALUES(?,?,?,?,?,1)`).bind(stageId,workflowId,'المرحلة 1',1,'company_admin'),
      c.env.DB.prepare(`INSERT INTO workflow_request_settings(id,workflow_id,target_employee_enabled,target_employee_required) VALUES(?,?,0,0)`).bind(crypto.randomUUID(),workflowId)
    ]);
  }catch(e){return workflowDbError(c,e);}
  return c.json({ok:true,id:workflowId},201);
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
  await ensurePhase6AuxTables(c);
  const workflowId=c.req.param('id');
  const parsed=workflowSchema.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success){ const referenceId=crypto.randomUUID(); console.error('HR_NEXUS_WORKFLOW_INPUT', {referenceId,path:c.req.path,issues:parsed.error.issues}); return c.json({error:'WORKFLOW-001',referenceId,message:'بيانات القالب الأساسية غير مكتملة. راجع الاسم والمراحل والعناصر ثم حاول مرة أخرى.',details:parsed.error.issues.map(i=>({path:i.path,message:i.message}))},400); }
  const existing=await c.env.DB.prepare(`
    SELECT wd.*,tt.company_id type_company_id FROM workflow_definitions wd
    JOIN transaction_types tt ON tt.id=wd.transaction_type_id
    WHERE wd.id=? AND tt.company_id IS NULL
  `).bind(workflowId).first<any>();
  if(!existing)return errorResponse(c,'WORKFLOW-003',404);
  if(existing.status!=='draft')return errorResponse(c,'WORKFLOW-004',409);
  if(existing.transaction_type_id!==parsed.data.transactionTypeId){ const referenceId=crypto.randomUUID(); return c.json({error:'WORKFLOW-001',referenceId,message:'القالب المحدد لا يطابق نسخة سير العمل التي تحاول حفظها.',details:[{path:['transactionTypeId'],message:'أعد فتح القالب من قائمة قوالب المعاملات ثم حاول الحفظ مرة أخرى.'}]},400); }

  // Draft saves must be resilient to older/stale clients that omit optional
  // collections. If stages are omitted entirely, preserve the existing draft
  // stages rather than rejecting the whole save with a Zod 'Required' error.
  // An explicitly empty stages array is still invalid and is caught by
  // validation/publish so a usable draft can never silently lose its stages.
  let saveData:any = parsed.data;
  if (!Array.isArray(parsed.data.stages)) {
    const existingStages = (await c.env.DB.prepare(`SELECT id,name_ar,responsible_type,responsible_value,duration_minutes,stage_order,config_json FROM workflow_stages WHERE workflow_id=? AND active=1 ORDER BY stage_order`).bind(workflowId).all<any>()).results;
    saveData = {
      ...parsed.data,
      stages: existingStages.map((s:any)=>({
        id:s.id, nameAr:s.name_ar, responsibleType:s.responsible_type,
        responsibleValue:s.responsible_value ?? null, durationMinutes:s.duration_minutes ?? null,
        stageOrder:Number(s.stage_order || 0), config:safeJson(s.config_json,{})
      }))
    };
  }
  const normalized=normalizePayload(saveData);
  const invalidSystemFields=parsed.data.systemFields.filter((f:any)=>!systemFieldKeys.has(f.sourceKey) || (f.scope==='target' && !parsed.data.targetEmployeeEnabled));
  if(invalidSystemFields.length){ return c.json({error:'WORKFLOW-001',referenceId:crypto.randomUUID(),message:'يوجد اختيار غير صالح ضمن بيانات النظام.',details:invalidSystemFields.map((f:any)=>({path:['systemFields',f.sourceKey],message:f.scope==='target'&&!parsed.data.targetEmployeeEnabled?'فعّل الموظف المعني أولًا.':'بيان النظام غير متاح.'}))},400); }
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
      `).bind(s.id,workflowId,s.nameAr,null,s.stageOrder,s.responsibleType,s.responsibleValue??null,s.durationMinutes??null,JSON.stringify(s.config??{})));
    }
    for(const f of normalized.fields){
      const config={displayOnly:Boolean(f.displayOnly), staticText:String(f.staticText||'')};
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
    statements.push(c.env.DB.prepare(`INSERT INTO workflow_request_settings(id,workflow_id,target_employee_enabled,target_employee_required) VALUES(?,?,?,?) ON CONFLICT(workflow_id) DO UPDATE SET target_employee_enabled=excluded.target_employee_enabled,target_employee_required=excluded.target_employee_required,updated_at=CURRENT_TIMESTAMP`).bind(crypto.randomUUID(),workflowId,parsed.data.targetEmployeeEnabled?1:0,parsed.data.targetEmployeeRequired?1:0));
    statements.push(c.env.DB.prepare(`DELETE FROM workflow_system_fields WHERE workflow_id=?`).bind(workflowId));
    for(const f of parsed.data.systemFields){
      statements.push(c.env.DB.prepare(`INSERT INTO workflow_system_fields(id,workflow_id,scope,source_key,label_ar,sort_order,active) VALUES(?,?,?,?,?,?,1)`).bind(crypto.randomUUID(),workflowId,f.scope,f.sourceKey,f.labelAr,f.sortOrder));
    }
    await c.env.DB.batch(statements);
  }catch(e){return workflowDbError(c,e);}
  await audit(c,'workflow_draft_saved','workflow',workflowId,{validationErrors:validation.errors.length,stageCount:normalized.stages.length,fieldCount:normalized.fields.length});
  return c.json({ok:true,validation});
});

app.post('/admin/workflows/:id/validate', async c=>{
  const w=await loadWorkflow(c,c.req.param('id'));
  if(!w)return errorResponse(c,'WORKFLOW-003',404);
  const result=validateModel({allowedSubmitters:w.workflow.allowed_submitters,stages:w.stages,fields:w.fields,transitions:w.transitions});
  if(w.requestSettings.targetEmployeeRequired && !w.requestSettings.targetEmployeeEnabled) result.errors.push({code:'TARGET_REQUIRED',message:'الموظف المعني مضبوط كمطلوب لكنه غير مفعّل.'});
  if(!w.systemFields.some((x:any)=>x.scope==='requester')) result.warnings.push({code:'REQUESTER_DATA',message:'لم يختر المصمم أي بيانات نظامية لمقدم الطلب.'});
  if(result.errors.length) result.valid=false;
  return c.json(result);
});

app.post('/admin/workflows/:id/publish', async c=>{
  const id=c.req.param('id');
  const w=await loadWorkflow(c,id);
  if(!w)return errorResponse(c,'WORKFLOW-003',404);
  if(w.workflow.status!=='draft')return errorResponse(c,'WORKFLOW-004',409);
  const validation=validateModel({allowedSubmitters:w.workflow.allowed_submitters,stages:w.stages,fields:w.fields,transitions:w.transitions});
  if(w.requestSettings.targetEmployeeRequired && !w.requestSettings.targetEmployeeEnabled) validation.errors.push({code:'TARGET_REQUIRED',message:'الموظف المعني مضبوط كمطلوب لكنه غير مفعّل.'});
  if(!w.systemFields.some((x:any)=>x.scope==='requester')) validation.warnings.push({code:'REQUESTER_DATA',message:'لم يختر المصمم أي بيانات نظامية لمقدم الطلب.'});
  if(validation.errors.length) validation.valid=false;
  if(!validation.valid)return c.json({error:'WORKFLOW_VALIDATION',referenceId:crypto.randomUUID(),message:'لا يمكن اعتماد القالب قبل إصلاح أخطاء التحقق.',validation},400);
  try{
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE workflow_definitions SET status='inactive',updated_at=CURRENT_TIMESTAMP WHERE transaction_type_id=? AND status='active'`).bind(w.workflow.transaction_type_id),
      c.env.DB.prepare(`UPDATE workflow_definitions SET status='active',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(actorId(c),id),
      c.env.DB.prepare(`UPDATE transaction_types SET status='active',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(actorId(c),w.workflow.transaction_type_id)
    ]);
  }catch(e){return workflowDbError(c,e);}
  await audit(c,'workflow_published','workflow',id,{version:w.workflow.version});
  return c.json({ok:true,status:'active'});
});

app.post('/admin/workflows/:id/deactivate', async c=>{
  const id=c.req.param('id');
  const w=await loadWorkflow(c,id);
  if(!w)return errorResponse(c,'WORKFLOW-003',404);
  try{
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE workflow_definitions SET status='inactive',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(actorId(c),id),
      c.env.DB.prepare(`UPDATE transaction_types SET status='inactive',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(actorId(c),w.workflow.transaction_type_id)
    ]);
  }catch(e){return workflowDbError(c,e);}
  await audit(c,'workflow_deactivated','workflow',id,{});
  return c.json({ok:true});
});

/* Isolated test environment: it only reads a draft and returns its definition.
   It never inserts employees, users, transactions, answers or history into D1. */
app.post('/admin/transactions/cleanup', async c=>{
  /* Super Admin only. Full Phase 6 reset. It is intentionally resilient to
     partially applied Phase 6 migrations: missing Phase-6 tables are skipped,
     while Phase 1-5 tables are never referenced. */
  const tables=[
    'transaction_attachments',
    'transaction_feedback',
    'transaction_actions',
    'transaction_answers',
    'transaction_stage_executions',
    'transactions',
    'transaction_sequences',
    'workflow_transitions',
    'workflow_conditions',
    'workflow_questions_v2',
    'workflow_questions',
    'workflow_system_fields',
    'workflow_request_settings',
    'workflow_fields',
    'workflow_stages',
    'workflow_definitions',
    'transaction_type_companies',
    'transaction_types'
  ];
  try{
    const existingTables=(await Promise.all(tables.map(async table=>[table,await tableExists(c,table)] as const)))
      .filter((x):x is readonly [string,true]=>x[1]);
    const existing=existingTables.map(x=>x[0]);
    const counts=await Promise.all(existing.map(async table=>{
      const row=await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<any>();
      return [table,Number(row?.count||0)] as const;
    }));
    const cleanupStatements: D1PreparedStatement[]=[];
    if(existing.length){
      cleanupStatements.push(...existing.map(table=>c.env.DB.prepare(`DELETE FROM ${table}`)));
    }
    if(await tableExists(c,'audit_logs')){
      cleanupStatements.push(c.env.DB.prepare(`DELETE FROM audit_logs WHERE resource IN ('workflow','workflow_engine','transaction') OR action LIKE 'workflow_%' OR action LIKE 'transaction_%'`));
    }
    if(cleanupStatements.length){
      await c.env.DB.batch(cleanupStatements);
    }
    return c.json({
      ok:true,
      reset:true,
      message:'تم تصفير جميع بيانات Phase 6 الخاصة بالمعاملات وسير العمل. الاستوديو جاهز للبدء من الصفر.',
      deleted:Object.fromEntries(counts)
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
  const id=c.req.param('id');
  const requestedWorkflowId=c.req.query('workflowId')||'';
  let type=await getType(c,id);
  let workflowId=requestedWorkflowId||'';

  // The test UI historically passed the transaction_type id. Newer links may
  // also pass the exact draft workflow id. Accept both so a test request can
  // never fail merely because the UI used the workflow identifier.
  if(!type){
    const wf=await c.env.DB.prepare(`
      SELECT wd.*,tt.id type_id,tt.name_ar type_name_ar,tt.description type_description,tt.allowed_submitters_json type_allowed_submitters,tt.status type_status
      FROM workflow_definitions wd
      JOIN transaction_types tt ON tt.id=wd.transaction_type_id
      WHERE wd.id=? AND tt.company_id IS NULL
      LIMIT 1
    `).bind(id).first<any>();
    if(wf){
      type={
        id:wf.type_id,
        company_id:null,
        name_ar:wf.type_name_ar,
        description:wf.type_description,
        allowed_submitters_json:wf.type_allowed_submitters,
        status:wf.type_status
      };
      workflowId=workflowId||wf.id;
    }
  }

  if(!type)return errorResponse(c,'WORKFLOW-003',404);

  if(workflowId){
    const owned=await c.env.DB.prepare(`SELECT id FROM workflow_definitions WHERE id=? AND transaction_type_id=? LIMIT 1`).bind(workflowId,type.id).first<any>();
    if(!owned)workflowId='';
  }

  if(!workflowId){
    workflowId=(await c.env.DB.prepare(`SELECT id FROM workflow_definitions WHERE transaction_type_id=? AND status='draft' ORDER BY version DESC LIMIT 1`).bind(type.id).first<any>())?.id||'';
  }
  if(!workflowId){
    workflowId=(await c.env.DB.prepare(`SELECT id FROM workflow_definitions WHERE transaction_type_id=? AND status='active' ORDER BY version DESC LIMIT 1`).bind(type.id).first<any>())?.id||'';
  }
  if(!workflowId)return errorResponse(c,'WORKFLOW-003',404);

  const workflow=await loadWorkflow(c,workflowId);
  if(!workflow)return errorResponse(c,'WORKFLOW-003',404);
  const validation=validateModel({allowedSubmitters:workflow.workflow.allowed_submitters,stages:workflow.stages,fields:workflow.fields,transitions:workflow.transitions});
  return c.json({type,workflow,validation,testRequester:{name:'موظف الاختبار',employeeNumber:'SIM-0001',jobTitle:'بيانات وظيفية محاكاة',organizationUnit:'الوحدة التنظيمية المحاكاة',position:'المنصب المحاكى',manager:'المدير المباشر المحاكى'},testExecutor:{platformUserId:actorId(c),displayName:'مدير النظام',username:'superadmin',role:'Super Admin'}});
});

export default app;
