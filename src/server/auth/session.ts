import type { Context } from 'hono';
import type { Env } from '../env';
import { sha256 } from './crypto';

export async function createSession(c: Context<Env>, tenantId: string, userId: string, employeeId: string | null, roles: string[]) {
  const rawToken = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const tokenHash = await sha256(rawToken);
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  await c.env.DB.prepare(`INSERT INTO sessions (id, tenant_id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, tenantId, userId, tokenHash, expiresAt).run();
  c.header('Set-Cookie', `hr_session=${rawToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`);
  return { id, expiresAt, tenantId, userId, employeeId, roles };
}

export async function destroySession(c: Context<Env>, rawToken: string) {
  const tokenHash = await sha256(rawToken);
  await c.env.DB.prepare(`UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ?`).bind(tokenHash).run();
  c.header('Set-Cookie', 'hr_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
}

export function getCookie(header: string | undefined, name: string) {
  if (!header) return null;
  const item = header.split(';').map((v) => v.trim()).find((v) => v.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}
