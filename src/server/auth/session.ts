import type { Context } from 'hono';
import type { Env } from '../env';
import type { SessionContext } from '../../shared/types';
import { sha256, hashOptional } from './crypto';
import { audit } from '../audit';

const SESSION_COOKIE = 'hr_session';
const ACCESS_COOKIE = 'hr_company_access';
const SESSION_TTL = 8 * 60 * 60 * 1000;
const ACCESS_TTL = 60 * 60 * 1000;
const INACTIVITY_TTL = 30 * 60 * 1000;

export function getCookie(header: string | undefined, name: string) {
  if (!header) return null;
  const item = header.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}
function cookie(c: Context<Env>, name: string, value: string, maxAge: number) {
  const secure=new URL(c.req.url).protocol==='https:';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; ${secure?'Secure; ':''}SameSite=Lax; Max-Age=${Math.floor(maxAge / 1000)}`;
}
function appendCookie(c: Context<Env>, value: string) {
  c.header('Set-Cookie', value, { append: true });
}
export async function createPlatformSession(c: Context<Env>, platformUserId: string) {
  const raw = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const id = crypto.randomUUID(), tokenHash = await sha256(raw);
  const expiresAt = new Date(Date.now() + SESSION_TTL).toISOString();
  await c.env.DB.prepare(`INSERT INTO sessions(id,session_type,platform_user_id,token_hash,expires_at,ip_hash,user_agent_hash) VALUES(?,?,?,?,?,?,?)`)
    .bind(id,'platform',platformUserId,tokenHash,expiresAt,await hashOptional(c.req.header('CF-Connecting-IP')),await hashOptional(c.req.header('User-Agent'))).run();
  c.header('Set-Cookie', cookie(c,SESSION_COOKIE, raw, SESSION_TTL));
  return { id, expiresAt };
}
export async function createCompanySession(c: Context<Env>, companyUserId: string) {
  const raw = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const id = crypto.randomUUID(), tokenHash = await sha256(raw);
  const expiresAt = new Date(Date.now() + SESSION_TTL).toISOString();
  await c.env.DB.prepare(`INSERT INTO sessions(id,session_type,company_user_id,token_hash,expires_at,ip_hash,user_agent_hash) VALUES(?,?,?,?,?,?,?)`)
    .bind(id,'company',companyUserId,tokenHash,expiresAt,await hashOptional(c.req.header('CF-Connecting-IP')),await hashOptional(c.req.header('User-Agent'))).run();
  c.header('Set-Cookie', cookie(c,SESSION_COOKIE, raw, SESSION_TTL));
  return { id, expiresAt };
}
export async function createCompanyAccessSession(c: Context<Env>, requestId: string, platformUserId: string, companyId: string) {
  const raw = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const id = crypto.randomUUID(), tokenHash = await sha256(raw);
  const expiresAt = new Date(Date.now() + ACCESS_TTL).toISOString();
  await c.env.DB.prepare(`INSERT INTO company_access_sessions(id,request_id,super_admin_user_id,company_id,token_hash,expires_at,ip_hash,user_agent_hash) VALUES(?,?,?,?,?,?,?,?)`)
    .bind(id,requestId,platformUserId,companyId,tokenHash,expiresAt,await hashOptional(c.req.header('CF-Connecting-IP')),await hashOptional(c.req.header('User-Agent'))).run();
  c.header('Set-Cookie', cookie(c,ACCESS_COOKIE, raw, ACCESS_TTL));
  return { id, expiresAt };
}
// Revokes the server session and expires both auth cookies.
// Cookie headers are appended independently so browsers do not parse two
// Set-Cookie values as one combined cookie.
export async function revokeCurrentSession(c: Context<Env>) {
  const raw = getCookie(c.req.header('Cookie'), SESSION_COOKIE);
  if (raw) {
    await c.env.DB.prepare(`UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=?`).bind(await sha256(raw)).run();
  }
  const accessRaw = getCookie(c.req.header('Cookie'), ACCESS_COOKIE);
  if (accessRaw) {
    await c.env.DB.prepare(`UPDATE company_access_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=? AND revoked_at IS NULL`).bind(await sha256(accessRaw)).run();
  }
  appendCookie(c, cookie(c,SESSION_COOKIE,'',0));
  appendCookie(c, cookie(c,ACCESS_COOKIE,'',0));
}
export async function revokeCompanyAccess(c: Context<Env>) {
  const raw = getCookie(c.req.header('Cookie'), ACCESS_COOKIE);
  if (raw) await c.env.DB.prepare(`UPDATE company_access_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=?`).bind(await sha256(raw)).run();
  appendCookie(c, cookie(c,ACCESS_COOKIE,'',0));
}
export { SESSION_COOKIE, ACCESS_COOKIE };

export async function loadSessionContext(c: Context<Env>): Promise<SessionContext | null> {
  const raw = getCookie(c.req.header('Cookie'), SESSION_COOKIE);
  if (!raw) return null;
  const tokenHash = await sha256(raw);
  const platform = await c.env.DB.prepare(`
    SELECT s.id,s.platform_user_id,pu.display_name,pu.status,pu.must_change_password, s.expires_at,s.last_activity_at
    FROM sessions s JOIN platform_users pu ON pu.id=s.platform_user_id
    WHERE s.session_type='platform' AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP AND pu.status='active'
  `).bind(tokenHash).first<{id:string;platform_user_id:string;display_name:string;status:string;must_change_password:number;expires_at:string}>();
  if (platform) {
    if (Date.now()-new Date(platform.last_activity_at).getTime()>INACTIVITY_TTL) { await c.env.DB.prepare(`UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE id=?`).bind(platform.id).run(); return null; }
    await c.env.DB.prepare(`UPDATE sessions SET last_activity_at=CURRENT_TIMESTAMP WHERE id=?`).bind(platform.id).run();
    const accessRaw = getCookie(c.req.header('Cookie'), ACCESS_COOKIE);
    if (accessRaw) {
      const accessHash = await sha256(accessRaw);
      const expiredAccess = await c.env.DB.prepare(`SELECT id,request_id,company_id,expires_at FROM company_access_sessions WHERE token_hash=? AND super_admin_user_id=? AND revoked_at IS NULL`).bind(accessHash,platform.platform_user_id).first<{id:string;request_id:string|null;company_id:string;expires_at:string}>();
      if(expiredAccess && new Date(expiredAccess.expires_at).getTime()<=Date.now()){
        await c.env.DB.prepare(`UPDATE company_access_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE id=? AND revoked_at IS NULL`).bind(expiredAccess.id).run();
        if(expiredAccess.request_id) await c.env.DB.prepare(`UPDATE company_access_requests SET status='expired' WHERE id=? AND status='approved'`).bind(expiredAccess.request_id).run();
        await audit(c,'company_access_expired','company',expiredAccess.company_id,{requestId:expiredAccess.request_id});
      }
      const access = await c.env.DB.prepare(`
        SELECT cas.id,cas.company_id,cas.request_id,cas.expires_at,cas.last_activity_at,c.company_identifier,c.display_name,c.legal_name,c.status
        FROM company_access_sessions cas JOIN companies c ON c.id=cas.company_id
        WHERE cas.token_hash=? AND cas.super_admin_user_id=? AND cas.revoked_at IS NULL
          AND cas.expires_at>CURRENT_TIMESTAMP AND c.status='active'
      `).bind(accessHash,platform.platform_user_id).first<{id:string;company_id:string;request_id:string|null;expires_at:string;last_activity_at:string;company_identifier:string;display_name:string;legal_name:string;status:string}>();
      if (access) {
        if (Date.now()-new Date(access.last_activity_at).getTime()>INACTIVITY_TTL) { await c.env.DB.prepare(`UPDATE company_access_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE id=?`).bind(access.id).run(); if(access.request_id) await c.env.DB.prepare(`UPDATE company_access_requests SET status='revoked',revoked_at=CURRENT_TIMESTAMP WHERE id=? AND status='approved'`).bind(access.request_id).run(); await audit(c,'company_access_ended','company',access.company_id,{requestId:access.request_id,reason:'inactivity'}); return {sessionId:platform.id,sessionType:'platform',platformUserId:platform.platform_user_id,companyUserId:null,activeCompanyId:null,accessMode:'platform',roles:['super_admin'],employeeId:null,mustChangePassword:Boolean(platform.must_change_password)}; }
        await c.env.DB.prepare(`UPDATE company_access_sessions SET last_activity_at=CURRENT_TIMESTAMP WHERE id=?`).bind(access.id).run();
        return {sessionId:platform.id,sessionType:'platform',platformUserId:platform.platform_user_id,companyUserId:null,activeCompanyId:access.company_id,accessMode:'super_admin_company_access',roles:['super_admin'],employeeId:null,mustChangePassword:Boolean(platform.must_change_password),company:{id:access.company_id,companyIdentifier:access.company_identifier,displayName:access.display_name,legalName:access.legal_name,status:access.status}};
      }
    }
    return {sessionId:platform.id,sessionType:'platform',platformUserId:platform.platform_user_id,companyUserId:null,activeCompanyId:null,accessMode:'platform',roles:['super_admin'],employeeId:null,mustChangePassword:Boolean(platform.must_change_password)};
  }
  const company = await c.env.DB.prepare(`
    SELECT s.id,s.company_user_id,cu.company_id,s.last_activity_at,cu.employee_id,cu.must_change_password,cu.status,
      c.company_identifier,c.display_name,c.legal_name,c.status AS company_status
    FROM sessions s JOIN company_users cu ON cu.id=s.company_user_id JOIN companies c ON c.id=cu.company_id
    WHERE s.session_type='company' AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP
      AND cu.status='active' AND c.status='active'
  `).bind(tokenHash).first<{id:string;company_user_id:string;company_id:string;employee_id:string|null;must_change_password:number;company_identifier:string;display_name:string;legal_name:string;company_status:string}>();
  if (!company) return null;
  if (Date.now()-new Date(company.last_activity_at).getTime()>INACTIVITY_TTL) { await c.env.DB.prepare(`UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE id=?`).bind(company.id).run(); return null; }
  await c.env.DB.prepare(`UPDATE sessions SET last_activity_at=CURRENT_TIMESTAMP WHERE id=?`).bind(company.id).run();
  const roles = await c.env.DB.prepare(`SELECT r.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.company_user_id=?`).bind(company.company_user_id).all<{code:string}>();
  return {sessionId:company.id,sessionType:'company',platformUserId:null,companyUserId:company.company_user_id,activeCompanyId:company.company_id,accessMode:'company_user',roles:roles.results.map(r=>r.code),employeeId:company.employee_id,mustChangePassword:Boolean(company.must_change_password),company:{id:company.company_id,companyIdentifier:company.company_identifier,displayName:company.display_name,legalName:company.legal_name,status:company.company_status}};
}
