import { Hono } from 'hono';
import type { Env } from '../env';
import { requireAuthentication } from '../middleware/session';
const app=new Hono<Env>();
app.get('/',requireAuthentication,async c=>{
  const s=c.get('session')!;
  let company=s.company??null;
  if(s.activeCompanyId && !company){
    company=await c.env.DB.prepare(`SELECT id,company_identifier,display_name,legal_name,status FROM companies WHERE id=?`).bind(s.activeCompanyId).first<any>() as any;
  }
  const notifications=s.companyUserId && s.activeCompanyId ? await c.env.DB.prepare(`SELECT id,title_ar,body_ar,type,read_at,created_at FROM notifications WHERE company_id=? AND user_id=? ORDER BY created_at DESC LIMIT 10`).bind(s.activeCompanyId,s.companyUserId).all() : {results:[]};
  return c.json({session:s,company,notifications:notifications.results});
});
app.post('/notifications/:id/read',requireAuthentication,async c=>{
  const s=c.get('session'); if(!s?.companyUserId||!s.activeCompanyId) return c.json({error:'FORBIDDEN'},403);
  await c.env.DB.prepare(`UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE id=? AND company_id=? AND user_id=?`).bind(c.req.param('id'),s.activeCompanyId,s.companyUserId).run();
  return c.json({ok:true});
});
export default app;
