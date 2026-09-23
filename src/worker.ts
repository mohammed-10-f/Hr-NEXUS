import { Hono } from 'hono';
import type { Env } from './server/env';
import { loadSession } from './server/middleware/session';
import { securityHeaders } from './server/middleware/security';
import auth from './server/routes/auth';
import employees from './server/routes/employees';
import organization from './server/routes/organization';
import platform from './server/routes/platform';
import context from './server/routes/context';

const app=new Hono<Env>();

app.onError((err,c)=>{
  console.error('HR_NEXUS_UNHANDLED_ERROR',err);
  if(c.req.path.startsWith('/api/')) return c.json({error:'SERVER_ERROR'},500);
  return c.text('Internal Server Error',500);
});
app.use('*',securityHeaders);
app.use('/api/*',loadSession);
app.get('/api/health',(c)=>c.json({ok:true,service:'hr-nexus',phase:2}));
app.route('/api/auth',auth);
app.route('/api/platform',platform);
app.route('/api/context',context);
app.route('/api/employees',employees);
app.route('/api/organization',organization);
app.all('/api/*',(c)=>c.json({error:'NOT_FOUND'},404));
app.all('*',async c=>c.env.ASSETS.fetch(c.req.raw));
export default app;
