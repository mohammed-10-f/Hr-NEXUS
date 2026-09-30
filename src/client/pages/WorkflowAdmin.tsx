import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  CircleAlert,
  Clock3,
  Eye,
  FileText,
  GitBranch,
  Layers3,
  Plus,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  UserRound,
  UsersRound,
  Workflow as WorkflowIcon,
  X,
  Building2,
  CircleDollarSign,
  CreditCard,
  MapPin,
  IdCard,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { ErrorState, LoadingState } from '../components/State';

type SystemField = {
  sourceKey: string;
  labelAr: string;
  group: string;
  type: string;
  sensitive: boolean;
  description?: string;
  permission?: string | null;
};
type SelectedSystemField = { sourceKey: string; scope: 'requester' | 'target'; labelAr: string; sortOrder: number };
type Field = {
  id: string;
  stageId: string | null;
  fieldKey: string;
  labelAr: string;
  fieldType: string;
  required: boolean;
  displayOnly: boolean;
  options: string[];
  sortOrder: number;
};
type Stage = {
  id: string;
  nameAr: string;
  responsibleType: string;
  responsibleValue: string;
  durationMinutes: number | null;
  stageOrder: number;
};
type Route = {
  id: string;
  fromStageId: string;
  toStageId: string | null;
  action: string;
  labelAr: string;
  condition: { fieldId: string; operator: string; values: string[] } | null;
  sortOrder: number;
  active: boolean;
};
type Template = { id: string; name_ar: string; description: string | null; status: string; latest_version: number | null; draft_id: string | null; stage_count: number };
type Catalog = { systemFields: SystemField[]; roles: { code: string; nameAr: string }[]; permissions: { id: string; nameAr: string }[] };
type ErrorDetail = { path?: (string | number)[]; message?: string };

const fieldTypes: Record<string, string> = { text: 'نص', textarea: 'ملاحظات', boolean: 'نعم / لا', select: 'قائمة اختيار' };
const responsibility: Record<string, string> = {
  direct_manager: 'المدير المباشر للموظف المعني',
  position_holder: 'شاغل المنصب المرتبط',
  department_manager: 'مدير الإدارة',
  role: 'دور وظيفي',
  permission: 'حامل صلاحية',
  company_admin: 'مدير الشركة',
  employee_owner: 'الموظف المعني',
};
const responsibilityIcons: Record<string, any> = {
  direct_manager: UsersRound,
  position_holder: BriefcaseBusiness,
  department_manager: Building2,
  role: ShieldCheck,
  permission: ShieldCheck,
  company_admin: ShieldCheck,
  employee_owner: UserRound,
};
const actions: Record<string, string> = { next: 'تمرير المعاملة', return: 'إرجاع', reject: 'رفض', cancel: 'إلغاء', complete: 'إكمال' };
const groupLabels: Record<string, string> = {
  identity: 'الهوية والبيانات الأساسية',
  employment: 'البيانات الوظيفية',
  organization: 'الهيكل التنظيمي',
  salary: 'الراتب والاستحقاقات',
  statutory: 'التأمينات والهوية النظامية',
};
const groupIcons: Record<string, any> = {
  identity: IdCard,
  employment: BriefcaseBusiness,
  organization: Building2,
  salary: CircleDollarSign,
  statutory: CreditCard,
};
const uid = () => crypto.randomUUID();
const makeFieldKey = (n: number) => `question_${n}`;
const blankStage = (n: number): Stage => ({ id: uid(), nameAr: `المرحلة ${n}`, responsibleType: 'company_admin', responsibleValue: '', durationMinutes: null, stageOrder: n });
const blankField = (stageId: string | null, n: number): Field => ({ id: uid(), stageId, fieldKey: makeFieldKey(n), labelAr: '', fieldType: 'text', required: false, displayOnly: false, options: [], sortOrder: n });

function getErrorDetails(e: any): ErrorDetail[] { return Array.isArray(e?.details) ? e.details : []; }
function errorText(e: any, fallback: string) {
  const details = getErrorDetails(e);
  const first = details[0];
  const detail = first?.message;
  return [detail || e?.message || fallback, e?.code ? `رمز الخطأ: ${e.code}` : '', e?.referenceId ? `رقم المرجع: ${e.referenceId}` : ''].filter(Boolean).join(' — ');
}
function pathLabel(detail: ErrorDetail) {
  const path = detail.path || [];
  const stageMatch = path.find(v => typeof v === 'number');
  if (path.includes('systemFields')) return `بيانات النظام: ${detail.message || 'راجع الاختيار.'}`;
  const labels: Record<string, string> = {
    nameAr: 'اسم المعاملة',
    allowedSubmitters: 'من يستطيع التقديم',
    stages: 'المراحل',
    fields: 'العناصر',
    transitions: 'المسارات',
    labelAr: 'اسم العنصر',
    responsibleType: 'مسؤول المرحلة',
    targetEmployeeEnabled: 'الموظف المعني',
  };
  const key = String(path.find(x => typeof x === 'string' && labels[x]) || '');
  return `${labels[key] || (stageMatch !== undefined ? `البيانات رقم ${Number(stageMatch) + 1}` : 'البيانات')}: ${detail.message || 'راجع القيمة المدخلة.'}`;
}

export function WorkflowAdmin() {
  const { typeId } = useParams<{ typeId?: string }>();
  const nav = useNavigate();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [type, setType] = useState<any>(null);
  const [workflow, setWorkflow] = useState<any>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [systemFields, setSystemFields] = useState<SelectedSystemField[]>([]);
  const [targetEnabled, setTargetEnabled] = useState(false);
  const [targetRequired, setTargetRequired] = useState(false);
  const [stages, setStages] = useState<Stage[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedStage, setSelectedStage] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitters, setSubmitters] = useState<string[]>(['self']);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState<any>(null);
  const [notice, setNotice] = useState('');
  const [systemPanel, setSystemPanel] = useState<'requester' | 'target' | null>(null);
  const [systemSearch, setSystemSearch] = useState('');
  const [rightTab, setRightTab] = useState<'summary' | 'conditions'>('summary');
  const stageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  async function loadList() {
    setLoading(true);
    setError('');
    try { setTemplates((await api<any>('/api/workflows/admin/types')).items || []); }
    catch (e) { setError(errorText(e, 'تعذر تحميل قوالب المعاملات.')); }
    finally { setLoading(false); }
  }
  async function loadCatalog() {
    try { setCatalog(await api<Catalog>('/api/workflows/admin/catalog')); }
    catch (e) { setError(errorText(e, 'تعذر تحميل بيانات النظام المتاحة للاستدعاء.')); }
  }
  useEffect(() => { void loadList(); void loadCatalog(); }, []);

  async function open(id: string) {
    setLoading(true); setError('');
    try {
      let r = await api<any>(`/api/workflows/admin/types/${id}`);
      if (!r.workflow || r.workflow.workflow.status !== 'draft') {
        const d = await api<any>(`/api/workflows/admin/types/${id}/new-draft`, { method: 'POST' });
        r = await api<any>(`/api/workflows/admin/types/${id}?workflowId=${d.id}`);
      }
      hydrate(r.type, r.workflow);
    } catch (e) { setError(errorText(e, 'تعذر فتح القالب.')); }
    finally { setLoading(false); }
  }
  function hydrate(t: any, w: any) {
    setType(t); setWorkflow(w.workflow); setName(t.name_ar || ''); setDescription(w.workflow.description || t.description || ''); setSubmitters(w.workflow.allowed_submitters || ['self']);
    setTargetEnabled(Boolean(w.requestSettings?.targetEmployeeEnabled));
    setTargetRequired(Boolean(w.requestSettings?.targetEmployeeRequired));
    setSystemFields((w.systemFields || []).map((x: any) => ({ sourceKey: x.source_key, scope: x.scope, labelAr: x.label_ar, sortOrder: Number(x.sort_order || 0) })));
    const ss = w.stages.map((x: any, i: number) => ({ id: x.id, nameAr: x.name_ar, responsibleType: x.responsible_type, responsibleValue: x.responsible_value || '', durationMinutes: x.duration_minutes === null ? null : Number(x.duration_minutes), stageOrder: i + 1 }));
    setStages(ss); setSelectedStage(ss[0]?.id || '');
    setFields(w.fields.map((x: any) => ({ id: x.id, stageId: x.stage_id || null, fieldKey: x.field_key, labelAr: x.label_ar, fieldType: ['text','textarea','boolean','select'].includes(x.field_type) ? x.field_type : 'text', required: Boolean(x.required), displayOnly: Boolean(x.config?.displayOnly), options: x.options || [], sortOrder: Number(x.sort_order || 0) })));
    setRoutes(w.transitions.map((x: any) => ({ id: x.id, fromStageId: x.from_stage_id, toStageId: x.to_stage_id || null, action: x.action, labelAr: x.label_ar, condition: x.condition || null, sortOrder: Number(x.sort_order || 0), active: Boolean(x.active) })));
    setValidation(null); setNotice(''); setSystemPanel(null); setRightTab('summary');
  }
  useEffect(() => { if (typeId && typeId !== 'new') void open(typeId); }, [typeId]);

  async function cleanupTransactions() {
    const ok = window.confirm('سيتم تصفير كل بيانات Phase 6: القوالب، الإصدارات، المراحل، العناصر، الشروط، المسارات، المعاملات، التنفيذ، المرفقات، الأرقام والسجل التدقيقي الخاص بـPhase 6. لن تُمس أي بيانات من Phase 1–5. هل تريد المتابعة؟');
    if (!ok) return;
    setLoading(true); setError(''); setNotice('');
    try { await api('/api/workflows/admin/transactions/cleanup', { method: 'POST' }); setNotice('تم تصفير بيانات Phase 6 بالكامل. الاستوديو جاهز للبدء من الصفر.'); await loadList(); }
    catch (e) { setError(errorText(e, 'تعذر تصفير بيانات Phase 6.')); }
    finally { setLoading(false); }
  }
  async function createNew(nameValue: string, descriptionValue: string, allowed: string[]) {
    setSaving(true); setError('');
    try {
      const r = await api<any>('/api/workflows/admin/types', { method: 'POST', body: JSON.stringify({ nameAr: nameValue, description: descriptionValue || null, allowedSubmitters: allowed }) });
      if (!r?.id) throw Object.assign(new Error('لم يُرجع الخادم رقم القالب الجديد.'), { code: 'WORKFLOW-005', referenceId: crypto.randomUUID() });
      nav(`/workflow-studio/${r.id}`, { replace: true });
    }
    catch (e) { setError(errorText(e, 'تعذر إنشاء القالب.')); }
    finally { setSaving(false); }
  }
  function addStage() { const s = blankStage(stages.length + 1); setStages([...stages, s]); setSelectedStage(s.id); requestAnimationFrame(() => stageRefs.current[s.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }
  function removeStage(id: string) {
    if (stages.length === 1) return;
    const remaining = stages.filter(s => s.id !== id).map((s, i) => ({ ...s, stageOrder: i + 1 }));
    setStages(remaining); setFields(fs => fs.filter(f => f.stageId !== id)); setRoutes(rs => rs.filter(r => r.fromStageId !== id && r.toStageId !== id)); setSelectedStage(remaining[0].id);
  }
  function moveStage(index: number, dir: number) {
    const j = index + dir; if (j < 0 || j >= stages.length) return;
    const next = [...stages]; [next[index], next[j]] = [next[j], next[index]]; setStages(next.map((s, i) => ({ ...s, stageOrder: i + 1 })));
  }
  function addField(stageId: string | null) { setFields([...fields, blankField(stageId, fields.length + 1)]); }
  function removeField(id: string) { setFields(fields.filter(f => f.id !== id)); setRoutes(routes.map(r => r.condition?.fieldId === id ? { ...r, condition: null } : r)); }
  function updateField(id: string, patch: Partial<Field>) { setFields(fs => fs.map(f => f.id === id ? { ...f, ...patch } : f)); }
  function addRoute(stageId: string) {
    const idx = stages.findIndex(s => s.id === stageId); const next = stages[idx + 1]?.id || null;
    if (!next) return;
    setRoutes([...routes, { id: uid(), fromStageId: stageId, toStageId: next, action: 'next', labelAr: 'تمرير المعاملة', condition: null, sortOrder: routes.filter(r => r.fromStageId === stageId).length, active: true }]);
  }
  function scrollTo(id: string) { setSelectedStage(id); requestAnimationFrame(() => stageRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }
  function setTargetSwitch(checked: boolean) {
    setTargetEnabled(checked);
    if (!checked) {
      setTargetRequired(false);
      setSystemFields(prev => prev.filter(x => x.scope !== 'target'));
    }
  }

  const selectedSystem = useMemo(() => systemFields.filter(f => f.scope === (systemPanel || 'requester')), [systemFields, systemPanel]);
  function toggleSystemField(item: SystemField) {
    const scope = systemPanel || 'requester';
    const exists = systemFields.some(f => f.scope === scope && f.sourceKey === item.sourceKey);
    if (exists) { setSystemFields(systemFields.filter(f => !(f.scope === scope && f.sourceKey === item.sourceKey))); return; }
    setSystemFields([...systemFields, { scope, sourceKey: item.sourceKey, labelAr: item.labelAr, sortOrder: systemFields.filter(f => f.scope === scope).length }]);
  }
  function localValidation() {
    const errs: any[] = [];
    if (!name.trim()) errs.push({ code: 'NAME', message: 'اسم المعاملة مطلوب.' });
    if (!submitters.length) errs.push({ code: 'SUBMITTER', message: 'حدد من يستطيع تقديم المعاملة.' });
    if (!stages.length) errs.push({ code: 'STAGES', message: 'أضف مرحلة واحدة على الأقل.' });
    if (targetRequired && !targetEnabled) errs.push({ code: 'TARGET', message: 'فعّل الموظف المعني قبل جعله مطلوبًا.' });
    const keys = new Set<string>();
    fields.forEach(f => {
      if (!f.labelAr.trim()) errs.push({ code: 'FIELD', message: 'كل عنصر يحتاج اسمًا واضحًا.', fieldId: f.id, stageId: f.stageId });
      if (keys.has(f.fieldKey)) errs.push({ code: 'KEY', message: `العنصر «${f.labelAr || 'بدون اسم'}» يحمل مفتاحًا مكررًا.`, fieldId: f.id, stageId: f.stageId });
      keys.add(f.fieldKey);
      if (f.fieldType === 'select' && !f.options.length) errs.push({ code: 'OPTIONS', message: `أضف خيارات لـ«${f.labelAr || 'العنصر'}».`, fieldId: f.id, stageId: f.stageId });
      if (f.required && f.displayOnly) errs.push({ code: 'READONLY', message: `«${f.labelAr || 'العنصر'}» لا يمكن أن يكون مطلوبًا وعرض فقط معًا.`, fieldId: f.id, stageId: f.stageId });
    });
    stages.forEach(s => {
      if (!s.nameAr.trim()) errs.push({ code: 'STAGE_NAME', message: 'اسم المرحلة مطلوب.', stageId: s.id });
      if (['role', 'permission'].includes(s.responsibleType) && !s.responsibleValue.trim()) errs.push({ code: 'RESPONSIBLE_VALUE', message: `حدد ${responsibility[s.responsibleType]} لـ«${s.nameAr || 'المرحلة'}».`, stageId: s.id });
    });
    setValidation({ valid: !errs.length, errors: errs, warnings: [] });
    if (errs[0]) { setError(errs[0].message); if (errs[0].fieldId) requestAnimationFrame(() => document.getElementById(`wf-field-${errs[0].fieldId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })); else if (errs[0].stageId) scrollTo(errs[0].stageId); }
    return !errs.length;
  }
  async function save(runValidation = false) {
    if (!type || !workflow || saving) return;
    if (!localValidation()) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const r = await api<any>(`/api/workflows/admin/workflows/${workflow.id}`, { method: 'PUT', body: JSON.stringify({ transactionTypeId: type.id, nameAr: name.trim(), description: description.trim() || null, allowedSubmitters: submitters, stages, fields, transitions: routes, systemFields, targetEmployeeEnabled: targetEnabled, targetEmployeeRequired: targetRequired }) });
      setValidation(r.validation); setNotice('تم حفظ المسودة بنجاح.');
      if (runValidation) setValidation(await api<any>(`/api/workflows/admin/workflows/${workflow.id}/validate`, { method: 'POST' }));
      await loadList();
    } catch (e: any) {
      const details = getErrorDetails(e); const human = details[0] ? pathLabel(details[0]) : errorText(e, 'تعذر حفظ المسودة.');
      setError(human);
      if (details.length) setValidation({ valid: false, errors: details.map(d => ({ message: pathLabel(d), stageId: d.path?.includes('stages') ? stages[0]?.id : undefined })), warnings: [] });
    } finally { setSaving(false); }
  }
  async function publish() {
    if (!workflow || saving) return;
    if (!localValidation()) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const v = await api<any>(`/api/workflows/admin/workflows/${workflow.id}/validate`, { method: 'POST' }); setValidation(v);
      if (!v.valid) { setError('لا يمكن اعتماد القالب قبل إصلاح الأخطاء الموضحة في بوابة الجودة.'); return; }
      await api(`/api/workflows/admin/workflows/${workflow.id}/publish`, { method: 'POST' }); setNotice('تم اعتماد القالب. أصبح التصميم صالحًا للتشغيل.'); await loadList();
    } catch (e) { setError(errorText(e, 'تعذر اعتماد القالب.')); }
    finally { setSaving(false); }
  }

  // Creation entrypoint uses SPA navigation so the shell/session is not reloaded.
  if (!typeId) return <TemplateList templates={templates} loading={loading} error={error} onOpen={open} onCleanup={cleanupTransactions} onCreate={() => nav('/workflow-studio/new')} />;
  if (typeId === 'new') return <CreateTemplatePage saving={saving} error={error} onCancel={() => nav('/workflow-studio')} onCreate={createNew} />;
  if (loading && !type) return <LoadingState />;
  if (!type || !workflow) return <ErrorState />;

  const requesterFields = systemFields.filter(f => f.scope === 'requester').sort((a, b) => a.sortOrder - b.sortOrder);
  const targetFields = systemFields.filter(f => f.scope === 'target').sort((a, b) => a.sortOrder - b.sortOrder);
  const totalQuestionFields = fields.length;
  const currentStageIndex = Math.max(0, stages.findIndex(s => s.id === selectedStage));

  return <div className="workflow-studio premium-studio wow-studio">
    <section className="wf-hero">
      <div className="wf-hero-copy">
        <div className="wf-crumb"><button onClick={() => nav('/workflow-studio')}>استوديو سير العمل</button><ChevronLeft size={14} /><span>تصميم القالب</span></div>
        <div className="wf-hero-title-row"><span className="wf-hero-symbol"><WorkflowIcon size={28} /></span><div><div className="wf-kicker">WORKFLOW STUDIO</div><h1>{name || type.name_ar}</h1><p>{description || 'صمّم المعاملة مرة واحدة، ودع المحرك يدير البيانات والمراحل والمسارات.'}</p></div></div>
      </div>
      <div className="wf-hero-actions"><span className={`wf-status ${workflow.status === 'active' ? 'active' : 'draft'}`}><span />{workflow.status === 'active' ? 'معتمد' : 'مسودة'}</span><Link className="wf-ghost" to={`/workflow-studio/preview/${type.id}`}><Eye size={16} />المعاينة</Link><Link className="wf-ghost" to={`/workflow-studio/test/${type.id}`}><CheckCircle2 size={16} />اختبار A–Z</Link></div>
    </section>

    {error && <div className="wf-alert-v2 danger"><CircleAlert size={19} /><div><strong>لم يتم حفظ التغيير</strong><span>{error}</span></div><button onClick={() => setError('')}><X size={16} /></button></div>}
    {notice && <div className="wf-alert-v2 success"><CheckCircle2 size={19} /><div><strong>تم الحفظ</strong><span>{notice}</span></div><button onClick={() => setNotice('')}><X size={16} /></button></div>}

    <div className="wf-quick-nav">
      <button onClick={() => document.getElementById('wf-identity')?.scrollIntoView({behavior:'smooth'})}><span>01</span>الأساس</button>
      <button onClick={() => document.getElementById('wf-system-data')?.scrollIntoView({behavior:'smooth'})}><span>02</span>بيانات النظام</button>
      <button onClick={() => document.getElementById('wf-request-data')?.scrollIntoView({behavior:'smooth'})}><span>03</span>أسئلة الطلب</button>
      <button onClick={() => document.getElementById('wf-stages')?.scrollIntoView({behavior:'smooth'})}><span>04</span>المراحل والمسار</button>
      <button onClick={() => document.getElementById('wf-quality')?.scrollIntoView({behavior:'smooth'})}><span>05</span>بوابة الجودة</button>
    </div>

    <div className="wf-main-grid">
      <main className="wf-canvas">
        <section id="wf-identity" className="wf-card wf-section-card">
          <SectionTitle number="01" eyebrow="الأساس" title="هوية المعاملة" subtitle="الاسم الذي سيظهر للمستخدم، ومن يملك حق بدء هذا النوع من المعاملات." />
          <div className="wf-form-grid">
            <label className="wf-input-group wide"><span>اسم المعاملة</span><input value={name} onChange={e => setName(e.target.value)} placeholder="مثال: طلب تغيير المسمى الوظيفي" /></label>
            <label className="wf-input-group wide"><span>وصف مختصر <em>اختياري</em></span><textarea rows={4} value={description} onChange={e => setDescription(e.target.value)} placeholder="شرح واضح يظهر للمستخدم قبل بدء المعاملة." /></label>
          </div>
          <div className="wf-access-box"><div><strong>من يستطيع تقديم المعاملة؟</strong><span>هذه قاعدة وصول للبدء، وليست مسؤولية مرحلة.</span></div><div className="wf-choice-pills">{[['self','الموظف نفسه'],['company_admin','مدير الشركة']].map(([key, label]) => { const on = submitters.includes(key); return <button key={key} className={on ? 'on' : ''} type="button" onClick={() => setSubmitters(on ? submitters.filter(x => x !== key) : [...submitters, key])}><span>{on && <Check size={12} />}</span>{label}</button>; })}</div></div>
        </section>

        <section id="wf-system-data" className="wf-card wf-section-card">
          <SectionTitle number="02" eyebrow="بيانات النظام" title="ما البيانات التي تريد أن تظهر؟" subtitle="اختر حقولًا من HR Nexus نفسه. عند التشغيل يستدعي المحرك القيمة الحالية من ملف الموظف بدل إعادة إدخالها يدويًا." action={<button className="wf-primary-action" onClick={() => {setSystemPanel('requester');setSystemSearch('');}}><Plus size={16}/>اختيار بيانات مقدم الطلب</button>} />
          <div className="wf-data-layout">
            <SystemDataCard scope="requester" title="مقدم الطلب" subtitle="الموظف الذي بدأ المعاملة" icon={UserRound} fields={requesterFields} onOpen={() => {setSystemPanel('requester');setSystemSearch('');}} onRemove={item => setSystemFields(prev => prev.filter(f => !(f.scope === 'requester' && f.sourceKey === item.sourceKey)))} />
            <div className="wf-live-profile"><div className="wf-live-profile-head"><div><span className="wf-kicker soft">SYSTEM DATA PREVIEW</span><strong>كيف ستظهر بيانات النظام</strong></div><span className="wf-live-badge">D1 عند التشغيل</span></div><div className="wf-avatar-line"><div className="wf-avatar-large"><UserRound size={18}/></div><div><strong>بيانات الموظف الفعلية عند التشغيل</strong><span>المحرك يقرأها من ملف الموظف في Phase 5، ولا تُنسخ داخل القالب.</span></div></div><div className="wf-profile-grid">{requesterFields.slice(0,6).map((f:any) => <div className="wf-profile-item" key={f.sourceKey}><span>{f.labelAr}</span><strong>{previewSystemValue(f.sourceKey)}</strong></div>)}{!requesterFields.length&&<div className="wf-profile-empty">اختر بيانات من القائمة لتظهر هنا مباشرة.</div>}</div><div className="wf-system-protection"><ShieldCheck size={15}/><span>الرقم الوظيفي يظهر كرقم موظف مثل <b>EMP-0015</b>. القيم الحساسة تخضع لصلاحيات النظام عند التشغيل.</span></div></div>
          </div>
          <div className="wf-target-block"><div className="wf-target-main"><span className="wf-target-icon"><UsersRound size={18}/></span><div><strong>الموظف المعني</strong><p>إذا كان الطلب لموظف آخر، فعّل هذا الخيار وسيتم جلب ملفه من Phase 5. إذا لم تفعّله، يكون الموظف المعني هو مقدم الطلب تلقائيًا.</p></div></div><div className="wf-target-controls"><label className="wf-toggle-row"><input type="checkbox" checked={targetEnabled} onChange={e => setTargetSwitch(e.target.checked)}/><span className="wf-toggle"><i /></span><b>تفعيل الموظف المعني</b></label>{targetEnabled&&<label className="wf-toggle-row"><input type="checkbox" checked={targetRequired} onChange={e=>setTargetRequired(e.target.checked)}/><span className="wf-toggle"><i /></span><b>اختياره إلزامي</b></label>}</div></div>
          {targetEnabled&&<SystemDataCard scope="target" title="بيانات الموظف المعني" subtitle={targetRequired?'يجب اختيار موظف معني عند تقديم المعاملة.':'اختيار الموظف المعني مدعوم لهذا القالب.'} icon={BriefcaseBusiness} fields={targetFields} onOpen={() => {setSystemPanel('target');setSystemSearch('');}} onRemove={item=>setSystemFields(prev=>prev.filter(f=>!(f.scope==='target'&&f.sourceKey===item.sourceKey)))} />}
        </section>

        <section id="wf-request-data" className="wf-card wf-section-card">
          <SectionTitle number="03" eyebrow="بيانات الطلب" title="الأسئلة والعناصر" subtitle="كل عنصر يضيفه المصمم هنا يظهر في أساس المعاملة. لا توجد حقول تلقائية ولا ملاحظات مخفية." action={<button className="wf-secondary-action" onClick={() => addField(null)}><Plus size={16}/>إضافة سؤال</button>} />
          <FieldEditor fields={fields.filter(f => !f.stageId)} onUpdate={updateField} onRemove={removeField} />
        </section>

        <section id="wf-stages" className="wf-stage-zone">
          <div className="wf-section-intro"><div><div className="wf-kicker soft">04 · WORKFLOW</div><h2>المراحل والمسار</h2><p>{stages.length} مراحل فعلية — الترتيب محفوظ ويقود المحرك الانتقال بين المراحل.</p></div><button className="wf-primary-action" onClick={addStage}><Plus size={16}/>إضافة مرحلة</button></div>
          <div className="wf-stage-stack">{stages.map((s, i) => {
            const stageFields = fields.filter(f => f.stageId === s.id);
            const stageRoutes = routes.filter(r => r.fromStageId === s.id);
            const ResponsibilityIcon = responsibilityIcons[s.responsibleType] || ShieldCheck;
            return <article key={s.id} ref={el => {stageRefs.current[s.id]=el}} className={`wf-stage-card ${selectedStage===s.id?'focus':''}`} onFocus={() => setSelectedStage(s.id)}>
              <div className="wf-stage-top"><div className="wf-stage-heading"><span className="wf-stage-number">{i+1}</span><div><span className="wf-stage-kicker">STAGE {String(i+1).padStart(2,'0')}</span><input value={s.nameAr} className="wf-stage-name-input" onChange={e => setStages(stages.map(x => x.id===s.id?{...x,nameAr:e.target.value}:x))} placeholder="اسم المرحلة" /></div></div><div className="wf-stage-actions"><button className="wf-icon-action" title="نقل لأعلى" disabled={i===0} onClick={()=>moveStage(i,-1)}><ArrowUp size={15}/></button><button className="wf-icon-action" title="نقل لأسفل" disabled={i===stages.length-1} onClick={()=>moveStage(i,1)}><ArrowDown size={15}/></button><button className="wf-icon-action danger" title="حذف المرحلة" disabled={stages.length===1} onClick={()=>removeStage(s.id)}><Trash2 size={15}/></button></div></div>
              <div className="wf-stage-meta-grid"><label className="wf-input-group"><span>مسؤول المرحلة</span><div className="wf-select-with-icon"><ResponsibilityIcon size={15}/><select value={s.responsibleType} onChange={e=>setStages(stages.map(x=>x.id===s.id?{...x,responsibleType:e.target.value,responsibleValue:''}:x))}>{Object.entries(responsibility).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div></label>{s.responsibleType==='role'&&<label className="wf-input-group"><span>الدور</span><select value={s.responsibleValue} onChange={e=>setStages(stages.map(x=>x.id===s.id?{...x,responsibleValue:e.target.value}:x))}><option value="">اختر الدور</option>{(catalog?.roles||[]).map(r=><option key={r.code} value={r.code}>{r.nameAr}</option>)}</select></label>}{s.responsibleType==='permission'&&<label className="wf-input-group"><span>الصلاحية</span><select value={s.responsibleValue} onChange={e=>setStages(stages.map(x=>x.id===s.id?{...x,responsibleValue:e.target.value}:x))}><option value="">اختر الصلاحية</option>{(catalog?.permissions||[]).map(p=><option key={p.id} value={p.id}>{p.nameAr}</option>)}</select></label>}<label className="wf-input-group"><span>مدة المرحلة <em>اختياري</em></span><div className="wf-input-icon"><Clock3 size={15}/><input type="number" min="1" value={s.durationMinutes??''} placeholder="بدون حد" onChange={e=>setStages(stages.map(x=>x.id===s.id?{...x,durationMinutes:e.target.value?Number(e.target.value):null}:x))}/></div></label></div>
              <div className="wf-stage-content"><div className="wf-content-head"><div><strong>عناصر المرحلة</strong><span>الأسئلة يمكن استخدامها كقرارات عند الحاجة.</span></div><button className="wf-secondary-action small" onClick={()=>addField(s.id)}><Plus size={14}/>إضافة سؤال</button></div><FieldEditor fields={stageFields} onUpdate={updateField} onRemove={removeField} /></div>
              <div className="wf-route-block"><div className="wf-route-head"><div><strong>المسار</strong><span>{i===stages.length-1?'عند النجاح هنا تصبح المعاملة مكتملة.':'بدون شرط، ينتقل المحرك تلقائيًا إلى المرحلة التالية.'}</span></div>{i<stages.length-1&&<button className="wf-secondary-action small" onClick={()=>addRoute(s.id)}><GitBranch size={14}/>إضافة فرع مشروط</button>}</div><RouteEditor stage={s} stages={stages} fields={fields} routes={stageRoutes} onChange={r=>setRoutes(routes.map(x=>x.id===r.id?r:x))} onAdd={()=>addRoute(s.id)} onRemove={id=>setRoutes(routes.filter(x=>x.id!==id))} />{i===stages.length-1&&<div className="wf-complete-note"><CheckCircle2 size={17}/><span><b>نهاية منطقية للمسار</b> — هذه آخر مرحلة فعلية باسمها الحالي. بعد نجاح التمرير تصبح المعاملة <strong>مكتملة</strong>.</span></div>}</div>
            </article>;
          })}</div>
        </section>

        <section id="wf-quality" className="wf-card wf-quality-card">
          <SectionTitle number="05" eyebrow="Quality Gate" title="بوابة جودة القالب" subtitle="أي خطأ يمنع الاعتماد، وكل مشكلة مرتبطة بمكان واضح داخل التصميم." action={<button className="wf-secondary-action" onClick={()=>void save(true)}><ShieldCheck size={16}/>فحص الآن</button>} />
          {!validation?<div className="wf-quality-empty"><ShieldCheck size={25}/><strong>جاهز للفحص</strong><span>شغّل الفحص قبل الاعتماد للتأكد من المسؤوليات والعناصر والمسارات.</span></div>:<ValidationPanel validation={validation} stages={stages} onJump={scrollTo} />}
        </section>
      </main>

      <aside className="wf-side-column">
        <div className="wf-sticky">
          <section className="wf-side-card wf-progress-card"><div className="wf-side-card-head"><div><span className="wf-kicker soft">DESIGN HEALTH</span><h3>حالة التصميم</h3></div><span className={`wf-health-dot ${validation?.valid?'good':'idle'}`} /></div><div className="wf-health-score"><div><strong>{validation?.valid?'جاهز للاعتماد':'مسودة'}</strong><span>{validation?.valid?'لا توجد أخطاء مانعة.':'احفظ ثم افحص القالب قبل الاعتماد.'}</span></div><ShieldCheck size={24}/></div><div className="wf-stat-grid"><Stat value={String(requesterFields.length)} label="بيانات مقدم الطلب" icon={UserRound}/><Stat value={targetEnabled?String(targetFields.length):'—'} label="بيانات الموظف المعني" icon={UsersRound}/><Stat value={String(totalQuestionFields)} label="أسئلة وعناصر" icon={FileText}/><Stat value={String(stages.length)} label="مراحل" icon={Layers3}/></div></section>
          <section className="wf-side-card"><div className="wf-side-card-head"><div><span className="wf-kicker soft">FLOW OUTLINE</span><h3>خريطة المسار</h3></div><span>{stages.length} مراحل</span></div><div className="wf-mini-timeline"><div className="wf-timeline-line" /><div className="wf-timeline-node fixed"><span><UserRound size={14}/></span><div><strong>بيانات مقدم الطلب</strong><small>من Phase 5</small></div></div><div className="wf-timeline-node fixed"><span><FileText size={14}/></span><div><strong>أسئلة / بيانات الطلب</strong><small>{fields.filter(f=>!f.stageId).length} عناصر</small></div></div>{stages.map((s,i)=><button type="button" className={`wf-timeline-node ${selectedStage===s.id?'selected':''}`} key={s.id} onClick={()=>scrollTo(s.id)}><span>{i+1}</span><div><strong>{s.nameAr}</strong><small>{responsibility[s.responsibleType]||'مسؤول المرحلة'}</small></div></button>)}<div className="wf-timeline-end"><CheckCircle2 size={15}/> مكتملة بعد نجاح آخر مرحلة</div></div></section>
          <section className="wf-side-card"><div className="wf-side-card-head"><div><span className="wf-kicker soft">SYSTEM DATA</span><h3>البيانات المعروضة</h3></div><button className="wf-link-button" onClick={()=>{setSystemPanel('requester');setSystemSearch('');}}>تعديل</button></div><div className="wf-side-data-list">{requesterFields.slice(0,5).map(f=><div key={f.sourceKey}><span>{f.labelAr}</span><b>من النظام</b></div>)}{!requesterFields.length&&<p>لم يتم اختيار بيانات مقدم الطلب.</p>}{requesterFields.length>5&&<p>+ {requesterFields.length-5} بيانات أخرى</p>}</div></section>
        </div>
      </aside>
    </div>

    <div className="wf-save-dock"><div><span className="wf-save-dot"/><div><strong>{saving?'جارٍ الحفظ...':'الحفظ اليدوي جاهز'}</strong><small>التغييرات لا تُرسل إلى القاعدة إلا عند الضغط على «حفظ المسودة».</small></div></div><div className="wf-save-actions"><button className="wf-secondary-action" disabled={saving} onClick={()=>void save(false)}><Save size={16}/>حفظ المسودة</button><button className="wf-secondary-action" disabled={saving} onClick={()=>void save(true)}><ShieldCheck size={16}/>فحص</button><button className="wf-primary-action" disabled={saving} onClick={()=>void publish()}><Check size={16}/>اعتماد القالب</button></div></div>

    {systemPanel&&<SystemFieldPicker scope={systemPanel} catalog={catalog} selected={selectedSystem} search={systemSearch} onSearch={setSystemSearch} onToggle={toggleSystemField} onClose={()=>setSystemPanel(null)} />}
  </div>;
}

function SectionTitle({number,eyebrow,title,subtitle,action}:{number:string;eyebrow:string;title:string;subtitle:string;action?:any}) {
  return <div className="wf-section-title"><div className="wf-title-number">{number}</div><div className="wf-title-copy"><span className="wf-kicker soft">{eyebrow}</span><h2>{title}</h2><p>{subtitle}</p></div>{action&&<div className="wf-title-action">{action}</div>}</div>;
}

function SystemDataCard({scope,title,subtitle,icon:Icon,fields,onOpen,onRemove}:{scope:'requester'|'target';title:string;subtitle:string;icon:any;fields:SelectedSystemField[];onOpen:()=>void;onRemove:(item:SelectedSystemField)=>void}) {
  return <div className="wf-system-card"><div className="wf-system-card-head"><div className="wf-system-card-icon"><Icon size={17}/></div><div><h3>{title}</h3><span>{subtitle}</span></div><div className="wf-system-card-actions"><span>{fields.length} بيانات</span><button className="wf-secondary-action small" onClick={onOpen}><Settings2 size={14}/>اختيار البيانات</button></div></div><div className="wf-selected-grid">{fields.length?fields.map(item=><div className="wf-selected-data" key={`${scope}-${item.sourceKey}`}><span className="wf-selected-data-icon"><Check size={13}/></span><div><strong>{item.labelAr}</strong><small>حقل نظامي · يُقرأ عند التشغيل</small></div><button onClick={()=>onRemove(item)} title="إزالة"><X size={13}/></button></div>):<button type="button" className="wf-empty-data" onClick={onOpen}><Plus size={18}/><span><b>اختر البيانات التي تريد ظهورها</b><small>مثل الرقم الوظيفي، الراتب، تاريخ المباشرة، المسمى، الإدارة…</small></span><ChevronLeft size={16}/></button>}</div></div>;
}

function SystemFieldPicker({scope,catalog,selected,search,onSearch,onToggle,onClose}:{scope:'requester'|'target';catalog:Catalog|null;selected:SelectedSystemField[];search:string;onSearch:(x:string)=>void;onToggle:(f:SystemField)=>void;onClose:()=>void}) {
  const selectedKeys=new Set(selected.map(x=>x.sourceKey));
  const groups=Object.entries(groupLabels).map(([key,label])=>({key,label,icon:groupIcons[key]||FileText,items:(catalog?.systemFields||[]).filter(f=>f.group===key).filter(f=>!search.trim()||`${f.labelAr} ${f.description||''}`.includes(search.trim()))})).filter(g=>g.items.length);
  return <div className="wf-picker-backdrop" onMouseDown={e=>e.currentTarget===e.target&&onClose()}><aside className="wf-picker"><div className="wf-picker-head"><div><span className="wf-kicker soft">SYSTEM DATA LIBRARY</span><h2>{scope==='requester'?'بيانات مقدم الطلب':'بيانات الموظف المعني'}</h2><p>حدد المعلومات التي سيعرضها القالب تلقائيًا من سجلات HR Nexus.</p></div><button className="wf-icon-action" onClick={onClose}><X size={18}/></button></div><div className="wf-picker-search"><Search size={17}/><input autoFocus value={search} onChange={e=>onSearch(e.target.value)} placeholder="ابحث: الرقم الوظيفي، الراتب، تاريخ المباشرة…" /></div><div className="wf-picker-intro"><ShieldCheck size={15}/><span>لا تخزن هذه الاختيارات نسخة ثانية من بيانات الموظف؛ هي مجرد خريطة لمصدر البيانات.</span></div><div className="wf-picker-body">{groups.map(group=>{const Icon=group.icon;return <section className="wf-picker-group" key={group.key}><div className="wf-picker-group-head"><div><span className="wf-picker-group-icon"><Icon size={14}/></span><strong>{group.label}</strong></div><span>{group.items.length} حقول متاحة</span></div><div className="wf-picker-grid">{group.items.map(item=>{const checked=selectedKeys.has(item.sourceKey);return <button type="button" key={item.sourceKey} className={`wf-picker-option ${checked?'selected':''}`} onClick={()=>onToggle(item)}><span className="wf-checkbox">{checked&&<Check size={12}/>}</span><div><strong>{item.labelAr}</strong><small>{item.description||'قيمة من ملف الموظف عند التشغيل.'}</small></div>{item.sensitive&&<span className="wf-sensitive"><ShieldCheck size={11}/>محمية</span>}</button>;})}</div></section>})}</div><div className="wf-picker-footer"><span><b>{selected.length}</b> بيانات مختارة</span><button className="wf-primary-action" onClick={onClose}>تم حفظ الاختيار</button></div></aside></div>;
}

function FieldEditor({fields,onUpdate,onRemove}:{fields:Field[];onUpdate:(id:string,patch:Partial<Field>)=>void;onRemove:(id:string)=>void}) {
  if(!fields.length) return <div className="wf-empty-question"><div><Layers3 size={18}/></div><section><strong>لا توجد عناصر بعد</strong><span>أضف أول سؤال لتحديد البيانات التي سيدخلها المستخدم أو يجيب عنها.</span></section></div>;
  return <div className="wf-field-stack">{fields.map((f,i)=><article id={`wf-field-${f.id}`} key={f.id} className="wf-field-card"><div className="wf-field-index">{i+1}</div><div className="wf-field-body"><div className="wf-field-row-top"><label className="wf-input-group"><span>اسم السؤال / العنصر</span><input value={f.labelAr} onChange={e=>onUpdate(f.id,{labelAr:e.target.value})} placeholder="مثال: سبب الطلب" /></label><label className="wf-input-group"><span>نوع الإجابة</span><select value={f.fieldType} onChange={e=>onUpdate(f.id,{fieldType:e.target.value})}>{Object.entries(fieldTypes).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label></div>{f.fieldType==='select'&&<label className="wf-input-group"><span>الخيارات</span><input value={f.options.join('، ')} onChange={e=>onUpdate(f.id,{options:e.target.value.split(/[,،\n]/).map(x=>x.trim()).filter(Boolean)})} placeholder="مثال: نعم، لا" /></label>}<div className="wf-field-help"><span>{f.fieldType==='boolean'?'إجابة نعم/لا يمكن استخدامها كقرار لتحديد المسار.':'يمكن استخدام إجابة هذا العنصر داخل شروط المسارات.'}</span><label className="wf-check-toggle"><input type="checkbox" checked={f.required} onChange={e=>onUpdate(f.id,{required:e.target.checked,displayOnly:e.target.checked?false:f.displayOnly})}/><span/>مطلوب</label><label className="wf-check-toggle"><input type="checkbox" checked={f.displayOnly} onChange={e=>onUpdate(f.id,{displayOnly:e.target.checked,required:e.target.checked?false:f.required})}/><span/>عرض فقط</label></div></div><button className="wf-delete-field" title="حذف العنصر" onClick={()=>onRemove(f.id)}><Trash2 size={16}/></button></article>)}</div>;
}

function RouteEditor({stage,stages,fields,routes,onChange,onAdd,onRemove}:{stage:Stage;stages:Stage[];fields:Field[];routes:Route[];onChange:(r:Route)=>void;onAdd:()=>void;onRemove:(id:string)=>void}) {
  const index=stages.findIndex(s=>s.id===stage.id);
  const sourceFields=fields.filter(f=>{const sid=f.stageId;return !sid||stages.findIndex(s=>s.id===sid)<=index});
  if(!routes.length) return <div className="wf-route-default"><div className="wf-route-default-icon"><GitBranch size={17}/></div><div><strong>المسار الافتراضي جاهز</strong><span>{index<stages.length-1?'يمرر المحرك الطلب تلقائيًا إلى المرحلة التالية ما لم تُنشئ فرعًا مشروطًا.':'هذه آخر مرحلة فعلية؛ النجاح هنا يحوّل المعاملة إلى مكتملة.'}</span></div>{index<stages.length-1&&<button className="wf-secondary-action small" onClick={onAdd}><GitBranch size={14}/>إضافة فرع مشروط</button>}</div>;
  return <div className="wf-route-list">{routes.map(r=><div className="wf-route-card" key={r.id}><div className="wf-route-badge"><GitBranch size={14}/><span>{r.condition?'شرط':'مسار'}</span></div><div className="wf-route-grid"><label className="wf-input-group"><span>الإجراء</span><select value={r.action} onChange={e=>onChange({...r,action:e.target.value})}>{Object.entries(actions).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label className="wf-input-group"><span>ينتقل إلى</span><select value={r.toStageId||''} disabled={!['next','return'].includes(r.action)} onChange={e=>onChange({...r,toStageId:e.target.value||null})}><option value="">اختر المرحلة</option>{stages.map((s,i)=><option key={s.id} value={s.id}>{i+1} — {s.nameAr}</option>)}</select></label><label className="wf-input-group"><span>اسم الإجراء</span><input value={r.labelAr} onChange={e=>onChange({...r,labelAr:e.target.value})}/></label><label className="wf-input-group"><span>الشرط <em>اختياري</em></span><select value={r.condition?.fieldId||''} onChange={e=>{const id=e.target.value;onChange({...r,condition:id?{fieldId:id,operator:'equals',values:['نعم']}:null})}}><option value="">بدون شرط</option>{sourceFields.map(f=><option key={f.id} value={f.id}>{f.labelAr||'عنصر بدون اسم'}</option>)}</select></label>{r.condition&&<label className="wf-input-group"><span>القيمة</span><input value={r.condition.values.join('، ')} onChange={e=>onChange({...r,condition:{...r.condition,values:e.target.value.split(/[,،]/).map(x=>x.trim()).filter(Boolean)}})} placeholder="مثال: نعم"/></label>}</div><button className="wf-delete-route" onClick={()=>onRemove(r.id)} title="حذف المسار"><Trash2 size={15}/></button></div>)}</div>;
}

function ValidationPanel({validation,stages,onJump}:{validation:any;stages:Stage[];onJump:(id:string)=>void}) {
  const errors=validation.errors||[], warnings=validation.warnings||[];
  if(!errors.length&&!warnings.length) return <div className="wf-validation-good"><CheckCircle2 size={25}/><div><strong>التصميم سليم</strong><span>يمكنك معاينة المسار أو تشغيل اختبار A–Z ثم اعتماد القالب.</span></div></div>;
  return <div className="wf-validation-body"><div className={`wf-validation-summary ${validation.valid?'good':'bad'}`}><span>{validation.valid?<CheckCircle2 size={20}/>:<CircleAlert size={20}/>}</span><div><strong>{validation.valid?'جاهز للاعتماد مع تحذيرات':'هناك أخطاء تمنع الاعتماد'}</strong><small>{errors.length?`${errors.length} أخطاء تحتاج إلى إصلاح.`:`${warnings.length} تحذيرات للمراجعة.`}</small></div></div><div className="wf-validation-list">{errors.map((v:any,i:number)=><button key={`e-${i}`} onClick={()=>v.stageId&&onJump(v.stageId)} className="wf-validation-row error"><CircleAlert size={15}/><span>{v.message}</span><ChevronLeft size={14}/></button>)}{warnings.map((v:any,i:number)=><div key={`w-${i}`} className="wf-validation-row warning"><Clock3 size={15}/><span>{v.message}</span></div>)}</div></div>;
}
function Stat({value,label,icon:Icon}:{value:string;label:string;icon:any}) { return <div className="wf-stat"><span><Icon size={15}/></span><strong>{value}</strong><small>{label}</small></div>; }
function previewSystemValue(key:string) { const map:Record<string,string>={employee_number:'رقم الموظف عند التشغيل',full_name:'اسم الموظف عند التشغيل',national_id:'حسب الصلاحية',job_title:'المسمى الوظيفي من الملف',organization_unit:'الوحدة التنظيمية من Phase 4',position:'المنصب من Phase 4',direct_manager:'المدير المباشر من Phase 4',actual_start_date:'تاريخ المباشرة من الملف',join_date:'تاريخ التعيين من الملف',basic_salary:'حسب صلاحية الراتب',housing_allowance:'حسب صلاحية الراتب',transport_allowance:'حسب صلاحية الراتب',other_allowances:'حسب صلاحية الراتب',nationality:'الجنسية من الملف',work_location:'موقع العمل من الملف',contract_type:'نوع العقد من الملف'}; return map[key]||'قيمة من بيانات الموظف عند التشغيل'; }

function CreateTemplatePage({saving,error,onCancel,onCreate}:{saving:boolean;error:string;onCancel:()=>void;onCreate:(name:string,description:string,allowed:string[])=>Promise<void>|void}) {
  const [name,setName]=useState('');
  const [description,setDescription]=useState('');
  const [allowed,setAllowed]=useState<string[]>(['self']);
  const [localError,setLocalError]=useState('');
  const valid=Boolean(name.trim()&&allowed.length);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    setLocalError('');
    if(!name.trim()) { setLocalError('اسم المعاملة مطلوب.'); return; }
    if(!allowed.length) { setLocalError('حدد جهة واحدة على الأقل تستطيع تقديم المعاملة.'); return; }
    await onCreate(name.trim(),description.trim(),allowed);
  }
  return <div className="workflow-studio premium-studio wow-studio"><section className="wf-hero compact"><div className="wf-hero-copy"><div className="wf-crumb"><button type="button" onClick={onCancel}>استوديو سير العمل</button><ChevronLeft size={14}/><span>قالب جديد</span></div><div className="wf-hero-title-row"><span className="wf-hero-symbol"><FileText size={28}/></span><div><div className="wf-kicker">NEW WORKFLOW</div><h1>إنشاء قالب معاملة</h1><p>ابدأ باسم واضح، وصف مختصر، وحدد من يملك حق تقديم هذا النوع.</p></div></div></div><span className="wf-status draft"><span/>مسودة جديدة</span></section>{(error||localError)&&<div className="wf-alert-v2 danger"><CircleAlert size={19}/><div><strong>تعذر إنشاء القالب</strong><span>{localError||error}</span></div></div>}<form className="wf-card wf-create-card" onSubmit={submit} noValidate><div className="wf-create-heading"><span>01</span><div><span className="wf-kicker soft">BASIC SETUP</span><h2>بيانات القالب الأساسية</h2><p>بعد الحفظ سيُنشئ النظام المرحلة الأولى تلقائيًا ويفتح لك المصمم.</p></div></div><label className="wf-input-group"><span>اسم المعاملة <em>مطلوب</em></span><input autoFocus required value={name} onChange={e=>{setName(e.target.value);if(localError)setLocalError('')}} placeholder="مثال: طلب تغيير المسمى الوظيفي" /></label><label className="wf-input-group"><span>الوصف <em>اختياري</em></span><textarea rows={4} value={description} onChange={e=>setDescription(e.target.value)} placeholder="متى تستخدم هذه المعاملة؟"/></label><div className="wf-access-box"><div><strong>من يستطيع تقديم المعاملة؟</strong><span>يمكن تعديل إعداد التقديم لاحقًا.</span></div><div className="wf-choice-pills">{[['self','الموظف نفسه'],['company_admin','مدير الشركة']].map(([key,label])=>{const on=allowed.includes(key);return <button type="button" key={key} className={on?'on':''} onClick={()=>{const next=on?allowed.filter(x=>x!==key):[...allowed,key];setAllowed(next);if(next.length)setLocalError('')}}><span>{on&&<Check size={12}/>}</span>{label}</button>})}</div></div><div className="wf-create-footer"><button type="button" className="wf-secondary-action" onClick={onCancel}>إلغاء</button><button type="submit" className="wf-primary-action large" disabled={saving}>{saving?'جارٍ إنشاء القالب…':'حفظ وفتح المرحلة الأولى'}<ChevronLeft size={16}/></button></div></form></div>;
}

function TemplateList({templates,loading,error,onOpen,onCleanup,onCreate}:{templates:Template[];loading:boolean;error:string;onOpen:(id:string)=>void;onCleanup:()=>void;onCreate:()=>void}) {
  const active=templates.filter(t=>t.status==='active').length;
  return <div className="workflow-studio premium-studio wow-studio"><section className="wf-hero list"><div className="wf-hero-copy"><div className="wf-kicker">WORKFLOW STUDIO</div><div className="wf-hero-title-row"><span className="wf-hero-symbol"><WorkflowIcon size={28}/></span><div><h1>استوديو سير العمل</h1><p>مساحة تصميم مؤسسية لبناء قوالب معاملات مرنة، قابلة للمعاينة والاختبار قبل الاعتماد.</p></div></div></div><div className="wf-hero-actions"><span className="wf-metric-hero"><b>{templates.length}</b><small>قوالب</small></span><span className="wf-metric-hero"><b>{active}</b><small>معتمدة</small></span><button type="button" className="wf-hero-light" onClick={onCleanup}><Trash2 size={15}/>تصفير Phase 6</button><button type="button" className="wf-primary-action light" onClick={onCreate}><Plus size={16}/>إنشاء قالب</button></div></section>{error&&<div className="wf-alert-v2 danger"><CircleAlert size={19}/><div><strong>تعذر تحميل الاستوديو</strong><span>{error}</span></div></div>}{loading?<LoadingState/>:<section className="wf-template-zone"><div className="wf-section-intro"><div><div className="wf-kicker soft">TEMPLATES</div><h2>قوالب المعاملات</h2><p>كل قالب هنا مسودة أو إصدار معتمد من استوديو سير العمل.</p></div></div>{templates.length?<div className="wf-template-grid">{templates.map(t=><article className="wf-template-card" key={t.id}><div className="wf-template-head"><span className="wf-template-icon"><WorkflowIcon size={18}/></span><span className={`wf-status-pill ${t.status==='active'?'active':'draft'}`}><span/>{t.status==='active'?'معتمد':'مسودة'}</span></div><h3>{t.name_ar}</h3><p>{t.description||'لا يوجد وصف لهذا القالب.'}</p><div className="wf-template-stats"><span><b>{t.stage_count||0}</b>مراحل</span><span><b>{t.latest_version||1}</b>إصدار</span><span><b>{t.draft_id?'مفتوح':'—'}</b>مسودة</span></div><div className="wf-template-actions"><button type="button" className="wf-secondary-action" onClick={()=>onOpen(t.id)}>فتح التصميم</button><button type="button" className="wf-primary-action" onClick={()=>onOpen(t.id)}><Settings2 size={15}/>تعديل</button></div></article>)}</div>:<div className="wf-template-empty"><div><WorkflowIcon size={28}/></div><h3>لا توجد قوالب بعد</h3><p>ابدأ ببناء أول قالب، ثم اختر البيانات النظامية التي تريد أن تظهر تلقائيًا للمستخدمين.</p><button type="button" className="wf-primary-action" onClick={onCreate}><Plus size={16}/>إنشاء أول قالب</button></div>}</section>}</div>;
}
