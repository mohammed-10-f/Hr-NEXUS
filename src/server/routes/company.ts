import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { hashPassword } from '../auth/crypto';
import { audit } from '../audit';
import { hasPermission, resolvePermissions } from '../authorization';
import { requireAuthentication, requireCompanyContext, requireCompanyUser, requirePasswordChanged } from '../middleware/session';

const app = new Hono<Env>();
app.use('*', requireAuthentication, requireCompanyContext, requireCompanyUser, requirePasswordChanged);

async function allowed(c: any, permission: string) {
  return hasPermission(c, permission);
}
function companyId(c: any) {
  return c.get('session')!.activeCompanyId as string;
}
function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}
const scopeSchema = z.object({
  scope: z.enum(['company','management_unit','department','section','self']).default('company'),
  scopeValue: z.string().trim().max(128).nullable().optional()
}).superRefine((v,ctx)=>{
  if (v.scope !== 'company' && v.scope !== 'self' && !v.scopeValue) ctx.addIssue({code:'custom',message:'SCOPE_VALUE_REQUIRED'});
  if (v.scope === 'company' || v.scope === 'self') return;
});

async function validateScope(c: any, scope: string, scopeValue: string|null|undefined) {
  if (scope === 'company' || scope === 'self') return true;
  if (!scopeValue) return false;
  const unit = await c.env.DB.prepare(`
    SELECT id FROM organization_units WHERE id=? AND company_id=? AND active=1
  `).bind(scopeValue, companyId(c)).first();
  return Boolean(unit);
}

const createUserSchema = z.object({
  username: z.string().trim().min(1).max(128),
  employeeId: z.string().trim().max(128).nullable().optional(),
  password: z.string().min(8).max(256),
  roleIds: z.array(z.string().min(1)).max(50).default([])
});
const updateUserSchema = z.object({
  username: z.string().trim().min(1).max(128).optional(),
  employeeId: z.string().trim().max(128).nullable().optional(),
  status: z.enum(['active','inactive','locked']).optional()
}).refine(v=>Object.keys(v).length>0);
const roleAssignSchema = z.object({ roleIds: z.array(z.string().min(1)).max(50) });
const overrideSchema = z.object({
  permissionId: z.string().min(1),
  effect: z.enum(['allow','deny']),
  scope: z.enum(['company','management_unit','department','section','self']).default('company'),
  scopeValue: z.string().trim().max(128).nullable().optional()
});

app.get('/permissions', async c => {
  if (!(await allowed(c,'permissions.view')) && !(await allowed(c,'permissions.manage')) && !(await allowed(c,'users.view')) && !(await allowed(c,'roles.view'))) return c.json({error:'FORBIDDEN'},403);
  const rows = await c.env.DB.prepare(`
    SELECT id,resource,action,name_ar,name_en,description
    FROM permissions ORDER BY resource,action
  `).all();
  return c.json({items: rows.results});
});

app.get('/scope-options', async c => {
  if (!(await allowed(c,'permissions.view')) && !(await allowed(c,'permissions.manage')) && !(await allowed(c,'users.view')) && !(await allowed(c,'roles.view'))) return c.json({error:'FORBIDDEN'},403);
  const rows = await c.env.DB.prepare(`
    SELECT id,parent_id,name_ar,name_en,level_name,code
    FROM organization_units WHERE company_id=? AND active=1 ORDER BY name_ar
  `).bind(companyId(c)).all();
  return c.json({items: rows.results});
});

app.get('/users', async c => {
  if (!(await allowed(c,'users.view'))) return c.json({error:'FORBIDDEN'},403);
  const search=(c.req.query('search')||'').trim();
  const status=(c.req.query('status')||'').trim();
  const cid=companyId(c);
  const params:any[]=[cid]; let where='cu.company_id=?';
  if(search){where+=` AND (cu.username LIKE ? OR cu.employee_id LIKE ? OR e.employee_number LIKE ? OR e.national_id LIKE ?)`; const q=`%${search}%`; params.push(q,q,q,q);}
  if(status){where+=' AND cu.status=?';params.push(status);}
  const rows=await c.env.DB.prepare(`
    SELECT cu.id,cu.username,cu.employee_id,cu.must_change_password,cu.status,cu.last_login_at,cu.created_at,
      e.employee_number,e.national_id,
      GROUP_CONCAT(CASE WHEN r.status='active' THEN r.name_ar ELSE r.name_ar||' (معطل)' END) roles
    FROM company_users cu
    LEFT JOIN employees e ON e.id=cu.employee_id AND e.company_id=cu.company_id
    LEFT JOIN user_roles ur ON ur.company_user_id=cu.id
    LEFT JOIN roles r ON r.id=ur.role_id
    WHERE ${where}
    GROUP BY cu.id
    ORDER BY cu.created_at DESC
  `).bind(...params).all<any>();
  return c.json({items:rows.results.map(u=>({...u,must_change_password:Boolean(u.must_change_password),roles:u.roles?String(u.roles).split(','):[]}))});
});

app.get('/users/:id', async c => {
  if (!(await allowed(c,'users.view'))) return c.json({error:'FORBIDDEN'},403);
  const user=await c.env.DB.prepare(`
    SELECT cu.id,cu.username,cu.employee_id,cu.must_change_password,cu.status,cu.last_login_at,cu.created_at,
      e.employee_number,e.national_id,e.first_name,e.family_name
    FROM company_users cu
    LEFT JOIN employees e ON e.id=cu.employee_id AND e.company_id=cu.company_id
    WHERE cu.id=? AND cu.company_id=?
  `).bind(c.req.param('id'),companyId(c)).first<any>();
  if(!user)return c.json({error:'USER_NOT_FOUND'},404);
  const roles=await c.env.DB.prepare(`
    SELECT r.id,r.name_ar,r.name_en,r.code,r.system_role,r.status
    FROM user_roles ur JOIN roles r ON r.id=ur.role_id
    WHERE ur.company_user_id=? AND r.company_id=?
    ORDER BY r.name_ar
  `).bind(user.id,companyId(c)).all();
  const overrides=await c.env.DB.prepare(`
    SELECT up.permission_id,p.resource,p.action,p.name_ar,up.effect,up.scope,up.scope_value
    FROM user_permissions up JOIN permissions p ON p.id=up.permission_id
    WHERE up.company_user_id=? ORDER BY p.resource,p.action
  `).bind(user.id).all();
  return c.json({user:{...user,must_change_password:Boolean(user.must_change_password)},roles:roles.results,overrides:overrides.results});
});

app.get('/users/:id/effective-permissions', async c => {
  if (!(await allowed(c,'users.view'))) return c.json({error:'FORBIDDEN'},403);
  const userId=c.req.param('id');
  const user=await c.env.DB.prepare(`SELECT id FROM company_users WHERE id=? AND company_id=?`).bind(userId,companyId(c)).first();
  if(!user)return c.json({error:'USER_NOT_FOUND'},404);
  // Resolve the target user explicitly, rather than using the caller's session.
  const roleRows=await c.env.DB.prepare(`
    SELECT p.id permission_id,p.resource,p.action,p.name_ar,r.name_ar role_name,r.id role_id,rp.scope,rp.scope_value
    FROM user_roles ur JOIN roles r ON r.id=ur.role_id AND r.company_id=? AND r.status='active'
    JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id
    WHERE ur.company_user_id=?
  `).bind(companyId(c),userId).all<any>();
  const overrideRows=await c.env.DB.prepare(`
    SELECT p.id permission_id,p.resource,p.action,p.name_ar,up.effect,up.scope,up.scope_value
    FROM user_permissions up JOIN permissions p ON p.id=up.permission_id
    WHERE up.company_user_id=?
  `).bind(userId).all<any>();
  const map=new Map<string,any>();
  for(const r of roleRows.results){
    const key=`${r.permission_id}|${r.scope}|${r.scope_value??''}`;
    if(!map.has(key))map.set(key,{...r,source:'role',effect:'allow'});
  }
  for(const r of overrideRows.results){
    const key=`${r.permission_id}|${r.scope}|${r.scope_value??''}`;
    map.set(key,{...r,source:r.effect==='deny'?'deny':'allow'});
  }
  return c.json({items:[...map.values()]});
});

app.post('/users', async c => {
  if (!(await allowed(c,'users.create'))) return c.json({error:'FORBIDDEN'},403);
  const parsed=createUserSchema.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return c.json({error:'INVALID_INPUT'},400);
  const cid=companyId(c);
  let employee:any=null;
  if(parsed.data.employeeId){
    employee=await c.env.DB.prepare(`SELECT id,national_id FROM employees WHERE id=? AND company_id=?`).bind(parsed.data.employeeId,cid).first<any>();
    if(!employee)return c.json({error:'EMPLOYEE_NOT_FOUND'},400);
    if(!employee.national_id)return c.json({error:'EMPLOYEE_NATIONAL_ID_REQUIRED'},400);
    if(parsed.data.username!==employee.national_id)return c.json({error:'EMPLOYEE_USERNAME_MUST_BE_NATIONAL_ID'},400);
  }
  const roleIds=uniqueStrings(parsed.data.roleIds);
  if(roleIds.length && !(await allowed(c,'permissions.manage'))) return c.json({error:'FORBIDDEN'},403);
  if(roleIds.length){
    const placeholders=roleIds.map(()=>'?').join(',');
    const roles=await c.env.DB.prepare(`SELECT id,status,system_role FROM roles WHERE company_id=? AND id IN (${placeholders})`).bind(cid,...roleIds).all<any>();
    if(roles.results.length!==roleIds.length)return c.json({error:'INVALID_ROLE'},400);
    if(roles.results.some((r:any)=>r.status!=='active'))return c.json({error:'ROLE_DISABLED'},400);
  }
  const id=crypto.randomUUID();
  try{
    await c.env.DB.prepare(`
      INSERT INTO company_users(id,company_id,username,employee_id,password_hash,must_change_password,status)
      VALUES(?,?,?,?,?,1,'active')
    `).bind(id,cid,parsed.data.username,parsed.data.employeeId??null,await hashPassword(parsed.data.password)).run();
    for(const roleId of roleIds){
      await c.env.DB.prepare(`INSERT INTO user_roles(company_user_id,role_id) VALUES(?,?)`).bind(id,roleId).run();
    }
  }catch(err){
    if(String(err).includes('UNIQUE'))return c.json({error:'USERNAME_OR_EMPLOYEE_EXISTS'},409);
    console.error('COMPANY_USER_CREATE_FAILED',err);return c.json({error:'USER_CREATE_FAILED'},500);
  }
  await audit(c,'user_created','company_user',id,{companyId:cid,roleIds});
  return c.json({ok:true,userId:id},201);
});

app.patch('/users/:id', async c => {
  const actionStatus=await allowed(c,'users.edit');
  if(!actionStatus)return c.json({error:'FORBIDDEN'},403);
  const parsed=updateUserSchema.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return c.json({error:'INVALID_INPUT'},400);
  const id=c.req.param('id'),cid=companyId(c);
  const before=await c.env.DB.prepare(`SELECT id,username,employee_id,status FROM company_users WHERE id=? AND company_id=?`).bind(id,cid).first<any>();
  if(!before)return c.json({error:'USER_NOT_FOUND'},404);
  let employeeId=parsed.data.employeeId!==undefined?parsed.data.employeeId:before.employee_id;
  const username=parsed.data.username!==undefined?parsed.data.username:before.username;
  if(employeeId){
    const employee=await c.env.DB.prepare(`SELECT id,national_id FROM employees WHERE id=? AND company_id=?`).bind(employeeId,cid).first<any>();
    if(!employee)return c.json({error:'EMPLOYEE_NOT_FOUND'},400);
    if(!employee.national_id || username!==employee.national_id)return c.json({error:'EMPLOYEE_USERNAME_MUST_BE_NATIONAL_ID'},400);
  }
  if(parsed.data.status && parsed.data.status!==before.status){
    const required=parsed.data.status==='active'?'users.activate':'users.deactivate';
    if(!(await allowed(c,required)))return c.json({error:'FORBIDDEN'},403);
  }
  const fields:string[]=[];const values:any[]=[];
  if(parsed.data.username!==undefined){fields.push('username=?');values.push(parsed.data.username);}
  if(parsed.data.employeeId!==undefined){fields.push('employee_id=?');values.push(parsed.data.employeeId);}
  if(parsed.data.status!==undefined){fields.push('status=?');values.push(parsed.data.status);}
  fields.push('updated_at=CURRENT_TIMESTAMP');values.push(id,cid);
  try{await c.env.DB.prepare(`UPDATE company_users SET ${fields.join(',')} WHERE id=? AND company_id=?`).bind(...values).run();
    if(parsed.data.status && parsed.data.status!=='active')await c.env.DB.prepare(`UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE session_type='company' AND company_user_id=? AND revoked_at IS NULL`).bind(id).run();
  }catch(err){if(String(err).includes('UNIQUE'))return c.json({error:'USERNAME_OR_EMPLOYEE_EXISTS'},409);console.error(err);return c.json({error:'USER_UPDATE_FAILED'},500);}
  await audit(c,'user_updated','company_user',id,{companyId:cid,before,after:parsed.data});
  if(parsed.data.status==='active' && before.status!=='active') await audit(c,'user_activated','company_user',id,{companyId:cid});
  if(parsed.data.status && parsed.data.status!=='active' && before.status==='active') await audit(c,'user_deactivated','company_user',id,{companyId:cid});
  return c.json({ok:true});
});

app.post('/users/:id/reset-password', async c => {
  if (!(await allowed(c,'users.reset_password'))) return c.json({error:'FORBIDDEN'},403);
  const parsed=z.object({newPassword:z.string().min(8).max(256)}).safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return c.json({error:'INVALID_INPUT'},400);
  const id=c.req.param('id'),cid=companyId(c);
  const user=await c.env.DB.prepare(`SELECT id,username FROM company_users WHERE id=? AND company_id=?`).bind(id,cid).first<any>();
  if(!user)return c.json({error:'USER_NOT_FOUND'},404);
  await c.env.DB.prepare(`UPDATE company_users SET password_hash=?,must_change_password=1,status='active',failed_login_count=0,locked_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND company_id=?`)
    .bind(await hashPassword(parsed.data.newPassword),id,cid).run();
  await c.env.DB.prepare(`UPDATE sessions SET revoked_at=CURRENT_TIMESTAMP WHERE session_type='company' AND company_user_id=? AND revoked_at IS NULL`).bind(id).run();
  await audit(c,'user_password_reset','company_user',id,{companyId:cid});
  return c.json({ok:true,mustChangePassword:true});
});

app.put('/users/:id/roles', async c => {
  if (!(await allowed(c,'permissions.manage'))) return c.json({error:'FORBIDDEN'},403);
  const id=c.req.param('id'),cid=companyId(c),actor=c.get('session')!.companyUserId!;
  if(id===actor)return c.json({error:'SELF_PERMISSION_CHANGE_FORBIDDEN'},403);
  const parsed=roleAssignSchema.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return c.json({error:'INVALID_INPUT'},400);
  const roleIds=uniqueStrings(parsed.data.roleIds);
  const user=await c.env.DB.prepare(`SELECT id FROM company_users WHERE id=? AND company_id=?`).bind(id,cid).first();
  if(!user)return c.json({error:'USER_NOT_FOUND'},404);
  const previousRoles=await c.env.DB.prepare(`SELECT role_id FROM user_roles WHERE company_user_id=?`).bind(id).all<{role_id:string}>();
  if(roleIds.length){
    const placeholders=roleIds.map(()=>'?').join(',');
    const rows=await c.env.DB.prepare(`SELECT id,status FROM roles WHERE company_id=? AND id IN (${placeholders})`).bind(cid,...roleIds).all<any>();
    if(rows.results.length!==roleIds.length)return c.json({error:'INVALID_ROLE'},400);
    if(rows.results.some((r:any)=>r.status!=='active'))return c.json({error:'ROLE_DISABLED'},400);
  }
  await c.env.DB.prepare(`DELETE FROM user_roles WHERE company_user_id=?`).bind(id).run();
  for(const roleId of roleIds)await c.env.DB.prepare(`INSERT INTO user_roles(company_user_id,role_id) VALUES(?,?)`).bind(id,roleId).run();
  await audit(c,'user_roles_changed','company_user',id,{companyId:cid,roleIds,previousRoleIds:previousRoles.results.map(r=>r.role_id)});
  for(const roleId of roleIds.filter(x=>!previousRoles.results.some(r=>r.role_id===x))) await audit(c,'role_assigned_to_user','company_user',id,{companyId:cid,roleId});
  for(const roleId of previousRoles.results.map(r=>r.role_id).filter(x=>!roleIds.includes(x))) await audit(c,'role_removed_from_user','company_user',id,{companyId:cid,roleId});
  return c.json({ok:true});
});

app.put('/users/:id/overrides', async c => {
  if (!(await allowed(c,'permissions.manage'))) return c.json({error:'FORBIDDEN'},403);
  const id=c.req.param('id'),cid=companyId(c),actor=c.get('session')!.companyUserId!;
  if(id===actor)return c.json({error:'SELF_PERMISSION_CHANGE_FORBIDDEN'},403);
  const body=await c.req.json().catch(()=>null);
  const parsed=z.object({overrides:z.array(overrideSchema).max(200)}).safeParse(body);
  if(!parsed.success)return c.json({error:'INVALID_INPUT'},400);
  const user=await c.env.DB.prepare(`SELECT id FROM company_users WHERE id=? AND company_id=?`).bind(id,cid).first();
  if(!user)return c.json({error:'USER_NOT_FOUND'},404);
  for(const item of parsed.data.overrides){
    if(!(await validateScope(c,item.scope,item.scopeValue)))return c.json({error:'INVALID_SCOPE'},400);
    const permission=await c.env.DB.prepare(`SELECT id FROM permissions WHERE id=?`).bind(item.permissionId).first();
    if(!permission)return c.json({error:'INVALID_PERMISSION'},400);
  }
  await c.env.DB.prepare(`DELETE FROM user_permissions WHERE company_user_id=?`).bind(id).run();
  for(const item of parsed.data.overrides){
    await c.env.DB.prepare(`INSERT INTO user_permissions(company_user_id,permission_id,effect,scope,scope_value) VALUES(?,?,?,?,?)`)
      .bind(id,item.permissionId,item.effect,item.scope,item.scopeValue??null).run();
  }
  await audit(c,'user_permission_overrides_changed','company_user',id,{companyId:cid,count:parsed.data.overrides.length});
  for(const item of parsed.data.overrides){
    await audit(c,item.effect==='allow'?'user_permission_granted':'user_permission_denied','company_user',id,{companyId:cid,permissionId:item.permissionId,scope:item.scope,scopeValue:item.scopeValue??null});
  }
  return c.json({ok:true});
});

const roleSchema=z.object({
  nameAr:z.string().trim().min(2).max(128),
  nameEn:z.string().trim().max(128).nullable().optional(),
  permissionIds:z.array(z.string().min(1)).max(200).default([])
});
const roleUpdateSchema=z.object({
  nameAr:z.string().trim().min(2).max(128).optional(),
  nameEn:z.string().trim().max(128).nullable().optional(),
  status:z.enum(['active','disabled']).optional(),
  permissionIds:z.array(z.string().min(1)).max(200).optional(),
  permissionScopes:z.array(z.object({permissionId:z.string(),scope:z.enum(['company','management_unit','department','section','self']),scopeValue:z.string().nullable().optional()})).max(200).optional()
}).refine(v=>Object.keys(v).length>0);

app.get('/roles', async c => {
  if (!(await allowed(c,'roles.view'))) return c.json({error:'FORBIDDEN'},403);
  const rows=await c.env.DB.prepare(`
    SELECT r.id,r.name_ar,r.name_en,r.code,r.system_role,r.status,r.created_at,
      COUNT(DISTINCT ur.company_user_id) user_count,
      COUNT(DISTINCT rp.permission_id) permission_count
    FROM roles r
    LEFT JOIN user_roles ur ON ur.role_id=r.id
    LEFT JOIN role_permissions rp ON rp.role_id=r.id
    WHERE r.company_id=? GROUP BY r.id ORDER BY r.system_role DESC,r.name_ar
  `).bind(companyId(c)).all<any>();
  return c.json({items:rows.results});
});

app.get('/roles/:id', async c => {
  if (!(await allowed(c,'roles.view'))) return c.json({error:'FORBIDDEN'},403);
  const role=await c.env.DB.prepare(`SELECT id,name_ar,name_en,code,system_role,status FROM roles WHERE id=? AND company_id=?`).bind(c.req.param('id'),companyId(c)).first<any>();
  if(!role)return c.json({error:'ROLE_NOT_FOUND'},404);
  const permissions=await c.env.DB.prepare(`
    SELECT rp.permission_id,p.resource,p.action,p.name_ar,p.name_en,rp.scope,rp.scope_value
    FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? ORDER BY p.resource,p.action
  `).bind(role.id).all();
  const users=await c.env.DB.prepare(`
    SELECT cu.id,cu.username FROM user_roles ur JOIN company_users cu ON cu.id=ur.company_user_id
    WHERE ur.role_id=? AND cu.company_id=? ORDER BY cu.username
  `).bind(role.id,companyId(c)).all();
  return c.json({role,permissions:permissions.results,users:users.results});
});

app.post('/roles', async c => {
  if (!(await allowed(c,'roles.create'))) return c.json({error:'FORBIDDEN'},403);
  const parsed=roleSchema.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)return c.json({error:'INVALID_INPUT'},400);
  const cid=companyId(c),roleId=crypto.randomUUID(),code=`custom_${roleId.replace(/-/g,'')}`;
  const permissionIds=uniqueStrings(parsed.data.permissionIds);
  if(permissionIds.length && !(await allowed(c,'permissions.manage'))) return c.json({error:'FORBIDDEN'},403);
  if(permissionIds.length){
    const placeholders=permissionIds.map(()=>'?').join(',');
    const rows=await c.env.DB.prepare(`SELECT id FROM permissions WHERE id IN (${placeholders})`).bind(...permissionIds).all();
    if(rows.results.length!==permissionIds.length)return c.json({error:'INVALID_PERMISSION'},400);
  }
  await c.env.DB.prepare(`INSERT INTO roles(id,company_id,name_ar,name_en,code,system_role,status) VALUES(?,?,?,?,?,0,'active')`)
    .bind(roleId,cid,parsed.data.nameAr,parsed.data.nameEn??null,code).run();
  for(const permissionId of permissionIds)await c.env.DB.prepare(`INSERT INTO role_permissions(role_id,permission_id,scope) VALUES(?,?, 'company')`).bind(roleId,permissionId).run();
  await audit(c,'role_created','role',roleId,{companyId:cid,permissionIds});
  for(const permissionId of permissionIds) await audit(c,'permission_assigned_to_role','role',roleId,{companyId:cid,permissionId});
  return c.json({ok:true,roleId},201);
});

app.patch('/roles/:id', async c => {
  if (!(await allowed(c,'roles.edit'))) return c.json({error:'FORBIDDEN'},403);
  const id=c.req.param('id'),cid=companyId(c),actor=c.get('session')!.companyUserId!;
  const role=await c.env.DB.prepare(`SELECT id,name_ar,name_en,system_role,status FROM roles WHERE id=? AND company_id=?`).bind(id,cid).first<any>();
  if(!role)return c.json({error:'ROLE_NOT_FOUND'},404);
  const parsed=roleUpdateSchema.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)return c.json({error:'INVALID_INPUT'},400);
  if(role.system_role)return c.json({error:'SYSTEM_ROLE_PROTECTED'},409);
  if(parsed.data.permissionIds!==undefined || parsed.data.permissionScopes!==undefined){
    if(!(await allowed(c,'permissions.manage')))return c.json({error:'FORBIDDEN'},403);
    const assigned=await c.env.DB.prepare(`SELECT 1 FROM user_roles WHERE role_id=? AND company_user_id=?`).bind(id,actor).first();
    if(assigned)return c.json({error:'SELF_PERMISSION_CHANGE_FORBIDDEN'},403);
  }
  if(parsed.data.status==='disabled'){
    if(!(await allowed(c,'roles.disable')))return c.json({error:'FORBIDDEN'},403);
  }
  let previousPermissionIds:string[]=[];
  if(parsed.data.permissionIds){
    previousPermissionIds=(await c.env.DB.prepare(`SELECT permission_id FROM role_permissions WHERE role_id=?`).bind(id).all<{permission_id:string}>()).results.map(x=>x.permission_id);
    const ids=uniqueStrings(parsed.data.permissionIds);
    if(ids.length){
      const placeholders=ids.map(()=>'?').join(',');
      const rows=await c.env.DB.prepare(`SELECT id FROM permissions WHERE id IN (${placeholders})`).bind(...ids).all();
      if(rows.results.length!==ids.length)return c.json({error:'INVALID_PERMISSION'},400);
    }
    const scopes=parsed.data.permissionScopes??[];
    for(const permissionId of ids){
      const sc=scopes.find(x=>x.permissionId===permissionId);
      const scope=sc?.scope??'company',value=sc?.scopeValue??null;
      if(!(await validateScope(c,scope,value)))return c.json({error:'INVALID_SCOPE'},400);
    }
    await c.env.DB.prepare(`DELETE FROM role_permissions WHERE role_id=?`).bind(id).run();
    for(const permissionId of ids){
      const sc=scopes.find(x=>x.permissionId===permissionId);
      const scope=sc?.scope??'company',value=sc?.scopeValue??null;
      await c.env.DB.prepare(`INSERT INTO role_permissions(role_id,permission_id,scope,scope_value) VALUES(?,?,?,?)`).bind(id,permissionId,scope,value).run();
    }
  }
  const fields:string[]=[];const vals:any[]=[];
  if(parsed.data.nameAr!==undefined){fields.push('name_ar=?');vals.push(parsed.data.nameAr);}
  if(parsed.data.nameEn!==undefined){fields.push('name_en=?');vals.push(parsed.data.nameEn);}
  if(parsed.data.status!==undefined){fields.push('status=?');vals.push(parsed.data.status);}
  if(fields.length){fields.push('updated_at=CURRENT_TIMESTAMP');vals.push(id,cid);await c.env.DB.prepare(`UPDATE roles SET ${fields.join(',')} WHERE id=? AND company_id=?`).bind(...vals).run();}
  await audit(c,'role_updated','role',id,{companyId:cid,changes:parsed.data});
  if(parsed.data.permissionIds){
    const ids=uniqueStrings(parsed.data.permissionIds);
    for(const permissionId of ids.filter(x=>!previousPermissionIds.includes(x))) await audit(c,'permission_assigned_to_role','role',id,{companyId:cid,permissionId});
    for(const permissionId of previousPermissionIds.filter(x=>!ids.includes(x))) await audit(c,'permission_removed_from_role','role',id,{companyId:cid,permissionId});
  }
  if(parsed.data.status==='disabled' && role.status!=='disabled') await audit(c,'role_disabled','role',id,{companyId:cid});
  return c.json({ok:true});
});

app.get('/audit-permission-check', async c => c.json({ok:true})); // harmless health surface for integration tests
export default app;
