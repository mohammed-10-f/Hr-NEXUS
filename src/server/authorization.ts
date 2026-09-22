import type { Context } from 'hono';
import type { Env } from './env';

export function isSuperAdmin(c: Context<Env>) {
  return c.get('session')?.platformUserId !== null && Boolean(c.get('session'));
}
export function assertCompanyContext(c: Context<Env>, companyId?: string) {
  const s=c.get('session');
  return Boolean(s?.activeCompanyId && (!companyId || s.activeCompanyId===companyId));
}
export async function hasPermission(c: Context<Env>, permissionId: string, scope='company') {
  const s=c.get('session');
  if (!s?.activeCompanyId) return false;
  if (s.platformUserId) return true; // platform identity remains authoritative inside approved company context
  if (!s.companyUserId) return false;
  const direct=await c.env.DB.prepare(`
    SELECT effect,scope FROM user_permissions
    WHERE company_user_id=? AND permission_id=? AND (scope=? OR scope='company')
    LIMIT 1`).bind(s.companyUserId,permissionId,scope).first<{effect:string;scope:string}>();
  if (direct) return direct.effect==='allow';
  const role=await c.env.DB.prepare(`
    SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id
    WHERE ur.company_user_id=? AND rp.permission_id=? AND (rp.scope=? OR rp.scope='company') LIMIT 1
  `).bind(s.companyUserId,permissionId,scope).first();
  return Boolean(role);
}
export function requirePasswordChange(c: Context<Env>) {
  return c.get('session')?.mustChangePassword === true;
}
