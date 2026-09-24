import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Building2, ChevronDown, Download, Edit3, GitBranch, Plus, Search,
  UserCog, Users, X, BriefcaseBusiness
} from 'lucide-react';
import { api } from '../lib/api';

type Unit = {
  id:string; parent_id:string|null; name_ar:string; name_en:string|null;
  level_name:string|null; code:string|null; active:number; position_count:number;
};
type Position = {
  id:string; organization_unit_id:string; title_ar:string; title_en:string|null;
  code:string|null; status:'vacant'|'occupied'|'frozen'; manager_position_id:string|null;
  organization_unit_name:string; manager_title_ar:string|null;
};
type OrgData = {
  units:Unit[]; positions:Position[];
  stats:{unit_count:number;position_count:number;occupied_count:number;vacant_count:number;frozen_count:number}
};

const statusLabel = { vacant:'شاغر', occupied:'مشغول', frozen:'مجمّد' } as const;

export function Organization(){
  const [data,setData] = useState<OrgData|null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [search,setSearch] = useState('');
  const [expanded,setExpanded] = useState<Set<string>>(new Set());
  const [showUnit,setShowUnit] = useState(false);
  const [showPosition,setShowPosition] = useState(false);
  const [editingUnit,setEditingUnit] = useState<Unit|null>(null);
  const [editingPosition,setEditingPosition] = useState<Position|null>(null);
  const [busy,setBusy] = useState(false);

  const [unitName,setUnitName] = useState('');
  const [unitNameEn,setUnitNameEn] = useState('');
  const [unitLevel,setUnitLevel] = useState('');
  const [unitCode,setUnitCode] = useState('');
  const [unitParent,setUnitParent] = useState('');
  const [unitActive,setUnitActive] = useState(true);

  const [posUnit,setPosUnit] = useState('');
  const [posTitle,setPosTitle] = useState('');
  const [posTitleEn,setPosTitleEn] = useState('');
  const [posCode,setPosCode] = useState('');
  const [posStatus,setPosStatus] = useState<Position['status']>('vacant');
  const [posManager,setPosManager] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const next = await api<OrgData>('/api/organization');
      setData(next);
      setExpanded(prev => {
        const valid = new Set(next.units.map(u => u.id));
        return new Set([...prev].filter(id => valid.has(id)));
      });
    } catch(e) {
      setError(e instanceof Error && e.message==='ORG-010' ? 'لا تملك صلاحية عرض الهيكل التنظيمي.' : 'تعذر تحميل الهيكل التنظيمي.');
    } finally { setLoading(false); }
  };

  useEffect(()=>{ void load(); },[]);

  const units = data?.units ?? [];
  const positions = data?.positions ?? [];
  const children = useMemo(() => {
    const map = new Map<string,Unit[]>();
    for (const unit of units) {
      if (!unit.parent_id) continue;
      const list = map.get(unit.parent_id) ?? [];
      list.push(unit); map.set(unit.parent_id,list);
    }
    return map;
  },[units]);
  const roots = useMemo(() => units.filter(u=>!u.parent_id),[units]);
  const positionByUnit = useMemo(() => {
    const map = new Map<string,Position[]>();
    for (const p of positions) {
      const list = map.get(p.organization_unit_id) ?? [];
      list.push(p); map.set(p.organization_unit_id,list);
    }
    return map;
  },[positions]);

  const normalizedSearch = search.trim().toLocaleLowerCase('ar');
  const textMatches = (text:string) => !normalizedSearch || text.toLocaleLowerCase('ar').includes(normalizedSearch);
  const unitDirectMatch = (u:Unit) => textMatches(`${u.name_ar} ${u.name_en??''} ${u.code??''} ${u.level_name??''}`);
  const positionMatch = (p:Position) => textMatches(`${p.title_ar} ${p.title_en??''} ${p.code??''} ${p.organization_unit_name}`);

  const unitHasMatch = (u:Unit):boolean => {
    if (unitDirectMatch(u)) return true;
    return (children.get(u.id)??[]).some(unitHasMatch) || (positionByUnit.get(u.id)??[]).some(positionMatch);
  };

  const searchPathIds = useMemo(() => {
    if (!normalizedSearch) return new Set<string>();
    const result = new Set<string>();
    const walk = (u:Unit) => {
      const childList = children.get(u.id) ?? [];
      const own = unitDirectMatch(u) || (positionByUnit.get(u.id)??[]).some(positionMatch);
      let descendant = false;
      for (const child of childList) { walk(child); if (result.has(child.id)) descendant = true; }
      if (own || descendant) result.add(u.id);
    };
    for (const root of roots) walk(root);
    return result;
  },[normalizedSearch,children,roots,positionByUnit]);

  const visibleExpanded = normalizedSearch ? searchPathIds : expanded;

  const toggle = (id:string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const expandAll = () => setExpanded(new Set(units.map(u=>u.id)));
  const collapseAll = () => setExpanded(new Set());

  function openUnit(unit?:Unit, parentId?:string){
    setEditingUnit(unit??null);
    setUnitName(unit?.name_ar??''); setUnitNameEn(unit?.name_en??'');
    setUnitLevel(unit?.level_name??''); setUnitCode(unit?.code??'');
    setUnitParent(parentId ?? unit?.parent_id ?? '');
    setUnitActive(unit ? Boolean(unit.active) : true);
    setShowUnit(true); setError('');
  }
  function openPosition(pos?:Position, unitId?:string){
    setEditingPosition(pos??null);
    setPosUnit(pos?.organization_unit_id ?? unitId ?? units.find(u=>u.active)?.id ?? '');
    setPosTitle(pos?.title_ar??''); setPosTitleEn(pos?.title_en??'');
    setPosCode(pos?.code??''); setPosStatus(pos?.status??'vacant');
    setPosManager(pos?.manager_position_id??''); setShowPosition(true); setError('');
  }

  async function saveUnit(e:FormEvent){
    e.preventDefault(); setBusy(true); setError('');
    try {
      const body={nameAr:unitName,nameEn:unitNameEn||null,levelName:unitLevel,code:unitCode||null,parentId:unitParent||null,active:unitActive};
      if(editingUnit) await api(`/api/organization/units/${editingUnit.id}`,{method:'PATCH',body:JSON.stringify(body)});
      else await api('/api/organization/units',{method:'POST',body:JSON.stringify(body)});
      setShowUnit(false); await load();
      if(unitParent) setExpanded(prev=>new Set(prev).add(unitParent));
    } catch(e){ setError(errorText(e)); } finally { setBusy(false); }
  }

  async function savePosition(e:FormEvent){
    e.preventDefault(); setBusy(true); setError('');
    try {
      const body={organizationUnitId:posUnit,titleAr:posTitle,titleEn:posTitleEn||null,code:posCode||null,status:posStatus,managerPositionId:posManager||null};
      if(editingPosition) await api(`/api/organization/positions/${editingPosition.id}`,{method:'PATCH',body:JSON.stringify(body)});
      else await api('/api/organization/positions',{method:'POST',body:JSON.stringify(body)});
      setShowPosition(false); await load();
    } catch(e){ setError(errorText(e)); } finally { setBusy(false); }
  }

  const errorText = (e:any) => {
    const code=e instanceof Error?e.message:'';
    const map:any={
      'ORG-001':'بيانات الوحدة غير مكتملة أو غير صحيحة.',
      'ORG-003':'الوحدة الأب غير صالحة.',
      'ORG-004':'لا يمكن نقل الوحدة إلى نفسها أو أحد فروعها.',
      'ORG-005':'لا يمكن استخدام سجل من شركة أخرى.',
      'ORG-006':'بيانات المنصب غير صحيحة.',
      'ORG-007':'لا يمكن إنشاء علاقة إدارية دائرية.',
      'ORG-008':'رمز المنصب مستخدم مسبقًا.',
      'ORG-010':'لا تملك الصلاحية المطلوبة.'
    };
    return map[code] || 'تعذر حفظ التغيير.';
  };

  function TreeNode({unit}:{unit:Unit}){
    const kids=children.get(unit.id)??[];
    const unitPositions=positionByUnit.get(unit.id)??[];
    const isOpen=visibleExpanded.has(unit.id);
    if(!unitHasMatch(unit)) return null;
    const directHit=normalizedSearch && unitDirectMatch(unit);
    return <div className="org-chart-node">
      <div className={`org-chart-card ${unit.active?'':'is-inactive'} ${directHit?'search-hit':''}`}>
        <div className="org-chart-card-head">
          <button className={`org-collapse ${kids.length?'':'disabled'}`} onClick={()=>kids.length&&toggle(unit.id)} aria-label={kids.length?(isOpen?'طي الوحدة':'توسيع الوحدة'): 'لا توجد وحدات فرعية'} disabled={!kids.length}>
            <ChevronDown size={16} className={isOpen?'':'org-chevron-collapsed'}/>
          </button>
          <div className="org-chart-icon"><Building2 size={19}/></div>
          <div className="org-chart-title"><strong>{unit.name_ar}</strong><span>{unit.level_name||'وحدة تنظيمية'}{unit.code?` · ${unit.code}`:''}</span></div>
          <div className="org-chart-actions">
            <button className="icon-btn compact" title="إضافة وحدة فرعية" onClick={()=>openUnit(undefined,unit.id)}><Plus size={14}/></button>
            <button className="icon-btn compact" title="إضافة منصب" onClick={()=>openPosition(undefined,unit.id)}><BriefcaseBusiness size={14}/></button>
            <button className="icon-btn compact" title="تعديل الوحدة" onClick={()=>openUnit(unit)}><Edit3 size={14}/></button>
          </div>
        </div>
        <div className="org-chart-meta">
          <span><BriefcaseBusiness size={13}/>{unitPositions.length} {unitPositions.length===1?'منصب':'مناصب'}</span>
          {!unit.active && <span className="badge danger">غير نشطة</span>}
          {kids.length>0 && <button className="org-count" onClick={()=>toggle(unit.id)}>{isOpen?'طي':'عرض'} {kids.length} فرعي</button>}
        </div>
        {isOpen && unitPositions.length>0 && <div className="org-position-chips">
          {unitPositions.map(p=><button key={p.id} className={`org-position-chip ${p.status}`} onClick={()=>openPosition(p)} title="تعديل المنصب">
            <UserCog size={13}/><span>{p.title_ar}</span><em>{statusLabel[p.status]}</em>
          </button>)}
        </div>}
      </div>
      {isOpen && kids.length>0 && <div className="org-chart-children">{kids.map(k=><TreeNode key={k.id} unit={k}/>)}</div>}
    </div>;
  }

  const matchingPositions=positions.filter(positionMatch);

  return <div>
    <div className="page-header">
      <div><div className="eyebrow">الهيكل المؤسسي</div><h1>الهيكل التنظيمي</h1><p>هيكل هرمي ديناميكي من بيانات الشركة، قابل للطي والتوسيع مع الوحدات والمناصب الفعلية.</p></div>
      <div className="header-actions">
        <button className="btn secondary" onClick={()=>window.location.href='/api/organization/export'}><Download size={16}/> تصدير</button>
        <button className="btn secondary" onClick={()=>openUnit()}><Plus size={16}/> وحدة تنظيمية</button>
        <button className="btn primary" onClick={()=>openPosition()} disabled={!units.some(u=>u.active)}><Plus size={16}/> منصب</button>
      </div>
    </div>
    {error&&<div className="login-error page-error">{error}</div>}
    <div className="org-toolbar">
      <div className="search-field"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="ابحث عن وحدة أو منصب..."/></div>
      <div className="org-toolbar-actions"><button className="btn secondary" onClick={expandAll}>توسيع الكل</button><button className="btn secondary" onClick={collapseAll}>طي الكل</button><div className="header-status"><GitBranch size={16}/> {data?.stats.unit_count||0} وحدة · {data?.stats.position_count||0} منصب</div></div>
    </div>

    {loading ? <div className="panel-empty">جاري تحميل الهيكل...</div> : <>
      <section className="panel org-chart-panel">
        <div className="panel-head"><div><h3>شجرة التنظيم</h3><p>الأب في الأعلى، والوحدات التابعة في المستوى التالي. استخدم + لإضافة مكتب أو إدارة أو قسم مباشرة تحت الوحدة.</p></div></div>
        {roots.length===0 ? <div className="state-card"><div className="state-icon"><Building2 size={22}/></div><h3>لا توجد وحدات تنظيمية</h3><p>ابدأ بإنشاء الشركة أو الوحدة الجذرية الأولى.</p><button className="btn primary" onClick={()=>openUnit()}><Plus size={16}/> إنشاء وحدة</button></div> :
          <div className="org-chart-canvas">{roots.map(root=><TreeNode key={root.id} unit={root}/>)}</div>}
      </section>

      <section className="panel org-positions-panel">
        <div className="panel-head"><div><h3>المناصب</h3><p>المنصب كيان مستقل عن الموظف، ويمكن أن يكون شاغرًا أو مشغولًا أو مجمّدًا.</p></div><button className="btn secondary" onClick={()=>openPosition()} disabled={!units.some(u=>u.active)}><Plus size={15}/> إضافة منصب</button></div>
        {matchingPositions.length===0 ? <div className="panel-empty">لا توجد مناصب مطابقة.</div> : <div className="position-list">{matchingPositions.map(p=><div className={`position-card ${p.status} ${normalizedSearch&&positionMatch(p)?'search-hit':''}`} key={p.id}>
          <div className="position-main"><div className="position-icon"><UserCog size={17}/></div><div><strong>{p.title_ar}</strong><span>{p.organization_unit_name}{p.code?` · ${p.code}`:''}</span><small>{p.manager_title_ar?`المدير: ${p.manager_title_ar}`:'بدون مدير مباشر'}</small></div></div>
          <div className="position-actions"><span className={`badge ${p.status==='occupied'?'success':p.status==='frozen'?'danger':'neutral'}`}>{statusLabel[p.status]}</span><button className="icon-btn compact" title="تعديل" onClick={()=>openPosition(p)}><Edit3 size={14}/></button></div>
        </div>)}</div>}
      </section>

      <div className="org-summary"><div><span><Users size={17}/>مشغولة</span><strong>{data?.stats.occupied_count??0}</strong></div><div><span><Building2 size={17}/>شاغرة</span><strong>{data?.stats.vacant_count??0}</strong></div><div><span><ChevronDown size={17}/>مجمّدة</span><strong>{data?.stats.frozen_count??0}</strong></div></div>
    </>}

    {showUnit&&<div className="modal-backdrop"><form className="access-modal wide-modal" onSubmit={saveUnit}>
      <button type="button" className="modal-close" onClick={()=>setShowUnit(false)}><X size={18}/></button><div className="modal-icon pending"><Building2 size={23}/></div>
      <h3>{editingUnit?'تعديل وحدة تنظيمية':'إنشاء وحدة تنظيمية'}</h3>
      <p className="modal-subtitle">أنشئ أي مستوى تنظيمي: مكتب الرئيس التنفيذي، إدارة، قسم، وحدة، أو غيرها.</p>
      <div className="modal-form-grid">
        <label className="modal-field">اسم الوحدة<input required value={unitName} onChange={e=>setUnitName(e.target.value)} placeholder="مثال: مكتب الرئيس التنفيذي"/></label>
        <label className="modal-field">الاسم بالإنجليزية<input value={unitNameEn} onChange={e=>setUnitNameEn(e.target.value)} placeholder="CEO Office"/></label>
        <label className="modal-field">المستوى التنظيمي<input required value={unitLevel} onChange={e=>setUnitLevel(e.target.value)} placeholder="مكتب / إدارة / قسم / قطاع"/></label>
        <label className="modal-field">الرمز<input value={unitCode} onChange={e=>setUnitCode(e.target.value)} placeholder="CEO-OFFICE"/></label>
        <label className="modal-field">الوحدة الأب<select value={unitParent} onChange={e=>setUnitParent(e.target.value)}><option value="">بدون أب (جذر)</option>{units.filter(u=>u.id!==editingUnit?.id&&u.active).map(u=><option key={u.id} value={u.id}>{u.name_ar}{u.level_name?` — ${u.level_name}`:''}</option>)}</select></label>
        {editingUnit&&<label className="check-row"><input type="checkbox" checked={unitActive} onChange={e=>setUnitActive(e.target.checked)}/><span>الوحدة نشطة</span></label>}
      </div>
      <div className="form-actions"><button type="button" className="btn secondary" onClick={()=>setShowUnit(false)}>إلغاء</button><button className="btn primary" disabled={busy}>{busy?'جارٍ الحفظ...':'حفظ الوحدة'}</button></div>
    </form></div>}

    {showPosition&&<div className="modal-backdrop"><form className="access-modal wide-modal" onSubmit={savePosition}>
      <button type="button" className="modal-close" onClick={()=>setShowPosition(false)}><X size={18}/></button><div className="modal-icon pending"><UserCog size={23}/></div>
      <h3>{editingPosition?'تعديل منصب':'إنشاء منصب'}</h3>
      <div className="modal-form-grid">
        <label className="modal-field">الوحدة التنظيمية<select required value={posUnit} onChange={e=>setPosUnit(e.target.value)}><option value="">اختر الوحدة</option>{units.filter(u=>u.active).map(u=><option key={u.id} value={u.id}>{u.name_ar}</option>)}</select></label>
        <label className="modal-field">اسم المنصب<input required value={posTitle} onChange={e=>setPosTitle(e.target.value)} placeholder="الرئيس التنفيذي"/></label>
        <label className="modal-field">الاسم بالإنجليزية<input value={posTitleEn} onChange={e=>setPosTitleEn(e.target.value)}/></label>
        <label className="modal-field">الرمز<input value={posCode} onChange={e=>setPosCode(e.target.value)}/></label>
        <label className="modal-field">الحالة<select value={posStatus} onChange={e=>setPosStatus(e.target.value as Position['status'])}><option value="vacant">شاغر</option><option value="occupied">مشغول</option><option value="frozen">مجمّد</option></select></label>
        <label className="modal-field">المدير المباشر<select value={posManager} onChange={e=>setPosManager(e.target.value)}><option value="">بدون مدير</option>{positions.filter(p=>p.id!==editingPosition?.id).map(p=><option key={p.id} value={p.id}>{p.title_ar} — {p.organization_unit_name}</option>)}</select></label>
      </div>
      <p className="form-hint">تغيير الوحدة أو المدير يتحقق منه الخادم لمنع العلاقات الدائرية أو تجاوز نطاق الشركة.</p>
      <div className="form-actions"><button type="button" className="btn secondary" onClick={()=>setShowPosition(false)}>إلغاء</button><button className="btn primary" disabled={busy}>{busy?'جارٍ الحفظ...':'حفظ المنصب'}</button></div>
    </form></div>}
  </div>;
}
