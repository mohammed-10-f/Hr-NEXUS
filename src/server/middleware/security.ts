import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';

function applySecurityHeaders(c: Parameters<MiddlewareHandler<Env>>[0]) {
  c.header('X-Content-Type-Options','nosniff');
  c.header('X-Frame-Options','DENY');
  c.header('Referrer-Policy','strict-origin-when-cross-origin');
  c.header('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
}

export const securityHeaders: MiddlewareHandler<Env> = async (c,next)=>{
  const method=c.req.method;
  if(['POST','PUT','PATCH','DELETE'].includes(method)){
    const origin=c.req.header('Origin');
    const host=c.req.header('Host');
    if(origin){
      try{
        const originUrl=new URL(origin);
        if(host && originUrl.host!==host) {
          applySecurityHeaders(c);
          return c.json({error:'CSRF_BLOCKED'},403);
        }
      }catch{
        applySecurityHeaders(c);
        return c.json({error:'CSRF_BLOCKED'},403);
      }
    }
  }
  try{
    return await next();
  }finally{
    applySecurityHeaders(c);
  }
};
