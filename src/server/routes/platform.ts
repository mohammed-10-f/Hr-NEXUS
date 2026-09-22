import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { requireSuperAdmin, requireAuthentication, requireCompanyUser } from '../middleware/session';
import { createCompanyAccessSession, getCookie, revokeCompanyAccess } from '../auth/session';
import { audit } from '../audit';
import { hashPassword, sha256 } from '../auth/crypto';

const app=new Hono<Env>();
const companySchema=z.object({companyIdentifier:z.string().trim().regex(/^[A-Za-z0-9_-]{2,32}$/),legalName:z.string().trim().min(2).max(200),displayName:z.string().trim().min(2).max(200)});
const adminSchema=z.object({username:z.string().trim().min(1).max(128),password:z.string().min(8).max(256),displayName:z.string().trim().min(2).max(200),employeeId:z.string().trim().max(128).optional().nullable()});

app.get('/companies',requireSuperAdmin,async c=>{
  const rows=await c.env.DB.prepare(`
    SELECT c.id,c.company_identifier,c.legal_name,c.display_name,c.status,c.created_at,
      EXISTS(SELECT 1 FROM company_users cu WHERE cu.company_id=c.id AND cu.status='active'
        AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.company_user_id=cu.id AND r.code='company_admin')) AS has_company_admin
    FROM companies c ORDER BY c.created_at DESC`).all<any>();
  return c.json({items:rows.results});
});
app.post('/companies',requireSuperAdmin,async c=>{
  const parsed=companySchema.safeParse(await c.req.json().catch(()=>null)); if(!parsed.success) return c.json({error:'INVALID_INPUT'},400);
  const id=crypto.randomUUID();
  try {
    await c.env.DB.prepare(`INSERT INTO companies(id,company_identifier,legal_name,display_name) VALUES(?,?,?,?)`).bind(id,parsed.data.companyIdentifier,parsed.data.legalName,parsed.data.displayName).run();
  } catch { return c.json({error:'COMPANY_IDENTIFIER_EXISTS'},409); }
  await audit(c,'company_create','company',id,{companyIdentifier:parsed.data.companyIdentifier});
  return c.json({ok:true,id},201);
});
app.post('/companies/:companyId/admins',requireSuperAdmin,async c=>{
  const parsed=adminSchema.safeParse(await c.req.json().catch(()=>null)); if(!parsed.success) return c.json({error:'INVALID_INPUT'},400);
  const company=await c.env.DB.prepare(`SELECT id FROM companies WHERE id=?`).bind(c.req.param('companyId')).first();
  if(!company) return c.json({error:'COMPANY_NOT_FOUND'},404);
  const userId=crypto.randomUUID();
  try {
    await c.env.DB.prepare(`INSERT INTO company_users(id,company_id,username,employee_id,password_hash,must_change_password) VALUES(?,?,?,?,?,1)`)
      .bind(userId,c.req.param('companyId'),parsed.data.username,parsed.data.employeeId??null,await hashPassword(parsed.data.password)).run();
    const roleId=crypto.randomUUID();
    await c.env.DB.prepare(`INSERT INTO roles(id,company_id,name_ar,name_en,code,system_role) VALUES(?,?,?,?,?,1)`)
      .bind(roleId,c.req.param('companyId'),'مدير الشركة','Company Admin','company_admin').run();
    const permissions=await c.env.DB.prepare(`SELECT id FROM permissions`).all<{id:string}>();
    const batch=permissions.results.map(p=>c.env.DB.prepare(`INSERT OR IGNORE INTO role_permissions(role_id,permission_id,scope) VALUES(?,?,?)`).bind(roleId,p.id,'company'));
    await c.env.DB.batch([c.env.DB.prepare(`INSERT INTO user_roles(company_user_id,role_id) VALUES(?,?)`).bind(userId,roleId),...batch]);
    await audit(c,'company_admin_create','company_user',userId,{companyId:c.req.param('companyId')});
  } catch { return c.json({error:'USERNAME_EXISTS_OR_CREATE_FAILED'},409); }
  return c.json({ok:true,userId},201);
});

app.post('/companies/:companyId/access-request',requireSuperAdmin,async c=>{
  const companyId=c.req.param('companyId');
  const body=await c.req.json().catch(()=>({}));
  const reason=z.object({reason:z.string().trim().min(3).max(500)}).safeParse(body);
  if(!reason.success) return c.json({error:'INVALID_INPUT'},400);
  const company=await c.env.DB.prepare(`SELECT id,status FROM companies WHERE id=?`).bind(companyId).first<{id:string;status:string}>();
  if(!company || company.status!=='active') return c.json({error:'COMPANY_NOT_FOUND'},404);
  const admin=await c.env.DB.prepare(`
    SELECT cu.id FROM company_users cu JOIN user_roles ur ON ur.company_user_id=cu.id JOIN roles r ON r.id=ur.role_id
    WHERE cu.company_id=? AND cu.status='active' AND r.code='company_admin' LIMIT 1`).bind(companyId).first<{id:string}>();
  const requestId=crypto.randomUUID();
  if(!admin){
    await c.env.DB.prepare(`INSERT INTO company_access_requests(id,super_admin_user_id,company_id,approved_at,expires_at,status,reason,created_at) VALUES(?,?,?,?,?,'approved',?,CURRENT_TIMESTAMP)`)
      .bind(requestId,c.get('session')!.platformUserId,companyId,new Date().toISOString(),new Date(Date.now()+60*60*1000).toISOString(),reason.data.reason).run();
    await createCompanyAccessSession(c,requestId,c.get('session')!.platformUserId!,companyId);
    await audit(c,'company_access_direct','company_access_request',requestId,{reason:reason.data.reason},{type:'platform',platformUserId:c.get('session')!.platformUserId,companyId});
    return c.json({ok:true,status:'approved',direct:true});
  }
  await c.env.DB.prepare(`INSERT INTO company_access_requests(id,super_admin_user_id,company_id,reason) VALUES(?,?,?,?)`).bind(requestId,c.get('session')!.platformUserId,companyId,reason.data.reason).run();
  await c.env.DB.prepare(`INSERT INTO notifications(id,company_id,user_id,title_ar,body_ar,type) VALUES(?,?,?,?,?,'company_access')`)
    .bind(crypto.randomUUID(),companyId,admin.id,'طلب دخول إلى بيئة الشركة','مدير المنصة يطلب الوصول إلى بيئة شركتكم.').run();
  await audit(c,'company_access_request','company_access_request',requestId,{reason:reason.data.reason},{type:'platform',platformUserId:c.get('session')!.platformUserId,companyId});
  return c.json({ok:true,status:'pending',requestId});
});

app.get('/access-requests/:requestId',requireSuperAdmin,async c=>{
  const row=await c.env.DB.prepare(`
    SELECT r.*,c.company_identifier,c.display_name,pu.display_name AS super_admin_name
    FROM company_access_requests r JOIN companies c ON c.id=r.company_id JOIN platform_users pu ON pu.id=r.super_admin_user_id
    WHERE r.id=? AND r.super_admin_user_id=?`).bind(c.req.param('requestId'),c.get('session')!.platformUserId).first();
  if(!row) return c.json({error:'NOT_FOUND'},404);
  if((row as any).status==='approved' && (row as any).expires_at && new Date((row as any).expires_at).getTime()>Date.now() && !getCookie(c.req.header('Cookie'),'hr_company_access')){
    await createCompanyAccessSession(c,c.req.param('requestId'),c.get('session')!.platformUserId!, (row as any).company_id);
  }
  return c.json({request:row});
});

app.get('/company-access-requests',requireCompanyUser,async c=>{
  if(!(await import('../authorization')).hasPermission(c,'company_access.review')) return c.json({error:'FORBIDDEN'},403);
  const rows=await c.env.DB.prepare(`
    SELECT r.id,r.requested_at,r.expires_at,r.status,r.reason,pu.display_name AS super_admin_name,c.company_identifier,c.display_name
    FROM company_access_requests r JOIN platform_users pu ON pu.id=r.super_admin_user_id JOIN companies c ON c.id=r.company_id
    WHERE r.company_id=? AND r.status='pending' ORDER BY r.requested_at DESC`).bind(c.get('session')!.activeCompanyId).all();
  return c.json({items:rows.results});
});
app.post('/company-access-requests/:requestId/decision',requireCompanyUser,async c=>{
  const {hasPermission}=await import('../authorization');
  if(!(await hasPermission(c,'company_access.review'))) return c.json({error:'FORBIDDEN'},403);
  const decision=z.object({decision:z.enum(['allow','reject'])}).safeParse(await c.req.json().catch(()=>null));
  if(!decision.success) return c.json({error:'INVALID_INPUT'},400);
  const req=await c.env.DB.prepare(`SELECT * FROM company_access_requests WHERE id=? AND company_id=? AND status='pending'`).bind(c.req.param('requestId'),c.get('session')!.activeCompanyId).first<any>();
  if(!req) return c.json({error:'NOT_FOUND_OR_DECIDED'},404);
  if(decision.data.decision==='allow'){
    const expires=new Date(Date.now()+60*60*1000).toISOString();
    await c.env.DB.prepare(`UPDATE company_access_requests SET status='approved',approved_at=CURRENT_TIMESTAMP,approved_by=?,expires_at=? WHERE id=?`).bind(c.get('session')!.companyUserId,expires,req.id).run();
    await audit(c,'company_access_approved','company_access_request',req.id,{},{type:'company',companyUserId:c.get('session')!.companyUserId,companyId:req.company_id});
  } else {
    await c.env.DB.prepare(`UPDATE company_access_requests SET status='rejected',rejected_at=CURRENT_TIMESTAMP,approved_by=? WHERE id=?`).bind(c.get('session')!.companyUserId,req.id).run();
    await audit(c,'company_access_rejected','company_access_request',req.id,{},{type:'company',companyUserId:c.get('session')!.companyUserId,companyId:req.company_id});
  }
  return c.json({ok:true,status:decision.data.decision==='allow'?'approved':'rejected'});
});

app.post('/exit-company',requireSuperAdmin,async c=>{
  const s=c.get('session')!;
  if(!s.activeCompanyId) return c.json({ok:true});
  const accessRaw=getCookie(c.req.header('Cookie'),'hr_company_access');
  if(accessRaw){
    const hash=await sha256(accessRaw);
    await c.env.DB.prepare(`UPDATE company_access_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=? AND super_admin_user_id=?`).bind(hash,s.platformUserId).run();
  }
  await audit(c,'company_access_exit','company',s.activeCompanyId,{});
  await revokeCompanyAccess(c);
  return c.json({ok:true});
});
export default app;
