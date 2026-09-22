import type { Context } from 'hono';
import type { Env } from './env';
import { hashOptional } from './auth/crypto';

export async function audit(c: Context<Env>, action:string, resource:string, resourceId:string|null=null, metadata:Record<string,unknown>={}, actor?:{type:'platform'|'company';platformUserId?:string|null;companyUserId?:string|null;companyId?:string|null}) {
  const s=c.get('session');
  const type=actor?.type ?? (s?.platformUserId?'platform':'company');
  await c.env.DB.prepare(`
    INSERT INTO audit_logs(id,company_id,actor_type,actor_platform_user_id,actor_company_user_id,action,resource,resource_id,metadata_json,ip_hash,user_agent_hash)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(),actor?.companyId??s?.activeCompanyId??null,type,actor?.platformUserId??s?.platformUserId??null,
      actor?.companyUserId??s?.companyUserId??null,action,resource,resourceId,JSON.stringify(metadata),
      await hashOptional(c.req.header('CF-Connecting-IP')),await hashOptional(c.req.header('User-Agent'))).run();
}
