import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';
import { loadSessionContext } from '../auth/session';

export const loadSession: MiddlewareHandler<Env> = async (c, next) => {
  c.set('session', await loadSessionContext(c));
  return next();
};
export const requireAuthentication: MiddlewareHandler<Env> = async (c,next) =>
  c.get('session') ? next() : c.json({error:'AUTH_REQUIRED'},401);
export const requireSuperAdmin: MiddlewareHandler<Env> = async (c,next) => {
  const s=c.get('session');
  if (!s || s.platformUserId === null) return c.json({error:'SUPER_ADMIN_REQUIRED'},403);
  return next();
};
export const requireCompanyContext: MiddlewareHandler<Env> = async (c,next) => {
  const s=c.get('session');
  if (!s?.activeCompanyId) return c.json({error:'COMPANY_CONTEXT_REQUIRED'},403);
  return next();
};
export const requireCompanyUser: MiddlewareHandler<Env> = async (c,next) => {
  const s=c.get('session');
  if (!s || s.accessMode !== 'company_user') return c.json({error:'COMPANY_USER_REQUIRED'},403);
  return next();
};

export const requirePasswordChanged: MiddlewareHandler<Env> = async (c,next) => {
  const s=c.get('session');
  if (s?.mustChangePassword) return c.json({error:'PASSWORD_CHANGE_REQUIRED'},403);
  return next();
};

export function requirePermission(permissionId:string, scope='company'): MiddlewareHandler<Env> {
  return async (c,next) => {
    const {hasPermission}=await import('../authorization');
    if(!(await hasPermission(c,permissionId,scope))) return c.json({error:'FORBIDDEN'},403);
    return next();
  };
}
export function requireScope(scope:string): MiddlewareHandler<Env> {
  return async (c,next) => {
    const s=c.get('session');
    if(!s?.activeCompanyId || (scope==='company' && !s.activeCompanyId)) return c.json({error:'SCOPE_REQUIRED'},403);
    return next();
  };
}
