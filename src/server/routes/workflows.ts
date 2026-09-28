import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { audit } from '../audit';
import { hasPermission } from '../authorization';
import { errorResponse, type AppErrorCode } from '../errors';
import { requireAuthentication, requireCompanyContext, requirePasswordChanged, requireSuperAdmin } from '../middleware/session';

const app = new Hono<Env>();

const statusValues=['قيد الإجراء','مكتملة','ملغية','مرفوضة'] as const;
const typeSchema=z.object({nameAr:z.string().trim().min(2).max(160),nameEn:z.string().trim().max(160).nullable().optional(),description:z.string().trim().max(1000).nullable().optional(),status:z.enum(['active','inactive']).default('active'),companyId:z.string().uuid().nullable().optional(),companyIds:z.array(z.string().uuid()).optional()});
const stageSchema=z.object({id:z.string().uuid().optional(),nameAr:z.string().trim().min(2).max(160),nameEn:z.string().trim().max(160).nullable().optional(),stageOrder:z.number().int().min(1),responsibleType:z.enum(['company_admin','role','user','manager','position_holder','department_manager','permission']).default('company_admin'),responsibleValue:z.string().trim().max(200).nullable().optional(),durationMinutes:z.number().int().min(1).max(525600).nullable().optional(),config:z.record(z.any()).optional(),active:z.boolean().default(true)});
const fieldSchema=z.object({id:z.string().uuid().optional(),stageId:z.string().uuid().nullable().optional(),fieldKey:z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]{1,80}$/),labelAr:z.string().trim().min(1).max(160),labelEn:z.string().trim().max(160).nullable().optional(),fieldType:z.enum(['text','textarea','number','date','datetime','boolean','select','multiselect','employee','organization_unit','position','user']),required:z.boolean().default(false),options:z.array(z.any()).optional(),config:z.record(z.any()).optional(),sortOrder:z.number().int().min(0).default(0),active:z.boolean().default(true)});
const questionSchema=z.object({id:z.string().uuid().optional(),stageId:z.string().uuid(),questionKey:z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]{1,80}$/),questionAr:z.string().trim().min(1).max(500),questionEn:z.string().trim().max(500).nullable().optional(),questionType:z.enum(['text','yes_no','select','notes']),required:z.boolean().default(false),options:z.array(z.any()).optional(),sortOrder:z.number().int().min(0).default(0),active:z.boolean().default(true)});
const transitionSchema=z.object({id:z.string().uuid().optional(),fromStageId:z.string().uuid(),toStageId:z.string().uuid().nullable().optional(),action:z.enum(['next','return','complete','reject','cancel']),labelAr:z.string().trim().min(1).max(160),condition:z.record(z.any()).nullable().optional(),sortOrder:z.number().int().min(0).default(0),active:z.boolean().default(true)});
const workflowSchema=z.object({transactionTypeId:z.string().uuid(),description:z.string().trim().max(1000).nullable().optional(),allowedSubmitters:z.array(z.string().trim().min(1).max(200)).max(100).default([]),status:z.enum(['draft','active','inactive']).default('draft'),stages:z.array(stageSchema).min(1).max(100),fields:z.array(fieldSchema).max(300).default([]),questions:z.array(questionSchema).max(500).default([]),transitions:z.array(transitionSchema).max(1000).default([])});
const createTxSchema=z.object({transactionTypeId:z.string().uuid(),employeeId:z.string().uuid().nullable().optional(),data:z.record(z.any()).default({}),answers:z.record(z.any()).default({})});
const actionSchema=z.object({action:z.enum(['next','complete','reject','cancel','return']),reason:z.string().trim().max(1000).nullable().optional(),answers:z.record(z.any()).optional(),toStageId:z.string().uuid().nullable().optional()});
const feedbackSchema=z.object({feedback:z.string().trim().min(1).max(4000)});

function sessionCompany(c:any){return c.get('session')?.activeCompanyId as string|null;}
function isSuper(c:any){return Boolean(c.get('session')?.platformUserId);}
async function allowed(c:any,p:string){return hasPermission(c,p);}
function forbidden(c:any,code:AppErrorCode='AUTH-001'){return errorResponse(c,code,403);}
function parseJson(value:any, fallback:any={}){try{return value?JSON.parse(value):fallback}catch{return fallback;}}
function actorId(c:any){const s=c.get('session');return s?.companyUserId??s?.platformUserId??null;}

async function allocateNumber(c:any,companyId:string){
  await c.env.DB.prepare(`INSERT OR IGNORE INTO transaction_sequences(company_id,next_number) VALUES(?,1)`).bind(companyId).run();
  const row=await c.env.DB.prepare(`UPDATE transaction_sequences SET next_number=next_number+1,updated_at=CURRENT_TIMESTAMP WHERE company_id=? RETURNING next_number`).bind(companyId).first<any>();
  if(!row) throw new Error('SEQUENCE_ALLOCATION_FAILED');
  return Number(row.next_number)-1;
}

async function loadWorkflow(c:any,workflowId:string){
  const workflow=await c.env.DB.prepare(`SELECT wd.*,tt.name_ar transaction_type_name,tt.company_id transaction_type_company_id,tt.status transaction_type_status FROM workflow_definitions wd JOIN transaction_types tt ON tt.id=wd.transaction_type_id WHERE wd.id=?`).bind(workflowId).first<any>();
  if(!workflow)return null;
  const stages=await c.env.DB.prepare(`SELECT * FROM workflow_stages WHERE workflow_id=? AND active=1 ORDER BY stage_order`).bind(workflowId).all<any>();
  const fields=await c.env.DB.prepare(`SELECT * FROM workflow_fields WHERE workflow_id=? AND active=1 ORDER BY sort_order,label_ar`).bind(workflowId).all<any>();
  const questions=await c.env.DB.prepare(`SELECT * FROM workflow_questions WHERE workflow_id=? AND active=1 ORDER BY stage_id,sort_order`).bind(workflowId).all<any>();
  const transitions=await c.env.DB.prepare(`SELECT * FROM workflow_transitions WHERE workflow_id=? AND active=1 ORDER BY from_stage_id,sort_order`).bind(workflowId).all<any>();
  workflow.allowed_submitters=parseJson(workflow.allowed_submitters_json,[]); return {workflow,stages:stages.results.map((x:any)=>({...x,config:parseJson(x.config_json,{})})),fields:fields.results.map((x:any)=>({...x,options:parseJson(x.options_json,[]),config:parseJson(x.config_json,{})})),questions:questions.results.map((x:any)=>({...x,options:parseJson(x.options_json,[])})),transitions:transitions.results.map((x:any)=>({...x,condition:parseJson(x.condition_json,null)}))};
}

function visibleTypeSql(companyId:string){
  return `SELECT tt.*, CASE WHEN tt.company_id IS NULL THEN 1 ELSE 0 END is_global
          FROM transaction_types tt
          WHERE tt.status='active' AND (tt.company_id=? OR tt.company_id IS NULL OR EXISTS(SELECT 1 FROM transaction_type_companies ttc WHERE ttc.transaction_type_id=tt.id AND ttc.company_id=? AND ttc.active=1))`;
}

// Super Admin configuration endpoints.
app.use('/admin/*',requireAuthentication,requirePasswordChanged,requireSuperAdmin);
app.get('/admin/companies',async c=>{
  const rows=await c.env.DB.prepare(`SELECT id,company_identifier,display_name,status FROM companies WHERE status='active' ORDER BY display_name`).all<any>();
  return c.json({items:rows.results});
});
app.post('/admin/transactions/clear',async c=>{
  const row=await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM transactions`).first<any>();
  const typeRow=await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM transaction_types`).first<any>();
  const transactionCount=Number(row?.count||0);
  const typeCount=Number(typeRow?.count||0);
  const body=await c.req.json().catch(()=>null) as any;
  const resetStudio=body?.resetStudio!==false;
  try{
    if(resetStudio){
      // Full Phase 6 reset: transactions first (RESTRICT references), then the
      // type tree. Cascades remove workflows, stages, fields, questions,
      // transitions, conditions and company copies. Companies/users/employees
      // and permission definitions are intentionally preserved.
      await c.env.DB.batch([
        c.env.DB.prepare(`DELETE FROM transactions`),
        c.env.DB.prepare(`DELETE FROM transaction_sequences`),
        c.env.DB.prepare(`DELETE FROM transaction_types`)
      ]);
    }else{
      await c.env.DB.batch([c.env.DB.prepare(`DELETE FROM transactions`),c.env.DB.prepare(`DELETE FROM transaction_sequences`)]);
    }
  }catch(e){return errorResponse(c,'DB-001',500,e);}
  await audit(c,'workflow_transaction_engine_cleared','transaction_engine',null,{deletedTransactions:transactionCount,deletedTypes:resetStudio?typeCount:0,scope:'all_companies',sequencesReset:true,studioReset:resetStudio});
  return c.json({ok:true,deletedTransactions:transactionCount,deletedTypes:resetStudio?typeCount:0,studioReset:resetStudio});
});
app.get('/admin/types',async c=>{
  const rows=await c.env.DB.prepare(`SELECT tt.*,c.display_name company_name,(SELECT COUNT(*) FROM workflow_definitions wd WHERE wd.transaction_type_id=tt.id) workflow_count,(SELECT wd.version FROM workflow_definitions wd WHERE wd.transaction_type_id=tt.id AND wd.status='active' ORDER BY wd.version DESC LIMIT 1) workflow_version,
    (SELECT wd.status FROM workflow_definitions wd WHERE wd.transaction_type_id=tt.id ORDER BY CASE wd.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,wd.version DESC LIMIT 1) workflow_status FROM transaction_types tt LEFT JOIN companies c ON c.id=tt.company_id ORDER BY tt.created_at DESC`).all<any>();
  return c.json({items:rows.results});
});
app.post('/admin/types',async c=>{
  const p=typeSchema.safeParse(await c.req.json().catch(()=>null));if(!p.success)return errorResponse(c,'WORKFLOW-001',400);
  const d=p.data,id=crypto.randomUUID(),actor=actorId(c);
  try{await c.env.DB.prepare(`INSERT INTO transaction_types(id,company_id,name_ar,name_en,description,status,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?)`).bind(id,d.companyId??null,d.nameAr,d.nameEn??null,d.description??null,d.status,actor,actor).run();if(d.companyIds?.length){await c.env.DB.batch(d.companyIds.map(x=>c.env.DB.prepare(`INSERT OR IGNORE INTO transaction_type_companies(transaction_type_id,company_id,active) VALUES(?,?,1)`).bind(id,x)));}}catch(e){if(String(e).includes('UNIQUE'))return errorResponse(c,'WORKFLOW-002',409,e);return errorResponse(c,'DB-001',500,e);}await audit(c,'workflow_transaction_type_created','transaction_type',id,{after:d});return c.json({ok:true,id},201);
});
app.patch('/admin/types/:id',async c=>{
  const p=typeSchema.partial().safeParse(await c.req.json().catch(()=>null));if(!p.success)return errorResponse(c,'WORKFLOW-001',400);const before=await c.env.DB.prepare(`SELECT * FROM transaction_types WHERE id=?`).bind(c.req.param('id')).first<any>();if(!before)return errorResponse(c,'WORKFLOW-003',404);const d=p.data;const sets:string[]=[];const vals:any[]=[];for(const [k,col] of Object.entries({nameAr:'name_ar',nameEn:'name_en',description:'description',status:'status',companyId:'company_id'})){if((d as any)[k]!==undefined){sets.push(`${col}=?`);vals.push((d as any)[k]??null);}}if(!sets.length)return errorResponse(c,'WORKFLOW-001',400);sets.push('updated_at=CURRENT_TIMESTAMP','updated_by=?');vals.push(actorId(c),c.req.param('id'));try{await c.env.DB.prepare(`UPDATE transaction_types SET ${sets.join(',')} WHERE id=?`).bind(...vals).run();}catch(e){return errorResponse(c,'DB-001',500,e);}await audit(c,'workflow_transaction_type_updated','transaction_type',c.req.param('id'),{before,after:d});return c.json({ok:true});
});
app.get('/admin/types/:id',async c=>{const row=await c.env.DB.prepare(`SELECT tt.*,c.display_name company_name FROM transaction_types tt LEFT JOIN companies c ON c.id=tt.company_id WHERE tt.id=?`).bind(c.req.param('id')).first<any>();if(!row)return errorResponse(c,'WORKFLOW-003',404);const companies=await c.env.DB.prepare(`SELECT ttc.company_id,c.display_name,c.company_identifier,ttc.active FROM transaction_type_companies ttc JOIN companies c ON c.id=ttc.company_id WHERE ttc.transaction_type_id=?`).bind(c.req.param('id')).all<any>();return c.json({type:row,companies:companies.results,workflow:(await c.env.DB.prepare(`SELECT * FROM workflow_definitions WHERE transaction_type_id=? ORDER BY version DESC`).bind(c.req.param('id')).all<any>()).results});});

app.post('/admin/workflows',async c=>{
  const p=workflowSchema.safeParse(await c.req.json().catch(()=>null));if(!p.success)return errorResponse(c,'WORKFLOW-001',400);const d=p.data;
  const type=await c.env.DB.prepare(`SELECT id,status FROM transaction_types WHERE id=?`).bind(d.transactionTypeId).first<any>();if(!type)return errorResponse(c,'WORKFLOW-003',404);if(type.status!=='active')return errorResponse(c,'WORKFLOW-004',400);
  const workflowId=crypto.randomUUID(),actor=actorId(c);
  try{
    if(d.status==='active')await c.env.DB.prepare(`UPDATE workflow_definitions SET status='inactive',updated_at=CURRENT_TIMESTAMP WHERE transaction_type_id=? AND status='active'`).bind(d.transactionTypeId).run();
    await c.env.DB.prepare(`INSERT INTO workflow_definitions(id,transaction_type_id,version,description,allowed_submitters_json,status,created_by,updated_by) SELECT ?,?,COALESCE(MAX(version),0)+1,?,?,?, ?,? FROM workflow_definitions WHERE transaction_type_id=?`).bind(workflowId,d.transactionTypeId,d.description??null,JSON.stringify(d.allowedSubmitters??[]),d.status,actor,actor,d.transactionTypeId).run();
    const stageIds=new Set<string>(); const stageMap=new Map<string,string>();
    for(const s of d.stages){const incoming=s.id??crypto.randomUUID();if(stageIds.has(incoming))throw new Error('DUPLICATE_STAGE_ID');stageIds.add(incoming);const sid=crypto.randomUUID();stageMap.set(incoming,sid);await c.env.DB.prepare(`INSERT INTO workflow_stages(id,workflow_id,name_ar,name_en,stage_order,responsible_type,responsible_value,duration_minutes,config_json,active) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(sid,workflowId,s.nameAr,s.nameEn??null,s.stageOrder,s.responsibleType,s.responsibleValue??null,s.durationMinutes??null,JSON.stringify(s.config??{}),s.active?1:0).run();}
    for(const f of d.fields){const fid=crypto.randomUUID();if(f.stageId&&!stageIds.has(f.stageId))throw new Error('FIELD_STAGE_INVALID');await c.env.DB.prepare(`INSERT INTO workflow_fields(id,workflow_id,stage_id,field_key,label_ar,label_en,field_type,required,options_json,config_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(fid,workflowId,f.stageId?(stageMap.get(f.stageId)??null):null,f.fieldKey,f.labelAr,f.labelEn??null,f.fieldType,f.required?1:0,f.options?JSON.stringify(f.options):null,JSON.stringify(f.config??{}),f.sortOrder,f.active?1:0).run();}
    for(const q of d.questions){const qid=crypto.randomUUID();if(!stageIds.has(q.stageId))throw new Error('QUESTION_STAGE_INVALID');await c.env.DB.prepare(`INSERT INTO workflow_questions(id,workflow_id,stage_id,question_key,question_ar,question_en,question_type,required,options_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(qid,workflowId,stageMap.get(q.stageId),q.questionKey,q.questionAr,q.questionEn??null,q.questionType,q.required?1:0,q.options?JSON.stringify(q.options):null,q.sortOrder,q.active?1:0).run();}
    for(const t of d.transitions){if(!stageIds.has(t.fromStageId)||(t.toStageId&&!stageIds.has(t.toStageId)))throw new Error('TRANSITION_STAGE_INVALID');await c.env.DB.prepare(`INSERT INTO workflow_transitions(id,workflow_id,from_stage_id,to_stage_id,action,label_ar,condition_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),workflowId,stageMap.get(t.fromStageId),t.toStageId?(stageMap.get(t.toStageId)??null):null,t.action,t.labelAr,t.condition?JSON.stringify(t.condition):null,t.sortOrder,t.active?1:0).run();}
  }catch(e){return errorResponse(c,String(e).includes('UNIQUE')?'WORKFLOW-002':'WORKFLOW-005',400,e);}
  await audit(c,'workflow_definition_created','workflow',workflowId,{transactionTypeId:d.transactionTypeId,status:d.status,stageCount:d.stages.length});return c.json({ok:true,id:workflowId},201);
});
app.post('/admin/types/:id/activate-draft',async c=>{
  const typeId=c.req.param('id');
  const type=await c.env.DB.prepare(`SELECT id,status FROM transaction_types WHERE id=?`).bind(typeId).first<any>();
  if(!type)return errorResponse(c,'WORKFLOW-003',404);
  const draft=await c.env.DB.prepare(`SELECT id,version FROM workflow_definitions WHERE transaction_type_id=? AND status='draft' ORDER BY version DESC,created_at DESC LIMIT 1`).bind(typeId).first<any>();
  if(!draft)return errorResponse(c,'WORKFLOW-006',400);
  try{
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE workflow_definitions SET status='inactive',updated_at=CURRENT_TIMESTAMP WHERE transaction_type_id=? AND status='active'`).bind(typeId),
      c.env.DB.prepare(`UPDATE workflow_definitions SET status='active',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(actorId(c),draft.id)
    ]);
  }catch(e){return errorResponse(c,'DB-001',500,e);}
  await audit(c,'workflow_draft_activated','workflow',draft.id,{transactionTypeId:typeId,version:draft.version});
  return c.json({ok:true,id:draft.id,version:draft.version});
});
app.post('/admin/types/:id/publish',async c=>{
  const body=await c.req.json().catch(()=>null) as any;
  const companyIds=Array.isArray(body?.companyIds)?body.companyIds.filter((x:any)=>typeof x==='string'):[];
  if(!companyIds.length)return errorResponse(c,'WORKFLOW-001',400);
  const source=await c.env.DB.prepare(`SELECT * FROM transaction_types WHERE id=?`).bind(c.req.param('id')).first<any>();
  if(!source)return errorResponse(c,'WORKFLOW-003',404);
  const sourceWorkflow=await c.env.DB.prepare(`SELECT * FROM workflow_definitions WHERE transaction_type_id=? AND status='active' ORDER BY version DESC LIMIT 1`).bind(source.id).first<any>();
  if(!sourceWorkflow)return errorResponse(c,'WORKFLOW-006',400);
  const actor=actorId(c); const results:any[]=[];
  try{
    for(const companyId of [...new Set(companyIds)]){
      const company=await c.env.DB.prepare(`SELECT id,display_name FROM companies WHERE id=? AND status='active'`).bind(companyId).first<any>();
      if(!company)continue;
      const existing=await c.env.DB.prepare(`SELECT id FROM transaction_types WHERE company_id=? AND name_ar=?`).bind(companyId,source.name_ar).first<any>();
      if(existing){results.push({companyId,status:'exists',typeId:existing.id});continue;}
      const newTypeId=crypto.randomUUID(), newWorkflowId=crypto.randomUUID();
      await c.env.DB.prepare(`INSERT INTO transaction_types(id,company_id,name_ar,name_en,description,status,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?)`).bind(newTypeId,companyId,source.name_ar,source.name_en??null,source.description??null,'active',actor,actor).run();
      await c.env.DB.prepare(`INSERT INTO workflow_definitions(id,transaction_type_id,version,description,allowed_submitters_json,status,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?)`).bind(newWorkflowId,newTypeId,sourceWorkflow.version,sourceWorkflow.description??null,sourceWorkflow.allowed_submitters_json??'[]','active',actor,actor).run();
      const stageRows=(await c.env.DB.prepare(`SELECT * FROM workflow_stages WHERE workflow_id=? AND active=1 ORDER BY stage_order`).bind(sourceWorkflow.id).all<any>()).results;
      const stageMap=new Map<string,string>();
      for(const st of stageRows){const id=crypto.randomUUID();stageMap.set(st.id,id);await c.env.DB.prepare(`INSERT INTO workflow_stages(id,workflow_id,name_ar,name_en,stage_order,responsible_type,responsible_value,duration_minutes,config_json,active) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(id,newWorkflowId,st.name_ar,st.name_en??null,st.stage_order,st.responsible_type,st.responsible_value??null,st.duration_minutes??null,st.config_json??'{}',1).run();}
      const fieldRows=(await c.env.DB.prepare(`SELECT * FROM workflow_fields WHERE workflow_id=? AND active=1 ORDER BY sort_order`).bind(sourceWorkflow.id).all<any>()).results;
      for(const f of fieldRows){await c.env.DB.prepare(`INSERT INTO workflow_fields(id,workflow_id,stage_id,field_key,label_ar,label_en,field_type,required,options_json,config_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),newWorkflowId,f.stage_id?stageMap.get(f.stage_id):null,f.field_key,f.label_ar,f.label_en??null,f.field_type,f.required,f.options_json??null,f.config_json??'{}',f.sort_order,1).run();}
      const questionRows=(await c.env.DB.prepare(`SELECT * FROM workflow_questions WHERE workflow_id=? AND active=1 ORDER BY sort_order`).bind(sourceWorkflow.id).all<any>()).results;
      for(const q of questionRows){const stageId=stageMap.get(q.stage_id);if(!stageId)continue;await c.env.DB.prepare(`INSERT INTO workflow_questions(id,workflow_id,stage_id,question_key,question_ar,question_en,question_type,required,options_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),newWorkflowId,stageId,q.question_key,q.question_ar,q.question_en??null,q.question_type,q.required,q.options_json??null,q.sort_order,1).run();}
      const transitionRows=(await c.env.DB.prepare(`SELECT * FROM workflow_transitions WHERE workflow_id=? AND active=1 ORDER BY sort_order`).bind(sourceWorkflow.id).all<any>()).results;
      for(const t of transitionRows){const from=stageMap.get(t.from_stage_id);if(!from)continue;const to=t.to_stage_id?stageMap.get(t.to_stage_id):null;await c.env.DB.prepare(`INSERT INTO workflow_transitions(id,workflow_id,from_stage_id,to_stage_id,action,label_ar,condition_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),newWorkflowId,from,to,t.action,t.label_ar,t.condition_json??null,t.sort_order,1).run();}
      results.push({companyId,companyName:company.display_name,status:'published',typeId:newTypeId,workflowId:newWorkflowId,version:sourceWorkflow.version});
      await audit(c,'workflow_transaction_type_published','transaction_type',newTypeId,{sourceTypeId:source.id,companyId,workflowVersion:sourceWorkflow.version});
    }
  }catch(e){return errorResponse(c,'WORKFLOW-005',400,e);}
  return c.json({ok:true,results});
});

app.get('/admin/company-transactions',async c=>{
  const rows=await c.env.DB.prepare(`SELECT c.id,c.company_identifier,c.display_name,c.status,
    (SELECT COUNT(*) FROM transaction_types tt WHERE tt.company_id=c.id AND tt.status='active') type_count,
    (SELECT COUNT(*) FROM transactions t WHERE t.company_id=c.id) transaction_count
    FROM companies c WHERE c.status='active' ORDER BY c.display_name`).all<any>();
  return c.json({items:rows.results});
});
app.get('/admin/company-transactions/:companyId/types',async c=>{
  const companyId=c.req.param('companyId');
  const company=await c.env.DB.prepare(`SELECT id,company_identifier,display_name,status FROM companies WHERE id=?`).bind(companyId).first<any>();
  if(!company)return errorResponse(c,'WORKFLOW-003',404);
  const rows=await c.env.DB.prepare(`SELECT tt.id,tt.name_ar,tt.name_en,tt.description,tt.status,wd.id workflow_id,wd.version workflow_version,wd.status workflow_status,
    (SELECT COUNT(*) FROM transactions t WHERE t.transaction_type_id=tt.id AND t.company_id=tt.company_id) transaction_count
    FROM transaction_types tt LEFT JOIN workflow_definitions wd ON wd.transaction_type_id=tt.id AND wd.status='active'
    WHERE tt.company_id=? ORDER BY tt.name_ar`).bind(companyId).all<any>();
  return c.json({company,items:rows.results});
});
app.get('/admin/company-transactions/:companyId/list',async c=>{
  const companyId=c.req.param('companyId');
  const company=await c.env.DB.prepare(`SELECT id,company_identifier,display_name,status FROM companies WHERE id=?`).bind(companyId).first<any>();
  if(!company)return errorResponse(c,'WORKFLOW-003',404);
  const typeId=c.req.query('typeId');
  const params:any[]=[companyId];
  let sql=`SELECT t.id,t.transaction_number,t.status,t.created_at,t.updated_at,tt.name_ar transaction_type_name,ws.name_ar stage_name,
    TRIM(COALESCE(e.first_name,'')||' '||COALESCE(e.father_name,'')||' '||COALESCE(e.family_name,'')) employee_name
    FROM transactions t JOIN transaction_types tt ON tt.id=t.transaction_type_id LEFT JOIN workflow_stages ws ON ws.id=t.current_stage_id
    LEFT JOIN employees e ON e.id=t.employee_id AND e.company_id=t.company_id WHERE t.company_id=?`;
  if(typeId){sql+=` AND t.transaction_type_id=?`;params.push(typeId);}sql+=` ORDER BY t.updated_at DESC LIMIT 200`;
  const rows=await c.env.DB.prepare(sql).bind(...params).all<any>();
  return c.json({company,items:rows.results});
});
app.get('/admin/company-transactions/:companyId/transactions/:id',async c=>{
  const companyId=c.req.param('companyId'),id=c.req.param('id');
  const tx=await c.env.DB.prepare(`SELECT t.*,tt.name_ar transaction_type_name,tt.name_en transaction_type_name_en,ws.name_ar stage_name,
    TRIM(COALESCE(e.first_name,'')||' '||COALESCE(e.father_name,'')||' '||COALESCE(e.family_name,'')) employee_name
    FROM transactions t JOIN transaction_types tt ON tt.id=t.transaction_type_id LEFT JOIN workflow_stages ws ON ws.id=t.current_stage_id
    LEFT JOIN employees e ON e.id=t.employee_id AND e.company_id=t.company_id WHERE t.id=? AND t.company_id=?`).bind(id,companyId).first<any>();
  if(!tx)return errorResponse(c,'TRANSACTION-007',404);
  const workflow=await loadWorkflow(c,tx.workflow_id);
  const history=await c.env.DB.prepare(`SELECT tse.*,ws.name_ar stage_name FROM transaction_stage_executions tse JOIN workflow_stages ws ON ws.id=tse.stage_id WHERE tse.transaction_id=? ORDER BY tse.execution_order`).bind(id).all<any>();
  const actions=await c.env.DB.prepare(`SELECT * FROM transaction_actions WHERE transaction_id=? ORDER BY created_at,id`).bind(id).all<any>();
  const answers=await c.env.DB.prepare(`SELECT ta.*,wf.field_key,wf.label_ar field_label,wq.question_key,wq.question_ar question_label FROM transaction_answers ta LEFT JOIN workflow_fields wf ON wf.id=ta.field_id LEFT JOIN workflow_questions wq ON wq.id=ta.question_id WHERE ta.transaction_id=?`).bind(id).all<any>();
  return c.json({company,transaction:{...tx,data:parseJson(tx.data_json,{})},workflow,history:history.results,actions:actions.results,answers:answers.results.map((x:any)=>({...x,value:parseJson(x.value_json,null)}))});
});

app.get('/admin/workflows/:id',async c=>{const data=await loadWorkflow(c,c.req.param('id'));if(!data)return errorResponse(c,'WORKFLOW-003',404);return c.json(data);});
app.patch('/admin/workflows/:id',async c=>{
  const workflowId=c.req.param('id');
  const p=workflowSchema.safeParse(await c.req.json().catch(()=>null));
  if(!p.success)return errorResponse(c,'WORKFLOW-001',400);
  const d=p.data;
  const existing=await c.env.DB.prepare(`SELECT * FROM workflow_definitions WHERE id=?`).bind(workflowId).first<any>();
  if(!existing)return errorResponse(c,'WORKFLOW-003',404);
  if(existing.transaction_type_id!==d.transactionTypeId)return errorResponse(c,'WORKFLOW-001',400);
  const actor=actorId(c);
  try{
    if(d.status==='active')await c.env.DB.prepare(`UPDATE workflow_definitions SET status='inactive',updated_at=CURRENT_TIMESTAMP WHERE transaction_type_id=? AND id<>? AND status='active'`).bind(d.transactionTypeId,workflowId).run();
    await c.env.DB.prepare(`UPDATE workflow_definitions SET description=?,allowed_submitters_json=?,status=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(d.description??null,JSON.stringify(d.allowedSubmitters??[]),d.status,actor,workflowId).run();
    await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM workflow_fields WHERE workflow_id=?`).bind(workflowId),
      c.env.DB.prepare(`DELETE FROM workflow_questions WHERE workflow_id=?`).bind(workflowId),
      c.env.DB.prepare(`DELETE FROM workflow_conditions WHERE workflow_id=?`).bind(workflowId),
      c.env.DB.prepare(`DELETE FROM workflow_transitions WHERE workflow_id=?`).bind(workflowId),
      c.env.DB.prepare(`DELETE FROM workflow_stages WHERE workflow_id=?`).bind(workflowId)
    ]);
    const stageIds=new Set<string>(); const stageMap=new Map<string,string>();
    for(const st of d.stages){const incoming=st.id??crypto.randomUUID();if(stageIds.has(incoming))throw new Error('DUPLICATE_STAGE_ID');stageIds.add(incoming);const sid=crypto.randomUUID();stageMap.set(incoming,sid);await c.env.DB.prepare(`INSERT INTO workflow_stages(id,workflow_id,name_ar,name_en,stage_order,responsible_type,responsible_value,duration_minutes,config_json,active) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(sid,workflowId,st.nameAr,st.nameEn??null,st.stageOrder,st.responsibleType,st.responsibleValue??null,st.durationMinutes??null,JSON.stringify(st.config??{}),st.active?1:0).run();}
    for(const f of d.fields){if(f.stageId&&!stageIds.has(f.stageId))throw new Error('FIELD_STAGE_INVALID');await c.env.DB.prepare(`INSERT INTO workflow_fields(id,workflow_id,stage_id,field_key,label_ar,label_en,field_type,required,options_json,config_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),workflowId,f.stageId?(stageMap.get(f.stageId)??null):null,f.fieldKey,f.labelAr,f.labelEn??null,f.fieldType,f.required?1:0,f.options?JSON.stringify(f.options):null,JSON.stringify(f.config??{}),f.sortOrder,f.active?1:0).run();}
    for(const q of d.questions){if(!stageIds.has(q.stageId))throw new Error('QUESTION_STAGE_INVALID');await c.env.DB.prepare(`INSERT INTO workflow_questions(id,workflow_id,stage_id,question_key,question_ar,question_en,question_type,required,options_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),workflowId,stageMap.get(q.stageId),q.questionKey,q.questionAr,q.questionEn??null,q.questionType,q.required?1:0,q.options?JSON.stringify(q.options):null,q.sortOrder,q.active?1:0).run();}
    for(const t of d.transitions){if(!stageIds.has(t.fromStageId)||(t.toStageId&&!stageIds.has(t.toStageId)))throw new Error('TRANSITION_STAGE_INVALID');await c.env.DB.prepare(`INSERT INTO workflow_transitions(id,workflow_id,from_stage_id,to_stage_id,action,label_ar,condition_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),workflowId,stageMap.get(t.fromStageId),t.toStageId?(stageMap.get(t.toStageId)??null):null,t.action,t.labelAr,t.condition?JSON.stringify(t.condition):null,t.sortOrder,t.active?1:0).run();}
  }catch(e){return errorResponse(c,String(e).includes('UNIQUE')?'WORKFLOW-002':'WORKFLOW-005',400,e);}
  await audit(c,'workflow_definition_updated','workflow',workflowId,{transactionTypeId:d.transactionTypeId,status:d.status,stageCount:d.stages.length});
  return c.json({ok:true,id:workflowId,status:d.status});
});

app.post('/admin/workflows/full-template',async c=>{
  const body=await c.req.json().catch(()=>null) as any;
  const transactionTypeId=typeof body?.transactionTypeId==='string'?body.transactionTypeId:'';
  if(!transactionTypeId)return errorResponse(c,'WORKFLOW-001',400);
  const type=await c.env.DB.prepare(`SELECT id,status,name_ar FROM transaction_types WHERE id=?`).bind(transactionTypeId).first<any>();
  if(!type)return errorResponse(c,'WORKFLOW-003',404);
  if(type.status!=='active')return errorResponse(c,'WORKFLOW-004',400);
  const actor=actorId(c),workflowId=crypto.randomUUID(),s1=crypto.randomUUID(),s2=crypto.randomUUID(),s3=crypto.randomUUID();
  try{
    await c.env.DB.prepare(`UPDATE workflow_definitions SET status='inactive',updated_at=CURRENT_TIMESTAMP WHERE transaction_type_id=? AND status='active'`).bind(transactionTypeId).run();
    await c.env.DB.prepare(`INSERT INTO workflow_definitions(id,transaction_type_id,version,description,allowed_submitters_json,status,created_by,updated_by) SELECT ?,?,COALESCE(MAX(version),0)+1,?,?,?,?,? FROM workflow_definitions WHERE transaction_type_id=?`).bind(workflowId,transactionTypeId,`قالب محاكاة متكامل لسير المعاملة: ${type.name_ar}`,JSON.stringify(['company_admin']), 'active',actor,actor,transactionTypeId).run();
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO workflow_stages(id,workflow_id,name_ar,name_en,stage_order,responsible_type,responsible_value,duration_minutes,config_json,active) VALUES(?,?,?,?,?,?,?,?,?,1)`).bind(s1,workflowId,'تقديم الطلب','Submit Request',1,'company_admin',null,null,JSON.stringify({employeeFeedback:false})),
      c.env.DB.prepare(`INSERT INTO workflow_stages(id,workflow_id,name_ar,name_en,stage_order,responsible_type,responsible_value,duration_minutes,config_json,active) VALUES(?,?,?,?,?,?,?,?,?,1)`).bind(s2,workflowId,'مراجعة الطلب','Review Request',2,'company_admin',null,null,JSON.stringify({employeeFeedback:true})),
      c.env.DB.prepare(`INSERT INTO workflow_stages(id,workflow_id,name_ar,name_en,stage_order,responsible_type,responsible_value,duration_minutes,config_json,active) VALUES(?,?,?,?,?,?,?,?,?,1)`).bind(s3,workflowId,'الاعتماد النهائي','Final Approval',3,'company_admin',null,null,JSON.stringify({employeeFeedback:false})),
      c.env.DB.prepare(`INSERT INTO workflow_questions(id,workflow_id,stage_id,question_key,question_ar,question_en,question_type,required,options_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,?,?,1)`).bind(crypto.randomUUID(),workflowId,s2,'review_approved','هل تمت الموافقة على الطلب بعد المراجعة؟','Was the request approved after review?','yes_no',1,null,1),
      c.env.DB.prepare(`INSERT INTO workflow_fields(id,workflow_id,stage_id,field_key,label_ar,label_en,field_type,required,options_json,config_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)`).bind(crypto.randomUUID(),workflowId,null,'request_title','عنوان الطلب','Request title','text',1,null,JSON.stringify({}),1),
      c.env.DB.prepare(`INSERT INTO workflow_fields(id,workflow_id,stage_id,field_key,label_ar,label_en,field_type,required,options_json,config_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)`).bind(crypto.randomUUID(),workflowId,null,'request_details','تفاصيل الطلب','Request details','textarea',0,null,JSON.stringify({}),2),
      c.env.DB.prepare(`INSERT INTO workflow_transitions(id,workflow_id,from_stage_id,to_stage_id,action,label_ar,condition_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,1)`).bind(crypto.randomUUID(),workflowId,s1,s2,'next','إرسال للمراجعة',null,1),
      c.env.DB.prepare(`INSERT INTO workflow_transitions(id,workflow_id,from_stage_id,to_stage_id,action,label_ar,condition_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,1)`).bind(crypto.randomUUID(),workflowId,s1,null,'cancel','إلغاء المعاملة',null,2),
      c.env.DB.prepare(`INSERT INTO workflow_transitions(id,workflow_id,from_stage_id,to_stage_id,action,label_ar,condition_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,1)`).bind(crypto.randomUUID(),workflowId,s1,null,'reject','رفض المعاملة',null,3),
      c.env.DB.prepare(`INSERT INTO workflow_transitions(id,workflow_id,from_stage_id,to_stage_id,action,label_ar,condition_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,1)`).bind(crypto.randomUUID(),workflowId,s2,s3,'next','اعتماد المراجعة',JSON.stringify({source:'question.review_approved',operator:'equals',value:true}),1),
      c.env.DB.prepare(`INSERT INTO workflow_transitions(id,workflow_id,from_stage_id,to_stage_id,action,label_ar,condition_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,1)`).bind(crypto.randomUUID(),workflowId,s2,s1,'return','إرجاع للتعديل',JSON.stringify({source:'question.review_approved',operator:'equals',value:false}),2),
      c.env.DB.prepare(`INSERT INTO workflow_transitions(id,workflow_id,from_stage_id,to_stage_id,action,label_ar,condition_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,1)`).bind(crypto.randomUUID(),workflowId,s2,null,'reject','رفض المعاملة',null,3),
      c.env.DB.prepare(`INSERT INTO workflow_transitions(id,workflow_id,from_stage_id,to_stage_id,action,label_ar,condition_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,1)`).bind(crypto.randomUUID(),workflowId,s2,null,'cancel','إلغاء المعاملة',null,4),
      c.env.DB.prepare(`INSERT INTO workflow_transitions(id,workflow_id,from_stage_id,to_stage_id,action,label_ar,condition_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,1)`).bind(crypto.randomUUID(),workflowId,s3,null,'complete','إكمال واعتماد',null,1),
      c.env.DB.prepare(`INSERT INTO workflow_transitions(id,workflow_id,from_stage_id,to_stage_id,action,label_ar,condition_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,1)`).bind(crypto.randomUUID(),workflowId,s3,s2,'return','إرجاع للمراجعة',null,2),
      c.env.DB.prepare(`INSERT INTO workflow_transitions(id,workflow_id,from_stage_id,to_stage_id,action,label_ar,condition_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,1)`).bind(crypto.randomUUID(),workflowId,s3,null,'reject','رفض المعاملة',null,3),
      c.env.DB.prepare(`INSERT INTO workflow_transitions(id,workflow_id,from_stage_id,to_stage_id,action,label_ar,condition_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,1)`).bind(crypto.randomUUID(),workflowId,s3,null,'cancel','إلغاء المعاملة',null,4)
    ]);
  }catch(e){return errorResponse(c,'WORKFLOW-005',400,e);}
  await audit(c,'workflow_full_template_created','workflow',workflowId,{transactionTypeId,template:'three_stage_simulation'});
  return c.json({ok:true,id:workflowId});
});

// Company transaction endpoints.
app.use('/types',requireAuthentication,requireCompanyContext,requirePasswordChanged);
app.use('/transactions/*',requireAuthentication,requireCompanyContext,requirePasswordChanged);
app.get('/types',async c=>{const companyId=sessionCompany(c)!;if(!(await allowed(c,'transaction.create')))return forbidden(c);const rows=await c.env.DB.prepare(visibleTypeSql(companyId)).bind(companyId,companyId).all<any>();const withWorkflow=[];for(const x of rows.results){const wf=await c.env.DB.prepare(`SELECT id,version,status FROM workflow_definitions WHERE transaction_type_id=? AND status='active' ORDER BY version DESC LIMIT 1`).bind(x.id).first<any>();if(wf)withWorkflow.push({...x,workflow_id:wf.id,workflow_version:wf.version});}return c.json({items:withWorkflow});});
app.get('/types/:id/workflow',async c=>{const companyId=sessionCompany(c)!;if(!(await allowed(c,'transaction.create')))return forbidden(c);const type=await c.env.DB.prepare(`${visibleTypeSql(companyId)} AND tt.id=?`).bind(companyId,companyId,c.req.param('id')).first<any>();if(!type)return errorResponse(c,'TRANSACTION-001',404);const wf=await c.env.DB.prepare(`SELECT id FROM workflow_definitions WHERE transaction_type_id=? AND status='active'`).bind(type.id).first<any>();if(!wf)return errorResponse(c,'WORKFLOW-006',404);const data=await loadWorkflow(c,wf.id);return c.json(data);});

app.post('/transactions',async c=>{
  const companyId=sessionCompany(c)!;if(!(await allowed(c,'transaction.create')))return forbidden(c);const p=createTxSchema.safeParse(await c.req.json().catch(()=>null));if(!p.success)return errorResponse(c,'TRANSACTION-001',400);const d=p.data;
  const type=await c.env.DB.prepare(`${visibleTypeSql(companyId)} AND tt.id=?`).bind(companyId,companyId,d.transactionTypeId).first<any>();if(!type||type.status!=='active')return errorResponse(c,'TRANSACTION-002',400);const wf=await c.env.DB.prepare(`SELECT id,allowed_submitters_json FROM workflow_definitions WHERE transaction_type_id=? AND status='active'`).bind(d.transactionTypeId).first<any>();if(!wf)return errorResponse(c,'WORKFLOW-006',400);const workflow=await loadWorkflow(c,wf.id);const submitters=parseJson(wf.allowed_submitters_json,[]);if(submitters.length){const s=c.get('session');const ok=submitters.some((x:string)=>x==='company_admin'&&s?.roles?.includes('company_admin')||x.startsWith('role:')&&s?.roles?.includes(x.slice(5))||x.startsWith('user:')&&s?.companyUserId===x.slice(5)||x.startsWith('permission:')&&hasPermission(c,x.slice(11)));if(!ok)return forbidden(c);}if(!workflow||!workflow.stages.length)return errorResponse(c,'WORKFLOW-006',400);
  if(d.employeeId){const emp=await c.env.DB.prepare(`SELECT id FROM employees WHERE id=? AND company_id=?`).bind(d.employeeId,companyId).first();if(!emp)return errorResponse(c,'TRANSACTION-003',400);}
  const first=workflow.stages[0];const required=workflow.fields.filter((f:any)=>f.stage_id===null&&f.required);for(const f of required){if(d.data[f.field_key]===undefined||d.data[f.field_key]===null||d.data[f.field_key]==='')return errorResponse(c,'TRANSACTION-004',400);}for(const q of workflow.questions.filter((q:any)=>q.stage_id===first.id&&q.required)){if(d.answers[q.question_key]===undefined)return errorResponse(c,'TRANSACTION-004',400);}
  let number:number;try{number=await allocateNumber(c,companyId);}catch(e){return errorResponse(c,'TRANSACTION-005',500,e);}const txId=crypto.randomUUID(),execId=crypto.randomUUID(),now=new Date().toISOString();const due=first.duration_minutes?new Date(Date.now()+Number(first.duration_minutes)*60000).toISOString():null;
  try{await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO transactions(id,company_id,transaction_number,transaction_type_id,workflow_id,requester_user_id,employee_id,status,current_stage_id,data_json) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(txId,companyId,number,d.transactionTypeId,wf.id,actorId(c),d.employeeId??null,'قيد الإجراء',first.id,JSON.stringify(d.data??{})),
    c.env.DB.prepare(`INSERT INTO transaction_stage_executions(id,transaction_id,stage_id,execution_order,started_at,due_at,status) VALUES(?,?,?,?,?,?,?)`).bind(execId,txId,first.id,1,now,due,'active'),
    ...workflow.fields.filter((f:any)=>Object.prototype.hasOwnProperty.call(d.data,f.field_key)).map((f:any)=>c.env.DB.prepare(`INSERT INTO transaction_answers(id,transaction_id,field_id,value_json) VALUES(?,?,?,?)`).bind(crypto.randomUUID(),txId,f.id,JSON.stringify(d.data[f.field_key]))),
    ...workflow.questions.filter((q:any)=>Object.prototype.hasOwnProperty.call(d.answers,q.question_key)).map((q:any)=>c.env.DB.prepare(`INSERT INTO transaction_answers(id,transaction_id,question_id,value_json) VALUES(?,?,?,?)`).bind(crypto.randomUUID(),txId,q.id,JSON.stringify(d.answers[q.question_key]))),
    c.env.DB.prepare(`INSERT INTO transaction_actions(id,transaction_id,company_id,actor_user_id,action,to_stage_id,metadata_json) VALUES(?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),txId,companyId,actorId(c),'created',first.id,JSON.stringify({transactionNumber:number,answersSnapshot:d.answers??{},dataSnapshot:d.data??{},stageId:first.id}))
  ]);}catch(e){return errorResponse(c,'DB-001',500,e);}await audit(c,'transaction_created','transaction',txId,{transactionNumber:number,transactionTypeId:d.transactionTypeId,stage:first.id});return c.json({ok:true,id:txId,transactionNumber:number},201);
});


app.post('/transactions/simulate',async c=>{
  const companyId=sessionCompany(c)!;
  if(!(await allowed(c,'transaction.create')))return forbidden(c);
  const body=await c.req.json().catch(()=>null) as any;
  const transactionTypeId=typeof body?.transactionTypeId==='string'?body.transactionTypeId:'';
  if(!transactionTypeId)return errorResponse(c,'TRANSACTION-001',400);
  const type=await c.env.DB.prepare(`${visibleTypeSql(companyId)} AND tt.id=?`).bind(companyId,companyId,transactionTypeId).first<any>();
  if(!type)return errorResponse(c,'TRANSACTION-002',400);
  const wf=await c.env.DB.prepare(`SELECT id,allowed_submitters_json FROM workflow_definitions WHERE transaction_type_id=? AND status='active'`).bind(transactionTypeId).first<any>();
  if(!wf)return errorResponse(c,'WORKFLOW-006',400);
  const workflow=await loadWorkflow(c,wf.id);if(!workflow||!workflow.stages.length)return errorResponse(c,'WORKFLOW-006',400);
  const submitters=parseJson(wf.allowed_submitters_json,[]);const s=c.get('session');
  if(submitters.length){const ok=submitters.some((x:string)=>x==='company_admin'&&s?.roles?.includes('company_admin')||x.startsWith('role:')&&s?.roles?.includes(x.slice(5))||x.startsWith('permission:')&&hasPermission(c,x.slice(11)));if(!ok)return forbidden(c);}
  const data:any={_simulation:true,simulationLabel:'محاكاة سير العمل'};
  for(const f of workflow.fields.filter((x:any)=>x.stage_id===null&&x.required)){
    if(f.field_type==='date')data[f.field_key]=new Date().toISOString().slice(0,10);
    else if(f.field_type==='number')data[f.field_key]=1;
    else if(f.field_type==='boolean')data[f.field_key]=true;
    else if(f.field_type==='select'&&Array.isArray(f.options)&&f.options.length)data[f.field_key]=f.options[0]?.value??f.options[0];
    else data[f.field_key]='بيانات محاكاة';
  }
  const first=workflow.stages[0];let number:number;try{number=await allocateNumber(c,companyId);}catch(e){return errorResponse(c,'TRANSACTION-005',500,e);}
  const txId=crypto.randomUUID(),execId=crypto.randomUUID(),now=new Date().toISOString(),due=first.duration_minutes?new Date(Date.now()+Number(first.duration_minutes)*60000).toISOString():null;
  try{await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO transactions(id,company_id,transaction_number,transaction_type_id,workflow_id,requester_user_id,employee_id,status,current_stage_id,data_json) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(txId,companyId,number,transactionTypeId,wf.id,actorId(c),null,'قيد الإجراء',first.id,JSON.stringify(data)),
    c.env.DB.prepare(`INSERT INTO transaction_stage_executions(id,transaction_id,stage_id,execution_order,started_at,due_at,status) VALUES(?,?,?,?,?,?,?)`).bind(execId,txId,first.id,1,now,due,'active'),
    ...workflow.fields.filter((f:any)=>Object.prototype.hasOwnProperty.call(data,f.field_key)).map((f:any)=>c.env.DB.prepare(`INSERT INTO transaction_answers(id,transaction_id,field_id,value_json) VALUES(?,?,?,?)`).bind(crypto.randomUUID(),txId,f.id,JSON.stringify(data[f.field_key]))),
    c.env.DB.prepare(`INSERT INTO transaction_actions(id,transaction_id,company_id,actor_user_id,action,to_stage_id,metadata_json) VALUES(?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),txId,companyId,actorId(c),'created',first.id,JSON.stringify({transactionNumber:number,simulation:true}))
  ]);}catch(e){return errorResponse(c,'DB-001',500,e);}
  await audit(c,'transaction_simulation_created','transaction',txId,{transactionNumber:number,transactionTypeId,simulation:true});
  return c.json({ok:true,id:txId,transactionNumber:number,simulation:true},201);
});

app.get('/transactions',async c=>{
  const companyId=sessionCompany(c)!;
  if(!(await allowed(c,'transaction.view')))return forbidden(c);
  const limit=Math.min(50,Math.max(1,Number(c.req.query('limit')||20)));
  const rows=await c.env.DB.prepare(`SELECT t.id,t.transaction_number,t.status,t.created_at,t.updated_at,t.employee_id,tt.name_ar transaction_type_name,ws.name_ar stage_name,TRIM(COALESCE(e.first_name,'')||' '||COALESCE(e.family_name,'')) employee_name FROM transactions t JOIN transaction_types tt ON tt.id=t.transaction_type_id LEFT JOIN workflow_stages ws ON ws.id=t.current_stage_id LEFT JOIN employees e ON e.id=t.employee_id AND e.company_id=t.company_id WHERE t.company_id=? ORDER BY t.created_at DESC,t.transaction_number DESC LIMIT ?`).bind(companyId,limit).all<any>();
  return c.json({items:rows.results});
});

app.get('/transactions/search',async c=>{const companyId=sessionCompany(c)!;if(!(await allowed(c,'transaction.search')))return forbidden(c);const n=Number(c.req.query('number'));if(!Number.isInteger(n)||n<1)return errorResponse(c,'TRANSACTION-006',400);const row=await c.env.DB.prepare(`SELECT t.id,t.transaction_number,t.status,t.current_stage_id,t.created_at,t.updated_at,t.employee_id,tt.name_ar transaction_type_name,ws.name_ar stage_name,TRIM(COALESCE(e.first_name,'')||' '||COALESCE(e.family_name,'')) employee_name FROM transactions t JOIN transaction_types tt ON tt.id=t.transaction_type_id LEFT JOIN workflow_stages ws ON ws.id=t.current_stage_id LEFT JOIN employees e ON e.id=t.employee_id AND e.company_id=t.company_id WHERE t.company_id=? AND t.transaction_number=?`).bind(companyId,n).first<any>();if(!row)return errorResponse(c,'TRANSACTION-007',404);return c.json({transaction:row});});

app.get('/transactions/:id',async c=>{const companyId=sessionCompany(c)!;if(!(await allowed(c,'transaction.view')))return forbidden(c);const tx=await c.env.DB.prepare(`SELECT t.*,tt.name_ar transaction_type_name,tt.name_en transaction_type_name_en,ws.name_ar stage_name,TRIM(COALESCE(e.first_name,'')||' '||COALESCE(e.father_name,'')||' '||COALESCE(e.family_name,'')) employee_name FROM transactions t JOIN transaction_types tt ON tt.id=t.transaction_type_id LEFT JOIN workflow_stages ws ON ws.id=t.current_stage_id LEFT JOIN employees e ON e.id=t.employee_id AND e.company_id=t.company_id WHERE t.id=? AND t.company_id=?`).bind(c.req.param('id'),companyId).first<any>();if(!tx)return errorResponse(c,'TRANSACTION-007',404);const workflow=await loadWorkflow(c,tx.workflow_id);const history=await c.env.DB.prepare(`SELECT tse.*,ws.name_ar stage_name FROM transaction_stage_executions tse JOIN workflow_stages ws ON ws.id=tse.stage_id WHERE tse.transaction_id=? ORDER BY tse.execution_order`).bind(tx.id).all<any>();const actions=await c.env.DB.prepare(`SELECT * FROM transaction_actions WHERE transaction_id=? ORDER BY created_at,id`).bind(tx.id).all<any>();const answers=await c.env.DB.prepare(`SELECT ta.*,wf.field_key,wf.label_ar field_label,wq.question_key,wq.question_ar question_label FROM transaction_answers ta LEFT JOIN workflow_fields wf ON wf.id=ta.field_id LEFT JOIN workflow_questions wq ON wq.id=ta.question_id WHERE ta.transaction_id=?`).bind(tx.id).all<any>();const feedback=await c.env.DB.prepare(`SELECT * FROM transaction_feedback WHERE transaction_id=? ORDER BY created_at`).bind(tx.id).all<any>();const attachments=await c.env.DB.prepare(`SELECT * FROM transaction_attachments WHERE transaction_id=? ORDER BY created_at`).bind(tx.id).all<any>();const now=Date.now();const historyItems=history.results.map((x:any)=>({...x,is_overdue:x.status==='active'&&x.due_at?new Date(x.due_at).getTime()<now:false}));return c.json({transaction:{...tx,data:parseJson(tx.data_json,{})},workflow,history:historyItems,actions:actions.results,answers:answers.results.map((x:any)=>({...x,value:parseJson(x.value_json,null)})),feedback:feedback.results,attachments:attachments.results});});

async function currentExecution(c:any,txId:string){return c.env.DB.prepare(`SELECT tse.*,t.current_stage_id,t.status,t.company_id,t.workflow_id,t.employee_id FROM transaction_stage_executions tse JOIN transactions t ON t.id=tse.transaction_id WHERE tse.transaction_id=? AND tse.status='active' ORDER BY tse.execution_order DESC LIMIT 1`).bind(txId).first<any>();}

async function responsibleForStage(c:any,stage:any,tx:any){
  const s=c.get('session');
  if(s?.platformUserId && s.accessMode==='super_admin_company_access') return true;
  if(stage.responsible_type==='company_admin') return Boolean(s?.roles?.includes('company_admin'));
  if(stage.responsible_type==='role') return Boolean(stage.responsible_value && s?.roles?.includes(stage.responsible_value));
  if(stage.responsible_type==='user') return Boolean(stage.responsible_value && s?.companyUserId===stage.responsible_value);
  if(stage.responsible_type==='manager'){
    if(!s?.employeeId||!tx.employee_id)return false;
    const row=await c.env.DB.prepare(`SELECT manager_employee_id FROM employees WHERE id=? AND company_id=?`).bind(tx.employee_id,tx.company_id).first<any>();
    return row?.manager_employee_id===s.employeeId;
  }
  if(stage.responsible_type==='position_holder' || stage.responsible_type==='department_manager'){
    if(!s?.employeeId||!stage.responsible_value)return false;
    const row=await c.env.DB.prepare(`SELECT id FROM employees WHERE id=? AND company_id=? AND position_id=?`).bind(s.employeeId,tx.company_id,stage.responsible_value).first<any>();
    return Boolean(row);
  }
  if(stage.responsible_type==='permission') return Boolean(stage.responsible_value && await allowed(c,stage.responsible_value));
  return false;
}

function requiredComplete(workflow:any,stageId:string,data:any,answers:any){
  for(const f of workflow.fields.filter((x:any)=>x.stage_id===stageId && x.required)){
    const v=data[f.field_key]; if(v===undefined||v===null||v==='') return false;
  }
  for(const q of workflow.questions.filter((x:any)=>x.stage_id===stageId && x.required)){
    if(answers[q.question_key]===undefined||answers[q.question_key]===null||answers[q.question_key]==='') return false;
  }
  return true;
}
function conditionMatches(condition:any,data:any,answers:any){if(!condition)return true;const source=condition.source;const actual=source?.startsWith('question.')?answers[source.slice(9)]:source?.startsWith('field.')?data[source.slice(6)]:undefined;let expected=condition.value;if(expected==='true')expected=true;else if(expected==='false')expected=false;switch(condition.operator){case 'not_equals':return actual!==expected;case 'contains':return String(actual??'').includes(String(expected??''));case 'is_true':return actual===true||actual==='true';case 'is_false':return actual===false||actual==='false';case 'in':return Array.isArray(expected)&&expected.some((x:any)=>JSON.stringify(x)===JSON.stringify(actual));default:return JSON.stringify(actual)===JSON.stringify(expected);}}

app.post('/transactions/:id/action',async c=>{
  const companyId=sessionCompany(c)!;const p=actionSchema.safeParse(await c.req.json().catch(()=>null));if(!p.success)return errorResponse(c,'TRANSACTION-008',400);const d=p.data;const perm=d.action==='cancel'?'transaction.cancel':d.action==='reject'?'transaction.reject':d.action==='return'?'transaction.return':'transaction.process';if(!(await allowed(c,perm)))return forbidden(c);const tx=await c.env.DB.prepare(`SELECT * FROM transactions WHERE id=? AND company_id=?`).bind(c.req.param('id'),companyId).first<any>();if(!tx)return errorResponse(c,'TRANSACTION-007',404);if(tx.status!=='قيد الإجراء')return errorResponse(c,'TRANSACTION-009',409);const exec=await currentExecution(c,tx.id);if(!exec)return errorResponse(c,'TRANSACTION-010',409);const workflow=await loadWorkflow(c,tx.workflow_id);if(!workflow)return errorResponse(c,'WORKFLOW-006',409);
  const currentStage=workflow.stages.find((x:any)=>x.id===exec.stage_id);if(!currentStage)return errorResponse(c,'WORKFLOW-006',409);if(!(await responsibleForStage(c,currentStage,tx)))return forbidden(c,'TRANSACTION-008');
  const data=parseJson(tx.data_json,{});const answersRows=await c.env.DB.prepare(`SELECT ta.*,wq.question_key,wf.field_key FROM transaction_answers ta LEFT JOIN workflow_questions wq ON wq.id=ta.question_id LEFT JOIN workflow_fields wf ON wf.id=ta.field_id WHERE ta.transaction_id=?`).bind(tx.id).all<any>();const answers:any={};for(const x of answersRows.results){if(x.question_key)answers[x.question_key]=parseJson(x.value_json,null);if(x.field_key)answers[x.field_key]=parseJson(x.value_json,null);}Object.assign(data,d.answers??{});
  if(d.action==='next'||d.action==='complete'||d.action==='reject'){if(!requiredComplete(workflow,exec.stage_id,data,answers))return errorResponse(c,'TRANSACTION-004',400);}
  let toStage:any=null;let action=d.action;if(action==='next'){const candidates=workflow.transitions.filter((t:any)=>t.from_stage_id===exec.stage_id&&t.active&&t.action==='next').sort((a:any,b:any)=>a.sort_order-b.sort_order);const matched=candidates.find((x:any)=>conditionMatches(x.condition,data,answers));toStage=matched?.to_stage_id?workflow.stages.find((s:any)=>s.id===matched.to_stage_id):null;if(!candidates.length){toStage=workflow.stages.find((s:any)=>Number(s.stage_order)===Number(currentStage.stage_order)+1)||null;if(!toStage)action='complete';}else if(!toStage)return errorResponse(c,'TRANSACTION-011',409);}else if(action==='return'){const candidates=workflow.transitions.filter((t:any)=>t.from_stage_id===exec.stage_id&&t.active&&t.action==='return').sort((a:any,b:any)=>a.sort_order-b.sort_order);const selected=candidates.find((x:any)=>conditionMatches(x.condition,data,answers)&&(!d.toStageId||x.to_stage_id===d.toStageId));const target=selected?.to_stage_id?workflow.stages.find((s:any)=>s.id===selected.to_stage_id):null;if(!target || Number(target.stage_order)>=Number(currentStage.stage_order))return errorResponse(c,'TRANSACTION-011',409);toStage=target;}else if(action==='complete'||action==='reject'||action==='cancel'){const t=workflow.transitions.find((x:any)=>x.from_stage_id===exec.stage_id&&x.action===action&&x.active);if(!t)return errorResponse(c,'TRANSACTION-011',409);}
  const now=new Date().toISOString();const newStatus=action==='complete'?'مكتملة':action==='reject'?'مرفوضة':action==='cancel'?'ملغية':'قيد الإجراء';const nextExecId=toStage?crypto.randomUUID():null;let nextOrder=Number(exec.execution_order)+1;const due=toStage?.duration_minutes?new Date(Date.now()+Number(toStage.duration_minutes)*60000).toISOString():null;
  try{
    const stmts:any[]=[c.env.DB.prepare(`UPDATE transaction_stage_executions SET completed_at=?,status=?,acted_by=?,return_reason=? WHERE id=? AND status='active'`).bind(now,action==='return'?'returned':action==='reject'?'rejected':action==='cancel'?'cancelled':'completed',actorId(c),action==='return'?(d.reason??''):null,exec.id),c.env.DB.prepare(`UPDATE transactions SET status=?,current_stage_id=?,updated_at=CURRENT_TIMESTAMP,completed_at=? WHERE id=? AND company_id=? AND status='قيد الإجراء'`).bind(newStatus,toStage?.id??null,newStatus==='قيد الإجراء'?null:now,tx.id,companyId),c.env.DB.prepare(`INSERT INTO transaction_actions(id,transaction_id,company_id,actor_user_id,action,from_stage_id,to_stage_id,reason,metadata_json) VALUES(?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),tx.id,companyId,actorId(c),action,exec.stage_id,toStage?.id??null,d.reason??null,JSON.stringify({answersSnapshot:d.answers??{},dataSnapshot:data,stageId:exec.stage_id})),c.env.DB.prepare(`UPDATE transactions SET data_json=? WHERE id=?`).bind(JSON.stringify(data),tx.id)];
    if(toStage)stmts.push(c.env.DB.prepare(`INSERT INTO transaction_stage_executions(id,transaction_id,stage_id,execution_order,started_at,due_at,status) VALUES(?,?,?,?,?,?,?)`).bind(nextExecId,tx.id,toStage.id,nextOrder,now,due,'active'));
    if(d.answers)for(const [key,val] of Object.entries(d.answers)){const q=workflow.questions.find((x:any)=>x.question_key===key);const f=workflow.fields.find((x:any)=>x.field_key===key);if(q)stmts.push(c.env.DB.prepare(`INSERT INTO transaction_answers(id,transaction_id,question_id,value_json) VALUES(?,?,?,?) ON CONFLICT DO UPDATE SET value_json=excluded.value_json,updated_at=CURRENT_TIMESTAMP`).bind(crypto.randomUUID(),tx.id,q.id,JSON.stringify(val)));else if(f)stmts.push(c.env.DB.prepare(`INSERT INTO transaction_answers(id,transaction_id,field_id,value_json) VALUES(?,?,?,?) ON CONFLICT DO UPDATE SET value_json=excluded.value_json,updated_at=CURRENT_TIMESTAMP`).bind(crypto.randomUUID(),tx.id,f.id,JSON.stringify(val)));}
    await c.env.DB.batch(stmts);
  }catch(e){return errorResponse(c,'DB-001',500,e);}await audit(c,`transaction_${action}`,'transaction',tx.id,{before:{status:tx.status,stage:exec.stage_id},after:{status:newStatus,stage:toStage?.id??null},reason:d.reason??null});return c.json({ok:true,status:newStatus,currentStageId:toStage?.id??null});
});

app.post('/transactions/:id/feedback',async c=>{const companyId=sessionCompany(c)!;if(!(await allowed(c,'transaction.feedback')))return forbidden(c);const p=feedbackSchema.safeParse(await c.req.json().catch(()=>null));if(!p.success)return errorResponse(c,'TRANSACTION-012',400);const tx=await c.env.DB.prepare(`SELECT id,current_stage_id,employee_id,status,workflow_id FROM transactions WHERE id=? AND company_id=?`).bind(c.req.param('id'),companyId).first<any>();if(!tx||!tx.current_stage_id)return errorResponse(c,'TRANSACTION-007',404);const wf=await loadWorkflow(c,tx.workflow_id);const stage=wf?.stages.find((x:any)=>x.id===tx.current_stage_id);if(!stage?.config?.employeeFeedback)return errorResponse(c,'TRANSACTION-012',400);await c.env.DB.prepare(`INSERT INTO transaction_feedback(id,transaction_id,stage_id,employee_id,user_id,feedback) VALUES(?,?,?,?,?,?)`).bind(crypto.randomUUID(),tx.id,tx.current_stage_id,tx.employee_id,actorId(c),p.data.feedback).run();await audit(c,'transaction_feedback_added','transaction',tx.id,{stage:tx.current_stage_id});return c.json({ok:true},201);});

export default app;
