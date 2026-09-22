import { Hono } from 'hono';
import type { Env } from '../env';
import { hasPermission } from '../authorization';
const app = new Hono<Env>();
app.get('/', async (c) => {
  if (!(await hasPermission(c, 'organization.view'))) return c.json({ error: 'FORBIDDEN' }, 403);
  const s = c.get('session')!;
  const units = await c.env.DB.prepare(`SELECT id, parent_id, name_ar, name_en, level_name, code, active FROM organization_units WHERE tenant_id = ? ORDER BY name_ar`).bind(s.tenantId).all();
  const positions = await c.env.DB.prepare(`SELECT id, organization_unit_id, parent_position_id, title_ar, title_en, code, status FROM positions WHERE tenant_id = ? ORDER BY title_ar`).bind(s.tenantId).all();
  return c.json({ units: units.results, positions: positions.results });
});
export default app;
