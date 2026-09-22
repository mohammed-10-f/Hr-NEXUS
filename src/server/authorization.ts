import type { Context } from 'hono';
import type { Env } from './env';

export async function hasPermission(c: Context<Env>, permissionId: string, scope = 'company') {
  const session = c.get('session');
  if (!session) return false;
  const direct = await c.env.DB.prepare(`
    SELECT 1 FROM user_permissions up JOIN permissions p ON p.id = up.permission_id
    WHERE up.user_id = ? AND p.id = ? AND up.effect = 'allow' AND (up.scope = ? OR up.scope = 'company') LIMIT 1
  `).bind(session.userId, permissionId, scope).first();
  if (direct) return true;
  const role = await c.env.DB.prepare(`
    SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    WHERE ur.user_id = ? AND rp.permission_id = ? AND (rp.scope = ? OR rp.scope = 'company') LIMIT 1
  `).bind(session.userId, permissionId, scope).first();
  return Boolean(role);
}

export function assertTenant(c: Context<Env>, tenantId: string) {
  const session = c.get('session');
  return Boolean(session && session.tenantId === tenantId);
}
