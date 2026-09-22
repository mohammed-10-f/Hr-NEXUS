import { Hono } from 'hono';
import type { Env } from '../env';
import { hasPermission } from '../authorization';

const app = new Hono<Env>();

app.get('/', async (c) => {
  if (!(await hasPermission(c, 'employees.view'))) return c.json({ error: 'FORBIDDEN' }, 403);
  const s = c.get('session')!;
  const search = c.req.query('search')?.trim() ?? '';
  const status = c.req.query('status')?.trim() ?? '';
  const page = Math.max(1, Number(c.req.query('page') ?? '1'));
  const pageSize = Math.min(50, Math.max(10, Number(c.req.query('pageSize') ?? '20')));
  const offset = (page - 1) * pageSize;
  const params: (string|number)[] = [s.tenantId];
  let where = `e.tenant_id = ?`;
  if (search) { where += ` AND (e.employee_number LIKE ? OR e.national_id LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
  if (status) { where += ` AND e.status = ?`; params.push(status); }
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM employees e WHERE ${where}`).bind(...params).first<{total:number}>();
  const rows = await c.env.DB.prepare(`
    SELECT e.id, e.employee_number,
      TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.father_name,'') || ' ' || COALESCE(e.family_name,'')) AS name,
      e.job_title,
      ou.name_ar AS department,
      TRIM(COALESCE(m.first_name,'') || ' ' || COALESCE(m.family_name,'')) AS manager,
      e.status, e.join_date
    FROM employees e
    LEFT JOIN organization_units ou ON ou.id = e.organization_unit_id AND ou.tenant_id = e.tenant_id
    LEFT JOIN employees m ON m.id = e.manager_employee_id AND m.tenant_id = e.tenant_id
    WHERE ${where}
    ORDER BY e.employee_number COLLATE NOCASE
    LIMIT ? OFFSET ?
  `).bind(...params, pageSize, offset).all();
  return c.json({ items: rows.results, page, pageSize, total: count?.total ?? 0 });
});

app.get('/:id', async (c) => {
  if (!(await hasPermission(c, 'employees.view'))) return c.json({ error: 'FORBIDDEN' }, 403);
  const s = c.get('session')!;
  const employee = await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ? AND tenant_id = ?`).bind(c.req.param('id'), s.tenantId).first();
  if (!employee) return c.json({ error: 'NOT_FOUND' }, 404);
  return c.json({ employee });
});

export default app;
