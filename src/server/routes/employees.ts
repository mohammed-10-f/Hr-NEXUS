import { Hono } from 'hono';
import type { Env } from '../env';
import { hasPermission } from '../authorization';
import { requireAuthentication, requireCompanyContext, requirePasswordChanged } from '../middleware/session';

const app=new Hono<Env>();
app.use('*',requireAuthentication,requireCompanyContext,requirePasswordChanged);
app.get('/',async c=>{
  if(!(await hasPermission(c,'employees.view'))) return c.json({error:'FORBIDDEN'},403);
  const s=c.get('session')!;
  const search=c.req.query('search')?.trim()??'', status=c.req.query('status')?.trim()??'';
  const page=Math.max(1,Number(c.req.query('page')??'1')), pageSize=Math.min(50,Math.max(10,Number(c.req.query('pageSize')??'20'))), offset=(page-1)*pageSize;
  const params:(string|number)[]=[s.activeCompanyId!]; let where='e.company_id=?';
  if(search){where+=` AND (e.employee_number LIKE ? OR e.national_id LIKE ? OR e.first_name LIKE ? OR e.family_name LIKE ?)`;const q=`%${search}%`;params.push(q,q,q,q);}
  if(status){where+=` AND e.status=?`;params.push(status);}
  const count=await c.env.DB.prepare(`SELECT COUNT(*) total FROM employees e WHERE ${where}`).bind(...params).first<{total:number}>();
  const rows=await c.env.DB.prepare(`
    SELECT e.id,e.employee_number,TRIM(COALESCE(e.first_name,'')||' '||COALESCE(e.father_name,'')||' '||COALESCE(e.family_name,'')) name,
      e.job_title,ou.name_ar department,TRIM(COALESCE(m.first_name,'')||' '||COALESCE(m.family_name,'')) manager,e.status,e.join_date
    FROM employees e
    LEFT JOIN organization_units ou ON ou.id=e.organization_unit_id AND ou.company_id=e.company_id
    LEFT JOIN employees m ON m.id=e.manager_employee_id AND m.company_id=e.company_id
    WHERE ${where} ORDER BY e.employee_number COLLATE NOCASE LIMIT ? OFFSET ?`).bind(...params,pageSize,offset).all();
  return c.json({items:rows.results,page,pageSize,total:count?.total??0});
});
app.get('/:id',async c=>{
  if(!(await hasPermission(c,'employees.view'))) return c.json({error:'FORBIDDEN'},403);
  const employee=await c.env.DB.prepare(`SELECT * FROM employees WHERE id=? AND company_id=?`).bind(c.req.param('id'),c.get('session')!.activeCompanyId).first();
  if(!employee) return c.json({error:'NOT_FOUND'},404);
  return c.json({employee});
});
export default app;
