import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';
import { getCookie } from '../auth/session';
import { sha256 } from '../auth/crypto';

export const loadSession: MiddlewareHandler<Env> = async (c, next) => {
  const raw = getCookie(c.req.header('Cookie'), 'hr_session');
  if (!raw) { c.set('session', null); return next(); }
  const tokenHash = await sha256(raw);
  const row = await c.env.DB.prepare(`
    SELECT s.tenant_id, s.user_id, u.employee_id,
           GROUP_CONCAT(r.code) AS roles
    FROM sessions s
    JOIN users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles r ON r.id = ur.role_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP
      AND u.status = 'active'
    GROUP BY s.id, s.tenant_id, s.user_id, u.employee_id
  `).bind(tokenHash).first<{tenant_id:string;user_id:string;employee_id:string|null;roles:string|null}>();
  c.set('session', row ? { tenantId: row.tenant_id, userId: row.user_id, employeeId: row.employee_id, roles: row.roles?.split(',').filter(Boolean) ?? [] } : null);
  return next();
};

export const requireSession: MiddlewareHandler<Env> = async (c, next) => {
  if (!c.get('session')) return c.json({ error: 'AUTH_REQUIRED' }, 401);
  return next();
};
