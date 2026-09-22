import { Hono } from 'hono';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '../auth/crypto';
import { createSession, destroySession, getCookie } from '../auth/session';
import type { Env } from '../env';

const app = new Hono<Env>();
const loginSchema = z.object({ companyId: z.string().trim().min(1).max(64), loginIdentifier: z.string().trim().min(1).max(128), password: z.string().min(8).max(256) });

app.post('/login', async (c) => {
  const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'INVALID_INPUT' }, 400);
  const { companyId, loginIdentifier, password } = parsed.data;
  const user = await c.env.DB.prepare(`
    SELECT u.id, u.tenant_id, u.employee_id, u.password_hash, u.status, t.status AS tenant_status
    FROM users u JOIN tenants t ON t.id = u.tenant_id
    WHERE t.code = ? AND u.login_identifier = ? LIMIT 1
  `).bind(companyId, loginIdentifier).first<{id:string;tenant_id:string;employee_id:string|null;password_hash:string;status:string;tenant_status:string}>();
  if (!user || user.status !== 'active' || user.tenant_status !== 'active' || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: 'INVALID_CREDENTIALS' }, 401);
  }
  const roles = await c.env.DB.prepare(`SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`).bind(user.id).all<{code:string}>();
  const session = await createSession(c, user.tenant_id, user.id, user.employee_id, roles.results.map((r) => r.code));
  await c.env.DB.prepare(`UPDATE users SET failed_login_count = 0, last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(user.id).run();
  return c.json({ ok: true, session: { expiresAt: session.expiresAt } });
});

app.post('/logout', async (c) => {
  const raw = getCookie(c.req.header('Cookie'), 'hr_session');
  if (raw) await destroySession(c, raw);
  return c.json({ ok: true });
});

app.get('/me', async (c) => c.json({ authenticated: Boolean(c.get('session')), session: c.get('session') }));

export default app;
