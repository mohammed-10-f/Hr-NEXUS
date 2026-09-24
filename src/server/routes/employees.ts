import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { hasPermission, hasPermissionAtOrganizationUnit, resolvePermissions } from '../authorization';
import { audit } from '../audit';
import { hashPassword } from '../auth/crypto';
import { errorResponse } from '../errors';
import { requireAuthentication, requireCompanyContext, requirePasswordChanged } from '../middleware/session';

const app=new Hono<Env>();
app.use('*',requireAuthentication,requireCompanyContext,requirePasswordChanged);

const employeeStatuses=['active','suspended','leave','terminated'] as const;
const employmentTypes=['full_time','part_time','training','tamheer'] as const;
const probationResults=['passed','failed'] as const;
const fieldTypes=['text','number','date','boolean','dropdown','multiselect'] as const;

const employeeSchema=z.object({
  employeeNumber:z.string().trim().min(1).max(64), firstName:z.string().trim().min(1).max(120), fatherName:z.string().trim().max(120).nullable().optional(),
  familyName:z.string().trim().max(120).nullable().optional(), nationality:z.string().trim().max(80).nullable().optional(), gender:z.string().trim().max(30).nullable().optional(), dateOfBirth:z.string().trim().max(30).nullable().optional(),
  nationalId:z.string().trim().max(64).nullable().optional(), identityType:z.string().trim().max(30).nullable().optional(), identityIssueDate:z.string().trim().max(30).nullable().optional(), identityIssuer:z.string().trim().max(120).nullable().optional(),
  passportNumber:z.string().trim().max(64).nullable().optional(), passportIssueDate:z.string().trim().max(30).nullable().optional(), passportExpiryDate:z.string().trim().max(30).nullable().optional(),
  personalPhone:z.string().trim().max(40).nullable().optional(), personalEmail:z.union([z.string().trim().email().max(180),z.literal('')]).nullable().optional(), shortAddress:z.string().trim().max(120).nullable().optional(), photoUrl:z.string().trim().max(500).nullable().optional(),
  jobTitle:z.string().trim().max(160).nullable().optional(), organizationUnitId:z.string().trim().max(128).nullable().optional(), positionId:z.string().trim().max(128).nullable().optional(), workLocation:z.string().trim().max(160).nullable().optional(),
  employmentType:z.enum(employmentTypes).nullable().optional(), contractType:z.string().trim().max(128).nullable().optional(), contractStartDate:z.string().trim().max(30).nullable().optional(), contractEndDate:z.string().trim().max(30).nullable().optional(), contractAutoRenew:z.boolean().optional(),
  status:z.enum(employeeStatuses).optional(), joinDate:z.string().trim().max(30).nullable().optional(), actualStartDate:z.string().trim().max(30).nullable().optional(), probationDays:z.number().int().min(1).max(180).optional(), probationExtensionDays:z.number().int().min(0).max(180).optional(),
  gosiNumber:z.string().trim().max(80).nullable().optional(), residencyClassification:z.string().trim().max(80).nullable().optional(), insuranceProfile:z.string().trim().max(160).nullable().optional(), professionalHazard:z.boolean().optional(), leavePolicyId:z.string().trim().max(128).nullable().optional(),
  createAccount:z.boolean().optional()
});
const salarySchema=z.object({basicSalary:z.number().min(0),housingAllowance:z.number().min(0),transportAllowance:z.number().min(0),otherAllowances:z.number().min(0),effectiveDate:z.string().min(1)});
const bankSchema=z.object({bankName:z.string().trim().min(1).max(120),iban:z.string().trim().min(5).max(64),accountHolderName:z.string().trim().max(180).nullable().optional()});
const fieldDefinitionSchema=z.object({fieldKey:z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/).max(64),labelAr:z.string().trim().min(1).max(120),labelEn:z.string().trim().max(120).nullable().optional(),fieldType:z.enum(fieldTypes),options:z.array(z.string().trim().min(1).max(120)).max(100).optional(),required:z.boolean().optional(),sortOrder:z.number().int().min(0).max(9999).optional()});
const contractTypeSchema=z.object({code:z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/).max(64),nameAr:z.string().trim().min(1).max(120),nameEn:z.string().trim().max(120).nullable().optional()});

function cid(c:any){return c.get('session')!.activeCompanyId as string;}
async function allowed(c:any,primary:string,legacy?:string){return (await hasPermission(c,primary)) || Boolean(legacy && await hasPermission(c,legacy));}
async function sensitiveAllowed(c:any,permission:string,legacy?:string){return allowed(c,permission,legacy);}
function fullName(row:any){return [row.first_name,row.father_name,row.family_name].filter(Boolean).join(' ');}
async function employeeById(c:any,id:string){return c.env.DB.prepare(`SELECT e.*,ou.name_ar organization_unit_name,p.title_ar position_title,TRIM(COALESCE(m.first_name,'')||' '||COALESCE(m.father_name,'')||' '||COALESCE(m.family_name,'')) manager_name FROM employees e LEFT JOIN organization_units ou ON ou.id=e.organization_unit_id AND ou.company_id=e.company_id LEFT JOIN positions p ON p.id=e.position_id AND p.company_id=e.company_id LEFT JOIN employees m ON m.id=e.manager_employee_id AND m.company_id=e.company_id WHERE e.id=? AND e.company_id=?`).bind(id,cid(c)).first<any>();}
async function ensureUnit(c:any,unitId:string|null){if(!unitId)return true;return Boolean(await c.env.DB.prepare(`SELECT id FROM organization_units WHERE id=? AND company_id=? AND active=1`).bind(unitId,cid(c)).first());}
async function ensureContractType(c:any,contractType:string|null){if(!contractType)return true;return Boolean(await c.env.DB.prepare(`SELECT id FROM employee_contract_types WHERE company_id=? AND code=? AND active=1`).bind(cid(c),contractType).first());}
async function ensureLeavePolicy(c:any,leavePolicyId:string|null){if(!leavePolicyId)return true;return Boolean(await c.env.DB.prepare(`SELECT id FROM leave_policies WHERE company_id=? AND id=? AND active=1`).bind(cid(c),leavePolicyId).first());}
async function ensurePosition(c:any,positionId:string|null,unitId:string|null){
  if(!positionId)return true;
  const p=await c.env.DB.prepare(`SELECT id,organization_unit_id,status FROM positions WHERE id=? AND company_id=?`).bind(positionId,cid(c)).first<any>();
  return Boolean(p && (!unitId || p.organization_unit_id===unitId) && p.status!=='frozen');
}
async function deriveManager(c:any,positionId:string|null){
  if(!positionId)return null;
  const row=await c.env.DB.prepare(`SELECT m.id FROM positions p LEFT JOIN positions mp ON mp.id=p.manager_position_id AND mp.company_id=p.company_id LEFT JOIN employees m ON m.position_id=mp.id AND m.company_id=p.company_id AND m.status<>'terminated' WHERE p.id=? AND p.company_id=? LIMIT 1`).bind(positionId,cid(c)).first<{id:string|null}>();
  return row?.id??null;
}
async function canViewEmployee(c:any,employee:any,permission='employee.view',legacy='employees.view'){
  if(await allowed(c,permission,legacy)){
    const s=c.get('session');
    if(s?.platformUserId && s.accessMode==='super_admin_company_access') return true;
  }
  if(await hasPermissionAtOrganizationUnit(c,permission,employee.organization_unit_id)) return true;
  if(legacy && await hasPermissionAtOrganizationUnit(c,legacy,employee.organization_unit_id)) return true;
  const s=c.get('session');
  return Boolean(s?.employeeId && s.employeeId===employee.id && await hasPermission(c,permission,'self',s.employeeId));
}

app.get('/contract-types',async c=>{
  if(!(await allowed(c,'employee.view','employees.view'))) return c.json({error:'FORBIDDEN'},403);
  const rows=await c.env.DB.prepare(`SELECT id,code,name_ar,name_en,active,sort_order FROM employee_contract_types WHERE company_id=? AND active=1 ORDER BY sort_order,name_ar`).bind(cid(c)).all();
  return c.json({items:rows.results});
});
app.post('/contract-types',async c=>{
  if(!(await hasPermission(c,'employee.manage_contract_types'))) return errorResponse(c,'EMP-006',403);
  const p=contractTypeSchema.safeParse(await c.req.json().catch(()=>null)); if(!p.success)return errorResponse(c,'EMP-001',400);
  const id=crypto.randomUUID(); try{await c.env.DB.prepare(`INSERT INTO employee_contract_types(id,company_id,code,name_ar,name_en) VALUES(?,?,?,?,?)`).bind(id,cid(c),p.data.code,p.data.nameAr,p.data.nameEn??null).run();}catch(e){if(String(e).includes('UNIQUE'))return errorResponse(c,'EMP-007',409);return errorResponse(c,'DB-001',500,e);}
  await audit(c,'employee_contract_type_created','employee_contract_type',id,{after:p.data}); return c.json({ok:true,id},201);
});

app.get('/field-definitions',async c=>{
  if(!(await allowed(c,'employee.view','employees.view'))) return c.json({error:'FORBIDDEN'},403);
  const rows=await c.env.DB.prepare(`SELECT id,field_key,label_ar,label_en,field_type,options_json,required,active,sort_order FROM employee_field_definitions WHERE company_id=? AND active=1 ORDER BY sort_order,label_ar`).bind(cid(c)).all<any>();
  return c.json({items:rows.results.map((x:any)=>({...x,options:x.options_json?JSON.parse(x.options_json):[],required:Boolean(x.required)}))});
});
app.post('/field-definitions',async c=>{
  if(!(await hasPermission(c,'employee.manage_custom_fields'))) return errorResponse(c,'EMP-006',403);
  const p=fieldDefinitionSchema.safeParse(await c.req.json().catch(()=>null)); if(!p.success)return errorResponse(c,'EMP-001',400);
  const id=crypto.randomUUID(); try{await c.env.DB.prepare(`INSERT INTO employee_field_definitions(id,company_id,field_key,label_ar,label_en,field_type,options_json,required,sort_order) VALUES(?,?,?,?,?,?,?,?,?)`).bind(id,cid(c),p.data.fieldKey,p.data.labelAr,p.data.labelEn??null,p.data.fieldType,p.data.options?JSON.stringify(p.data.options):null,p.data.required?1:0,p.data.sortOrder??0).run();}catch(e){if(String(e).includes('UNIQUE'))return errorResponse(c,'EMP-007',409);return errorResponse(c,'DB-001',500,e);}
  await audit(c,'employee_field_created','employee_field_definition',id,{after:p.data}); return c.json({ok:true,id},201);
});

app.get('/',async c=>{
  if(!(await allowed(c,'employee.view','employees.view'))) return c.json({error:'FORBIDDEN'},403);
  const s=c.get('session')!; const search=c.req.query('search')?.trim()??'', status=c.req.query('status')?.trim()??'';
  const page=Math.max(1,Number(c.req.query('page')??'1')),pageSize=Math.min(50,Math.max(10,Number(c.req.query('pageSize')??'20'))),offset=(page-1)*pageSize;
  const params:any[]=[cid(c)]; let where='e.company_id=?';
  if(search){where+=` AND (e.employee_number LIKE ? OR e.national_id LIKE ? OR e.first_name LIKE ? OR e.father_name LIKE ? OR e.family_name LIKE ?)`;const q=`%${search}%`;params.push(q,q,q,q,q);}
  if(status){where+=` AND e.status=?`;params.push(status);}
  const permissions=await resolvePermissions(c); const scoped=permissions.filter(p=>['employee.view','employees.view'].includes(p.permissionId)&&p.effect==='allow');
  const companyScope=scoped.some(p=>p.scope==='company') || Boolean(s.platformUserId&&s.accessMode==='super_admin_company_access');
  if(!companyScope){
    const selfScope=scoped.some(p=>p.scope==='self');
    const unitScopes=scoped.filter(p=>['management','management_unit','department','section'].includes(p.scope)&&p.scopeValue);
    const clauses:string[]=[]; const scopeParams:any[]=[];
    if(selfScope&&s.employeeId){clauses.push('e.id=?');scopeParams.push(s.employeeId);}
    for(const u of unitScopes){clauses.push(`e.organization_unit_id IN (WITH RECURSIVE tree(id) AS (SELECT id FROM organization_units WHERE id=? AND company_id=? UNION ALL SELECT ou.id FROM organization_units ou JOIN tree t ON ou.parent_id=t.id WHERE ou.company_id=?) SELECT id FROM tree)`);scopeParams.push(u.scopeValue,cid(c),cid(c));}
    if(!clauses.length)return c.json({items:[],page,pageSize,total:0});
    where+=` AND (${clauses.join(' OR ')})`;params.push(...scopeParams);
  }
  const count=await c.env.DB.prepare(`SELECT COUNT(*) total FROM employees e WHERE ${where}`).bind(...params).first<{total:number}>();
  const rows=await c.env.DB.prepare(`SELECT e.id,e.employee_number,TRIM(COALESCE(e.first_name,'')||' '||COALESCE(e.father_name,'')||' '||COALESCE(e.family_name,'')) name,e.job_title,ou.name_ar department,p.title_ar position_name,TRIM(COALESCE(m.first_name,'')||' '||COALESCE(m.family_name,'')) manager,e.status,e.actual_start_date,e.join_date,CASE WHEN e.national_id IS NOT NULL AND EXISTS(SELECT 1 FROM employees d WHERE d.company_id=e.company_id AND d.national_id=e.national_id AND d.id<>e.id) THEN 1 ELSE 0 END duplicate_national_id FROM employees e LEFT JOIN organization_units ou ON ou.id=e.organization_unit_id AND ou.company_id=e.company_id LEFT JOIN positions p ON p.id=e.position_id AND p.company_id=e.company_id LEFT JOIN employees m ON m.id=e.manager_employee_id AND m.company_id=e.company_id WHERE ${where} ORDER BY e.employee_number COLLATE NOCASE LIMIT ? OFFSET ?`).bind(...params,pageSize,offset).all();
  return c.json({items:rows.results,page,pageSize,total:count?.total??0});
});

app.post('/',async c=>{
  if(!(await allowed(c,'employee.create','employees.create'))) return errorResponse(c,'EMP-006',403);
  const p=employeeSchema.safeParse(await c.req.json().catch(()=>null)); if(!p.success)return errorResponse(c,'EMP-001',400);
  const d=p.data,companyId=cid(c),id=crypto.randomUUID();
  if(!(await ensureUnit(c,d.organizationUnitId??null)))return errorResponse(c,'EMP-003',400);
  if(!(await ensurePosition(c,d.positionId??null,d.organizationUnitId??null)))return errorResponse(c,'EMP-004',400);
  if(!(await ensureContractType(c,d.contractType??null)))return errorResponse(c,'EMP-005',400);
  if(!(await ensureLeavePolicy(c,d.leavePolicyId??null)))return errorResponse(c,'EMP-005',400);
  if(d.contractEndDate && d.contractStartDate && d.contractEndDate<d.contractStartDate)return errorResponse(c,'EMP-005',400);
  if(d.createAccount && !d.nationalId)return errorResponse(c,'EMP-008',400);
  const actualStart=d.actualStartDate??d.joinDate??null;
  const probationDays=Math.min(180,d.probationDays??180),extension=Math.max(0,d.probationExtensionDays??0);
  const probationEnd=actualStart?new Date(new Date(actualStart+'T00:00:00Z').getTime()+(probationDays+extension-1)*86400000).toISOString().slice(0,10):null;
  const managerId=await deriveManager(c,d.positionId??null);
  try{
    await c.env.DB.prepare(`INSERT INTO employees(id,company_id,employee_number,first_name,father_name,family_name,job_title,organization_unit_id,manager_employee_id,status,join_date,national_id,nationality,gender,date_of_birth,personal_phone,personal_email,short_address,photo_url,identity_type,identity_issue_date,identity_issuer,passport_number,passport_issue_date,passport_expiry_date,actual_start_date,position_id,work_location,employment_type,contract_type,contract_start_date,contract_end_date,contract_auto_renew,probation_days,probation_extension_days,probation_end_date,gosi_number,residency_classification,insurance_profile,professional_hazard,leave_policy_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,companyId,d.employeeNumber,d.firstName,d.fatherName??null,d.familyName??null,d.jobTitle??null,d.organizationUnitId??null,managerId,d.status??'active',d.joinDate??null,d.nationalId??null,d.nationality??null,d.gender??null,d.dateOfBirth??null,d.personalPhone??null,d.personalEmail??null,d.shortAddress??null,d.photoUrl??null,d.identityType??null,d.identityIssueDate??null,d.identityIssuer??null,d.passportNumber??null,d.passportIssueDate??null,d.passportExpiryDate??null,actualStart,d.positionId??null,d.workLocation??null,d.employmentType??null,d.contractType??null,d.contractStartDate??null,d.contractEndDate??null,d.contractAutoRenew?1:0,probationDays,extension,probationEnd,d.gosiNumber??null,d.residencyClassification??null,d.insuranceProfile??null,d.professionalHazard?1:0,d.leavePolicyId??null).run();
    if(d.positionId)await c.env.DB.prepare(`UPDATE positions SET status='occupied',updated_at=CURRENT_TIMESTAMP WHERE id=? AND company_id=?`).bind(d.positionId,companyId).run();
    await c.env.DB.prepare(`INSERT INTO employee_career_history(id,company_id,employee_id,change_type,effective_date,organization_unit_id,position_id,job_title,manager_employee_id,notes) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),companyId,id,'hire',actualStart||new Date().toISOString().slice(0,10),d.organizationUnitId??null,d.positionId??null,d.jobTitle??null,managerId,'إنشاء السجل الرئيسي').run();
    if(d.createAccount){await c.env.DB.prepare(`INSERT INTO company_users(id,company_id,username,employee_id,password_hash,must_change_password,status) VALUES(?,?,?,?,?,1,'active')`).bind(crypto.randomUUID(),companyId,d.nationalId,id,await hashPassword('Mm123456')).run();}
  }catch(e){const m=String(e);if(m.includes('UNIQUE constraint failed: employees.company_id, employees.employee_number'))return errorResponse(c,'EMP-002',409);if(m.includes('UNIQUE constraint failed: employee_active_position'))return errorResponse(c,'EMP-004',409);if(m.includes('UNIQUE constraint failed: company_users.company_id, company_users.username'))return errorResponse(c,'EMP-009',409);return errorResponse(c,'DB-001',500,e);}
  await audit(c,'employee_created','employee',id,{after:{...d,createAccount:Boolean(d.createAccount)}}); return c.json({ok:true,id},201);
});

app.get('/:id',async c=>{
  const employee=await employeeById(c,c.req.param('id')); if(!employee)return errorResponse(c,'EMP-010',404);
  if(!(await canViewEmployee(c,employee)))return errorResponse(c,'EMP-006',403);
  const out:any={employee:{...employee}};
  out.employee.full_name=fullName(employee);
  if(!(await sensitiveAllowed(c,'employee.view_sensitive_data'))){for(const k of ['personal_phone','personal_email','short_address','date_of_birth','gender'])delete out.employee[k];}
  if(!(await sensitiveAllowed(c,'employee.view_identity'))){for(const k of ['national_id','identity_type','identity_issue_date','identity_issuer','passport_number','passport_issue_date','passport_expiry_date'])delete out.employee[k];}
  if(await sensitiveAllowed(c,'employee.view_salary','salary.view'))out.salary=await c.env.DB.prepare(`SELECT * FROM employee_salary_history WHERE employee_id=? AND company_id=? ORDER BY effective_date DESC,created_at DESC`).bind(employee.id,cid(c)).all();
  if(await sensitiveAllowed(c,'employee.view_bank'))out.bank=await c.env.DB.prepare(`SELECT id,bank_name,iban,account_holder_name,active,created_at,updated_at FROM employee_bank_accounts WHERE employee_id=? AND company_id=? ORDER BY active DESC,updated_at DESC`).bind(employee.id,cid(c)).all();
  if(await sensitiveAllowed(c,'employee.view_gosi'))out.statutory=await c.env.DB.prepare(`SELECT * FROM employee_statutory_profiles WHERE employee_id=? AND company_id=?`).bind(employee.id,cid(c)).first();
  out.leave=await c.env.DB.prepare(`SELECT id,leave_type,balance_days,effective_from,effective_to FROM employee_leave_balances WHERE employee_id=? AND company_id=? ORDER BY effective_from DESC`).bind(employee.id,cid(c)).all();
  out.career=await c.env.DB.prepare(`SELECT h.*,ou.name_ar organization_unit_name,p.title_ar position_name FROM employee_career_history h LEFT JOIN organization_units ou ON ou.id=h.organization_unit_id AND ou.company_id=h.company_id LEFT JOIN positions p ON p.id=h.position_id AND p.company_id=h.company_id WHERE h.employee_id=? AND h.company_id=? ORDER BY h.effective_date DESC,h.created_at DESC`).bind(employee.id,cid(c)).all();
  const fields=await c.env.DB.prepare(`SELECT d.id,d.field_key,d.label_ar,d.label_en,d.field_type,d.options_json,d.required,v.value_text FROM employee_field_definitions d LEFT JOIN employee_field_values v ON v.field_definition_id=d.id AND v.employee_id=? WHERE d.company_id=? AND d.active=1 ORDER BY d.sort_order,d.label_ar`).bind(employee.id,cid(c)).all();
  out.customFields=fields.results.map((x:any)=>({...x,options:x.options_json?JSON.parse(x.options_json):[]}));
  out.capabilities={edit:await allowed(c,'employee.edit','employees.edit'),viewSalary:await sensitiveAllowed(c,'employee.view_salary','salary.view'),editSalary:await sensitiveAllowed(c,'employee.edit_salary'),viewBank:await sensitiveAllowed(c,'employee.view_bank'),viewGosi:await sensitiveAllowed(c,'employee.view_gosi'),viewIdentity:await sensitiveAllowed(c,'employee.view_identity'),viewSensitive:await sensitiveAllowed(c,'employee.view_sensitive_data')};
  return c.json(out);
});

app.patch('/:id',async c=>{
  const before=await employeeById(c,c.req.param('id')); if(!before)return errorResponse(c,'EMP-010',404);
  if(!(await allowed(c,'employee.edit','employees.edit')))return errorResponse(c,'EMP-006',403);
  if(!(await canViewEmployee(c,before,'employee.edit','employees.edit')))return errorResponse(c,'EMP-006',403);
  const p=employeeSchema.partial().omit({employeeNumber:true,createAccount:true}).safeParse(await c.req.json().catch(()=>null)); if(!p.success)return errorResponse(c,'EMP-001',400);
  const d=p.data as any,companyId=cid(c); const unitId=d.organizationUnitId===undefined?before.organization_unit_id:d.organizationUnitId; const positionId=d.positionId===undefined?before.position_id:d.positionId;
  if(!(await ensureUnit(c,unitId)))return errorResponse(c,'EMP-003',400); if(!(await ensurePosition(c,positionId,unitId)))return errorResponse(c,'EMP-004',400);
  if(!(await ensureContractType(d.contractType===undefined?before.contract_type:d.contractType)))return errorResponse(c,'EMP-005',400);
  if(!(await ensureLeavePolicy(d.leavePolicyId===undefined?before.leave_policy_id:d.leavePolicyId)))return errorResponse(c,'EMP-005',400);
  const managerId=d.positionId===undefined?before.manager_employee_id:await deriveManager(c,positionId);
  const probationDays=Math.min(180,d.probationDays??before.probation_days??180),extension=Math.max(0,d.probationExtensionDays??before.probation_extension_days??0); const actualStart=d.actualStartDate===undefined?before.actual_start_date:d.actualStartDate; const probationEnd=actualStart?new Date(new Date(actualStart+'T00:00:00Z').getTime()+(probationDays+extension-1)*86400000).toISOString().slice(0,10):null;
  const fields:any[]=[];const values:any[]=[];const map:any={firstName:'first_name',fatherName:'father_name',familyName:'family_name',nationality:'nationality',gender:'gender',dateOfBirth:'date_of_birth',nationalId:'national_id',identityType:'identity_type',identityIssueDate:'identity_issue_date',identityIssuer:'identity_issuer',passportNumber:'passport_number',passportIssueDate:'passport_issue_date',passportExpiryDate:'passport_expiry_date',personalPhone:'personal_phone',personalEmail:'personal_email',shortAddress:'short_address',photoUrl:'photo_url',jobTitle:'job_title',organizationUnitId:'organization_unit_id',positionId:'position_id',workLocation:'work_location',employmentType:'employment_type',contractType:'contract_type',contractStartDate:'contract_start_date',contractEndDate:'contract_end_date',contractAutoRenew:'contract_auto_renew',status:'status',joinDate:'join_date',actualStartDate:'actual_start_date',probationDays:'probation_days',probationExtensionDays:'probation_extension_days',gosiNumber:'gosi_number',residencyClassification:'residency_classification',insuranceProfile:'insurance_profile',professionalHazard:'professional_hazard',leavePolicyId:'leave_policy_id'};
  for(const [k,col] of Object.entries(map)){if(d[k]!==undefined){fields.push(`${col}=?`);values.push(typeof d[k]==='boolean'?(d[k]?1:0):d[k]??null);}}
  if(d.positionId!==undefined){fields.push('manager_employee_id=?');values.push(managerId);}
  if(d.probationDays!==undefined||d.probationExtensionDays!==undefined||d.actualStartDate!==undefined){fields.push('probation_end_date=?');values.push(probationEnd);}
  fields.push('updated_at=CURRENT_TIMESTAMP');values.push(c.req.param('id'),companyId);
  try{await c.env.DB.prepare(`UPDATE employees SET ${fields.join(',')} WHERE id=? AND company_id=?`).bind(...values).run();if(before.position_id&&(before.position_id!==positionId||d.status==='terminated'))await c.env.DB.prepare(`UPDATE positions SET status='vacant',updated_at=CURRENT_TIMESTAMP WHERE id=? AND company_id=?`).bind(before.position_id,companyId).run();if(positionId&&before.position_id!==positionId&&d.status!=='terminated')await c.env.DB.prepare(`UPDATE positions SET status='occupied',updated_at=CURRENT_TIMESTAMP WHERE id=? AND company_id=?`).bind(positionId,companyId).run();if(positionId&&before.status==='terminated'&&d.status&&d.status!=='terminated')await c.env.DB.prepare(`UPDATE positions SET status='occupied',updated_at=CURRENT_TIMESTAMP WHERE id=? AND company_id=?`).bind(positionId,companyId).run();}catch(e){if(String(e).includes('UNIQUE constraint failed: employees.company_id, employees.employee_number'))return errorResponse(c,'EMP-002',409);return errorResponse(c,'DB-001',500,e);}
  const after=await employeeById(c,c.req.param('id')); const careerChanged=['organization_unit_id','position_id','job_title','manager_employee_id'].some((k:string)=>before[k]!==after?.[k]); if(careerChanged&&after){await c.env.DB.prepare(`INSERT INTO employee_career_history(id,company_id,employee_id,change_type,effective_date,organization_unit_id,position_id,job_title,manager_employee_id,notes) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),companyId,before.id,'employment_change',after.actual_start_date||new Date().toISOString().slice(0,10),after.organization_unit_id,after.position_id,after.job_title,after.manager_employee_id,'تغيير وظيفي/تنظيمي').run();} await audit(c,'employee_updated','employee',c.req.param('id'),{before,after}); return c.json({ok:true,employee:after});
});

app.post('/:id/salary',async c=>{
  const employee=await employeeById(c,c.req.param('id'));if(!employee)return errorResponse(c,'EMP-010',404);if(!(await sensitiveAllowed(c,'employee.edit_salary')))return errorResponse(c,'SAL-001',403);if(!(await canViewEmployee(c,employee,'employee.edit_salary','salary.view')))return errorResponse(c,'SAL-001',403);
  const p=salarySchema.safeParse(await c.req.json().catch(()=>null));if(!p.success)return errorResponse(c,'SAL-001',400);const id=crypto.randomUUID();
  try{await c.env.DB.prepare(`INSERT INTO employee_salary_history(id,company_id,employee_id,basic_salary,housing_allowance,transport_allowance,other_allowances,effective_date) VALUES(?,?,?,?,?,?,?,?)`).bind(id,cid(c),employee.id,p.data.basicSalary,p.data.housingAllowance,p.data.transportAllowance,p.data.otherAllowances,p.data.effectiveDate).run();}catch(e){return errorResponse(c,'DB-001',500,e);}const previous=await c.env.DB.prepare(`SELECT * FROM employee_salary_history WHERE employee_id=? AND id<>? ORDER BY effective_date DESC LIMIT 1`).bind(employee.id,id).first(); await c.env.DB.prepare(`INSERT INTO employee_career_history(id,company_id,employee_id,change_type,effective_date,salary_history_id,notes) VALUES(?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),cid(c),employee.id,'salary_change',p.data.effectiveDate,id,'تغيير راتب').run(); await audit(c,'employee_salary_changed','employee',employee.id,{before:previous,after:p.data});return c.json({ok:true,id},201);
});

app.post('/:id/bank',async c=>{
  const employee=await employeeById(c,c.req.param('id'));if(!employee)return errorResponse(c,'EMP-010',404);if(!(await sensitiveAllowed(c,'employee.edit','employees.edit')))return errorResponse(c,'BANK-001',403);if(!(await canViewEmployee(c,employee,'employee.edit','employees.edit')))return errorResponse(c,'BANK-001',403);const p=bankSchema.safeParse(await c.req.json().catch(()=>null));if(!p.success)return errorResponse(c,'BANK-001',400);const id=crypto.randomUUID();try{await c.env.DB.batch([c.env.DB.prepare(`UPDATE employee_bank_accounts SET active=0,updated_at=CURRENT_TIMESTAMP WHERE employee_id=? AND company_id=? AND active=1`).bind(employee.id,cid(c)),c.env.DB.prepare(`INSERT INTO employee_bank_accounts(id,company_id,employee_id,bank_name,iban,account_holder_name,active) VALUES(?,?,?,?,?,?,1)`).bind(id,cid(c),employee.id,p.data.bankName,p.data.iban,p.data.accountHolderName??null)]);}catch(e){return errorResponse(c,'BANK-001',400,e);}await audit(c,'employee_bank_changed','employee',employee.id,{after:{...p.data,iban:'[PROTECTED]'}});return c.json({ok:true,id},201);
});

app.post('/:id/statutory',async c=>{const employee=await employeeById(c,c.req.param('id'));if(!employee)return errorResponse(c,'EMP-010',404);if(!(await allowed(c,'employee.edit','employees.edit')))return errorResponse(c,'GOSI-001',403);const b=await c.req.json().catch(()=>null) as any;const gosi=typeof b?.gosiNumber==='string'?b.gosiNumber.trim():null;const insuranceNumber=typeof b?.insuranceNumber==='string'?b.insuranceNumber.trim():null;const provider=typeof b?.insuranceProvider==='string'?b.insuranceProvider.trim():null;const insuranceClass=typeof b?.insuranceClass==='string'?b.insuranceClass.trim():null;const hazard=Boolean(b?.professionalHazard);await c.env.DB.prepare(`INSERT INTO employee_statutory_profiles(id,company_id,employee_id,gosi_number,insurance_number,insurance_provider,insurance_class,professional_hazard) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(employee_id) DO UPDATE SET gosi_number=excluded.gosi_number,insurance_number=excluded.insurance_number,insurance_provider=excluded.insurance_provider,insurance_class=excluded.insurance_class,professional_hazard=excluded.professional_hazard,updated_at=CURRENT_TIMESTAMP`).bind(crypto.randomUUID(),cid(c),employee.id,gosi,insuranceNumber,provider,insuranceClass,hazard?1:0).run();await audit(c,'employee_statutory_changed','employee',employee.id,{after:{gosiNumber:gosi,insuranceNumber:insuranceNumber?'[PROTECTED]':null,insuranceProvider:provider,insuranceClass,professionalHazard:hazard}});return c.json({ok:true});});

app.post('/:id/fields',async c=>{const employee=await employeeById(c,c.req.param('id'));if(!employee)return errorResponse(c,'EMP-010',404);if(!(await allowed(c,'employee.edit','employees.edit')))return errorResponse(c,'EMP-006',403);const body=await c.req.json().catch(()=>null) as any;const values=body?.values&&typeof body.values==='object'?body.values:{};const defs=await c.env.DB.prepare(`SELECT id,field_key FROM employee_field_definitions WHERE company_id=? AND active=1`).bind(cid(c)).all<any>();const statements=defs.results.filter((d:any)=>Object.prototype.hasOwnProperty.call(values,d.field_key)).map((d:any)=>c.env.DB.prepare(`INSERT INTO employee_field_values(employee_id,field_definition_id,value_text) VALUES(?,?,?) ON CONFLICT(employee_id,field_definition_id) DO UPDATE SET value_text=excluded.value_text,updated_at=CURRENT_TIMESTAMP`).bind(employee.id,d.id,values[d.field_key]===null?null:String(values[d.field_key])));if(statements.length)await c.env.DB.batch(statements);await audit(c,'employee_custom_fields_changed','employee',employee.id,{fields:Object.keys(values)});return c.json({ok:true});});

app.post('/:id/leave-balance',async c=>{const employee=await employeeById(c,c.req.param('id'));if(!employee)return errorResponse(c,'EMP-010',404);if(!(await allowed(c,'employee.edit','employees.edit')))return errorResponse(c,'EMP-006',403);const b=await c.req.json().catch(()=>null) as any;if(!b?.leaveType||b?.balanceDays===undefined||!b?.effectiveFrom)return errorResponse(c,'EMP-001',400);const id=crypto.randomUUID();await c.env.DB.prepare(`INSERT INTO employee_leave_balances(id,company_id,employee_id,leave_type,balance_days,effective_from,effective_to) VALUES(?,?,?,?,?,?,?)`).bind(id,cid(c),employee.id,String(b.leaveType),Number(b.balanceDays),String(b.effectiveFrom),b.effectiveTo||null).run();await audit(c,'employee_leave_balance_changed','employee',employee.id,{after:b});return c.json({ok:true,id},201);});

app.post('/:id/probation/decision',async c=>{const employee=await employeeById(c,c.req.param('id'));if(!employee)return errorResponse(c,'EMP-010',404);if(!(await allowed(c,'employee.edit','employees.edit')))return errorResponse(c,'EMP-006',403);const body=await c.req.json().catch(()=>null) as any;if(!['passed','failed'].includes(body?.result))return errorResponse(c,'EMP-001',400);await c.env.DB.prepare(`UPDATE employees SET probation_result=?,probation_decision_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND company_id=?`).bind(body.result,employee.id,cid(c)).run();await audit(c,'employee_probation_decision','employee',employee.id,{before:{result:employee.probation_result},after:{result:body.result}});return c.json({ok:true});});

export async function processProbation(env: Env['Bindings']){
  const reminders=await env.DB.prepare(`SELECT e.id,e.company_id,e.first_name,e.family_name,e.employee_number,e.probation_end_date,cu.id manager_user_id FROM employees e LEFT JOIN employees m ON m.id=e.manager_employee_id AND m.company_id=e.company_id LEFT JOIN company_users cu ON cu.employee_id=m.id AND cu.company_id=e.company_id AND cu.status='active' WHERE e.status<>'terminated' AND e.actual_start_date IS NOT NULL AND e.probation_end_date IS NOT NULL AND e.probation_result IS NULL AND date(e.probation_end_date)=date('now','+2 day')`).all<any>();
  for(const e of reminders.results){if(e.manager_user_id){const exists=await env.DB.prepare(`SELECT id FROM notifications WHERE company_id=? AND user_id=? AND type='employee_probation' AND date(created_at)=date('now') AND body_ar LIKE ? LIMIT 1`).bind(e.company_id,e.manager_user_id,`%${e.employee_number}%`).first();if(!exists){await env.DB.prepare(`INSERT INTO notifications(id,company_id,user_id,title_ar,body_ar,type) VALUES(?,?,?,?,?,'employee_probation')`).bind(crypto.randomUUID(),e.company_id,e.manager_user_id,'تنبيه فترة تجربة',`يتبقى يومان على نهاية فترة تجربة الموظف ${e.first_name||''} ${e.family_name||''} (${e.employee_number}).`).run();}}}
  const rows=await env.DB.prepare(`SELECT id,company_id FROM employees WHERE status<>'terminated' AND actual_start_date IS NOT NULL AND probation_end_date IS NOT NULL AND probation_result IS NULL AND date(probation_end_date)<=date('now')`).all<any>();
  for(const e of rows.results){await env.DB.prepare(`UPDATE employees SET probation_result='passed',probation_decision_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND company_id=? AND probation_result IS NULL`).bind(e.id,e.company_id).run();await env.DB.prepare(`INSERT INTO audit_logs(id,company_id,actor_type,action,resource,resource_id,metadata_json) VALUES(?,?,'system','employee_probation_auto_passed','employee',?,?)`).bind(crypto.randomUUID(),e.company_id,e.id,JSON.stringify({after:{probationResult:'passed',reason:'deadline'}})).run();}
}

export default app;
