import type { Context } from 'hono';
import type { Env } from './env';

export type PermissionRecord = {
  permissionId: string;
  resource: string;
  action: string;
  nameAr: string;
  source: 'role' | 'allow' | 'deny';
  effect: 'allow' | 'deny';
  scope: string;
  scopeValue: string | null;
};

export function isSuperAdmin(c: Context<Env>) {
  return Boolean(c.get('session')?.platformUserId);
}

export function assertCompanyContext(c: Context<Env>, companyId?: string) {
  const s = c.get('session');
  return Boolean(s?.activeCompanyId && (!companyId || s.activeCompanyId === companyId));
}

export async function resolvePermissions(c: Context<Env>): Promise<PermissionRecord[]> {
  const s = c.get('session');
  if (!s?.activeCompanyId || !s.companyUserId) return [];

  const [roleRows, overrideRows] = await Promise.all([
    c.env.DB.prepare(`
      SELECT p.id permission_id,p.resource,p.action,p.name_ar,
             rp.scope,rp.scope_value
      FROM user_roles ur
      JOIN roles r ON r.id=ur.role_id AND r.company_id=? AND r.status='active'
      JOIN role_permissions rp ON rp.role_id=r.id
      JOIN permissions p ON p.id=rp.permission_id
      WHERE ur.company_user_id=?
    `).bind(s.activeCompanyId, s.companyUserId).all<any>(),
    c.env.DB.prepare(`
      SELECT p.id permission_id,p.resource,p.action,p.name_ar,
             up.effect,up.scope,up.scope_value
      FROM user_permissions up
      JOIN permissions p ON p.id=up.permission_id
      WHERE up.company_user_id=?
    `).bind(s.companyUserId).all<any>()
  ]);

  const map = new Map<string, PermissionRecord>();
  for (const row of roleRows.results) {
    const key = `${row.permission_id}|${row.scope}|${row.scope_value ?? ''}`;
    if (!map.has(key)) {
      map.set(key, {
        permissionId: row.permission_id,
        resource: row.resource,
        action: row.action,
        nameAr: row.name_ar,
        source: 'role',
        effect: 'allow',
        scope: row.scope,
        scopeValue: row.scope_value ?? null
      });
    }
  }

  for (const row of overrideRows.results) {
    const key = `${row.permission_id}|${row.scope}|${row.scope_value ?? ''}`;
    map.set(key, {
      permissionId: row.permission_id,
      resource: row.resource,
      action: row.action,
      nameAr: row.name_ar,
      source: row.effect === 'deny' ? 'deny' : 'allow',
      effect: row.effect,
      scope: row.scope,
      scopeValue: row.scope_value ?? null
    });
  }

  return [...map.values()];
}

function matchesScope(grantedScope: string, grantedValue: string | null, requestedScope: string, requestedValue: string | null) {
  if (grantedScope === 'company') return true;
  if (grantedScope !== requestedScope) return false;
  if (!grantedValue) return true;
  return !requestedValue || grantedValue === requestedValue;
}

/**
 * Resolution order:
 * 1) Any matching explicit DENY blocks the permission.
 * 2) Otherwise any matching explicit ALLOW grants it.
 * 3) Otherwise any matching active role permission grants it.
 */
export async function hasPermission(c: Context<Env>, permissionId: string, scope = 'company', scopeValue: string | null = null) {
  const s = c.get('session');
  if (!s?.activeCompanyId) return false;
  if (s.platformUserId && s.accessMode === 'super_admin_company_access') return true;
  if (!s.companyUserId) return false;

  const [overrides, roles] = await Promise.all([
    c.env.DB.prepare(`
      SELECT effect,scope,scope_value
      FROM user_permissions
      WHERE company_user_id=? AND permission_id=?
    `).bind(s.companyUserId, permissionId).all<{effect:string;scope:string;scope_value:string|null}>(),
    c.env.DB.prepare(`
      SELECT rp.scope,rp.scope_value
      FROM user_roles ur
      JOIN roles r ON r.id=ur.role_id AND r.company_id=? AND r.status='active'
      JOIN role_permissions rp ON rp.role_id=r.id
      WHERE ur.company_user_id=? AND rp.permission_id=?
    `).bind(s.activeCompanyId, s.companyUserId, permissionId).all<{scope:string;scope_value:string|null}>()
  ]);

  const matchingOverrides = overrides.results.filter(x => matchesScope(x.scope, x.scope_value, scope, scopeValue));
  if (matchingOverrides.some(x => x.effect === 'deny')) return false;
  if (matchingOverrides.some(x => x.effect === 'allow')) return true;
  return roles.results.some(x => matchesScope(x.scope, x.scope_value, scope, scopeValue));
}

export async function hasPermissionAtOrganizationUnit(c: Context<Env>, permissionId: string, organizationUnitId: string) {
  const s = c.get('session');
  if (!s?.activeCompanyId) return false;
  if (s.platformUserId && s.accessMode === 'super_admin_company_access') return true;
  if (!s.companyUserId) return false;

  const rows = await c.env.DB.prepare(`
    WITH RECURSIVE tree(id) AS (
      SELECT id FROM organization_units WHERE id=? AND company_id=? AND active=1
      UNION ALL
      SELECT ou.id FROM organization_units ou JOIN tree t ON ou.parent_id=t.id
      WHERE ou.company_id=? AND ou.active=1
    )
    SELECT up.effect,up.scope,up.scope_value
    FROM user_permissions up
    WHERE up.company_user_id=? AND up.permission_id=?
      AND (
        up.scope='company'
        OR (up.scope IN ('management_unit','department','section') AND up.scope_value IN (SELECT id FROM tree))
      )
    ORDER BY CASE WHEN up.effect='deny' THEN 0 ELSE 1 END
  `).bind(organizationUnitId,s.activeCompanyId,s.activeCompanyId,s.companyUserId,permissionId).all<{effect:string;scope:string;scope_value:string|null}>();

  if (rows.results.some(x=>x.effect==='deny')) return false;
  if (rows.results.some(x=>x.effect==='allow')) return true;

  const roleRows = await c.env.DB.prepare(`
    WITH RECURSIVE tree(id) AS (
      SELECT id FROM organization_units WHERE id=? AND company_id=? AND active=1
      UNION ALL
      SELECT ou.id FROM organization_units ou JOIN tree t ON ou.parent_id=t.id
      WHERE ou.company_id=? AND ou.active=1
    )
    SELECT rp.scope,rp.scope_value
    FROM user_roles ur
    JOIN roles r ON r.id=ur.role_id AND r.company_id=? AND r.status='active'
    JOIN role_permissions rp ON rp.role_id=r.id
    WHERE ur.company_user_id=? AND rp.permission_id=?
      AND (
        rp.scope='company'
        OR (rp.scope IN ('management_unit','department','section') AND rp.scope_value IN (SELECT id FROM tree))
      )
  `).bind(organizationUnitId,s.activeCompanyId,s.activeCompanyId,s.activeCompanyId,s.companyUserId,permissionId).all();
  return roleRows.results.length>0;
}

export async function hasAnyPermission(c: Context<Env>, permissions: string[]) {
  for (const permission of permissions) if (await hasPermission(c, permission)) return true;
  return false;
}

export function requirePasswordChange(c: Context<Env>) {
  return c.get('session')?.mustChangePassword === true;
}
