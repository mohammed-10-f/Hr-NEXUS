import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { audit } from '../audit';
import { hasPermission } from '../authorization';
import { errorResponse } from '../errors';
import { requireAuthentication, requireCompanyContext, requirePasswordChanged } from '../middleware/session';

const app = new Hono<Env>();
app.use('*', requireAuthentication, requireCompanyContext, requirePasswordChanged);

const unitSchema = z.object({
  nameAr: z.string().trim().min(2).max(120),
  nameEn: z.string().trim().max(120).nullable().optional(),
  levelName: z.string().trim().min(1).max(80),
  code: z.string().trim().max(64).nullable().optional(),
  parentId: z.string().trim().max(128).nullable().optional(),
  active: z.boolean().optional()
});
const unitUpdateSchema = unitSchema.partial().refine(v => Object.keys(v).length > 0);
const positionSchema = z.object({
  organizationUnitId: z.string().trim().min(1),
  titleAr: z.string().trim().min(2).max(160),
  titleEn: z.string().trim().max(160).nullable().optional(),
  code: z.string().trim().max(64).nullable().optional(),
  status: z.enum(['vacant','occupied','frozen']).default('vacant'),
  managerPositionId: z.string().trim().max(128).nullable().optional()
});
const positionUpdateSchema = positionSchema.partial().refine(v => Object.keys(v).length > 0);
const moveSchema = z.object({ parentId: z.string().trim().max(128).nullable() });
const managerSchema = z.object({ managerPositionId: z.string().trim().max(128).nullable() });

function companyId(c: any) { return c.get('session')!.activeCompanyId as string; }
async function allowed(c: any, permission: string) {
  return hasPermission(c, permission);
}
function forbidden(c: any) { return errorResponse(c, 'ORG-010', 403); }

async function getUnit(c: any, id: string) {
  return c.env.DB.prepare(`SELECT * FROM organization_units WHERE id=? AND company_id=?`).bind(id, companyId(c)).first<any>();
}
async function getPosition(c: any, id: string) {
  return c.env.DB.prepare(`SELECT * FROM positions WHERE id=? AND company_id=?`).bind(id, companyId(c)).first<any>();
}
async function validateParent(c: any, parentId: string|null, movingId: string|null = null) {
  if (!parentId) return true;
  if (movingId && parentId === movingId) return false;
  const parent = await c.env.DB.prepare(`SELECT id FROM organization_units WHERE id=? AND company_id=? AND active=1`).bind(parentId, companyId(c)).first();
  if (!parent) return false;
  if (movingId) {
    const hit = await c.env.DB.prepare(`
      WITH RECURSIVE tree(id) AS (
        SELECT id FROM organization_units WHERE id=? AND company_id=?
        UNION ALL
        SELECT ou.id FROM organization_units ou JOIN tree t ON ou.parent_id=t.id WHERE ou.company_id=?
      ) SELECT id FROM tree WHERE id=? LIMIT 1
    `).bind(movingId, companyId(c), companyId(c), parentId).first();
    if (hit) return false;
  }
  return true;
}
async function validateManager(c: any, managerPositionId: string|null, positionId: string|null = null) {
  if (!managerPositionId) return true;
  if (positionId && managerPositionId === positionId) return false;
  const manager = await c.env.DB.prepare(`SELECT id FROM positions WHERE id=? AND company_id=?`).bind(managerPositionId, companyId(c)).first();
  if (!manager) return false;
  if (positionId) {
    const cycle = await c.env.DB.prepare(`
      WITH RECURSIVE chain(id) AS (
        SELECT manager_position_id FROM positions WHERE id=? AND company_id=? AND manager_position_id IS NOT NULL
        UNION ALL
        SELECT p.manager_position_id FROM positions p JOIN chain ch ON p.id=ch.id
        WHERE p.company_id=? AND p.manager_position_id IS NOT NULL
      ) SELECT id FROM chain WHERE id=? LIMIT 1
    `).bind(managerPositionId, companyId(c), companyId(c), positionId).first();
    if (cycle) return false;
  }
  return true;
}

app.get('/', async c => {
  if (!(await allowed(c,'organization.view'))) return forbidden(c);
  const cid = companyId(c);
  const [units, stats] = await Promise.all([
    c.env.DB.prepare(`
      SELECT ou.id,ou.parent_id,ou.name_ar,ou.name_en,ou.level_name,ou.code,ou.active,
             COUNT(DISTINCT p.id) AS position_count,
             SUM(CASE WHEN p.status='occupied' THEN 1 ELSE 0 END) AS occupied_count,
             SUM(CASE WHEN p.status='vacant' THEN 1 ELSE 0 END) AS vacant_count,
             SUM(CASE WHEN p.status='frozen' THEN 1 ELSE 0 END) AS frozen_count
      FROM organization_units ou
      LEFT JOIN positions p ON p.organization_unit_id=ou.id AND p.company_id=ou.company_id
      WHERE ou.company_id=?
      GROUP BY ou.id
      ORDER BY COALESCE(ou.level_name,''),ou.name_ar
    `).bind(cid).all(),
    c.env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM organization_units WHERE company_id=?) AS unit_count,
        (SELECT COUNT(*) FROM positions WHERE company_id=?) AS position_count,
        (SELECT COUNT(*) FROM positions WHERE company_id=? AND status='occupied') AS occupied_count,
        (SELECT COUNT(*) FROM positions WHERE company_id=? AND status='vacant') AS vacant_count,
        (SELECT COUNT(*) FROM positions WHERE company_id=? AND status='frozen') AS frozen_count
    `).bind(cid,cid,cid,cid,cid).first<any>()
  ]);
  return c.json({ units: units.results, stats });
});

app.get('/positions', async c => {
  if (!(await allowed(c,'organization.view'))) return forbidden(c);
  const cid=companyId(c);
  const url=new URL(c.req.url);
  const page=Math.max(1,Number(url.searchParams.get('page')||'1')||1);
  const requestedPageSize=Math.max(10,Number(url.searchParams.get('pageSize')||'25')||25);
  const pageSize=Math.min(500,requestedPageSize);
  const offset=(page-1)*pageSize;
  const unitId=url.searchParams.get('unitId')?.trim()||'';
  const q=url.searchParams.get('q')?.trim()||'';
  const status=url.searchParams.get('status')?.trim()||'';
  const clauses=['p.company_id=?'];
  const binds:any[]=[cid];
  if(unitId){clauses.push('p.organization_unit_id=?');binds.push(unitId)}
  if(status && ['vacant','occupied','frozen'].includes(status)){clauses.push('p.status=?');binds.push(status)}
  if(q){clauses.push(`(LOWER(p.title_ar) LIKE LOWER(?) OR LOWER(COALESCE(p.title_en,'')) LIKE LOWER(?) OR LOWER(COALESCE(p.code,'')) LIKE LOWER(?) OR LOWER(ou.name_ar) LIKE LOWER(?))`);const like=`%${q}%`;binds.push(like,like,like,like)}
  const where=clauses.join(' AND ');
  const [rows,total]=await Promise.all([
    c.env.DB.prepare(`SELECT p.id,p.organization_unit_id,p.title_ar,p.title_en,p.code,p.status,p.manager_position_id,ou.name_ar AS organization_unit_name,m.title_ar AS manager_title_ar FROM positions p JOIN organization_units ou ON ou.id=p.organization_unit_id AND ou.company_id=p.company_id LEFT JOIN positions m ON m.id=p.manager_position_id AND m.company_id=p.company_id WHERE ${where} ORDER BY ou.name_ar,p.title_ar LIMIT ? OFFSET ?`).bind(...binds,pageSize,offset).all(),
    c.env.DB.prepare(`SELECT COUNT(*) AS total FROM positions p JOIN organization_units ou ON ou.id=p.organization_unit_id AND ou.company_id=p.company_id WHERE ${where}`).bind(...binds).first<any>()
  ]);
  return c.json({results:rows.results,total:Number(total?.total||0),page,pageSize});
});

app.post('/units', async c => {
  if (!(await allowed(c,'organization.create'))) return forbidden(c);
  const parsed = unitSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return errorResponse(c,'ORG-001',400);
  const cid=companyId(c), d=parsed.data, parentId=d.parentId ?? null;
  if (!(await validateParent(c,parentId))) return errorResponse(c,'ORG-003',400);
  const id=crypto.randomUUID();
  try {
    await c.env.DB.prepare(`INSERT INTO organization_units(id,company_id,parent_id,name_ar,name_en,level_name,code,active) VALUES(?,?,?,?,?,?,?,?)`)
      .bind(id,cid,parentId,d.nameAr,d.nameEn ?? null,d.levelName,d.code || null,d.active===false?0:1).run();
  } catch(err) {
    return errorResponse(c,'DB-001',500,err);
  }
  await audit(c,'organization_unit_created','organization_unit',id,{before:null,after:{...d,parentId}});
  return c.json({ok:true,id},201);
});

app.patch('/units/:id', async c => {
  if (!(await allowed(c,'organization.edit'))) return forbidden(c);
  const id=c.req.param('id'), before=await getUnit(c,id);
  if (!before) return errorResponse(c,'ORG-002',404);
  const parsed=unitUpdateSchema.safeParse(await c.req.json().catch(()=>null));
  if (!parsed.success) return errorResponse(c,'ORG-001',400);
  const d=parsed.data;
  const nextParent = d.parentId === undefined ? before.parent_id : (d.parentId || null);
  const parentChanged = nextParent !== before.parent_id;
  if (parentChanged && !(await allowed(c,'organization.move'))) return forbidden(c);
  if (!(await validateParent(c,nextParent,id))) return errorResponse(c,'ORG-004',409);
  const next={
    nameAr:d.nameAr ?? before.name_ar,nameEn:d.nameEn === undefined ? before.name_en : (d.nameEn || null),
    levelName:d.levelName ?? before.level_name,code:d.code === undefined ? before.code : (d.code || null),
    parentId:nextParent,active:d.active === undefined ? Boolean(before.active) : d.active
  };
  try {
    await c.env.DB.prepare(`UPDATE organization_units SET parent_id=?,name_ar=?,name_en=?,level_name=?,code=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND company_id=?`)
      .bind(next.parentId,next.nameAr,next.nameEn,next.levelName,next.code,next.active?1:0,id,companyId(c)).run();
  } catch(err){ return errorResponse(c,'DB-001',500,err); }
  await audit(c,'organization_unit_updated','organization_unit',id,{before,after:next});
  return c.json({ok:true});
});

app.post('/units/:id/move', async c => {
  if (!(await allowed(c,'organization.move'))) return forbidden(c);
  const id=c.req.param('id'), before=await getUnit(c,id);
  if(!before)return errorResponse(c,'ORG-002',404);
  const parsed=moveSchema.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return errorResponse(c,'ORG-001',400);
  if(!(await validateParent(c,parsed.data.parentId,id)))return errorResponse(c,'ORG-004',409);
  try{await c.env.DB.prepare(`UPDATE organization_units SET parent_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND company_id=?`).bind(parsed.data.parentId||null,id,companyId(c)).run();}
  catch(err){return errorResponse(c,'DB-001',500,err)}
  await audit(c,'organization_unit_moved','organization_unit',id,{before:{parentId:before.parent_id},after:{parentId:parsed.data.parentId||null}});
  return c.json({ok:true});
});

app.post('/positions', async c => {
  if (!(await allowed(c,'organization.manage_positions'))) return forbidden(c);
  const parsed=positionSchema.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return errorResponse(c,'ORG-006',400);
  const d=parsed.data,cid=companyId(c);
  const unit=await c.env.DB.prepare(`SELECT id FROM organization_units WHERE id=? AND company_id=? AND active=1`).bind(d.organizationUnitId,cid).first();
  if(!unit)return errorResponse(c,'ORG-005',403);
  if(!(await validateManager(c,d.managerPositionId??null)))return errorResponse(c,'ORG-006',400);
  const id=crypto.randomUUID();
  try{await c.env.DB.prepare(`INSERT INTO positions(id,company_id,organization_unit_id,title_ar,title_en,code,status,manager_position_id) VALUES(?,?,?,?,?,?,?,?)`).bind(id,cid,d.organizationUnitId,d.titleAr,d.titleEn??null,d.code||null,d.status,d.managerPositionId||null).run();}
  catch(err){
    const msg=String((err as any)?.message||err);
    return errorResponse(c,msg.includes('UNIQUE')?'ORG-008':'DB-001',msg.includes('UNIQUE')?409:500,err);
  }
  await audit(c,'organization_position_created','position',id,{before:null,after:d});
  return c.json({ok:true,id},201);
});

app.patch('/positions/:id', async c => {
  if (!(await allowed(c,'organization.manage_positions'))) return forbidden(c);
  const id=c.req.param('id'),before=await getPosition(c,id);
  if(!before)return errorResponse(c,'ORG-002',404);
  const parsed=positionUpdateSchema.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return errorResponse(c,'ORG-006',400);
  const d=parsed.data,cid=companyId(c), unitId=d.organizationUnitId ?? before.organization_unit_id, managerId=d.managerPositionId === undefined ? before.manager_position_id : (d.managerPositionId||null);
  const unit=await c.env.DB.prepare(`SELECT id FROM organization_units WHERE id=? AND company_id=? AND active=1`).bind(unitId,cid).first();
  if(!unit)return errorResponse(c,'ORG-005',403);
  const managerChanged = managerId !== before.manager_position_id;
  if (managerChanged && !(await allowed(c,'organization.manage_managers'))) return forbidden(c);
  if(!(await validateManager(c,managerId,id)))return errorResponse(c,'ORG-007',409);
  const next={organizationUnitId:unitId,titleAr:d.titleAr??before.title_ar,titleEn:d.titleEn===undefined?before.title_en:(d.titleEn||null),code:d.code===undefined?before.code:(d.code||null),status:d.status??before.status,managerPositionId:managerId};
  try{await c.env.DB.prepare(`UPDATE positions SET organization_unit_id=?,title_ar=?,title_en=?,code=?,status=?,manager_position_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND company_id=?`).bind(next.organizationUnitId,next.titleAr,next.titleEn,next.code,next.status,next.managerPositionId,id,cid).run();}
  catch(err){const msg=String((err as any)?.message||err);return errorResponse(c,msg.includes('UNIQUE')?'ORG-008':'DB-001',msg.includes('UNIQUE')?409:500,err)}
  await audit(c,'organization_position_updated','position',id,{before,after:next});
  return c.json({ok:true});
});

app.patch('/positions/:id/manager', async c => {
  if (!(await allowed(c,'organization.manage_managers'))) return forbidden(c);
  const id=c.req.param('id'),before=await getPosition(c,id);
  if(!before)return errorResponse(c,'ORG-002',404);
  const parsed=managerSchema.safeParse(await c.req.json().catch(()=>null));
  if(!parsed.success)return errorResponse(c,'ORG-006',400);
  const managerId=parsed.data.managerPositionId||null;
  if(!(await validateManager(c,managerId,id)))return errorResponse(c,'ORG-007',409);
  try{await c.env.DB.prepare(`UPDATE positions SET manager_position_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND company_id=?`).bind(managerId,id,companyId(c)).run();}
  catch(err){return errorResponse(c,'DB-001',500,err)}
  await audit(c,'organization_manager_changed','position',id,{before:{managerPositionId:before.manager_position_id},after:{managerPositionId:managerId}});
  return c.json({ok:true});
});

app.get('/export', async c => {
  if (!(await allowed(c,'organization.export'))) return forbidden(c);
  const cid=companyId(c);
  const rows=await c.env.DB.prepare(`
    SELECT 'UNIT' AS record_type,ou.id,ou.parent_id AS parent_id,ou.name_ar AS name_ar,ou.name_en AS name_en,ou.level_name AS level_name,ou.code AS code,CAST(ou.active AS TEXT) AS status,'' AS manager_position_id
    FROM organization_units ou WHERE ou.company_id=?
    UNION ALL
    SELECT 'POSITION',p.id,p.organization_unit_id,p.title_ar,p.title_en,'POSITION',p.code,p.status,COALESCE(p.manager_position_id,'')
    FROM positions p WHERE p.company_id=?
    ORDER BY record_type,name_ar
  `).bind(cid,cid).all<any>();
  const escape=(v:any)=>`"${String(v??'').replaceAll('"','""')}"`;
  const csv=['record_type,id,parent_or_unit_id,name_ar,name_en,level_or_type,code,status,manager_position_id',...rows.results.map((r:any)=>[r.record_type,r.id,r.parent_id,r.name_ar,r.name_en,r.level_name,r.code,r.status,r.manager_position_id].map(escape).join(','))].join('\r\n');
  c.header('Content-Type','text/csv; charset=utf-8');
  c.header('Content-Disposition','attachment; filename="hr-nexus-organization.csv"');
  return c.body('\uFEFF'+csv);
});

export default app;
