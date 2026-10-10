import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { audit } from '../audit';
import { hasPermission } from '../authorization';
import { requireAuthentication, requireCompanyContext, requireCompanyUser, requirePasswordChanged } from '../middleware/session';

const app = new Hono<Env>();
app.use('*', requireAuthentication, requireCompanyContext, requireCompanyUser, requirePasswordChanged);

const companyId=(c:any)=>c.get('session')!.activeCompanyId as string;
const userId=(c:any)=>c.get('session')!.companyUserId as string;
const employeeId=(c:any)=>c.get('session')!.employeeId as string|null;
const safe=(v:any,d:any)=>{try{return v?JSON.parse(v):d}catch{return d}};

async function allowed(c:any,p:string){ return hasPermission(c,p); }
function isCompanyAdmin(c:any){ return (c.get('session')?.roles||[]).some((r:string)=>['company_admin','مدير الشركة'].includes(r)); }

async function ensureRuntimeTables(c:any){
  await c.env.DB.batch([
    c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS workflow_company_settings (workflow_id TEXT NOT NULL, company_id TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 0, allowed_submitters_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(workflow_id,company_id))`),
    c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS workflow_company_stage_assignments (workflow_id TEXT NOT NULL, stage_id TEXT NOT NULL, company_id TEXT NOT NULL, employee_ids_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(workflow_id,stage_id,company_id))`),
    c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS transaction_answer_history (id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL, execution_id TEXT, field_id TEXT, question_id TEXT, value_json TEXT, actor_user_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`),
    c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS transaction_delegations (id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL, stage_execution_id TEXT NOT NULL, from_employee_id TEXT, to_employee_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT)`)
  ]);
}

async function loadPublishedWorkflow(c:any, typeId:string){
  const cid=companyId(c);
  const w=await c.env.DB.prepare(`
    SELECT wd.*,tt.name_ar type_name_ar,tt.description type_description,wcs.allowed_submitters_json company_submitters,wcs.active company_active
    FROM workflow_definitions wd
    JOIN transaction_types tt ON tt.id=wd.transaction_type_id AND tt.company_id IS NULL
    JOIN workflow_company_settings wcs ON wcs.workflow_id=wd.id AND wcs.company_id=? AND wcs.active=1
    WHERE wd.transaction_type_id=? AND wd.status='active' AND tt.status='active'
    LIMIT 1`).bind(cid,typeId).first<any>();
  if(!w)return null;
  const [stages,fields,transitions,settings]=await Promise.all([
    c.env.DB.prepare(`SELECT * FROM workflow_stages WHERE workflow_id=? AND active=1 ORDER BY stage_order`).bind(w.id).all<any>(),
    c.env.DB.prepare(`SELECT * FROM workflow_fields WHERE workflow_id=? AND active=1 ORDER BY CASE WHEN stage_id IS NULL THEN 0 ELSE 1 END,stage_id,sort_order,id`).bind(w.id).all<any>(),
    c.env.DB.prepare(`SELECT * FROM workflow_transitions WHERE workflow_id=? AND active=1 ORDER BY from_stage_id,sort_order,id`).bind(w.id).all<any>(),
    c.env.DB.prepare(`SELECT * FROM workflow_request_settings WHERE workflow_id=? LIMIT 1`).bind(w.id).first<any>()
  ]);
  return {w,stages:stages.results,fields:fields.results,transitions:transitions.results,settings};
}

async function employeeCard(c:any,id:string){
  return c.env.DB.prepare(`
    SELECT e.id,e.employee_number,e.first_name,e.father_name,e.family_name,e.job_title,e.organization_unit_id,e.position_id,e.manager_employee_id,
      ou.name_ar organization_unit_name,
      CASE WHEN m.id IS NULL THEN NULL ELSE trim(m.first_name||' '||coalesce(m.father_name||' ','')||coalesce(m.family_name,'')) END manager_name
    FROM employees e LEFT JOIN organization_units ou ON ou.id=e.organization_unit_id AND ou.company_id=e.company_id
    LEFT JOIN employees m ON m.id=e.manager_employee_id AND m.company_id=e.company_id
    WHERE e.id=? AND e.company_id=?`).bind(id,companyId(c)).first<any>();
}

function transitionConditionMatches(condition:any, answers:Map<string,any>){
  if(!condition)return true;
  const list=Array.isArray(condition)?condition:[condition];
  return list.every((x:any)=>{
    const actual=answers.get(x.fieldId);
    const values=Array.isArray(x.values)?x.values:[];
    switch(x.operator){
      case 'equals': return String(actual??'')===String(values[0]??'');
      case 'not_equals': return String(actual??'')!==String(values[0]??'');
      case 'contains': return Array.isArray(actual)?actual.map(String).includes(String(values[0]??'')):String(actual??'').includes(String(values[0]??''));
      case 'is_true': return actual===true || String(actual).toLowerCase()==='true' || String(actual)==='نعم';
      case 'is_false': return !(actual===true || String(actual).toLowerCase()==='true' || String(actual)==='نعم');
      case 'is_empty': return actual===null || actual===undefined || actual==='';
      case 'is_not_empty': return !(actual===null || actual===undefined || actual==='');
      case 'greater_than': return Number(actual)>Number(values[0]);
      case 'greater_or_equal': return Number(actual)>=Number(values[0]);
      case 'less_than': return Number(actual)<Number(values[0]);
      case 'less_or_equal': return Number(actual)<=Number(values[0]);
      case 'in': return values.map(String).includes(String(actual??''));
      default:return false;
    }
  });
}

async function allAnswers(c:any,txId:string){
  const rows=await c.env.DB.prepare(`SELECT id,field_id,question_id,value_json,created_at FROM transaction_answers WHERE transaction_id=? ORDER BY created_at,id`).bind(txId).all<any>();
  const map=new Map<string,any>();
  for(const r of rows.results){ const key=r.field_id||r.question_id; if(key) map.set(key,safe(r.value_json,null)); }
  return {rows:rows.results,map};
}

async function resolveStageAssignees(c:any,wf:any,stage:any,subjectEmployeeId?:string|null){
  const cid=companyId(c);
  const override=await c.env.DB.prepare(`SELECT employee_ids_json FROM workflow_company_stage_assignments WHERE workflow_id=? AND stage_id=? AND company_id=?`).bind(wf.id,stage.id,cid).first<any>();
  if(override){
    const ids=safe(override.employee_ids_json,[]); return Array.isArray(ids)?ids:[];
  }
  if(stage.responsible_type==='company_admin'){
    const rows=await c.env.DB.prepare(`SELECT cu.employee_id FROM company_users cu JOIN user_roles ur ON ur.company_user_id=cu.id JOIN roles r ON r.id=ur.role_id WHERE cu.company_id=? AND cu.status='active' AND r.status='active' AND (r.code='company_admin' OR r.name_ar='مدير الشركة') AND cu.employee_id IS NOT NULL`).bind(cid).all<any>();
    return rows.results.map(x=>x.employee_id).filter(Boolean);
  }
  if(stage.responsible_type==='direct_manager'){
    const emp=await employeeCard(c,subjectEmployeeId||employeeId(c)||''); return emp?.manager_employee_id?[emp.manager_employee_id]:[];
  }
  if(stage.responsible_type==='employee_owner') return employeeId(c)?[employeeId(c)!]:[];
  if(stage.responsible_type==='position_holder' && stage.responsible_value){
    const r=await c.env.DB.prepare(`SELECT e.id FROM employees e WHERE e.company_id=? AND e.position_id=? AND e.status<>'terminated'`).bind(cid,stage.responsible_value).all<any>(); return r.results.map(x=>x.id);
  }
  if(stage.responsible_type==='department_manager' && subjectEmployeeId){
    const r=await c.env.DB.prepare(`SELECT m.id FROM employees e JOIN positions p ON p.id=e.position_id AND p.company_id=e.company_id JOIN employees m ON m.position_id=p.manager_position_id AND m.company_id=e.company_id WHERE e.id=? AND e.company_id=? AND m.status<>'terminated'`).bind(subjectEmployeeId,cid).all<any>(); return r.results.map(x=>x.id);
  }
  if(stage.responsible_type==='role' && stage.responsible_value){
    const r=await c.env.DB.prepare(`SELECT DISTINCT cu.employee_id FROM company_users cu JOIN user_roles ur ON ur.company_user_id=cu.id JOIN roles r ON r.id=ur.role_id WHERE cu.company_id=? AND cu.status='active' AND cu.employee_id IS NOT NULL AND r.company_id=? AND r.status='active' AND r.code=?`).bind(cid,cid,stage.responsible_value).all<any>(); return r.results.map(x=>x.employee_id);
  }
  if(stage.responsible_type==='permission' && stage.responsible_value){
    const r=await c.env.DB.prepare(`SELECT DISTINCT cu.employee_id FROM company_users cu JOIN user_permissions up ON up.company_user_id=cu.id WHERE cu.company_id=? AND cu.status='active' AND cu.employee_id IS NOT NULL AND up.permission_id=? AND up.effect='allow' UNION SELECT DISTINCT cu.employee_id FROM company_users cu JOIN user_roles ur ON ur.company_user_id=cu.id JOIN roles r ON r.id=ur.role_id JOIN role_permissions rp ON rp.role_id=r.id WHERE cu.company_id=? AND cu.status='active' AND cu.employee_id IS NOT NULL AND r.status='active' AND rp.permission_id=?`).bind(cid,stage.responsible_value,cid,stage.responsible_value).all<any>(); return r.results.map(x=>x.employee_id);
  }
  return [];
}

async function canAct(c:any,tx:any,stage:any){
  if(!(await allowed(c,'transaction.process')))return false;
  const delegated=await c.env.DB.prepare(`SELECT id FROM transaction_delegations WHERE transaction_id=? AND status='active' AND to_employee_id=? LIMIT 1`).bind(tx.id,employeeId(c)).first<any>();
  if(delegated)return true;
  const ids=await resolveStageAssignees(c,tx.workflow,stage,tx.employee_id||null);
  return ids.includes(employeeId(c));
}


app.get('/settings', async c=>{
  if(!isCompanyAdmin(c) && !(await allowed(c,'workflow.company_manage')))return c.json({error:'FORBIDDEN'},403);
  await ensureRuntimeTables(c); const cid=companyId(c);
  const rows=await c.env.DB.prepare(`
    SELECT tt.id,tt.name_ar,tt.description,wcs.workflow_id,wcs.active,wcs.allowed_submitters_json
    FROM transaction_types tt JOIN workflow_definitions wd ON wd.transaction_type_id=tt.id AND wd.status='active'
    JOIN workflow_company_settings wcs ON wcs.workflow_id=wd.id AND wcs.company_id=?
    WHERE tt.company_id IS NULL ORDER BY tt.name_ar`).bind(cid).all<any>();
  return c.json({items:rows.results.map((x:any)=>({...x,active:Boolean(x.active),allowedSubmitters:safe(x.allowed_submitters_json,['self'])}))});
});

const companySettingSchema=z.object({active:z.boolean(),allowedSubmitters:z.array(z.string().min(1)).min(1).max(20)});
app.put('/settings/:workflowId', async c=>{
  if(!isCompanyAdmin(c) && !(await allowed(c,'workflow.company_manage')))return c.json({error:'FORBIDDEN'},403);
  await ensureRuntimeTables(c); const parsed=companySettingSchema.safeParse(await c.req.json().catch(()=>null)); if(!parsed.success)return c.json({error:'WORKFLOW-COMPANY-002'},400);
  const cid=companyId(c); const wid=c.req.param('workflowId');
  const w=await c.env.DB.prepare(`SELECT id FROM workflow_definitions WHERE id=? AND status='active'`).bind(wid).first(); if(!w)return c.json({error:'WORKFLOW_NOT_ACTIVE'},404);
  await c.env.DB.prepare(`INSERT INTO workflow_company_settings(workflow_id,company_id,active,allowed_submitters_json) VALUES(?,?,?,?) ON CONFLICT(workflow_id,company_id) DO UPDATE SET active=excluded.active,allowed_submitters_json=excluded.allowed_submitters_json,updated_at=CURRENT_TIMESTAMP`).bind(wid,cid,parsed.data.active?1:0,JSON.stringify(parsed.data.allowedSubmitters)).run();
  await audit(c,'workflow_company_settings_updated','workflow',wid,{companyId:cid,active:parsed.data.active,allowedSubmitters:parsed.data.allowedSubmitters}); return c.json({ok:true});
});

app.get('/settings/:workflowId/stages', async c=>{
  if(!isCompanyAdmin(c) && !(await allowed(c,'workflow.company_manage')))return c.json({error:'FORBIDDEN'},403);
  await ensureRuntimeTables(c); const cid=companyId(c); const wid=c.req.param('workflowId');
  const rows=await c.env.DB.prepare(`SELECT s.id,s.name_ar,s.stage_order,s.responsible_type,s.responsible_value,a.employee_ids_json FROM workflow_stages s LEFT JOIN workflow_company_stage_assignments a ON a.workflow_id=s.workflow_id AND a.stage_id=s.id AND a.company_id=? WHERE s.workflow_id=? AND s.active=1 ORDER BY s.stage_order`).bind(cid,wid).all<any>();
  return c.json({items:rows.results.map((x:any)=>({...x,employeeIds:safe(x.employee_ids_json,[])}))});
});
const stageSettingSchema=z.object({employeeIds:z.array(z.string().uuid()).max(50)});
app.put('/settings/:workflowId/stages/:stageId', async c=>{
  if(!isCompanyAdmin(c) && !(await allowed(c,'workflow.company_manage')))return c.json({error:'FORBIDDEN'},403);
  await ensureRuntimeTables(c); const parsed=stageSettingSchema.safeParse(await c.req.json().catch(()=>null)); if(!parsed.success)return c.json({error:'WORKFLOW-COMPANY-003'},400);
  const cid=companyId(c),wid=c.req.param('workflowId'),sid=c.req.param('stageId');
  const stage=await c.env.DB.prepare(`SELECT id FROM workflow_stages WHERE id=? AND workflow_id=? AND active=1`).bind(sid,wid).first(); if(!stage)return c.json({error:'STAGE_NOT_FOUND'},404);
  if(parsed.data.employeeIds.length){ const ph=parsed.data.employeeIds.map(()=>'?').join(','); const valid=await c.env.DB.prepare(`SELECT id FROM employees WHERE company_id=? AND id IN (${ph}) AND status<>'terminated'`).bind(cid,...parsed.data.employeeIds).all(); if(valid.results.length!==parsed.data.employeeIds.length)return c.json({error:'INVALID_EMPLOYEE_ASSIGNMENT'},400); }
  await c.env.DB.prepare(`INSERT INTO workflow_company_stage_assignments(workflow_id,stage_id,company_id,employee_ids_json) VALUES(?,?,?,?) ON CONFLICT(workflow_id,stage_id,company_id) DO UPDATE SET employee_ids_json=excluded.employee_ids_json,updated_at=CURRENT_TIMESTAMP`).bind(wid,sid,cid,JSON.stringify(parsed.data.employeeIds)).run();
  await audit(c,'workflow_stage_assignees_updated','workflow_stage',sid,{workflowId:wid,employeeIds:parsed.data.employeeIds}); return c.json({ok:true});
});

app.get('/available', async c=>{
  if(!(await allowed(c,'transaction.create')))return c.json({error:'FORBIDDEN'},403);
  await ensureRuntimeTables(c);
  const cid=companyId(c); const eid=employeeId(c);
  const rows=await c.env.DB.prepare(`
    SELECT tt.id,tt.name_ar,tt.description,wcs.allowed_submitters_json
    FROM transaction_types tt JOIN workflow_definitions wd ON wd.transaction_type_id=tt.id AND wd.status='active'
    JOIN workflow_company_settings wcs ON wcs.workflow_id=wd.id AND wcs.company_id=? AND wcs.active=1
    WHERE tt.company_id IS NULL AND tt.status='active' ORDER BY tt.name_ar`).bind(cid).all<any>();
  const out=[];
  for(const r of rows.results){
    const submitters=safe(r.allowed_submitters_json, ['self']);
    const roleCodes=c.get('session')?.roles||[]; const allowedSpecific=submitters.some((x:string)=>x===`employee:${eid}`||x.startsWith('role:')&&roleCodes.includes(x.slice(5))); if(submitters.includes('self')&&eid || submitters.includes('company_admin')&&isCompanyAdmin(c) || allowedSpecific) out.push({id:r.id,nameAr:r.name_ar,description:r.description});
  }
  return c.json({items:out});
});


app.get('/available/:typeId', async c=>{
  if(!(await allowed(c,'transaction.create')))return c.json({error:'FORBIDDEN'},403);
  const wf=await loadPublishedWorkflow(c,c.req.param('typeId')); if(!wf)return c.json({error:'TRANSACTION_NOT_AVAILABLE'},404);
  const submitters=safe(wf.w.company_submitters,['self']);
  const eid=employeeId(c); const roleCodes=c.get('session')?.roles||[]; const allowedSpecific=submitters.some((x:string)=>x===`employee:${eid}`||x.startsWith('role:')&&roleCodes.includes(x.slice(5))); if(!submitters.includes('self') && !(submitters.includes('company_admin')&&isCompanyAdmin(c)) && !allowedSpecific)return c.json({error:'TRANSACTION_FORBIDDEN'},403);
  return c.json({type:{id:wf.w.transaction_type_id,nameAr:wf.w.type_name_ar,description:wf.w.type_description},targetEmployeeEnabled:Boolean(wf.settings?.target_employee_enabled),targetEmployeeRequired:Boolean(wf.settings?.target_employee_required),fields:wf.fields.filter((f:any)=>!f.stage_id).map((f:any)=>({...f,options:safe(f.options_json,[]),config:safe(f.config_json,{})}))});
});

app.get('/employees', async c=>{
  if(!(await allowed(c,'transaction.create')))return c.json({error:'FORBIDDEN'},403);
  const q=(c.req.query('search')||'').trim(); const cid=companyId(c); const p:any[]=[cid]; let where=`company_id=? AND status<>'terminated'`;
  if(q){where+=` AND (employee_number LIKE ? OR first_name LIKE ? OR family_name LIKE ?)`; const s=`%${q}%`;p.push(s,s,s);}
  const rows=await c.env.DB.prepare(`SELECT id,employee_number,first_name,father_name,family_name,job_title FROM employees WHERE ${where} ORDER BY employee_number LIMIT 50`).bind(...p).all<any>();
  return c.json({items:rows.results.map(x=>({...x,fullName:[x.first_name,x.father_name,x.family_name].filter(Boolean).join(' ')}))});
});

app.get('/mine', async c=>{
  if(!(await allowed(c,'transaction.view')))return c.json({error:'FORBIDDEN'},403);
  const eid=employeeId(c); const cid=companyId(c);
  const rows=await c.env.DB.prepare(`
    SELECT t.*,tt.name_ar type_name,ws.name_ar stage_name
    FROM transactions t JOIN transaction_types tt ON tt.id=t.transaction_type_id
    LEFT JOIN workflow_stages ws ON ws.id=t.current_stage_id
    WHERE t.company_id=? AND (t.requester_user_id=? OR t.employee_id=?)
    ORDER BY t.updated_at DESC LIMIT 200`).bind(cid,userId(c),eid).all<any>();
  const activeRows=await c.env.DB.prepare(`SELECT t.*,tt.name_ar type_name,ws.name_ar stage_name FROM transactions t JOIN transaction_types tt ON tt.id=t.transaction_type_id JOIN workflow_stages ws ON ws.id=t.current_stage_id JOIN transaction_stage_executions tse ON tse.transaction_id=t.id AND tse.stage_id=t.current_stage_id AND tse.status='active' WHERE t.company_id=? AND t.status='قيد الإجراء' ORDER BY t.updated_at DESC LIMIT 200`).bind(cid).all<any>();
  const assigned:any[]=[]; for(const tx of activeRows.results){ const stage=await c.env.DB.prepare(`SELECT * FROM workflow_stages WHERE id=?`).bind(tx.current_stage_id).first<any>(); if(stage&&await canAct(c,tx,stage)) assigned.push(tx); }
  const map=new Map<string,any>(); [...rows.results,...assigned].forEach(x=>map.set(x.id,x)); return c.json({items:[...map.values()].sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)))});
});

app.get('/:id', async c=>{
  if(!(await allowed(c,'transaction.view')))return c.json({error:'FORBIDDEN'},403);
  const cid=companyId(c); const id=c.req.param('id');
  const tx=await c.env.DB.prepare(`SELECT t.*,tt.name_ar type_name,wd.description workflow_description FROM transactions t JOIN transaction_types tt ON tt.id=t.transaction_type_id JOIN workflow_definitions wd ON wd.id=t.workflow_id WHERE t.id=? AND t.company_id=?`).bind(id,cid).first<any>();
  if(!tx)return c.json({error:'TRANSACTION_NOT_FOUND'},404);
  const currentForAccess=tx.current_stage_id?await c.env.DB.prepare(`SELECT * FROM workflow_stages WHERE id=?`).bind(tx.current_stage_id).first<any>():null; const own=tx.requester_user_id===userId(c)||tx.employee_id===employeeId(c); const acted=Boolean(await c.env.DB.prepare(`SELECT 1 FROM transaction_actions WHERE transaction_id=? AND actor_user_id=? LIMIT 1`).bind(id,userId(c)).first()); const admin=isCompanyAdmin(c); const assigned=currentForAccess?await canAct(c,tx,currentForAccess):false; if(!own&&!acted&&!admin&&!assigned)return c.json({error:'FORBIDDEN'},403);
  const [stages,fields,answers,answerHistory,actions,employee,requesterEmployee]=await Promise.all([
    c.env.DB.prepare(`SELECT tse.*,ws.name_ar stage_name,ws.stage_order FROM transaction_stage_executions tse JOIN workflow_stages ws ON ws.id=tse.stage_id WHERE tse.transaction_id=? ORDER BY tse.execution_order`).bind(id).all<any>(),
    c.env.DB.prepare(`SELECT * FROM workflow_fields WHERE workflow_id=? AND active=1 ORDER BY stage_id,sort_order,id`).bind(tx.workflow_id).all<any>(),
    c.env.DB.prepare(`SELECT * FROM transaction_answers WHERE transaction_id=? ORDER BY created_at,id`).bind(id).all<any>(),
    c.env.DB.prepare(`SELECT * FROM transaction_answer_history WHERE transaction_id=? ORDER BY created_at,id`).bind(id).all<any>(),
    c.env.DB.prepare(`SELECT * FROM transaction_actions WHERE transaction_id=? ORDER BY created_at,id`).bind(id).all<any>(),
    employeeCard(c,tx.employee_id), employeeCard(c, c.get('session')?.employeeId || '')
  ]);
  const [allWorkflowStages,currentStage]=await Promise.all([c.env.DB.prepare(`SELECT * FROM workflow_stages WHERE workflow_id=? AND active=1 ORDER BY stage_order`).bind(tx.workflow_id).all<any>(),tx.current_stage_id?c.env.DB.prepare(`SELECT * FROM workflow_stages WHERE id=?`).bind(tx.current_stage_id).first<any>():null]);
  const actor= currentStage ? await canAct(c,tx,currentStage) : false;
  return c.json({transaction:{...tx,data:safe(tx.data_json,{})},employee,requesterEmployee,workflowStages:allWorkflowStages.results,stages:stages.results,fields:fields.results.map((x:any)=>({...x,options:safe(x.options_json,[]),config:safe(x.config_json,{})})),answers:answers.results.map((x:any)=>({...x,value:safe(x.value_json,null)})),answerHistory:answerHistory.results.map((x:any)=>({...x,value:safe(x.value_json,null)})),actions:actions.results,currentStage:currentStage?{...currentStage,config:safe(currentStage.config_json,{})}:null,canAct:actor});
});

const createSchema=z.object({transactionTypeId:z.string().uuid(),targetEmployeeId:z.string().uuid().nullable().optional(),answers:z.array(z.object({fieldId:z.string().uuid(),value:z.any()})).default([])});
app.post('/', async c=>{
  if(!(await allowed(c,'transaction.create')))return c.json({error:'FORBIDDEN'},403);
  await ensureRuntimeTables(c);
  const parsed=createSchema.safeParse(await c.req.json().catch(()=>null)); if(!parsed.success)return c.json({error:'TRANSACTION-001',message:'بيانات الطلب غير مكتملة.',details:parsed.error.issues},400);
  const d=parsed.data; const wf=await loadPublishedWorkflow(c,d.transactionTypeId); if(!wf)return c.json({error:'TRANSACTION_NOT_AVAILABLE',message:'المعاملة غير مفعلة لهذه الشركة.'},404);
  const submitters=safe(wf.w.company_submitters,['self']); const requesterEid=employeeId(c); const roleCodes=c.get('session')?.roles||[]; const allowedSpecific=submitters.some((x:string)=>x===`employee:${requesterEid}`||x.startsWith('role:')&&roleCodes.includes(x.slice(5))); if(!submitters.includes('self') && !(submitters.includes('company_admin')&&isCompanyAdmin(c)) && !allowedSpecific)return c.json({error:'TRANSACTION_FORBIDDEN'},403);
  const eid=d.targetEmployeeId||employeeId(c); if(!eid)return c.json({error:'TARGET_EMPLOYEE_REQUIRED',message:'يجب تحديد الموظف المعني.'},400);
  const target=await employeeCard(c,eid); if(!target)return c.json({error:'TARGET_EMPLOYEE_NOT_FOUND'},404);
  const requestFields=wf.fields.filter((f:any)=>!f.stage_id && f.active); const firstStage=wf.stages[0];
  for(const f of requestFields){ if(f.required && !d.answers.some(a=>a.fieldId===f.id && a.value!==null && a.value!=='')) return c.json({error:'TRANSACTION-002',message:`الحقل «${f.label_ar}» مطلوب.`},400); }
  const txId=crypto.randomUUID(); const firstExecutionId=crypto.randomUUID();
  await c.env.DB.prepare(`INSERT OR IGNORE INTO transaction_sequences(company_id,next_number) VALUES(?,1)`).bind(companyId(c)).run();
  const seq=await c.env.DB.prepare(`UPDATE transaction_sequences SET next_number=next_number+1,updated_at=CURRENT_TIMESTAMP WHERE company_id=? RETURNING next_number-1 AS number`).bind(companyId(c)).first<any>();
  const number=Number(seq?.number||0); if(!number)return c.json({error:'TRANSACTION_SEQUENCE_ERROR'},500);
  const now=new Date(); const due=firstStage.duration_minutes?new Date(now.getTime()+Number(firstStage.duration_minutes)*60000).toISOString():null;
  const settings=wf.settings;
  if(settings?.target_employee_required && !d.targetEmployeeId)return c.json({error:'TARGET_EMPLOYEE_REQUIRED'},400);
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO transactions(id,company_id,transaction_number,transaction_type_id,workflow_id,requester_user_id,employee_id,status,current_stage_id,data_json) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(txId,companyId(c),number,d.transactionTypeId,wf.w.id,userId(c),eid,'قيد الإجراء',firstStage.id,JSON.stringify({requesterEmployeeId:employeeId(c),targetEmployeeId:eid})),
    c.env.DB.prepare(`INSERT INTO transaction_stage_executions(id,transaction_id,stage_id,execution_order,due_at,status) VALUES(?,?,?,?,?,'active')`).bind(firstExecutionId,txId,firstStage.id,1,due),
    ...d.answers.flatMap(a=>[c.env.DB.prepare(`INSERT INTO transaction_answers(id,transaction_id,field_id,value_json) VALUES(?,?,?,?)`).bind(crypto.randomUUID(),txId,a.fieldId,JSON.stringify(a.value)),c.env.DB.prepare(`INSERT INTO transaction_answer_history(id,transaction_id,execution_id,field_id,value_json,actor_user_id) VALUES(?,?,?,?,?,?)`).bind(crypto.randomUUID(),txId,firstExecutionId,a.fieldId,JSON.stringify(a.value),userId(c))]),
    c.env.DB.prepare(`INSERT INTO transaction_actions(id,transaction_id,company_id,actor_user_id,action,to_stage_id,metadata_json) VALUES(?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),txId,companyId(c),userId(c),'create',firstStage.id,JSON.stringify({transactionNumber:number}))
  ]);
  await audit(c,'transaction_created','transaction',txId,{transactionNumber:number,transactionTypeId:d.transactionTypeId,targetEmployeeId:eid});
  return c.json({id:txId,transactionNumber:number},201);
});

const actionSchema=z.object({action:z.enum(['next','return','reject','cancel','delegate']),toStageId:z.string().uuid().nullable().optional(),delegateEmployeeId:z.string().uuid().nullable().optional(),reason:z.string().trim().max(2000).nullable().optional(),answers:z.array(z.object({fieldId:z.string().uuid(),value:z.any()})).default([])});
app.post('/:id/action', async c=>{
  if(!(await allowed(c,'transaction.process')))return c.json({error:'FORBIDDEN'},403);
  const parsed=actionSchema.safeParse(await c.req.json().catch(()=>null)); if(!parsed.success)return c.json({error:'TRANSACTION-003',message:'الإجراء غير مكتمل.'},400);
  const d=parsed.data; const cid=companyId(c); const id=c.req.param('id');
  const tx=await c.env.DB.prepare(`SELECT * FROM transactions WHERE id=? AND company_id=?`).bind(id,cid).first<any>(); if(!tx)return c.json({error:'TRANSACTION_NOT_FOUND'},404);
  if(tx.status!=='قيد الإجراء')return c.json({error:'TRANSACTION_CLOSED'},409);
  const stage=await c.env.DB.prepare(`SELECT * FROM workflow_stages WHERE id=? AND workflow_id=?`).bind(tx.current_stage_id,tx.workflow_id).first<any>(); if(!stage)return c.json({error:'STAGE_NOT_FOUND'},409);
  const txFor={...tx,workflow:{id:tx.workflow_id}}; if(!(await canAct(c,txFor,stage)))return c.json({error:'STAGE_FORBIDDEN',message:'لا تملك صلاحية تنفيذ هذه المرحلة.'},403);
  const wf=await loadPublishedWorkflow(c,tx.transaction_type_id); if(!wf)return c.json({error:'WORKFLOW_NOT_AVAILABLE'},409);
  const answerMap=(await allAnswers(c,id)).map; for(const a of d.answers){ answerMap.set(a.fieldId,a.value); }
  for(const f of wf.fields.filter((x:any)=>x.stage_id===stage.id&&x.active)){if(f.required&&!d.answers.some(a=>a.fieldId===f.id&&a.value!==null&&a.value!=='')){return c.json({error:'TRANSACTION-004',message:`الحقل «${f.label_ar}» مطلوب.`},400);}}
  if(d.answers.length) await c.env.DB.batch(d.answers.flatMap(a=>[c.env.DB.prepare(`DELETE FROM transaction_answers WHERE transaction_id=? AND field_id=?`).bind(id,a.fieldId),c.env.DB.prepare(`INSERT INTO transaction_answers(id,transaction_id,field_id,value_json) VALUES(?,?,?,?)`).bind(crypto.randomUUID(),id,a.fieldId,JSON.stringify(a.value)),c.env.DB.prepare(`INSERT INTO transaction_answer_history(id,transaction_id,execution_id,field_id,value_json,actor_user_id) VALUES(?,?,?,?,?,?)`).bind(crypto.randomUUID(),id,active.id,a.fieldId,JSON.stringify(a.value),userId(c))])));
  let nextStage:any=null; let finalStatus=tx.status; let action=d.action; const activeDelegation=await c.env.DB.prepare(`SELECT id FROM transaction_delegations WHERE transaction_id=? AND status='active' AND to_employee_id=? LIMIT 1`).bind(id,employeeId(c)).first<any>(); if(activeDelegation && d.action==='next'){ await c.env.DB.batch([c.env.DB.prepare(`UPDATE transaction_delegations SET status='completed',completed_at=CURRENT_TIMESTAMP WHERE id=?`).bind(activeDelegation.id),c.env.DB.prepare(`INSERT INTO transaction_actions(id,transaction_id,company_id,actor_user_id,action,from_stage_id,reason,metadata_json) VALUES(?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),id,cid,userId(c),'delegation_complete',stage.id,d.reason??null,JSON.stringify({delegationId:activeDelegation.id}))]); await audit(c,'transaction_delegation_completed','transaction',id,{stageId:stage.id}); return c.json({ok:true,status:tx.status,currentStageId:stage.id,delegationCompleted:true}); }
  if(d.action==='delegate'){
    const cfg=safe(stage.config_json,{}); if(!cfg?.delegate?.enabled)return c.json({error:'DELEGATION_NOT_CONFIGURED',message:'التفويض غير متاح في هذه المرحلة.'},409);
    if(!(d.delegateEmployeeId))return c.json({error:'DELEGATE_EMPLOYEE_REQUIRED'},400);
    const target=await c.env.DB.prepare(`SELECT id FROM employees WHERE id=? AND company_id=? AND status<>'terminated'`).bind(d.delegateEmployeeId,cid).first(); if(!target)return c.json({error:'INVALID_DELEGATE_EMPLOYEE'},400);
    const active=await c.env.DB.prepare(`SELECT id FROM transaction_stage_executions WHERE transaction_id=? AND status='active' ORDER BY execution_order DESC LIMIT 1`).bind(id).first<any>();
    await c.env.DB.batch([c.env.DB.prepare(`INSERT INTO transaction_delegations(id,transaction_id,stage_execution_id,from_employee_id,to_employee_id,status) VALUES(?,?,?,?,?,'active')`).bind(crypto.randomUUID(),id,active.id,employeeId(c),d.delegateEmployeeId),c.env.DB.prepare(`INSERT INTO transaction_actions(id,transaction_id,company_id,actor_user_id,action,from_stage_id,reason,metadata_json) VALUES(?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),id,cid,userId(c),'delegate',stage.id,d.reason??null,JSON.stringify({delegateEmployeeId:d.delegateEmployeeId}))]);
    await audit(c,'transaction_delegated','transaction',id,{stageId:stage.id,delegateEmployeeId:d.delegateEmployeeId}); return c.json({ok:true,delegated:true});
  }
  if(d.action==='cancel'){ if(!(await allowed(c,'transaction.cancel')))return c.json({error:'FORBIDDEN'},403); const configured=wf.transitions.some((t:any)=>t.from_stage_id===stage.id&&t.action==='cancel'); if(!configured)return c.json({error:'ACTION_NOT_CONFIGURED',message:'الإلغاء غير متاح في هذه المرحلة.'},409); finalStatus='ملغية'; }
  else if(d.action==='reject'){ if(!(await allowed(c,'transaction.reject')))return c.json({error:'FORBIDDEN'},403); const configured=wf.transitions.some((t:any)=>t.from_stage_id===stage.id&&t.action==='reject'); if(!configured)return c.json({error:'ACTION_NOT_CONFIGURED',message:'الرفض غير متاح في هذه المرحلة.'},409); finalStatus='مرفوضة'; }
  else if(d.action==='return'){ if(!(await allowed(c,'transaction.return')))return c.json({error:'FORBIDDEN'},403); const configured=wf.transitions.filter((t:any)=>t.from_stage_id===stage.id&&t.action==='return'); const chosen=configured.find((t:any)=>!d.toStageId||t.to_stage_id===d.toStageId); if(!chosen)return c.json({error:'RETURN_ROUTE_NOT_CONFIGURED',message:'مسار الإرجاع لهذه المرحلة غير مضبوط في الاستديو.'},409); nextStage=wf.stages.find((s:any)=>s.id===chosen.to_stage_id); if(!nextStage)return c.json({error:'RETURN_STAGE_REQUIRED'},400); }
  else {
    const routes=wf.transitions.filter((t:any)=>t.from_stage_id===stage.id&&t.action==='next');
    const matched=routes.sort((a:any,b:any)=>a.sort_order-b.sort_order).find((t:any)=>transitionConditionMatches(safe(t.condition_json,null),answerMap));
    nextStage=matched?.to_stage_id?wf.stages.find((s:any)=>s.id===matched.to_stage_id):null;
    if(!nextStage){ const idx=wf.stages.findIndex((s:any)=>s.id===stage.id); nextStage=wf.stages[idx+1]||null; }
    if(!nextStage)finalStatus='مكتملة';
  }
  const now=new Date();
  const active=await c.env.DB.prepare(`SELECT id,execution_order FROM transaction_stage_executions WHERE transaction_id=? AND status='active' ORDER BY execution_order DESC LIMIT 1`).bind(id).first<any>();
  const statements:any[]=[
    c.env.DB.prepare(`UPDATE transaction_stage_executions SET status=?,completed_at=CURRENT_TIMESTAMP,acted_by=?,return_reason=? WHERE id=?`).bind(finalStatus==='مرفوضة'?'rejected':finalStatus==='ملغية'?'cancelled':action==='return'?'returned':'completed',userId(c),d.reason??null,active.id),
    c.env.DB.prepare(`INSERT INTO transaction_actions(id,transaction_id,company_id,actor_user_id,action,from_stage_id,to_stage_id,reason,metadata_json) VALUES(?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),id,cid,userId(c),action,stage.id,nextStage?.id??null,d.reason??null,JSON.stringify({executionOrder:active.execution_order}))
  ];
  if(finalStatus==='قيد الإجراء' && nextStage){ const due=nextStage.duration_minutes?new Date(now.getTime()+Number(nextStage.duration_minutes)*60000).toISOString():null; statements.push(c.env.DB.prepare(`UPDATE transactions SET current_stage_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(nextStage.id,id)); statements.push(c.env.DB.prepare(`INSERT INTO transaction_stage_executions(id,transaction_id,stage_id,execution_order,due_at,status) VALUES(?,?,?,?,?,'active')`).bind(crypto.randomUUID(),id,nextStage.id,Number(active.execution_order)+1,due)); }
  else statements.push(c.env.DB.prepare(`UPDATE transactions SET status=?,current_stage_id=NULL,updated_at=CURRENT_TIMESTAMP,completed_at=CASE WHEN ? IN ('مكتملة','ملغية','مرفوضة') THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE id=?`).bind(finalStatus,finalStatus,id));
  await c.env.DB.batch(statements); await audit(c,`transaction_${action}`,'transaction',id,{fromStageId:stage.id,toStageId:nextStage?.id??null,reason:d.reason??null});
  return c.json({ok:true,status:finalStatus,currentStageId:nextStage?.id??null});
});

export default app;
