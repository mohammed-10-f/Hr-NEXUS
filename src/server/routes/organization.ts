import { Hono } from 'hono';
import type { Env } from '../env';
import { hasPermission } from '../authorization';
import { requireAuthentication, requireCompanyContext, requirePasswordChanged } from '../middleware/session';
const app=new Hono<Env>();
app.use('*',requireAuthentication,requireCompanyContext,requirePasswordChanged);
app.get('/',async c=>{
  if(!(await hasPermission(c,'organization.view'))) return c.json({error:'FORBIDDEN'},403);
  const companyId=c.get('session')!.activeCompanyId!;
  const units=await c.env.DB.prepare(`SELECT id,parent_id,name_ar,name_en,level_name,code,active FROM organization_units WHERE company_id=? ORDER BY name_ar`).bind(companyId).all();
  return c.json({units:units.results,positions:[]});
});
export default app;
