import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { audit } from '../audit';
import { hasPermission } from '../authorization';
import { errorResponse } from '../errors';
import { requireAuthentication, requirePasswordChanged, requireSuperAdmin } from '../middleware/session';

const app = new Hono<Env>();

const responsibilityTypes = ['employee_owner','direct_manager','department_manager','position_holder','role','permission','company_admin','specific_user'] as const;
const fieldTypes = ['text','textarea','number','date','datetime','boolean','select','multiselect','employee','organization_unit','position','user'] as const;
const actionTypes = ['next','return','complete','reject','cancel'] as const;

const typeSchema = z.object({
  nameAr: z.string().trim().min(2).max(160),
  nameEn: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  allowedSubmitters: z.array(z.string().trim().min(1).max(200)).max(20).default(['self']),
});

const fieldSchema = z.object({
  id: z.string().uuid().optional(),
  stageId: z.string().uuid().nullable().optional(),
  fieldKey: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]{1,80}$/),
  labelAr: z.string().trim().min(1).max(160),
  labelEn: z.string().trim().max(160).nullable().optional(),
  fieldType: z.enum(fieldTypes),
  required: z.boolean().default(false),
  options: z.array(z.any()).optional(),
  config: z.record(z.any()).optional(),
  sortOrder: z.number().int().min(0).default(0),
  active: z.boolean().default(true),
});

const stageSchema = z.object({
  id: z.string().uuid().optional(),
  nameAr: z.string().trim().min(1).max(160),
  nameEn: z.string().trim().max(160).nullable().optional(),
  stageOrder: z.number().int().min(1),
  responsibleType: z.enum(responsibilityTypes),
  responsibleValue: z.string().trim().max(240).nullable().optional(),
  durationMinutes: z.number().int().min(1).max(525600).nullable().optional(),
  config: z.record(z.any()).optional(),
  active: z.boolean().default(true),
});

const transitionSchema = z.object({
  id: z.string().uuid().optional(),
  fromStageId: z.string().uuid(),
  toStageId: z.string().uuid().nullable().optional(),
  action: z.enum(actionTypes),
  labelAr: z.string().trim().min(1).max(160),
  condition: z.object({ fieldKey: z.string().trim().min(1), values: z.array(z.any()).min(1) }).nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
  active: z.boolean().default(true),
});

const workflowSchema = z.object({
  transactionTypeId: z.string().uuid(),
  description: z.string().trim().max(1000).nullable().optional(),
  allowedSubmitters: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  nameAr: z.string().trim().min(2).max(160).optional(),
  nameEn: z.string().trim().max(160).nullable().optional(),
  stages: z.array(stageSchema).min(1).max(100),
  fields: z.array(fieldSchema).max(300).default([]),
  transitions: z.array(transitionSchema).max(1000).default([]),
});

function json(value: any, fallback: any) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function actorId(c: any) {
  return c.get('session')?.platformUserId ?? null;
}

function sortStages(stages: any[]) {
  return [...stages].sort((a, b) => Number(a.stage_order ?? a.stageOrder) - Number(b.stage_order ?? b.stageOrder));
}

function asCondition(value: any) {
  if (!value) return null;
  if (typeof value === 'string') return json(value, null);
  return value;
}

function fieldHasOptions(field: any) {
  const options = Array.isArray(field?.options) ? field.options : json(field?.options_json, []);
  return Array.isArray(options) && options.length > 0;
}

function validateWorkflowShape(input: { stages: any[]; fields: any[]; transitions: any[]; allowedSubmitters?: any[] }) {
  const errors: Array<{ code: string; message: string; stageId?: string; fieldKey?: string; transitionId?: string }> = [];
  const warnings: Array<{ message: string; stageId?: string }> = [];
  if (Array.isArray(input.allowedSubmitters) && input.allowedSubmitters.length === 0) errors.push({ code: 'NO_SUBMITTER', message: 'حدد من يمكنه تقديم المعاملة.' });
  const stages = sortStages(input.stages);
  const stageIds = new Set(stages.map((s: any) => s.id));
  const stageOrder = new Map(stages.map((s: any) => [s.id, Number(s.stage_order ?? s.stageOrder)]));

  stages.forEach((stage: any, index: number) => {
    const order = Number(stage.stage_order ?? stage.stageOrder);
    if (order !== index + 1) errors.push({ code: 'STAGE_ORDER', message: 'رتّب المراحل بالتسلسل الصحيح.', stageId: stage.id });
    if (!String(stage.name_ar ?? stage.nameAr ?? '').trim()) errors.push({ code: 'STAGE_NAME', message: 'اسم المرحلة مطلوب.', stageId: stage.id });
    const responsibleType = stage.responsible_type ?? stage.responsibleType;
    if (!responsibilityTypes.includes(responsibleType as any)) errors.push({ code: 'RESPONSIBILITY', message: 'حدد مسؤول المرحلة.', stageId: stage.id });
    if (['role','permission','specific_user'].includes(responsibleType) && !String(stage.responsible_value ?? stage.responsibleValue ?? '').trim()) errors.push({ code: 'RESPONSIBILITY_VALUE', message: 'حدد قيمة المسؤول عن هذه المرحلة.', stageId: stage.id });
    const duration = stage.duration_minutes ?? stage.durationMinutes;
    if (duration !== null && duration !== undefined && (!Number.isInteger(Number(duration)) || Number(duration) < 1)) {
      errors.push({ code: 'STAGE_DURATION', message: 'مدة المرحلة يجب أن تكون دقيقة واحدة على الأقل.', stageId: stage.id });
    }
  });

  const fieldMap = new Map<string, any>();
  for (const field of input.fields) {
    const key = String(field.field_key ?? field.fieldKey ?? '');
    if (!key) continue;
    if (fieldMap.has(key)) errors.push({ code: 'DUPLICATE_FIELD', message: 'يوجد عنصر آخر يستخدم نفس المفتاح الداخلي.', stageId: field.stage_id ?? field.stageId ?? undefined, fieldKey: key });
    fieldMap.set(key, field);
    const label = String(field.label_ar ?? field.labelAr ?? '').trim();
    if (!label) errors.push({ code: 'FIELD_LABEL', message: 'اسم العنصر مطلوب.', stageId: field.stage_id ?? field.stageId ?? undefined, fieldKey: key });
    const type = field.field_type ?? field.fieldType;
    if (!fieldTypes.includes(type)) errors.push({ code: 'FIELD_TYPE', message: 'نوع العنصر غير صالح.', stageId: field.stage_id ?? field.stageId ?? undefined, fieldKey: key });
    const stageId = field.stage_id ?? field.stageId ?? null;
    if (stageId && !stageIds.has(stageId)) errors.push({ code: 'FIELD_STAGE', message: 'العنصر مرتبط بمرحلة غير موجودة.', stageId, fieldKey: key });
    if (['select', 'multiselect'].includes(type) && !fieldHasOptions(field)) errors.push({ code: 'FIELD_OPTIONS', message: 'أضف القيم التي يمكن الاختيار منها.', stageId: stageId ?? undefined, fieldKey: key });
    const fieldConfig = field?.config && typeof field.config === 'object' ? field.config : json(field?.config_json, {});
    if (fieldConfig?.displayOnly && Number(field.required ?? 0) === 1) errors.push({ code: 'FIELD_READONLY_REQUIRED', message: 'عنصر العرض فقط لا يمكن أن يكون مطلوبًا.', stageId: stageId ?? undefined, fieldKey: key });
  }

  const routesByStage = new Map<string, any[]>();
  for (const route of input.transitions) {
    if (route.active === 0 || route.active === false) continue;
    const from = route.from_stage_id ?? route.fromStageId;
    const to = route.to_stage_id ?? route.toStageId ?? null;
    const action = route.action;
    const condition = asCondition(route.condition_json ?? route.condition);
    if (!stageIds.has(from)) {
      errors.push({ code: 'TRANSITION_FROM', message: 'المسار مرتبط بمرحلة غير موجودة.', stageId: from, transitionId: route.id });
      continue;
    }
    if (!routesByStage.has(from)) routesByStage.set(from, []);
    routesByStage.get(from)!.push(route);
    const fromOrder = Number(stageOrder.get(from) ?? 0);
    const toOrder = Number(stageOrder.get(to) ?? 0);

    if (['next', 'return'].includes(action as string)) {
      if (!to) errors.push({ code: 'TRANSITION_TARGET', message: action === 'next' ? 'حدد المرحلة التالية.' : 'حدد المرحلة التي ستعود إليها.', stageId: from, transitionId: route.id });
      else if (!stageIds.has(to)) errors.push({ code: 'TRANSITION_TO', message: 'وجهة المسار غير موجودة.', stageId: from, transitionId: route.id });
      else if (action === 'next' && toOrder <= fromOrder) errors.push({ code: 'TRANSITION_DIRECTION', message: 'مسار الانتقال يجب أن يتجه إلى مرحلة لاحقة.', stageId: from, transitionId: route.id });
      else if (action === 'return' && toOrder >= fromOrder) errors.push({ code: 'TRANSITION_DIRECTION', message: 'مسار الرجوع يجب أن يتجه إلى مرحلة سابقة.', stageId: from, transitionId: route.id });
    } else if (to) {
      errors.push({ code: 'TERMINAL_TARGET', message: 'الأثر النهائي لا يحتاج مرحلة وجهة.', stageId: from, transitionId: route.id });
    }

    if (condition) {
      const key = String(condition.fieldKey ?? '');
      const values = Array.isArray(condition.values) ? condition.values.filter((v: any) => String(v).trim() !== '') : [];
      if (!key) errors.push({ code: 'CONDITION_FIELD', message: 'حدد حقل الشرط.', stageId: from, transitionId: route.id });
      if (!values.length) errors.push({ code: 'CONDITION_VALUE', message: 'حدد قيمة الشرط.', stageId: from, transitionId: route.id });
      const field = fieldMap.get(key);
      if (key && !field) errors.push({ code: 'CONDITION_SOURCE', message: 'حقل الشرط غير موجود.', stageId: from, transitionId: route.id });
      if (field) {
        const sourceStage = field.stage_id ?? field.stageId ?? null;
        const currentOrder = Number(stageOrder.get(from) ?? 0);
        const sourceOrder = sourceStage ? Number(stageOrder.get(sourceStage) ?? 0) : 0;
        if (sourceStage && sourceOrder > currentOrder) errors.push({ code: 'CONDITION_FUTURE', message: 'لا يمكن أن يعتمد الشرط على مرحلة لم تُنفذ بعد.', stageId: from, transitionId: route.id });
        if (['select', 'multiselect'].includes(field.field_type ?? field.fieldType)) {
          const options = Array.isArray(field.options) ? field.options : json(field.options_json, []);
          if (Array.isArray(options) && options.length && values.some((v: any) => !options.map((x: any) => String(x)).includes(String(v)))) {
            errors.push({ code: 'CONDITION_OPTION', message: 'قيمة الشرط غير موجودة ضمن خيارات العنصر.', stageId: from, transitionId: route.id });
          }
        }
      }
    }
  }

  stages.forEach((stage: any, index: number) => {
    const routes = (routesByStage.get(stage.id) ?? []).filter((route: any) => route.active !== 0);
    const hasForward = routes.some((route: any) => route.action === 'next' && route.to_stage_id);
    const hasTerminal = routes.some((route: any) => ['complete', 'reject', 'cancel'].includes(route.action));
    const defaults = routes.filter((route: any) => !asCondition(route.condition_json ?? route.condition));
    const conditionals = routes.filter((route: any) => asCondition(route.condition_json ?? route.condition));

    // The final configured stage is not a special stage type and does not need a
    // stored "completion" route. Passing it successfully completes the transaction
    // automatically; explicit conditional reject/cancel/return/complete routes may
    // still override that behavior.
    if (index < stages.length - 1) {
      if (!routes.length) errors.push({ code: 'NO_ROUTE', message: 'حدد أثر التمرير لهذه المرحلة.', stageId: stage.id });
      if (!hasForward && !hasTerminal) errors.push({ code: 'NO_FORWARD', message: 'حدد المرحلة التالية أو أثرًا نهائيًا.', stageId: stage.id });
      if (conditionals.length && !defaults.length) errors.push({ code: 'CONDITION_FALLBACK', message: 'المسارات المشروطة تحتاج مسارًا افتراضيًا يحدد المرحلة التالية.', stageId: stage.id });
    } else {
      if (routes.some((route: any) => route.action === 'next')) errors.push({ code: 'LAST_NEXT', message: 'لا يمكن لآخر مرحلة فعلية الانتقال إلى مرحلة تالية.', stageId: stage.id });
      if (defaults.length > 1) errors.push({ code: 'MULTIPLE_DEFAULT', message: 'يجب أن يكون للمرحلة مسار افتراضي واحد فقط.', stageId: stage.id });
      // With no default route, the engine's implicit outcome is "مكتملة".
      // Conditional routes are therefore allowed without a fallback route.
    }
    if (index < stages.length - 1 && defaults.length > 1) errors.push({ code: 'MULTIPLE_DEFAULT', message: 'يجب أن يكون للمرحلة مسار افتراضي واحد فقط.', stageId: stage.id });
  });

  return { valid: errors.length === 0, errors, warnings };
}

async function loadWorkflow(c: any, workflowId: string) {
  const workflow = await c.env.DB.prepare(`
    SELECT wd.*, tt.name_ar transaction_type_name, tt.name_en transaction_type_name_en,
           tt.description transaction_type_description, tt.status transaction_type_status
    FROM workflow_definitions wd
    JOIN transaction_types tt ON tt.id=wd.transaction_type_id
    WHERE wd.id=? AND tt.company_id IS NULL
  `).bind(workflowId).first<any>();
  if (!workflow) return null;

  const [stages, fields, transitions] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM workflow_stages WHERE workflow_id=? AND active=1 ORDER BY stage_order`).bind(workflowId).all<any>(),
    c.env.DB.prepare(`SELECT * FROM workflow_fields WHERE workflow_id=? AND active=1 ORDER BY CASE WHEN stage_id IS NULL THEN 0 ELSE 1 END, stage_id, sort_order, id`).bind(workflowId).all<any>(),
    c.env.DB.prepare(`SELECT * FROM workflow_transitions WHERE workflow_id=? AND active=1 ORDER BY from_stage_id,sort_order,id`).bind(workflowId).all<any>(),
  ]);

  return {
    workflow: { ...workflow, allowed_submitters: json(workflow.allowed_submitters_json, []) },
    stages: stages.results.map((row: any) => ({ ...row, config: json(row.config_json, {}) })),
    fields: fields.results.map((row: any) => ({ ...row, options: json(row.options_json, []), config: json(row.config_json, {}) })),
    transitions: transitions.results.map((row: any) => ({ ...row, condition: json(row.condition_json, null) })),
  };
}

async function globalType(c: any, id: string) {
  return c.env.DB.prepare(`SELECT * FROM transaction_types WHERE id=? AND company_id IS NULL`).bind(id).first<any>();
}

app.use('/admin/*', requireAuthentication, requirePasswordChanged, requireSuperAdmin);
app.use('/test/*', requireAuthentication, requirePasswordChanged, requireSuperAdmin);

app.get('/admin/types', async c => {
  const rows = await c.env.DB.prepare(`
    SELECT tt.id,tt.name_ar,tt.name_en,tt.description,tt.status,tt.created_at,tt.updated_at,
      (SELECT MAX(version) FROM workflow_definitions wd WHERE wd.transaction_type_id=tt.id) latest_version,
      (SELECT version FROM workflow_definitions wd WHERE wd.transaction_type_id=tt.id AND wd.status='active' ORDER BY version DESC LIMIT 1) active_version,
      (SELECT id FROM workflow_definitions wd WHERE wd.transaction_type_id=tt.id AND wd.status='draft' ORDER BY version DESC LIMIT 1) draft_id,
      (SELECT COUNT(*) FROM workflow_stages ws JOIN workflow_definitions wd2 ON wd2.id=ws.workflow_id WHERE wd2.transaction_type_id=tt.id AND wd2.version=(SELECT MAX(version) FROM workflow_definitions z WHERE z.transaction_type_id=tt.id) AND ws.active=1) stage_count,
      (SELECT COUNT(*) FROM workflow_fields wf JOIN workflow_definitions wd3 ON wd3.id=wf.workflow_id WHERE wd3.transaction_type_id=tt.id AND wd3.version=(SELECT MAX(version) FROM workflow_definitions z2 WHERE z2.transaction_type_id=tt.id) AND wf.stage_id IS NULL AND wf.active=1) requester_field_count
    FROM transaction_types tt
    WHERE tt.company_id IS NULL
    ORDER BY tt.updated_at DESC,tt.name_ar
  `).all<any>();
  return c.json({ items: rows.results });
});

app.post('/admin/types', async c => {
  const parsed = typeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return errorResponse(c, 'WORKFLOW-001', 400);
  const d = parsed.data;
  const duplicate = await c.env.DB.prepare(`
    SELECT id FROM transaction_types
    WHERE company_id IS NULL AND TRIM(name_ar)=TRIM(?)
    LIMIT 1
  `).bind(d.nameAr).first<any>();
  if (duplicate) return errorResponse(c, 'WORKFLOW-007', 409);

  const typeId = crypto.randomUUID();
  const workflowId = crypto.randomUUID();
  const stageId = crypto.randomUUID();
  const actor = actorId(c);
  try {
    await c.env.DB.batch([
      // A new template is not usable until its workflow is approved.
      c.env.DB.prepare(`INSERT INTO transaction_types(id,company_id,name_ar,name_en,description,status,created_by,updated_by) VALUES(?,?,?,?,?,'inactive',?,?)`).bind(typeId, null, d.nameAr, d.nameEn ?? null, d.description ?? null, actor, actor),
      c.env.DB.prepare(`INSERT INTO workflow_definitions(id,transaction_type_id,version,description,allowed_submitters_json,status,created_by,updated_by) VALUES(?,?,?,?,?,'draft',?,?)`).bind(workflowId, typeId, 1, d.description ?? null, JSON.stringify(d.allowedSubmitters?.length ? d.allowedSubmitters : ['self']), actor, actor, actor),
      c.env.DB.prepare(`INSERT INTO workflow_stages(id,workflow_id,name_ar,name_en,stage_order,responsible_type,responsible_value,duration_minutes,config_json,active) VALUES(?,?,?,?,1,'company_admin',NULL,NULL,?,1)`).bind(stageId, workflowId, 'المرحلة 1', 'Stage 1', JSON.stringify({ employeeFeedback: false })),
    ]);
  } catch (e) {
    const message = String((e as any)?.message || e || '');
    if (/UNIQUE constraint failed.*transaction_types/i.test(message) || /ux_transaction_types_scope_name/i.test(message)) {
      return errorResponse(c, 'WORKFLOW-007', 409, e);
    }
    return errorResponse(c, 'WORKFLOW-005', 500, e);
  }
  await audit(c, 'workflow_template_created', 'transaction_type', typeId, { nameAr: d.nameAr, workflowId, version: 1 });
  return c.json({ ok: true, id: typeId, workflowId });
});

app.patch('/admin/types/:id', async c => {
  const parsed = typeSchema.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return errorResponse(c, 'WORKFLOW-001', 400);
  if (!await globalType(c, c.req.param('id'))) return errorResponse(c, 'WORKFLOW-003', 404);
  const d = parsed.data;
  if (d.nameAr !== undefined) {
    const duplicate = await c.env.DB.prepare(`
      SELECT id FROM transaction_types
      WHERE company_id IS NULL AND TRIM(name_ar)=TRIM(?) AND id<>?
      LIMIT 1
    `).bind(d.nameAr, c.req.param('id')).first<any>();
    if (duplicate) return errorResponse(c, 'WORKFLOW-007', 409);
  }
  const sets: string[] = [];
  const values: any[] = [];
  if (d.nameAr !== undefined) { sets.push('name_ar=?'); values.push(d.nameAr); }
  if (d.nameEn !== undefined) { sets.push('name_en=?'); values.push(d.nameEn ?? null); }
  if (d.description !== undefined) { sets.push('description=?'); values.push(d.description ?? null); }
  if (!sets.length) return c.json({ ok: true });
  sets.push('updated_at=CURRENT_TIMESTAMP', 'updated_by=?'); values.push(actorId(c), c.req.param('id'));
  try { await c.env.DB.prepare(`UPDATE transaction_types SET ${sets.join(',')} WHERE id=?`).bind(...values, c.req.param('id')).run(); }
  catch (e) { return errorResponse(c, 'WORKFLOW-002', 409, e); }
  await audit(c, 'workflow_template_updated', 'transaction_type', c.req.param('id'), { fields: Object.keys(d) });
  return c.json({ ok: true });
});

app.post('/admin/types/:id/new-draft', async c => {
  const typeId = c.req.param('id');
  const type = await globalType(c, typeId);
  if (!type) return errorResponse(c, 'WORKFLOW-003', 404);
  const existing = await c.env.DB.prepare(`SELECT id,version FROM workflow_definitions WHERE transaction_type_id=? AND status='draft' ORDER BY version DESC LIMIT 1`).bind(typeId).first<any>();
  if (existing) return c.json({ id: existing.id, existing: true, version: existing.version });
  const source = await c.env.DB.prepare(`SELECT * FROM workflow_definitions WHERE transaction_type_id=? AND status='active' ORDER BY version DESC LIMIT 1`).bind(typeId).first<any>();
  const version = Number((await c.env.DB.prepare(`SELECT COALESCE(MAX(version),0) version FROM workflow_definitions WHERE transaction_type_id=?`).bind(typeId).first<any>())?.version || 0) + 1;
  const workflowId = crypto.randomUUID();
  const actor = actorId(c);

  try {
    if (!source) {
      const stageId = crypto.randomUUID();
      await c.env.DB.batch([
        c.env.DB.prepare(`INSERT INTO workflow_definitions(id,transaction_type_id,version,description,allowed_submitters_json,status,created_by,updated_by) VALUES(?,?,?,?,?,'draft',?,?)`).bind(workflowId, typeId, version, type.description ?? null, JSON.stringify(['self']), actor, actor, actor),
        c.env.DB.prepare(`INSERT INTO workflow_stages(id,workflow_id,name_ar,name_en,stage_order,responsible_type,responsible_value,duration_minutes,config_json,active) VALUES(?,?,?,?,1,'company_admin',NULL,NULL,?,1)`).bind(stageId, workflowId, 'المرحلة 1', 'Stage 1', JSON.stringify({ employeeFeedback: false })),
      ]);
    } else {
      const srcStages = (await c.env.DB.prepare(`SELECT * FROM workflow_stages WHERE workflow_id=? ORDER BY stage_order`).bind(source.id).all<any>()).results;
      const stageMap = new Map<string, string>();
      for (const stage of srcStages) stageMap.set(stage.id, crypto.randomUUID());
      const statements: D1PreparedStatement[] = [
        c.env.DB.prepare(`INSERT INTO workflow_definitions(id,transaction_type_id,version,description,allowed_submitters_json,status,created_by,updated_by) VALUES(?,?,?,?,?,'draft',?,?)`).bind(workflowId, typeId, version, source.description, source.allowed_submitters_json, actor, actor, actor),
      ];
      for (const stage of srcStages) {
        statements.push(c.env.DB.prepare(`INSERT INTO workflow_stages(id,workflow_id,name_ar,name_en,stage_order,responsible_type,responsible_value,duration_minutes,config_json,active) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(stageMap.get(stage.id), workflowId, stage.name_ar, stage.name_en, stage.stage_order, stage.responsible_type, stage.responsible_value, stage.duration_minutes, stage.config_json, stage.active));
      }
      const srcFields = (await c.env.DB.prepare(`SELECT * FROM workflow_fields WHERE workflow_id=? ORDER BY sort_order,id`).bind(source.id).all<any>()).results;
      for (const field of srcFields) {
        statements.push(c.env.DB.prepare(`INSERT INTO workflow_fields(id,workflow_id,stage_id,field_key,label_ar,label_en,field_type,required,options_json,config_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), workflowId, field.stage_id ? stageMap.get(field.stage_id) ?? null : null, field.field_key, field.label_ar, field.label_en, field.field_type, field.required, field.options_json, field.config_json, field.sort_order, field.active));
      }
      const srcTransitions = (await c.env.DB.prepare(`SELECT * FROM workflow_transitions WHERE workflow_id=? ORDER BY from_stage_id,sort_order,id`).bind(source.id).all<any>()).results;
      for (const route of srcTransitions) {
        statements.push(c.env.DB.prepare(`INSERT INTO workflow_transitions(id,workflow_id,from_stage_id,to_stage_id,action,label_ar,condition_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), workflowId, stageMap.get(route.from_stage_id), route.to_stage_id ? stageMap.get(route.to_stage_id) ?? null : null, route.action, route.label_ar, route.condition_json, route.sort_order, route.active));
      }
      await c.env.DB.batch(statements);
    }
  } catch (e) {
    return errorResponse(c, 'WORKFLOW-005', 400, e);
  }
  await audit(c, 'workflow_draft_created', 'workflow', workflowId, { transactionTypeId: typeId, version });
  return c.json({ id: workflowId, existing: false, version });
});

app.get('/admin/types/:id', async c => {
  const type = await globalType(c, c.req.param('id'));
  if (!type) return errorResponse(c, 'WORKFLOW-003', 404);
  let workflowId = c.req.query('workflowId') || '';
  if (!workflowId) workflowId = (await c.env.DB.prepare(`SELECT id FROM workflow_definitions WHERE transaction_type_id=? AND status='draft' ORDER BY version DESC LIMIT 1`).bind(type.id).first<any>())?.id || '';
  if (!workflowId) workflowId = (await c.env.DB.prepare(`SELECT id FROM workflow_definitions WHERE transaction_type_id=? AND status='active' ORDER BY version DESC LIMIT 1`).bind(type.id).first<any>())?.id || '';
  if (!workflowId) return c.json({ type, workflow: null });
  const workflow = await loadWorkflow(c, workflowId);
  if (!workflow) return errorResponse(c, 'WORKFLOW-003', 404);
  return c.json({ type, workflow });
});

app.get('/admin/workflows/:id', async c => {
  const data = await loadWorkflow(c, c.req.param('id'));
  if (!data) return errorResponse(c, 'WORKFLOW-003', 404);
  return c.json(data);
});

app.put('/admin/workflows/:id', async c => {
  const workflowId = c.req.param('id');
  const parsed = workflowSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return errorResponse(c, 'WORKFLOW-001', 400);
  const data = parsed.data;
  const existing = await c.env.DB.prepare(`
    SELECT wd.* FROM workflow_definitions wd
    JOIN transaction_types tt ON tt.id=wd.transaction_type_id
    WHERE wd.id=? AND tt.company_id IS NULL
  `).bind(workflowId).first<any>();
  if (!existing) return errorResponse(c, 'WORKFLOW-003', 404);
  if (existing.status !== 'draft') return errorResponse(c, 'WORKFLOW-004', 409);
  if (existing.transaction_type_id !== data.transactionTypeId) return errorResponse(c, 'WORKFLOW-001', 400);

  if (data.nameAr !== undefined) {
    const duplicate = await c.env.DB.prepare(`
      SELECT id FROM transaction_types
      WHERE company_id IS NULL AND TRIM(name_ar)=TRIM(?) AND id<>? LIMIT 1
    `).bind(data.nameAr, existing.transaction_type_id).first<any>();
    if (duplicate) return errorResponse(c, 'WORKFLOW-007', 409);
  }

  const normalizedStageIds = data.stages.map(stage => stage.id || crypto.randomUUID());
  const stageIdSet = new Set(normalizedStageIds);
  const clientStageIds = new Map<string | undefined, string>();
  data.stages.forEach((stage, index) => clientStageIds.set(stage.id, normalizedStageIds[index]));
  const normalizedStages = data.stages.map((stage, index) => ({ ...stage, id: normalizedStageIds[index], stageOrder: index + 1 }));
  const actor = actorId(c);

  const shaped = {
    allowedSubmitters: data.allowedSubmitters,
    stages: normalizedStages.map((stage: any) => ({
      id: stage.id,
      stage_order: stage.stageOrder,
      name_ar: stage.nameAr,
      responsible_type: stage.responsibleType,
      responsible_value: stage.responsibleValue,
      duration_minutes: stage.durationMinutes,
    })),
    fields: data.fields.map((field: any) => ({
      id: field.id || crypto.randomUUID(),
      field_key: field.fieldKey,
      label_ar: field.labelAr,
      field_type: field.fieldType,
      required: field.required ? 1 : 0,
      options: field.options || [],
      config: field.config || {},
      stage_id: field.stageId ? clientStageIds.get(field.stageId) || field.stageId : null,
    })),
    transitions: data.transitions.map((route: any) => ({
      id: route.id || crypto.randomUUID(),
      from_stage_id: clientStageIds.get(route.fromStageId) || route.fromStageId,
      to_stage_id: route.toStageId ? clientStageIds.get(route.toStageId) || route.toStageId : null,
      action: route.action,
      condition_json: route.condition ? JSON.stringify(route.condition) : null,
      active: route.active ? 1 : 0,
    })),
  };

  if (shaped.stages.some((stage: any) => !stageIdSet.has(stage.id))) return errorResponse(c, 'WORKFLOW-001', 400);
  if (shaped.fields.some((field: any) => field.stage_id && !stageIdSet.has(field.stage_id))) return errorResponse(c, 'WORKFLOW-001', 400);
  if (shaped.transitions.some((route: any) => !stageIdSet.has(route.from_stage_id) || (route.to_stage_id && !stageIdSet.has(route.to_stage_id)))) return errorResponse(c, 'WORKFLOW-001', 400);

  const validation = validateWorkflowShape(shaped);
  // Draft saves are intentionally allowed while the designer is still building.
  // Approval remains the hard validation gate.

  try {
    const oldStages = (await c.env.DB.prepare(`SELECT id FROM workflow_stages WHERE workflow_id=?`).bind(workflowId).all<any>()).results;
    const oldStageIds = new Set(oldStages.map((row: any) => row.id));
    const removedStageIds = oldStages.map((row: any) => row.id).filter((id: string) => !stageIdSet.has(id));

    const oldFields = (await c.env.DB.prepare(`SELECT id,field_key FROM workflow_fields WHERE workflow_id=?`).bind(workflowId).all<any>()).results;
    const fieldIdSet = new Set(shaped.fields.map((field: any) => field.id));
    const oldFieldByKey = new Map(oldFields.map((row: any) => [row.field_key, row.id]));

    const statements: D1PreparedStatement[] = [
      // Avoid deleting stage rows: historical stage references can exist and must stay valid.
      // Move all existing orders out of the way first so reordering cannot hit UNIQUE(workflow_id,stage_order).
      ...oldStages.map((row: any, index: number) =>
        c.env.DB.prepare(`UPDATE workflow_stages SET stage_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workflow_id=?`).bind(-1000000 - index, row.id, workflowId)
      ),
      // Removed fields are retained but made inactive to preserve historical references.
      ...oldFields.map((row: any) =>
        !fieldIdSet.has(row.id)
          ? c.env.DB.prepare(`UPDATE workflow_fields SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workflow_id=?`).bind(row.id, workflowId)
          : c.env.DB.prepare(`UPDATE workflow_fields SET updated_at=CURRENT_TIMESTAMP WHERE id=? AND workflow_id=?`).bind(row.id, workflowId)
      ),
      ...removedStageIds.map((id: string, index: number) =>
        c.env.DB.prepare(`UPDATE workflow_stages SET active=0,stage_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND workflow_id=?`).bind(-2000000 - index, id, workflowId)
      ),
      c.env.DB.prepare(`UPDATE transaction_types SET name_ar=COALESCE(?,name_ar),name_en=CASE WHEN ?=1 THEN ? ELSE name_en END,description=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND company_id IS NULL`)
        .bind(data.nameAr ?? null, data.nameEn === undefined ? 0 : 1, data.nameEn ?? null, data.description ?? null, actor, existing.transaction_type_id),
      c.env.DB.prepare(`UPDATE workflow_definitions SET description=?,allowed_submitters_json=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .bind(data.description ?? null, JSON.stringify(data.allowedSubmitters || []), actor, workflowId),
      c.env.DB.prepare(`DELETE FROM workflow_transitions WHERE workflow_id=?`).bind(workflowId),
    ];

    for (const stage of normalizedStages) {
      if (oldStageIds.has(stage.id)) {
        statements.push(c.env.DB.prepare(`
          UPDATE workflow_stages
          SET name_ar=?,name_en=?,stage_order=?,responsible_type=?,responsible_value=?,duration_minutes=?,config_json=?,active=?,updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND workflow_id=?
        `).bind(stage.nameAr, stage.nameEn ?? null, stage.stageOrder, stage.responsibleType, stage.responsibleValue ?? null, stage.durationMinutes ?? null, JSON.stringify(stage.config ?? {}), stage.active ? 1 : 0, stage.id, workflowId));
      } else {
        statements.push(c.env.DB.prepare(`
          INSERT INTO workflow_stages(id,workflow_id,name_ar,name_en,stage_order,responsible_type,responsible_value,duration_minutes,config_json,active)
          VALUES(?,?,?,?,?,?,?,?,?,?)
        `).bind(stage.id, workflowId, stage.nameAr, stage.nameEn ?? null, stage.stageOrder, stage.responsibleType, stage.responsibleValue ?? null, stage.durationMinutes ?? null, JSON.stringify(stage.config ?? {}), stage.active ? 1 : 0));
      }
    }

    for (const field of shaped.fields as any[]) {
      const existingField = oldFields.find((row: any) => row.id === field.id) || oldFields.find((row: any) => row.id === oldFieldByKey.get(field.field_key));
      if (existingField) {
        const source = data.fields.find((f:any)=>f.id===field.id) || data.fields.find((f:any)=>f.fieldKey===field.field_key);
        statements.push(c.env.DB.prepare(`
          UPDATE workflow_fields
          SET stage_id=?,field_key=?,label_ar=?,label_en=?,field_type=?,required=?,options_json=?,config_json=?,sort_order=?,active=?,updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND workflow_id=?
        `).bind(field.stage_id, field.field_key, field.label_ar, source?.labelEn ?? null, field.field_type, field.required, JSON.stringify(field.options || []), JSON.stringify(field.config || {}), Number(source?.sortOrder || 0), field.active ?? 1, existingField.id, workflowId));
      } else {
        const source = data.fields.find((f:any)=>f.id===field.id);
        statements.push(c.env.DB.prepare(`
          INSERT INTO workflow_fields(id,workflow_id,stage_id,field_key,label_ar,label_en,field_type,required,options_json,config_json,sort_order,active)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
        `).bind(field.id, workflowId, field.stage_id, field.field_key, field.label_ar, source?.labelEn ?? null, field.field_type, field.required, JSON.stringify(field.options || []), JSON.stringify(field.config || {}), Number(source?.sortOrder || 0), source?.active === false ? 0 : 1));
      }
    }

    for (const route of shaped.transitions as any[]) {
      const source = data.transitions.find((r:any) => (r.id || null) === route.id);
      statements.push(c.env.DB.prepare(`
        INSERT INTO workflow_transitions(id,workflow_id,from_stage_id,to_stage_id,action,label_ar,condition_json,sort_order,active)
        VALUES(?,?,?,?,?,?,?,?,?)
      `).bind(route.id, workflowId, route.from_stage_id, route.to_stage_id, route.action, source?.labelAr || actionLabelsForStorage(route.action), route.condition_json, Number(source?.sortOrder || 0), route.active ? 1 : 0));
    }

    await c.env.DB.batch(statements);
  } catch (e) {
    const message=String((e as any)?.message||e||'');
    if(/no such table|no such column|has no column named/i.test(message)) return errorResponse(c,'WORKFLOW-009',500,e);
    if(/FOREIGN KEY constraint failed/i.test(message)) return errorResponse(c,'WORKFLOW-010',409,e);
    return errorResponse(c, 'WORKFLOW-005', 500, e);
  }
  await audit(c, 'workflow_draft_saved', 'workflow', workflowId, {
    transactionTypeId: data.transactionTypeId,
    version: existing.version,
    stageCount: data.stages.length,
    fieldCount: data.fields.length,
    transitionCount: data.transitions.length,
    validationErrorCount: validation.errors.length,
  });
  return c.json({ ok: true, validation });
});

function actionLabelsForStorage(action: string) {
  return ({ next: 'انتقال', return: 'إرجاع', complete: 'إكمال', reject: 'رفض', cancel: 'إلغاء' } as Record<string,string>)[action] || action;
}

app.post('/admin/workflows/:id/validate', async c => {
  const data = await loadWorkflow(c, c.req.param('id'));
  if (!data) return errorResponse(c, 'WORKFLOW-003', 404);
  return c.json(validateWorkflowShape({ allowedSubmitters: data.workflow.allowed_submitters, stages: data.stages, fields: data.fields, transitions: data.transitions.map((route: any) => ({ ...route, condition_json: route.condition ? JSON.stringify(route.condition) : null })) }));
});

app.post('/admin/workflows/:id/approve', async c => {
  const workflowId = c.req.param('id');
  const existing = await c.env.DB.prepare(`SELECT wd.*,tt.id type_id,tt.name_ar type_name FROM workflow_definitions wd JOIN transaction_types tt ON tt.id=wd.transaction_type_id WHERE wd.id=? AND tt.company_id IS NULL`).bind(workflowId).first<any>();
  if (!existing) return errorResponse(c, 'WORKFLOW-003', 404);
  if (existing.status !== 'draft') return errorResponse(c, 'WORKFLOW-004', 409);
  const data = await loadWorkflow(c, workflowId);
  if (!data) return errorResponse(c, 'WORKFLOW-003', 404);
  const validation = validateWorkflowShape({ allowedSubmitters: data.workflow.allowed_submitters, stages: data.stages, fields: data.fields, transitions: data.transitions.map((route: any) => ({ ...route, condition_json: route.condition ? JSON.stringify(route.condition) : null })) });
  if (!validation.valid) return c.json({ error: 'WORKFLOW_VALIDATION', message: 'لم تكتمل إعدادات سير العمل بعد.', validation }, 400);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE workflow_definitions SET status='inactive',updated_at=CURRENT_TIMESTAMP WHERE transaction_type_id=? AND status='active'`).bind(existing.transaction_type_id),
      c.env.DB.prepare(`UPDATE workflow_definitions SET status='active',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(actorId(c), workflowId),
      c.env.DB.prepare(`UPDATE transaction_types SET status='active',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(actorId(c), existing.transaction_type_id),
    ]);
  } catch (e) {
    return errorResponse(c, 'WORKFLOW-005', 400, e);
  }
  await audit(c, 'workflow_approved', 'workflow', workflowId, { transactionTypeId: existing.transaction_type_id, version: existing.version });
  return c.json({ ok: true, status: 'active', version: existing.version });
});

app.post('/admin/workflows/:id/deactivate', async c => {
  const existing = await c.env.DB.prepare(`SELECT wd.id,wd.transaction_type_id FROM workflow_definitions wd JOIN transaction_types tt ON tt.id=wd.transaction_type_id WHERE wd.id=? AND tt.company_id IS NULL`).bind(c.req.param('id')).first<any>();
  if (!existing) return errorResponse(c, 'WORKFLOW-003', 404);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE workflow_definitions SET status='inactive',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(actorId(c), existing.id),
    c.env.DB.prepare(`UPDATE transaction_types SET status='inactive',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(actorId(c), existing.transaction_type_id),
  ]);
  await audit(c, 'workflow_deactivated', 'workflow', existing.id, { transactionTypeId: existing.transaction_type_id });
  return c.json({ ok: true });
});


async function loadCompanyEmployee(c: any, employeeId: string) {
  return c.env.DB.prepare(`
    SELECT e.id,e.company_id,e.employee_number,e.first_name,e.father_name,e.family_name,e.job_title,
           e.organization_unit_id,e.manager_employee_id,e.position_id,e.status,
           ou.name_ar organization_unit_name,
           p.title_ar position_title
    FROM employees e
    LEFT JOIN organization_units ou ON ou.id=e.organization_unit_id AND ou.company_id=e.company_id
    LEFT JOIN positions p ON p.id=e.position_id AND p.company_id=e.company_id
    WHERE e.id=? AND e.company_id=?
  `).bind(employeeId, c.get('session')?.activeCompanyId).first<any>();
}

async function loadRequester(c: any) {
  const s = c.get('session');
  if (!s?.companyUserId || !s.activeCompanyId) return null;
  return c.env.DB.prepare(`
    SELECT cu.id user_id,cu.username,cu.display_name,cu.employee_id,
           e.employee_number,e.first_name,e.father_name,e.family_name,e.job_title,
           e.organization_unit_id,e.manager_employee_id,e.position_id,e.status employee_status,
           ou.name_ar organization_unit_name,p.title_ar position_title
    FROM company_users cu
    LEFT JOIN employees e ON e.id=cu.employee_id AND e.company_id=cu.company_id
    LEFT JOIN organization_units ou ON ou.id=e.organization_unit_id AND ou.company_id=cu.company_id
    LEFT JOIN positions p ON p.id=e.position_id AND p.company_id=cu.company_id
    WHERE cu.id=? AND cu.company_id=? AND cu.status='active'
  `).bind(s.companyUserId, s.activeCompanyId).first<any>();
}

function fullName(row: any) {
  return [row?.first_name,row?.father_name,row?.family_name].filter(Boolean).join(' ').trim() || row?.display_name || row?.username || null;
}

async function workflowAvailableForCompany(c: any, transactionTypeId: string) {
  const companyId = c.get('session')?.activeCompanyId;
  if (!companyId) return null;
  return c.env.DB.prepare(`
    SELECT tt.id type_id,tt.name_ar type_name,tt.description type_description,tt.status type_status,
           wd.id workflow_id,wd.version,wd.allowed_submitters_json
    FROM transaction_types tt
    JOIN transaction_type_companies ttc ON ttc.transaction_type_id=tt.id AND ttc.company_id=? AND ttc.active=1
    JOIN workflow_definitions wd ON wd.transaction_type_id=tt.id AND wd.status='active'
    WHERE tt.id=? AND tt.status='active'
    LIMIT 1
  `).bind(companyId, transactionTypeId).first<any>();
}

async function hasCompanyAdminRole(c: any) {
  const s=c.get('session');
  if(!s?.companyUserId||!s.activeCompanyId)return false;
  const row=await c.env.DB.prepare(`SELECT 1 x FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.company_user_id=? AND r.company_id=? AND r.code='company_admin' AND r.status='active' LIMIT 1`).bind(s.companyUserId,s.activeCompanyId).first<any>();
  return Boolean(row);
}

async function submitterAllowed(c: any, allowed: string[]) {
  const s=c.get('session');
  if (!s?.companyUserId) return false;
  if (allowed.includes('self')) return true;
  if (allowed.includes('company_admin') && await hasCompanyAdminRole(c)) return true;
  for (const item of allowed) {
    if (item.startsWith('permission:') && await (async()=>{
      const permission=item.slice('permission:'.length); return permission ? Boolean(await c.env.DB.prepare(`
        SELECT 1 x FROM user_permissions up
        WHERE up.company_user_id=? AND up.permission_id=? AND up.effect='allow'
        UNION ALL
        SELECT 1 x FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id
        WHERE ur.company_user_id=? AND rp.permission_id=?
        LIMIT 1
      `).bind(s.companyUserId,permission,s.companyUserId,permission).first<any>()) : false;
    })()) return true;
  }
  return false;
}

function dueAt(startedAt: string, minutes: number | null | undefined) {
  if (!minutes) return null;
  const t=new Date(startedAt).getTime()+Number(minutes)*60000;
  return new Date(t).toISOString();
}

function answerEmpty(value: any) {
  return value===undefined || value===null || value==='' || (Array.isArray(value)&&value.length===0);
}

async function transactionData(c: any, transactionId: string) {
  const companyId=c.get('session')?.activeCompanyId;
  return c.env.DB.prepare(`
    SELECT t.*,tt.name_ar transaction_type_name,tt.description transaction_type_description,
           wd.version workflow_version,
           ws.name_ar current_stage_name,
           e.employee_number linked_employee_number,e.first_name linked_first_name,e.father_name linked_father_name,e.family_name linked_family_name,e.job_title linked_job_title,
           ou.name_ar linked_department,
           cu.username requester_username,cu.display_name requester_display_name,
           re.employee_number requester_employee_number,re.first_name requester_first_name,re.father_name requester_father_name,re.family_name requester_family_name,re.job_title requester_job_title,
           rou.name_ar requester_department,
           p.title_ar requester_position_title
    FROM transactions t
    JOIN transaction_types tt ON tt.id=t.transaction_type_id
    JOIN workflow_definitions wd ON wd.id=t.workflow_id
    LEFT JOIN workflow_stages ws ON ws.id=t.current_stage_id
    LEFT JOIN employees e ON e.id=t.employee_id AND e.company_id=t.company_id
    LEFT JOIN organization_units ou ON ou.id=e.organization_unit_id AND ou.company_id=e.company_id
    LEFT JOIN company_users cu ON cu.id=t.requester_user_id AND cu.company_id=t.company_id
    LEFT JOIN employees re ON re.id=cu.employee_id AND re.company_id=t.company_id
    LEFT JOIN organization_units rou ON rou.id=re.organization_unit_id AND rou.company_id=re.company_id
    LEFT JOIN positions p ON p.id=re.position_id AND p.company_id=re.company_id
    WHERE t.id=? AND t.company_id=?
  `).bind(transactionId,companyId).first<any>();
}

app.use('/transactions/*', requireAuthentication, requirePasswordChanged);
app.use('/transactions/*', async (c,next) => {
  if (!c.get('session')?.activeCompanyId || c.get('session')?.accessMode !== 'company_user') return c.json({error:'COMPANY_CONTEXT_REQUIRED'},403);
  return next();
});

app.get('/transactions/types', async c => {
  const companyId=c.get('session')?.activeCompanyId;
  const rows=await c.env.DB.prepare(`
    SELECT tt.id,tt.name_ar,tt.name_en,tt.description,
      wd.id workflow_id,wd.version workflow_version
    FROM transaction_types tt
    JOIN transaction_type_companies ttc ON ttc.transaction_type_id=tt.id AND ttc.company_id=? AND ttc.active=1
    JOIN workflow_definitions wd ON wd.transaction_type_id=tt.id AND wd.status='active'
    WHERE tt.status='active'
    ORDER BY tt.name_ar
  `).bind(companyId).all<any>();
  return c.json({items:rows.results});
});

app.post('/transactions', async c => {
  if(!await hasPermission(c,'transaction.create'))return errorResponse(c,'TRANSACTION-003',403);
  const body=await c.req.json().catch(()=>null);
  const typeId=typeof body?.transactionTypeId==='string'?body.transactionTypeId:'';
  if(!typeId)return errorResponse(c,'TRANSACTION-001',400);
  const available=await workflowAvailableForCompany(c,typeId);
  if(!available)return errorResponse(c,'TRANSACTION-001',400);
  const requester=await loadRequester(c);
  if(!requester)return errorResponse(c,'TRANSACTION-001',400);
  const allowed=json(available.allowed_submitters_json,[]);
  if(!await submitterAllowed(c,allowed))return errorResponse(c,'TRANSACTION-003',403);

  let employeeId=typeof body.employeeId==='string'&&body.employeeId.trim()?body.employeeId:null;
  if(employeeId){
    const linked=await loadCompanyEmployee(c,employeeId);
    if(!linked || linked.status==='terminated')return errorResponse(c,'TRANSACTION-001',400);
  } else employeeId=requester.employee_id||null;

  const workflow=await loadWorkflow(c,available.workflow_id);
  if(!workflow)return errorResponse(c,'TRANSACTION-001',400);
  const requestFields=workflow.fields.filter((f:any)=>!f.stage_id&&f.active!==0);
  const values=body?.values&&typeof body.values==='object'?body.values:{};
  for(const field of requestFields){
    if(field.required && answerEmpty(values[field.field_key])) return c.json({error:'TRANSACTION_VALIDATION',message:'يوجد حقل مطلوب لم يُستكمل.',fieldKey:field.field_key},400);
    if(field.field_type==='employee' && !answerEmpty(values[field.field_key])){
      const picked=await loadCompanyEmployee(c,String(values[field.field_key]));
      if(!picked || picked.status==='terminated')return errorResponse(c,'TRANSACTION-001',400);
      employeeId=employeeId||picked.id;
    }
  }
  const firstStage=workflow.stages[0];
  if(!firstStage)return errorResponse(c,'TRANSACTION-001',400);
  const transactionId=crypto.randomUUID();
  const startedAt=new Date().toISOString();
  const sequence=await c.env.DB.prepare(`
    INSERT INTO transaction_sequences(company_id,next_number) VALUES(?,2)
    ON CONFLICT(company_id) DO UPDATE SET next_number=transaction_sequences.next_number+1,updated_at=CURRENT_TIMESTAMP
    RETURNING next_number-1 AS number
  `).bind(c.get('session').activeCompanyId).first<any>();
  const number=Number(sequence?.number||0);
  if(!number)return errorResponse(c,'TRANSACTION-001',500);
  const linkedSnapshot=employeeId?await loadCompanyEmployee(c,employeeId):null;
  const requesterSnapshot={name:fullName(requester),employeeNumber:requester.employee_number||null,jobTitle:requester.job_title||requester.position_title||null,organizationUnit:requester.organization_unit_name||null,position:requester.position_title||null,username:requester.username};
  const dataJson=JSON.stringify({requester:requesterSnapshot,linkedEmployee:linkedSnapshot?{id:linkedSnapshot.id,employeeNumber:linkedSnapshot.employee_number,name:fullName(linkedSnapshot)}:null});
  try{
    const statements:D1PreparedStatement[]=[
      c.env.DB.prepare(`INSERT INTO transactions(id,company_id,transaction_number,transaction_type_id,workflow_id,requester_user_id,employee_id,status,current_stage_id,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'قيد الإجراء',?,?,?,?)`).bind(transactionId,c.get('session').activeCompanyId,number,typeId,available.workflow_id,requester.user_id,employeeId,firstStage.id,dataJson,startedAt,startedAt),
      c.env.DB.prepare(`INSERT INTO transaction_stage_executions(id,transaction_id,stage_id,execution_order,started_at,due_at,status) VALUES(?,?,?,?,?,?, 'active')`).bind(crypto.randomUUID(),transactionId,firstStage.id,1,startedAt,dueAt(startedAt,firstStage.duration_minutes)),
      c.env.DB.prepare(`INSERT INTO transaction_actions(id,transaction_id,company_id,actor_user_id,action,to_stage_id,metadata_json) VALUES(?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),transactionId,c.get('session').activeCompanyId,requester.user_id,'created',firstStage.id,JSON.stringify({workflowVersion:available.version})),
    ];
    for(const field of requestFields){
      const v=values[field.field_key]; if(answerEmpty(v)&&!field.required)continue;
      statements.push(c.env.DB.prepare(`INSERT INTO transaction_answers(id,transaction_id,field_id,value_json) VALUES(?,?,?,?)`).bind(crypto.randomUUID(),transactionId,field.id,JSON.stringify(v??null)));
    }
    await c.env.DB.batch(statements);
  }catch(e){return errorResponse(c,'TRANSACTION-001',500,e);}
  await audit(c,'transaction_created','transaction',transactionId,{companyId:c.get('session').activeCompanyId,transactionNumber:number,transactionTypeId:typeId,workflowId:available.workflow_id,stageId:firstStage.id});
  return c.json({ok:true,id:transactionId,transactionNumber:number,status:'قيد الإجراء'});
});

app.get('/transactions/search', async c => {
  if(!await hasPermission(c,'transaction.search'))return errorResponse(c,'TRANSACTION-003',403);
  const companyId=c.get('session')?.activeCompanyId;
  const number=Number(c.req.query('transactionNumber'));
  if(!Number.isInteger(number)||number<1)return errorResponse(c,'TRANSACTION-001',400);
  const row=await c.env.DB.prepare(`SELECT id,transaction_number,transaction_type_id,status,current_stage_id,created_at,updated_at FROM transactions WHERE company_id=? AND transaction_number=? LIMIT 1`).bind(companyId,number).first<any>();
  if(!row)return errorResponse(c,'TRANSACTION-002',404);
  return c.json(row);
});

app.get('/transactions/:id', async c => {
  if(!await hasPermission(c,'transaction.view'))return errorResponse(c,'TRANSACTION-003',403);
  const data=await transactionData(c,c.req.param('id'));
  if(!data)return errorResponse(c,'TRANSACTION-002',404);
  const workflow=await loadWorkflow(c,data.workflow_id);
  if(!workflow)return errorResponse(c,'TRANSACTION-002',404);
  const [history,answers,actions,feedback,attachments]=await Promise.all([
    c.env.DB.prepare(`SELECT tse.*,ws.name_ar stage_name,cu.username acted_username FROM transaction_stage_executions tse JOIN workflow_stages ws ON ws.id=tse.stage_id LEFT JOIN company_users cu ON cu.id=tse.acted_by WHERE tse.transaction_id=? ORDER BY tse.execution_order`).bind(data.id).all<any>(),
    c.env.DB.prepare(`SELECT ta.*,wf.field_key,wf.label_ar,wf.stage_id,wf.field_type,wf.options_json,wf.config_json FROM transaction_answers ta LEFT JOIN workflow_fields wf ON wf.id=ta.field_id WHERE ta.transaction_id=?`).bind(data.id).all<any>(),
    c.env.DB.prepare(`SELECT * FROM transaction_actions WHERE transaction_id=? ORDER BY created_at`).bind(data.id).all<any>(),
    c.env.DB.prepare(`SELECT * FROM transaction_feedback WHERE transaction_id=? ORDER BY created_at`).bind(data.id).all<any>(),
    c.env.DB.prepare(`SELECT * FROM transaction_attachments WHERE transaction_id=? ORDER BY created_at`).bind(data.id).all<any>(),
  ]);
  return c.json({
    transaction:{...data, requester_name:fullName({first_name:data.requester_first_name,father_name:data.requester_father_name,family_name:data.requester_family_name,display_name:data.requester_display_name,username:data.requester_username}),linked_employee_name:fullName({first_name:data.linked_first_name,father_name:data.linked_father_name,family_name:data.linked_family_name})},
    workflow,history:history.results,
    answers:answers.results.map((x:any)=>({...x,value:json(x.value_json,null),options:json(x.options_json,[]),config:json(x.config_json,{})})),actions:actions.results,feedback:feedback.results,attachments:attachments.results
  });
});


async function canProcessStage(c: any, stage: any, tx: any) {
  const s=c.get('session');
  if(!s?.companyUserId || !s.activeCompanyId)return false;
  if(!await hasPermission(c,'transaction.process'))return false;
  const responsible=stage.responsible_type;
  if(responsible==='company_admin')return await hasCompanyAdminRole(c);
  if(responsible==='specific_user')return String(stage.responsible_value||'')===String(s.companyUserId);
  if(responsible==='role'){
    const v=String(stage.responsible_value||'');
    const row=await c.env.DB.prepare(`SELECT 1 x FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.company_user_id=? AND r.company_id=? AND r.status='active' AND (r.id=? OR r.code=?) LIMIT 1`).bind(s.companyUserId,s.activeCompanyId,v,v).first<any>();
    return Boolean(row);
  }
  if(responsible==='permission'){
    const v=String(stage.responsible_value||'');
    return v?await hasPermission(c,v):false;
  }
  const linked=tx.employee_id?await loadCompanyEmployee(c,tx.employee_id):null;
  if(responsible==='employee_owner')return Boolean(linked&&s.employeeId===linked.id);
  if(responsible==='direct_manager')return Boolean(linked&&s.employeeId&&linked.manager_employee_id===s.employeeId);
  if(responsible==='position_holder'){
    if(!stage.responsible_value)return false;
    const holder=await c.env.DB.prepare(`SELECT e.id FROM employees e WHERE e.company_id=? AND e.position_id=? AND e.status<>'terminated' LIMIT 1`).bind(s.activeCompanyId,stage.responsible_value).first<any>();
    return Boolean(holder&&holder.id===s.employeeId);
  }
  if(responsible==='department_manager'){
    if(!linked?.organization_unit_id || !s.employeeId)return false;
    const managerPosition=linked.position_id?await c.env.DB.prepare(`
      SELECT manager_position_id
      FROM positions
      WHERE id=? AND company_id=?
      LIMIT 1
    `).bind(linked.position_id,s.activeCompanyId).first<any>():null;
    if(!managerPosition?.manager_position_id)return false;
    const holder=await c.env.DB.prepare(`
      SELECT e.id
      FROM employees e
      WHERE e.company_id=? AND e.position_id=? AND e.organization_unit_id=? AND e.status<>'terminated'
      LIMIT 1
    `).bind(s.activeCompanyId,managerPosition.manager_position_id,linked.organization_unit_id).first<any>();
    return Boolean(holder&&holder.id===s.employeeId);
  }
  return false;
}

function routeMatchesValue(route: any, values: Record<string,any>, fieldMap: Map<string,any>) {
  const condition=route.condition;
  if(!condition)return true;
  const field=fieldMap.get(String(condition.fieldKey||''));
  if(!field)return false;
  const actual=values[field.field_key];
  const expected=Array.isArray(condition.values)?condition.values.map(String):[];
  if(field.field_type==='multiselect'){
    const actuals=Array.isArray(actual)?actual.map(String):[];
    return expected.some(v=>actuals.includes(v));
  }
  if(field.field_type==='boolean'){
    const normalized=actual===true||String(actual).toLowerCase()==='true'||String(actual)==='نعم'?'نعم':actual===false||String(actual).toLowerCase()==='false'||String(actual)==='لا'?'لا':String(actual??'');
    return expected.some(v=>normalized===v);
  }
  if(field.field_type==='number')return expected.some(v=>Number(v)===Number(actual));
  return expected.some(v=>String(actual??'')===v);
}

app.post('/transactions/:id/action', async c => {
  if(!await hasPermission(c,'transaction.process'))return errorResponse(c,'TRANSACTION-003',403);
  const tx=await transactionData(c,c.req.param('id'));
  if(!tx)return errorResponse(c,'TRANSACTION-002',404);
  if(tx.status!=='قيد الإجراء')return errorResponse(c,'TRANSACTION-003',409);
  const workflow=await loadWorkflow(c,tx.workflow_id);
  const stage=workflow?.stages.find((row:any)=>row.id===tx.current_stage_id);
  if(!workflow||!stage)return errorResponse(c,'TRANSACTION-002',404);
  if(!await canProcessStage(c,stage,tx))return errorResponse(c,'TRANSACTION-003',403);
  const body=await c.req.json().catch(()=>null);
  const incomingValues=body?.values&&typeof body.values==='object'?body.values:{};
  const storedAnswerRows=(await c.env.DB.prepare(`
    SELECT ta.value_json,wf.field_key
    FROM transaction_answers ta
    JOIN workflow_fields wf ON wf.id=ta.field_id
    WHERE ta.transaction_id=? AND wf.workflow_id=?
  `).bind(tx.id,tx.workflow_id).all<any>()).results;
  const values:Record<string,any>={};
  for(const row of storedAnswerRows) values[String(row.field_key)]=json(row.value_json,null);
  Object.assign(values,incomingValues);
  const currentFields=workflow.fields.filter((f:any)=>f.stage_id===stage.id&&f.active!==0);
  for(const field of currentFields){
    if(field.required&&answerEmpty(values[field.field_key]))return c.json({error:'TRANSACTION_VALIDATION',message:'يوجد حقل مطلوب لم يُستكمل.',fieldKey:field.field_key},400);
  }
  const fieldMap=new Map(workflow.fields.map((f:any)=>[f.field_key,f]));
  const routes=workflow.transitions.filter((r:any)=>r.from_stage_id===stage.id).sort((a:any,b:any)=>Number(a.sort_order)-Number(b.sort_order));
  const matching=routes.filter((r:any)=>routeMatchesValue(r,values,fieldMap));
  const chosen=matching.find((r:any)=>Boolean(r.condition))||matching.find((r:any)=>!r.condition)||null;
  const stageIndex=workflow.stages.findIndex((s:any)=>s.id===stage.id);
  if(!chosen&&stageIndex===workflow.stages.length-1){
    try{
      const statements:D1PreparedStatement[]=[];
      for(const field of currentFields){
        const value=values[field.field_key]; if(answerEmpty(value))continue;
        const old=await c.env.DB.prepare(`SELECT id FROM transaction_answers WHERE transaction_id=? AND field_id=? LIMIT 1`).bind(tx.id,field.id).first<any>();
        if(old)statements.push(c.env.DB.prepare(`UPDATE transaction_answers SET value_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(JSON.stringify(value),old.id));
        else statements.push(c.env.DB.prepare(`INSERT INTO transaction_answers(id,transaction_id,field_id,value_json) VALUES(?,?,?,?)`).bind(crypto.randomUUID(),tx.id,field.id,JSON.stringify(value)));
      }
      statements.push(c.env.DB.prepare(`UPDATE transaction_stage_executions SET status='completed',completed_at=CURRENT_TIMESTAMP,acted_by=? WHERE transaction_id=? AND stage_id=? AND status='active'`).bind(c.get('session').companyUserId,tx.id,stage.id));
      statements.push(c.env.DB.prepare(`UPDATE transactions SET status='مكتملة',current_stage_id=NULL,updated_at=CURRENT_TIMESTAMP,completed_at=CURRENT_TIMESTAMP WHERE id=? AND company_id=? AND status='قيد الإجراء'`).bind(tx.id,c.get('session').activeCompanyId));
      statements.push(c.env.DB.prepare(`INSERT INTO transaction_actions(id,transaction_id,company_id,actor_user_id,action,from_stage_id,reason,metadata_json) VALUES(?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),tx.id,c.get('session').activeCompanyId,c.get('session').companyUserId,'complete',stage.id,typeof body?.reason==='string'?body.reason.trim()||null:null,JSON.stringify({implicitFinalStageCompletion:true})));
      await c.env.DB.batch(statements);
    }catch(e){return errorResponse(c,'TRANSACTION-001',500,e);}
    await audit(c,'transaction_completed','transaction',tx.id,{companyId:c.get('session').activeCompanyId,stageId:stage.id,implicit:true});
    return c.json({ok:true,status:'مكتملة'});
  }
  if(!chosen)return errorResponse(c,'TRANSACTION-001',400);
  const requestedTransitionId=typeof body?.transitionId==='string'?body.transitionId:'';
  const route=requestedTransitionId?routes.find((r:any)=>r.id===requestedTransitionId&&routeMatchesValue(r,values,fieldMap)):chosen;
  if(!route)return errorResponse(c,'TRANSACTION-001',400);
  if(requestedTransitionId && route.from_stage_id!==stage.id)return errorResponse(c,'TRANSACTION-001',400);
  if(route.action==='next'&&!route.to_stage_id)return errorResponse(c,'TRANSACTION-001',400);
  if(route.action==='return'&&!route.to_stage_id)return errorResponse(c,'TRANSACTION-001',400);
  const target=route.to_stage_id?workflow.stages.find((s:any)=>s.id===route.to_stage_id):null;
  const terminal=['complete','reject','cancel'].includes(route.action);
  if((route.action==='next'||route.action==='return')&&!target)return errorResponse(c,'TRANSACTION-001',400);
  const newStatus=route.action==='complete'?'مكتملة':route.action==='reject'?'مرفوضة':route.action==='cancel'?'ملغية':'قيد الإجراء';
  const executionOrder=Number((await c.env.DB.prepare(`SELECT COALESCE(MAX(execution_order),0) n FROM transaction_stage_executions WHERE transaction_id=?`).bind(tx.id).first<any>())?.n||0)+1;
  const startedAt=new Date().toISOString();
  try{
    const statements:D1PreparedStatement[]=[];
    for(const field of currentFields){
      const value=values[field.field_key]; if(answerEmpty(value))continue;
      const old=await c.env.DB.prepare(`SELECT id FROM transaction_answers WHERE transaction_id=? AND field_id=? LIMIT 1`).bind(tx.id,field.id).first<any>();
      if(old)statements.push(c.env.DB.prepare(`UPDATE transaction_answers SET value_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(JSON.stringify(value),old.id));
      else statements.push(c.env.DB.prepare(`INSERT INTO transaction_answers(id,transaction_id,field_id,value_json) VALUES(?,?,?,?)`).bind(crypto.randomUUID(),tx.id,field.id,JSON.stringify(value)));
    }
    const closed=route.action==='return'?'returned':route.action==='reject'?'rejected':route.action==='cancel'?'cancelled':'completed';
    const returnReason=route.action==='return'&&typeof body?.reason==='string'?body.reason.trim()||null:null;
    statements.push(c.env.DB.prepare(`UPDATE transaction_stage_executions SET status=?,completed_at=CURRENT_TIMESTAMP,acted_by=?,return_reason=? WHERE transaction_id=? AND stage_id=? AND status='active'`).bind(closed,c.get('session').companyUserId,returnReason,tx.id,stage.id));
    if(terminal){
      statements.push(c.env.DB.prepare(`UPDATE transactions SET status=?,current_stage_id=NULL,updated_at=CURRENT_TIMESTAMP,completed_at=CASE WHEN ?='مكتملة' THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE id=? AND company_id=? AND status='قيد الإجراء'`).bind(newStatus,newStatus,tx.id,c.get('session').activeCompanyId));
    }else{
      statements.push(c.env.DB.prepare(`UPDATE transactions SET current_stage_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND company_id=? AND status='قيد الإجراء'`).bind(target!.id,tx.id,c.get('session').activeCompanyId));
      statements.push(c.env.DB.prepare(`INSERT INTO transaction_stage_executions(id,transaction_id,stage_id,execution_order,started_at,due_at,status,acted_by) VALUES(?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),tx.id,target!.id,executionOrder,startedAt,dueAt(startedAt,target!.duration_minutes),'active',null));
    }
    statements.push(c.env.DB.prepare(`INSERT INTO transaction_actions(id,transaction_id,company_id,actor_user_id,action,from_stage_id,to_stage_id,reason,metadata_json) VALUES(?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),tx.id,c.get('session').activeCompanyId,c.get('session').companyUserId,route.action,stage.id,target?.id||null,typeof body?.reason==='string'?body.reason.trim()||null:null,JSON.stringify({transitionId:route.id})));
    await c.env.DB.batch(statements);
  }catch(e){return errorResponse(c,'TRANSACTION-001',500,e);}
  await audit(c,'transaction_stage_action','transaction',tx.id,{companyId:c.get('session').activeCompanyId,stageId:stage.id,action:route.action,toStageId:target?.id||null});
  return c.json({ok:true,status:newStatus,currentStageId:terminal?null:target!.id,action:route.action});
});

app.get('/test/templates', async c => {
  const rows = await c.env.DB.prepare(`
    SELECT tt.id,tt.name_ar,tt.status,
      (SELECT MAX(version) FROM workflow_definitions wd WHERE wd.transaction_type_id=tt.id) latest_version,
      (SELECT version FROM workflow_definitions wd WHERE wd.transaction_type_id=tt.id AND wd.status='active' ORDER BY version DESC LIMIT 1) active_version,
      (SELECT id FROM workflow_definitions wd WHERE wd.transaction_type_id=tt.id AND wd.status='draft' ORDER BY version DESC LIMIT 1) draft_id
    FROM transaction_types tt
    WHERE tt.company_id IS NULL
    ORDER BY tt.updated_at DESC,tt.name_ar
  `).all<any>();
  return c.json({ items: rows.results });
});

app.get('/test/templates/:id', async c => {
  const type = await c.env.DB.prepare(`SELECT id,name_ar,name_en,description,status FROM transaction_types WHERE id=? AND company_id IS NULL`).bind(c.req.param('id')).first<any>();
  if (!type) return errorResponse(c, 'WORKFLOW-003', 404);
  const draft = await c.env.DB.prepare(`SELECT id FROM workflow_definitions WHERE transaction_type_id=? AND status='draft' ORDER BY version DESC LIMIT 1`).bind(type.id).first<any>();
  const active = await c.env.DB.prepare(`SELECT id FROM workflow_definitions WHERE transaction_type_id=? AND status='active' ORDER BY version DESC LIMIT 1`).bind(type.id).first<any>();
  const workflowId = draft?.id || active?.id || '';
  if (!workflowId) return errorResponse(c, 'WORKFLOW-005', 400);
  const workflow = await loadWorkflow(c, workflowId);
  if (!workflow) return errorResponse(c, 'WORKFLOW-003', 404);
  const validation = validateWorkflowShape({ allowedSubmitters: workflow.workflow.allowed_submitters, stages: workflow.stages, fields: workflow.fields, transitions: workflow.transitions.map((route: any) => ({ ...route, condition_json: route.condition ? JSON.stringify(route.condition) : null })) });
  return c.json({ type, workflow, validation });
});

export default app;
