import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { audit } from '../audit';
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

function validateWorkflowShape(input: { stages: any[]; fields: any[]; transitions: any[] }) {
  const errors: Array<{ code: string; message: string; stageId?: string; fieldKey?: string; transitionId?: string }> = [];
  const warnings: Array<{ message: string; stageId?: string }> = [];
  const stages = sortStages(input.stages);
  const stageIds = new Set(stages.map((s: any) => s.id));
  const stageOrder = new Map(stages.map((s: any) => [s.id, Number(s.stage_order ?? s.stageOrder)]));

  stages.forEach((stage: any, index: number) => {
    const order = Number(stage.stage_order ?? stage.stageOrder);
    if (order !== index + 1) errors.push({ code: 'STAGE_ORDER', message: 'رتّب المراحل بالتسلسل الصحيح.', stageId: stage.id });
    if (!String(stage.name_ar ?? stage.nameAr ?? '').trim()) errors.push({ code: 'STAGE_NAME', message: 'اسم المرحلة مطلوب.', stageId: stage.id });
    if (!responsibilityTypes.includes((stage.responsible_type ?? stage.responsibleType) as any)) errors.push({ code: 'RESPONSIBILITY', message: 'حدد مسؤول المرحلة.', stageId: stage.id });
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
  }

  const routesByStage = new Map<string, any[]>();
  for (const route of input.transitions) {
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
    if (!routes.length) errors.push({ code: 'NO_ROUTE', message: 'حدد أثر التمرير لهذه المرحلة.', stageId: stage.id });
    if (index < stages.length - 1 && !hasForward && !hasTerminal) errors.push({ code: 'NO_FORWARD', message: 'حدد المرحلة التالية أو أثرًا نهائيًا.', stageId: stage.id });
    if (index === stages.length - 1 && !hasTerminal) errors.push({ code: 'NO_TERMINAL', message: 'المرحلة الأخيرة تحتاج أثر إنهاء.', stageId: stage.id });
    const defaults = routes.filter((route: any) => !asCondition(route.condition_json ?? route.condition));
    if (defaults.length > 1) warnings.push({ message: 'هناك أكثر من مسار افتراضي لهذه المرحلة؛ استخدم مسارًا افتراضيًا واحدًا.', stageId: stage.id });
    if (routes.some((route: any) => route.action === 'next' && index === stages.length - 1)) errors.push({ code: 'LAST_NEXT', message: 'المرحلة الأخيرة لا تحتاج انتقالًا.', stageId: stage.id });
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
  const typeId = crypto.randomUUID();
  const workflowId = crypto.randomUUID();
  const stageId = crypto.randomUUID();
  const routeId = crypto.randomUUID();
  const actor = actorId(c);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO transaction_types(id,company_id,name_ar,name_en,description,status,created_by,updated_by) VALUES(?,?,?,?,?,'active',?,?)`).bind(typeId, null, d.nameAr, d.nameEn ?? null, d.description ?? null, actor, actor),
      c.env.DB.prepare(`INSERT INTO workflow_definitions(id,transaction_type_id,version,description,allowed_submitters_json,status,created_by,updated_by) VALUES(?,?,?,?,?,'draft',?,?,?)`).bind(workflowId, typeId, 1, d.description ?? null, JSON.stringify(d.allowedSubmitters?.length ? d.allowedSubmitters : ['self']), actor, actor, actor),
      c.env.DB.prepare(`INSERT INTO workflow_stages(id,workflow_id,name_ar,name_en,stage_order,responsible_type,responsible_value,duration_minutes,config_json,active) VALUES(?,?,?,?,1,'company_admin',NULL,NULL,?,1)`).bind(stageId, workflowId, 'المرحلة الأولى', 'Stage 1', JSON.stringify({ employeeFeedback: false })),
      c.env.DB.prepare(`INSERT INTO workflow_transitions(id,workflow_id,from_stage_id,to_stage_id,action,label_ar,condition_json,sort_order,active) VALUES(?,?,?,?,?,'تنتهي مكتملة',NULL,0,1)`).bind(routeId, workflowId, stageId, null, 'complete'),
    ]);
  } catch (e) {
    return errorResponse(c, 'WORKFLOW-002', 409, e);
  }
  await audit(c, 'workflow_template_created', 'transaction_type', typeId, { nameAr: d.nameAr, workflowId, version: 1 });
  return c.json({ ok: true, id: typeId, workflowId });
});

app.patch('/admin/types/:id', async c => {
  const parsed = typeSchema.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return errorResponse(c, 'WORKFLOW-001', 400);
  if (!await globalType(c, c.req.param('id'))) return errorResponse(c, 'WORKFLOW-003', 404);
  const d = parsed.data;
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
      const routeId = crypto.randomUUID();
      await c.env.DB.batch([
        c.env.DB.prepare(`INSERT INTO workflow_definitions(id,transaction_type_id,version,description,allowed_submitters_json,status,created_by,updated_by) VALUES(?,?,?,?,?,'draft',?,?,?)`).bind(workflowId, typeId, version, type.description ?? null, JSON.stringify(['self']), actor, actor, actor),
        c.env.DB.prepare(`INSERT INTO workflow_stages(id,workflow_id,name_ar,name_en,stage_order,responsible_type,responsible_value,duration_minutes,config_json,active) VALUES(?,?,?,?,1,'company_admin',NULL,NULL,?,1)`).bind(stageId, workflowId, 'المرحلة الأولى', 'Stage 1', JSON.stringify({ employeeFeedback: false })),
        c.env.DB.prepare(`INSERT INTO workflow_transitions(id,workflow_id,from_stage_id,to_stage_id,action,label_ar,condition_json,sort_order,active) VALUES(?,?,?,?,?,'تنتهي مكتملة',NULL,0,1)`).bind(routeId, workflowId, stageId, null, 'complete'),
      ]);
    } else {
      const srcStages = (await c.env.DB.prepare(`SELECT * FROM workflow_stages WHERE workflow_id=? ORDER BY stage_order`).bind(source.id).all<any>()).results;
      const stageMap = new Map<string, string>();
      for (const stage of srcStages) stageMap.set(stage.id, crypto.randomUUID());
      const statements: D1PreparedStatement[] = [
        c.env.DB.prepare(`INSERT INTO workflow_definitions(id,transaction_type_id,version,description,allowed_submitters_json,status,created_by,updated_by) VALUES(?,?,?,?,?,'draft',?,?,?)`).bind(workflowId, typeId, version, source.description, source.allowed_submitters_json, actor, actor, actor),
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
  const existing = await c.env.DB.prepare(`SELECT wd.* FROM workflow_definitions wd JOIN transaction_types tt ON tt.id=wd.transaction_type_id WHERE wd.id=? AND tt.company_id IS NULL`).bind(workflowId).first<any>();
  if (!existing) return errorResponse(c, 'WORKFLOW-003', 404);
  if (existing.status !== 'draft') return errorResponse(c, 'WORKFLOW-004', 409);
  if (existing.transaction_type_id !== data.transactionTypeId) return errorResponse(c, 'WORKFLOW-001', 400);

  const normalizedStageIds = data.stages.map(stage => stage.id || crypto.randomUUID());
  const stageIdSet = new Set(normalizedStageIds);
  const normalizedStages = data.stages.map((stage, index) => ({ ...stage, id: normalizedStageIds[index], stageOrder: index + 1 }));
  const clientStageIds = new Map(data.stages.map((stage, index) => [stage.id, normalizedStageIds[index]]));
  const shaped = {
    stages: normalizedStages.map((stage: any) => ({ id: stage.id, stage_order: stage.stageOrder, name_ar: stage.nameAr, responsible_type: stage.responsibleType, duration_minutes: stage.durationMinutes })),
    fields: data.fields.map((field: any) => ({ field_key: field.fieldKey, label_ar: field.labelAr, field_type: field.fieldType, required: field.required ? 1 : 0, options: field.options || [], stage_id: field.stageId ? clientStageIds.get(field.stageId) || field.stageId : null })),
    transitions: data.transitions.map((route: any) => ({ id: route.id || crypto.randomUUID(), from_stage_id: clientStageIds.get(route.fromStageId) || route.fromStageId, to_stage_id: route.toStageId ? clientStageIds.get(route.toStageId) || route.toStageId : null, action: route.action, condition_json: route.condition ? JSON.stringify(route.condition) : null, active: route.active ? 1 : 0 })),
  };
  if (shaped.fields.some((field: any) => field.stage_id && !stageIdSet.has(field.stage_id))) return errorResponse(c, 'WORKFLOW-001', 400);
  const validation = validateWorkflowShape(shaped);
  if (!validation.valid) return c.json({ error: 'WORKFLOW_VALIDATION', message: 'لم تكتمل إعدادات سير العمل بعد.', validation }, 400);

  const actor = actorId(c);
  try {
    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(`DELETE FROM workflow_transitions WHERE workflow_id=?`).bind(workflowId),
      c.env.DB.prepare(`DELETE FROM workflow_conditions WHERE workflow_id=?`).bind(workflowId),
      c.env.DB.prepare(`DELETE FROM workflow_fields WHERE workflow_id=?`).bind(workflowId),
      c.env.DB.prepare(`DELETE FROM workflow_questions WHERE workflow_id=?`).bind(workflowId),
      c.env.DB.prepare(`DELETE FROM workflow_stages WHERE workflow_id=?`).bind(workflowId),
      c.env.DB.prepare(`UPDATE workflow_definitions SET description=?,allowed_submitters_json=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(data.description ?? null, JSON.stringify(data.allowedSubmitters || []), actor, workflowId),
    ];

    for (const stage of normalizedStages) {
      statements.push(c.env.DB.prepare(`INSERT INTO workflow_stages(id,workflow_id,name_ar,name_en,stage_order,responsible_type,responsible_value,duration_minutes,config_json,active) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(stage.id, workflowId, stage.nameAr, stage.nameEn ?? null, stage.stageOrder, stage.responsibleType, stage.responsibleValue ?? null, stage.durationMinutes ?? null, JSON.stringify(stage.config ?? {}), stage.active ? 1 : 0));
    }
    for (const field of data.fields) {
      const stageId = field.stageId ? clientStageIds.get(field.stageId) || field.stageId : null;
      statements.push(c.env.DB.prepare(`INSERT INTO workflow_fields(id,workflow_id,stage_id,field_key,label_ar,label_en,field_type,required,options_json,config_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), workflowId, stageId, field.fieldKey, field.labelAr, field.labelEn ?? null, field.fieldType, field.required ? 1 : 0, JSON.stringify(field.options || []), JSON.stringify(field.config || {}), field.sortOrder, field.active ? 1 : 0));
    }
    for (const route of data.transitions) {
      const fromId = clientStageIds.get(route.fromStageId) || route.fromStageId;
      const toId = route.toStageId ? clientStageIds.get(route.toStageId) || route.toStageId : null;
      statements.push(c.env.DB.prepare(`INSERT INTO workflow_transitions(id,workflow_id,from_stage_id,to_stage_id,action,label_ar,condition_json,sort_order,active) VALUES(?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), workflowId, fromId, toId, route.action, route.labelAr, route.condition ? JSON.stringify(route.condition) : null, route.sortOrder, route.active ? 1 : 0));
    }
    await c.env.DB.batch(statements);
  } catch (e) {
    return errorResponse(c, 'WORKFLOW-005', 400, e);
  }
  await audit(c, 'workflow_draft_saved', 'workflow', workflowId, { transactionTypeId: data.transactionTypeId, version: existing.version, stageCount: data.stages.length, fieldCount: data.fields.length, transitionCount: data.transitions.length });
  return c.json({ ok: true, validation });
});

app.post('/admin/workflows/:id/validate', async c => {
  const data = await loadWorkflow(c, c.req.param('id'));
  if (!data) return errorResponse(c, 'WORKFLOW-003', 404);
  return c.json(validateWorkflowShape({ stages: data.stages, fields: data.fields, transitions: data.transitions.map((route: any) => ({ ...route, condition_json: route.condition ? JSON.stringify(route.condition) : null })) }));
});

app.post('/admin/workflows/:id/approve', async c => {
  const workflowId = c.req.param('id');
  const existing = await c.env.DB.prepare(`SELECT wd.*,tt.id type_id,tt.name_ar type_name FROM workflow_definitions wd JOIN transaction_types tt ON tt.id=wd.transaction_type_id WHERE wd.id=? AND tt.company_id IS NULL`).bind(workflowId).first<any>();
  if (!existing) return errorResponse(c, 'WORKFLOW-003', 404);
  if (existing.status !== 'draft') return errorResponse(c, 'WORKFLOW-004', 409);
  const data = await loadWorkflow(c, workflowId);
  if (!data) return errorResponse(c, 'WORKFLOW-003', 404);
  const validation = validateWorkflowShape({ stages: data.stages, fields: data.fields, transitions: data.transitions.map((route: any) => ({ ...route, condition_json: route.condition ? JSON.stringify(route.condition) : null })) });
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
  const validation = validateWorkflowShape({ stages: workflow.stages, fields: workflow.fields, transitions: workflow.transitions.map((route: any) => ({ ...route, condition_json: route.condition ? JSON.stringify(route.condition) : null })) });
  return c.json({ type, workflow, validation });
});

export default app;
