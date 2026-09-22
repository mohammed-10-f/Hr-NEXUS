import { Hono } from 'hono';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '../auth/crypto';
import { createCompanySession, createPlatformSession, getCookie, revokeCurrentSession } from '../auth/session';
import { audit } from '../audit';
import type { Env } from '../env';
import { requireAuthentication } from '../middleware/session';

const app=new Hono<Env>();
const companyLogin=z.object({companyId:z.string().trim().min(1).max(64),loginIdentifier:z.string().trim().min(1).max(128),password:z.string().min(1).max(256)});
const platformLogin=z.object({username:z.string().trim().min(1).max(128),password:z.string().min(1).max(256)});
const changePassword=z.object({currentPassword:z.string().min(1).max(256),newPassword:z.string().min(8).max(256)});

async function locked(status:string, lockedUntil:string|null) {
  return status!=='active' || Boolean(lockedUntil && new Date(lockedUntil).getTime()>Date.now());
}
async function failCompany(c:any,user:any) {
  const count=(user.failed_login_count??0)+1;
  const until=count>=5?new Date(Date.now()+15*60*1000).toISOString():null;
  await c.env.DB.prepare(`UPDATE company_users SET failed_login_count=?,locked_until=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(count,until,user.id).run();
}
async function failPlatform(c:any,user:any) {
  const count=(user.failed_login_count??0)+1;
  const until=count>=5?new Date(Date.now()+15*60*1000).toISOString():null;
  await c.env.DB.prepare(`UPDATE platform_users SET failed_login_count=?,locked_until=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(count,until,user.id).run();
}

app.post('/login',async c=>{
  const parsed=companyLogin.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success) return c.json({error:'INVALID_INPUT'},400);
  const {companyId,loginIdentifier,password}=parsed.data;
  const user=await c.env.DB.prepare(`
    SELECT cu.id,cu.company_id,cu.employee_id,cu.password_hash,cu.status,cu.must_change_password,cu.failed_login_count,cu.locked_until,
      c.status company_status,c.company_identifier,c.display_name,c.legal_name
    FROM company_users cu JOIN companies c ON c.id=cu.company_id
    WHERE c.company_identifier=? AND cu.username=? LIMIT 1`)
    .bind(companyId,loginIdentifier).first<any>();
  if(!user || user.company_status!=='active' || await locked(user.status,user.locked_until) || !(await verifyPassword(password,user.password_hash))){
    if(user && user.company_status==='active' && user.status==='active') await failCompany(c,user);
    return c.json({error:'INVALID_CREDENTIALS'},401);
  }
  const session=await createCompanySession(c,user.id);
  await c.env.DB.prepare(`UPDATE company_users SET failed_login_count=0,locked_until=NULL,last_login_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(user.id).run();
  await audit(c,'login','company_user',user.id,{companyId:user.company_id},{type:'company',companyUserId:user.id,companyId:user.company_id});
  return c.json({ok:true,session:{expiresAt:session.expiresAt,mustChangePassword:Boolean(user.must_change_password),company:{id:user.company_id,companyIdentifier:user.company_identifier,displayName:user.display_name}}});
});

app.post('/platform-login',async c=>{
  const parsed=platformLogin.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success) return c.json({error:'INVALID_INPUT'},400);
  const {username,password}=parsed.data;
  const user=await c.env.DB.prepare(`SELECT id,display_name,password_hash,status,must_change_password,failed_login_count,locked_until FROM platform_users WHERE username=? LIMIT 1`).bind(username).first<any>();
  if(!user || await locked(user?.status??'inactive',user?.locked_until??null) || !(await verifyPassword(password,user?.password_hash??''))){
    if(user && user.status==='active') await failPlatform(c,user);
    return c.json({error:'INVALID_CREDENTIALS'},401);
  }
  const session=await createPlatformSession(c,user.id);
  await c.env.DB.prepare(`UPDATE platform_users SET failed_login_count=0,locked_until=NULL,last_login_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(user.id).run();
  await audit(c,'login','platform_user',user.id,{},{type:'platform',platformUserId:user.id});
  return c.json({ok:true,session:{expiresAt:session.expiresAt,mustChangePassword:Boolean(user.must_change_password)}});
});

app.post('/logout',async c=>{await revokeCurrentSession(c);return c.json({ok:true});});

app.post('/change-password',requireAuthentication,async c=>{
  const s=c.get('session')!;
  const parsed=changePassword.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success) return c.json({error:'INVALID_INPUT'},400);
  if(parsed.data.newPassword===parsed.data.currentPassword) return c.json({error:'PASSWORD_REUSE'},400);
  if(s.companyUserId){
    const user=await c.env.DB.prepare(`SELECT id,password_hash FROM company_users WHERE id=? AND company_id=?`).bind(s.companyUserId,s.activeCompanyId).first<any>();
    if(!user || !(await verifyPassword(parsed.data.currentPassword,user.password_hash))) return c.json({error:'INVALID_CREDENTIALS'},401);
    await c.env.DB.prepare(`UPDATE company_users SET password_hash=?,must_change_password=0,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(await hashPassword(parsed.data.newPassword),user.id).run();
    await audit(c,'password_change','company_user',user.id,{firstLogin:s.mustChangePassword});
  }else if(s.platformUserId){
    const user=await c.env.DB.prepare(`SELECT id,password_hash FROM platform_users WHERE id=?`).bind(s.platformUserId).first<any>();
    if(!user || !(await verifyPassword(parsed.data.currentPassword,user.password_hash))) return c.json({error:'INVALID_CREDENTIALS'},401);
    await c.env.DB.prepare(`UPDATE platform_users SET password_hash=?,must_change_password=0,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(await hashPassword(parsed.data.newPassword),user.id).run();
    await audit(c,'password_change','platform_user',user.id,{});
  }
  return c.json({ok:true});
});

app.get('/me',async c=>{
  const s=c.get('session');
  return c.json({authenticated:Boolean(s),session:s});
});
export default app;
