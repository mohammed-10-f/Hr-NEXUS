import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { requireSuperAdmin, requireCompanyUser, requirePasswordChanged } from '../middleware/session';
import { createCompanyAccessSession, getCookie, revokeCompanyAccess } from '../auth/session';
import { audit } from '../audit';
import { hashPassword, sha256 } from '../auth/crypto';
import { hasPermission } from '../authorization';

const app=new Hono<Env>();
app.use('*',requirePasswordChanged);
const companySchema=z.object({
  companyIdentifier:z.string().trim().regex(/^[A-Za-z0-9_-]{2,32}$/),
  legalName:z.string().trim().min(2).max(200),
  displayName:z.string().trim().min(2).max(200),
  managementStatus:z.enum(['active','inactive']).default('active')
});
const adminSchema=z.object({
  username:z.string().trim().min(1).max(128),
  password:z.string().min(8).max(256),
  displayName:z.string().trim().min(2).max(200),
  employeeId:z.string().trim().max(128).optional().nullable()
});
const createCompanySchema=companySchema.extend({admin:adminSchema.optional()});
const updateCompanySchema=companySchema.partial().refine(v=>Object.keys(v).length>0,{message:'EMPTY_UPDATE'});

async function companyById(c:any, companyId:string){
  return c.env.DB.prepare(`SELECT id,company_identifier,legal_name,display_name,status,management_status,created_at,updated_at FROM companies WHERE id=?`).bind(companyId).first<any>();
}
async function activeCompanyAdmin(c:any, companyId:string){
  return c.env.DB.prepare(`
    SELECT cu.id,cu.username,cu.display_name,cu.employee_id,cu.status
    FROM company_users cu
    JOIN user_roles ur ON ur.company_user_id=cu.id
    JOIN roles r ON r.id=ur.role_id
    WHERE cu.company_id=? AND cu.status='active' AND r.code='company_admin'
    LIMIT 1`).bind(companyId).first<any>();
}

app.get('/companies',requireSuperAdmin,async c=>{
  const search=(c.req.query('search')??'').trim();
  const status=c.req.query('status')??'';
  const params:any[]=[];
  const where:string[]=[];
  if(search){where.push('(c.company_identifier LIKE ? OR c.display_name LIKE ? OR c.legal_name LIKE ?)');const q=`%${search}%`;params.push(q,q,q);}
  if(status==='active'||status==='inactive'){where.push('c.management_status=?');params.push(status);}
  const sql=`SELECT c.id,c.company_identifier,c.legal_name,c.display_name,c.status,c.management_status,c.created_at,
    EXISTS(SELECT 1 FROM company_users cu JOIN user_roles ur ON ur.company_user_id=cu.id JOIN roles r ON r.id=ur.role_id
      WHERE cu.company_id=c.id AND cu.status='active' AND r.code='company_admin') AS has_company_admin
    FROM companies c ${where.length?`WHERE ${where.join(' AND ')}`:''} ORDER BY c.created_at DESC`;
  const rows=await c.env.DB.prepare(sql).bind(...params).all<any>();
  return c.json({items:rows.results});
});

app.get('/companies/:companyId',requireSuperAdmin,async c=>{
  const company=await companyById(c,c.req.param('companyId'));
  if(!company) return c.json({error:'COMPANY_NOT_FOUND'},404);
  const admin=await activeCompanyAdmin(c,c.req.param('companyId'));
  const recentRequests=await c.env.DB.prepare(`
    SELECT r.id,r.status,r.reason,r.requested_at,r.approved_at,r.rejected_at,r.expires_at,pu.display_name AS super_admin_name
    FROM company_access_requests r JOIN platform_users pu ON pu.id=r.super_admin_user_id
    WHERE r.company_id=? ORDER BY r.requested_at DESC LIMIT 10`).bind(c.req.param('companyId')).all<any>();
  return c.json({company,admin:admin??null,recentRequests:recentRequests.results});
});

app.post('/companies',requireSuperAdmin,async c=>{
  const parsed=createCompanySchema.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success) return c.json({error:'INVALID_INPUT'},400);
  const id=crypto.randomUUID();
  const admin=parsed.data.admin;
  const adminId=admin?crypto.randomUUID():null;
  const roleId=admin?crypto.randomUUID():null;
  const passwordHash=admin?await hashPassword(admin.password):null;
  try{
    const statements=[c.env.DB.prepare(`INSERT INTO companies(id,company_identifier,legal_name,display_name,management_status) VALUES(?,?,?,?,?)`)
      .bind(id,parsed.data.companyIdentifier,parsed.data.legalName,parsed.data.displayName,parsed.data.managementStatus)];
    if(admin&&adminId&&roleId){
      statements.push(c.env.DB.prepare(`INSERT INTO company_users(id,company_id,username,display_name,employee_id,password_hash,must_change_password,status) VALUES(?,?,?,?,?,?,1,'active')`).bind(adminId,id,admin.username,admin.displayName,admin.employeeId??null,passwordHash));
      statements.push(c.env.DB.prepare(`INSERT INTO roles(id,company_id,name_ar,name_en,code,system_role) VALUES(?,?,?,?,?,1)`).bind(roleId,id,'مدير الشركة','Company Admin','company_admin'));
      statements.push(c.env.DB.prepare(`INSERT INTO user_roles(company_user_id,role_id) VALUES(?,?)`).bind(adminId,roleId));
      const permissions=await c.env.DB.prepare(`SELECT id FROM permissions`).all<{id:string}>();
      for(const p of permissions.results) statements.push(c.env.DB.prepare(`INSERT INTO role_permissions(role_id,permission_id,scope) VALUES(?,?,?)`).bind(roleId,p.id,'company'));
    }
    await c.env.DB.batch(statements);
  }catch(err){
    const message=String(err);
    if(message.includes('UNIQUE')||message.includes('constraint failed')) return c.json({error:'COMPANY_IDENTIFIER_EXISTS'},409);
    return c.json({error:'COMPANY_CREATE_FAILED'},409);
  }
  await audit(c,'company_create','company',id,{companyIdentifier:parsed.data.companyIdentifier,hasCompanyAdmin:Boolean(admin)});
  if(admin) await audit(c,'company_admin_create','company_user',adminId!,{companyId:id});
  return c.json({ok:true,id,adminId},201);
});

app.patch('/companies/:companyId',requireSuperAdmin,async c=>{
  const companyId=c.req.param('companyId');
  const parsed=updateCompanySchema.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success) return c.json({error:'INVALID_INPUT'},400);
  const before=await companyById(c,companyId);
  if(!before) return c.json({error:'COMPANY_NOT_FOUND'},404);
  const data=parsed.data;
  const fields:string[]=[];const values:any[]=[];
  if(data.companyIdentifier!==undefined){fields.push('company_identifier=?');values.push(data.companyIdentifier);}
  if(data.legalName!==undefined){fields.push('legal_name=?');values.push(data.legalName);}
  if(data.displayName!==undefined){fields.push('display_name=?');values.push(data.displayName);}
  if(data.managementStatus!==undefined){fields.push('management_status=?');values.push(data.managementStatus);}
  fields.push('updated_at=CURRENT_TIMESTAMP');values.push(companyId);
  try{await c.env.DB.prepare(`UPDATE companies SET ${fields.join(',')} WHERE id=?`).bind(...values).run();}
  catch(err){if(String(err).includes('UNIQUE')) return c.json({error:'COMPANY_IDENTIFIER_EXISTS'},409);return c.json({error:'COMPANY_UPDATE_FAILED'},409);}
  if(data.managementStatus==='inactive' && before.management_status!=='inactive'){
    await c.env.DB.prepare(`UPDATE company_access_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE company_id=? AND revoked_at IS NULL`).bind(companyId).run();
    await c.env.DB.prepare(`UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE session_type='company' AND company_user_id IN (SELECT id FROM company_users WHERE company_id=?) AND revoked_at IS NULL`).bind(companyId).run();
    await c.env.DB.prepare(`UPDATE company_access_requests SET status='revoked',revoked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE company_id=? AND status='pending'`).bind(companyId).run();
  }
  await audit(c,'company_update','company',companyId,{before:{managementStatus:before.management_status,status:before.status},after:data});
  return c.json({ok:true});
});

app.post('/companies/:companyId/admins',requireSuperAdmin,async c=>{
  const parsed=adminSchema.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success) return c.json({error:'INVALID_INPUT'},400);
  const company=await companyById(c,c.req.param('companyId'));
  if(!company) return c.json({error:'COMPANY_NOT_FOUND'},404);
  const existing=await activeCompanyAdmin(c,c.req.param('companyId'));
  if(existing) return c.json({error:'ACTIVE_COMPANY_ADMIN_EXISTS'},409);
  const userId=crypto.randomUUID(),roleId=crypto.randomUUID();
  try{
    const permissions=await c.env.DB.prepare(`SELECT id FROM permissions`).all<{id:string}>();
    const statements=[
      c.env.DB.prepare(`INSERT INTO company_users(id,company_id,username,display_name,employee_id,password_hash,must_change_password,status) VALUES(?,?,?,?,?,?,1,'active')`).bind(userId,company.id,parsed.data.username,parsed.data.displayName,parsed.data.employeeId??null,await hashPassword(parsed.data.password)),
      c.env.DB.prepare(`INSERT INTO roles(id,company_id,name_ar,name_en,code,system_role) VALUES(?,?,?,?,?,1)`).bind(roleId,company.id,'مدير الشركة','Company Admin','company_admin'),
      c.env.DB.prepare(`INSERT INTO user_roles(company_user_id,role_id) VALUES(?,?)`).bind(userId,roleId),
      ...permissions.results.map(p=>c.env.DB.prepare(`INSERT INTO role_permissions(role_id,permission_id,scope) VALUES(?,?,?)`).bind(roleId,p.id,'company'))
    ];
    await c.env.DB.batch(statements);
  }catch(err){if(String(err).includes('UNIQUE')) return c.json({error:'USERNAME_EXISTS'},409);return c.json({error:'COMPANY_ADMIN_CREATE_FAILED'},409);}
  await audit(c,'company_admin_create','company_user',userId,{companyId:company.id});
  return c.json({ok:true,userId},201);
});

app.post('/companies/:companyId/access-request',requireSuperAdmin,async c=>{
  const companyId=c.req.param('companyId');
  const parsed=z.object({reason:z.string().trim().min(3).max(500)}).safeParse(await c.req.json().catch(()=>({})));
  if(!parsed.success) return c.json({error:'INVALID_INPUT'},400);
  const company=await companyById(c,companyId);
  if(!company || company.management_status!=='active') return c.json({error:'COMPANY_INACTIVE'},409);
  const current=await c.env.DB.prepare(`SELECT id,status FROM company_access_requests WHERE super_admin_user_id=? AND company_id=? AND status='pending' LIMIT 1`).bind(c.get('session')!.platformUserId,companyId).first<any>();
  if(current) return c.json({ok:true,status:'pending',requestId:current.id});
  const admin=await activeCompanyAdmin(c,companyId);
  const requestId=crypto.randomUUID();
  if(!admin){
    const expires=new Date(Date.now()+60*60*1000).toISOString();
    await c.env.DB.prepare(`INSERT INTO company_access_requests(id,super_admin_user_id,company_id,approved_at,expires_at,status,reason) VALUES(?,?,?,?,?,'approved',?)`)
      .bind(requestId,c.get('session')!.platformUserId,companyId,new Date().toISOString(),expires,parsed.data.reason).run();
    await createCompanyAccessSession(c,requestId,c.get('session')!.platformUserId!,companyId);
    await audit(c,'company_access_started','company',companyId,{requestId,reason:parsed.data.reason,mode:'direct'});
    return c.json({ok:true,status:'approved',direct:true});
  }
  await c.env.DB.prepare(`INSERT INTO company_access_requests(id,super_admin_user_id,company_id,reason) VALUES(?,?,?,?)`).bind(requestId,c.get('session')!.platformUserId,companyId,parsed.data.reason).run();
  await c.env.DB.prepare(`INSERT INTO notifications(id,company_id,user_id,title_ar,body_ar,type) VALUES(?,?,?,?,?,'company_access')`)
    .bind(crypto.randomUUID(),companyId,admin.id,'طلب دخول إلى بيئة الشركة','مدير المنصة يطلب الوصول إلى بيئة شركتكم للمراجعة والدعم.').run();
  await audit(c,'company_access_request','company_access_request',requestId,{reason:parsed.data.reason});
  return c.json({ok:true,status:'pending',requestId});
});

app.get('/access-requests/:requestId',requireSuperAdmin,async c=>{
  const row=await c.env.DB.prepare(`SELECT r.*,c.company_identifier,c.display_name,pu.display_name AS super_admin_name FROM company_access_requests r JOIN companies c ON c.id=r.company_id JOIN platform_users pu ON pu.id=r.super_admin_user_id WHERE r.id=? AND r.super_admin_user_id=?`).bind(c.req.param('requestId'),c.get('session')!.platformUserId).first<any>();
  if(!row) return c.json({error:'NOT_FOUND'},404);
  if(row.status==='approved' && row.expires_at && new Date(row.expires_at).getTime()>Date.now() && !getCookie(c.req.header('Cookie'),'hr_company_access')){
    await createCompanyAccessSession(c,c.req.param('requestId'),c.get('session')!.platformUserId!,row.company_id);
    await audit(c,'company_access_started','company',row.company_id,{requestId:row.id,reason:row.reason,mode:'approved'});
  }
  if(row.status==='approved' && row.expires_at && new Date(row.expires_at).getTime()<=Date.now()){
    await c.env.DB.prepare(`UPDATE company_access_requests SET status='expired',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='approved'`).bind(row.id).run();
    row.status='expired';
  }
  return c.json({request:row});
});

app.get('/company-access-requests',requireCompanyUser,async c=>{
  if(!(await hasPermission(c,'company_access.review'))) return c.json({error:'FORBIDDEN'},403);
  const rows=await c.env.DB.prepare(`SELECT r.id,r.requested_at,r.expires_at,r.status,r.reason,pu.display_name AS super_admin_name,c.company_identifier,c.display_name FROM company_access_requests r JOIN platform_users pu ON pu.id=r.super_admin_user_id JOIN companies c ON c.id=r.company_id WHERE r.company_id=? AND r.status='pending' ORDER BY r.requested_at DESC`).bind(c.get('session')!.activeCompanyId).all();
  return c.json({items:rows.results});
});
app.post('/company-access-requests/:requestId/decision',requireCompanyUser,async c=>{
  if(!(await hasPermission(c,'company_access.review'))) return c.json({error:'FORBIDDEN'},403);
  const decision=z.object({decision:z.enum(['allow','reject'])}).safeParse(await c.req.json().catch(()=>null));
  if(!decision.success) return c.json({error:'INVALID_INPUT'},400);
  const req=await c.env.DB.prepare(`SELECT * FROM company_access_requests WHERE id=? AND company_id=? AND status='pending'`).bind(c.req.param('requestId'),c.get('session')!.activeCompanyId).first<any>();
  if(!req) return c.json({error:'NOT_FOUND_OR_DECIDED'},404);
  if(decision.data.decision==='allow'){
    const expires=new Date(Date.now()+60*60*1000).toISOString();
    await c.env.DB.prepare(`UPDATE company_access_requests SET status='approved',approved_at=CURRENT_TIMESTAMP,approved_by=?,expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(c.get('session')!.companyUserId,expires,req.id).run();
    await audit(c,'company_access_approved','company_access_request',req.id,{},{type:'company',companyUserId:c.get('session')!.companyUserId,companyId:req.company_id});
  }else{
    await c.env.DB.prepare(`UPDATE company_access_requests SET status='rejected',rejected_at=CURRENT_TIMESTAMP,approved_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(c.get('session')!.companyUserId,req.id).run();
    await audit(c,'company_access_rejected','company_access_request',req.id,{},{type:'company',companyUserId:c.get('session')!.companyUserId,companyId:req.company_id});
  }
  return c.json({ok:true,status:decision.data.decision==='allow'?'approved':'rejected'});
});

app.post('/exit-company',requireSuperAdmin,async c=>{
  const s=c.get('session')!;
  if(!s.activeCompanyId) return c.json({ok:true});
  const accessRaw=getCookie(c.req.header('Cookie'),'hr_company_access');
  let requestId:string|null=null;
  if(accessRaw){ const hash=await sha256(accessRaw); const access=await c.env.DB.prepare(`SELECT request_id FROM company_access_sessions WHERE token_hash=? AND super_admin_user_id=? AND company_id=?`).bind(hash,s.platformUserId,s.activeCompanyId).first<{request_id:string|null}>(); requestId=access?.request_id??null; await c.env.DB.prepare(`UPDATE company_access_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=? AND super_admin_user_id=?`).bind(hash,s.platformUserId).run(); }
  if(requestId) await c.env.DB.prepare(`UPDATE company_access_requests SET status='revoked',revoked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='approved'`).bind(requestId).run();
  await audit(c,'company_access_exit','company',s.activeCompanyId,{});
  await revokeCompanyAccess(c);
  return c.json({ok:true});
});
export default app;
