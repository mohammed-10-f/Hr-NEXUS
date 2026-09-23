import { FormEvent, useEffect, useMemo, useState } from 'react';
import { KeyRound, Plus, RefreshCw, Search, ShieldCheck, UserPlus, Users as UsersIcon, X } from 'lucide-react';
import { api } from '../lib/api';

type User={id:string;username:string;employee_id:string|null;employee_number?:string|null;national_id?:string|null;must_change_password:boolean;status:'active'|'inactive'|'locked';last_login_at:string|null;roles:string[]};
type Role={id:string;name_ar:string;name_en:string|null;status:'active'|'disabled';system_role:number};
type Permission={id:string;resource:string;action:string;name_ar:string;name_en?:string|null};
type Override={permission_id:string;name_ar:string;effect:'allow'|'deny';scope:string;scope_value:string|null};

export function Users(){
 const [items,setItems]=useState<User[]>([]),[roles,setRoles]=useState<Role[]>([]),[permissions,setPermissions]=useState<Permission[]>([]);
 const [search,setSearch]=useState(''),[status,setStatus]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [selected,setSelected]=useState<User|null>(null),[detail,setDetail]=useState<any>(null),[effective,setEffective]=useState<any[]>([]);
 const [showForm,setShowForm]=useState(false),[busy,setBusy]=useState(false);
 const [username,setUsername]=useState(''),[employeeId,setEmployeeId]=useState(''),[password,setPassword]=useState(''),[roleIds,setRoleIds]=useState<string[]>([]);
 const [editStatus,setEditStatus]=useState<'active'|'inactive'|'locked'>('active');
 const [selectedPermission,setSelectedPermission]=useState(''),[overrideEffect,setOverrideEffect]=useState<'allow'|'deny'>('allow'),[overrideScope,setOverrideScope]=useState('company'),[overrideScopeValue,setOverrideScopeValue]=useState('');
 const [overrides,setOverrides]=useState<Override[]>([]),[scopeOptions,setScopeOptions]=useState<any[]>([]);

 async function load(){
  setLoading(true);setError('');
  try{
   const q=new URLSearchParams();if(search)q.set('search',search);if(status)q.set('status',status);
   const [u,r,p,s]=await Promise.all([
    api<{items:User[]}>(`/api/company/users?${q}`),
    api<{items:Role[]}>('/api/company/roles'),
    api<{items:Permission[]}>('/api/company/permissions'),
    api<{items:any[]}>('/api/company/scope-options')
   ]);
   setItems(u.items);setRoles(r.items);setPermissions(p.items);setScopeOptions(s.items);
  }catch(err){setError(err instanceof Error&&err.message==='FORBIDDEN'?'لا تملك صلاحية إدارة المستخدمين.':'تعذر تحميل المستخدمين.')}
  finally{setLoading(false)}
 }
 useEffect(()=>{void load()},[status]);
 useEffect(()=>{const t=setTimeout(()=>void load(),300);return()=>clearTimeout(t)},[search]);

 async function openUser(u:User){
  setSelected(u);setError('');
  try{
   const [d,e]=await Promise.all([
    api<any>(`/api/company/users/${u.id}`),
    api<{items:any[]}>(`/api/company/users/${u.id}/effective-permissions`)
   ]);
   setDetail(d);setEffective(e.items);setOverrides(d.overrides);
   setRoleIds(d.roles.map((r:Role)=>r.id));setEditStatus(u.status);
  }catch{setError('تعذر تحميل تفاصيل المستخدم.')}
 }
 async function saveNew(e:FormEvent){
  e.preventDefault();setBusy(true);setError('');
  try{
   await api('/api/company/users',{method:'POST',body:JSON.stringify({username,employeeId:employeeId||null,password,roleIds})});
   setShowForm(false);setUsername('');setEmployeeId('');setPassword('');setRoleIds([]);await load();
  }catch(err){setError(mapError(err))}
  finally{setBusy(false)}
 }
 async function saveUser(){
  if(!selected)return;setBusy(true);setError('');
  try{
   await api(`/api/company/users/${selected.id}`,{method:'PATCH',body:JSON.stringify({status:editStatus})});
   if(selected.id!==detail?.user?.id)return;
   await api(`/api/company/users/${selected.id}/roles`,{method:'PUT',body:JSON.stringify({roleIds})});
   await api(`/api/company/users/${selected.id}/overrides`,{method:'PUT',body:JSON.stringify({overrides})});
   await load();const fresh=items.find(x=>x.id===selected.id);if(fresh)await openUser(fresh);
  }catch(err){setError(mapError(err))}
  finally{setBusy(false)}
 }
 async function resetPasswordFor(user:User|null){
  if(!user)return; const next=window.prompt('أدخل كلمة المرور المؤقتة الجديدة (8 أحرف على الأقل):');if(!next)return;
  setBusy(true);setError('');
  try{await api(`/api/company/users/${user.id}/reset-password`,{method:'POST',body:JSON.stringify({newPassword:next})});setError('تمت إعادة تعيين كلمة المرور وإلغاء الجلسات الحالية.');}
  catch(err){setError(mapError(err))}finally{setBusy(false)}
 }
 function addOverride(){
  if(!selectedPermission)return;
  setOverrides(v=>[...v.filter(x=>x.permission_id!==selectedPermission),{permission_id:selectedPermission,name_ar:permissions.find(p=>p.id===selectedPermission)?.name_ar??selectedPermission,effect:overrideEffect,scope:overrideScope,scope_value:overrideScope==='company'||overrideScope==='self'?null:overrideScopeValue||null}]);
  setSelectedPermission('');setOverrideScopeValue('');
 }
 const availablePermissions=useMemo(()=>permissions.filter(p=>!overrides.some(o=>o.permission_id===p.id)),[permissions,overrides]);
 return <div>
  <div className="page-header"><div><div className="eyebrow">الإدارة</div><h1>المستخدمون</h1><p>إدارة حسابات مستخدمي الشركة وأدوارهم وصلاحياتهم الفعلية.</p></div><div className="header-actions"><button className="btn secondary" onClick={()=>void load()}><RefreshCw size={16}/> تحديث</button><button className="btn primary" onClick={()=>setShowForm(true)}><UserPlus size={16}/> إضافة مستخدم</button></div></div>
  {error&&<div className="login-error page-error">{error}</div>}
  <section className="panel"><div className="filter-bar"><div className="search-field"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="البحث باسم المستخدم أو الموظف أو الهوية"/></div><div className="filter-select"><span>الحالة</span><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">الكل</option><option value="active">نشط</option><option value="inactive">غير نشط</option><option value="locked">مقفل</option></select></div></div>
   {loading?<div className="panel-empty">جاري تحميل المستخدمين...</div>:items.length===0?<div className="panel-empty"><UsersIcon size={28}/><p>لا توجد حسابات مطابقة.</p></div>:
   <div className="table-wrap"><table><thead><tr><th>المستخدم</th><th>الموظف</th><th>الأدوار</th><th>الحالة</th><th>آخر دخول</th><th>الإجراءات</th></tr></thead><tbody>{items.map(u=><tr key={u.id}><td><strong>{u.username}</strong>{u.must_change_password&&<div className="mono">تغيير كلمة المرور مطلوب</div>}</td><td>{u.employee_number||'—'}</td><td>{u.roles.length?u.roles.map(r=><span className="badge neutral" key={r}>{r}</span>):'—'}</td><td><span className={`badge ${u.status==='active'?'success':u.status==='locked'?'danger':'neutral'}`}>{u.status==='active'?'نشط':u.status==='locked'?'مقفل':'غير نشط'}</span></td><td>{u.last_login_at||'—'}</td><td><button className="table-link" onClick={()=>void openUser(u)}><ShieldCheck size={14}/> الصلاحيات</button> <button className="table-link" onClick={()=>void resetPasswordFor(u)}><KeyRound size={14}/> كلمة المرور</button></td></tr>)}</tbody></table></div>}
  </section>

  {showForm&&<div className="modal-backdrop"><form className="access-modal" onSubmit={saveNew}><button type="button" className="modal-close" onClick={()=>setShowForm(false)}><X size={18}/></button><div className="modal-icon pending"><UserPlus size={24}/></div><h3>إضافة مستخدم</h3><p>الحساب المرتبط بموظف يستخدم رقم الهوية الوطنية كاسم مستخدم.</p><div className="modal-form-grid"><label className="modal-field">اسم المستخدم<input required value={username} onChange={e=>setUsername(e.target.value)}/></label><label className="modal-field">معرّف الموظف<input value={employeeId} onChange={e=>setEmployeeId(e.target.value)} placeholder="معرّف سجل الموظف"/></label><label className="modal-field">كلمة المرور المؤقتة<input required minLength={8} type="password" value={password} onChange={e=>setPassword(e.target.value)}/></label></div><div className="form-section"><strong>الأدوار</strong>{roles.filter(r=>r.status==='active').map(r=><label className="check-row" key={r.id}><input type="checkbox" checked={roleIds.includes(r.id)} onChange={e=>setRoleIds(v=>e.target.checked?[...v,r.id]:v.filter(x=>x!==r.id))}/><span>{r.name_ar}</span></label>)}</div><div className="form-actions"><button type="button" className="btn secondary" onClick={()=>setShowForm(false)}>إلغاء</button><button className="btn primary" disabled={busy}>إنشاء المستخدم</button></div></form></div>}

  {selected&&detail&&<div className="modal-backdrop"><div className="access-modal wide-modal"><button className="modal-close" onClick={()=>setSelected(null)}><X size={18}/></button><div className="modal-icon pending"><ShieldCheck size={24}/></div><h3>{detail.user.username}</h3><p>{detail.user.employee_number||'حساب غير مرتبط بموظف'} · الصلاحيات الفعلية</p>
   <div className="modal-form-grid"><label className="modal-field">الحالة<select value={editStatus} onChange={e=>setEditStatus(e.target.value as any)}><option value="active">نشط</option><option value="inactive">غير نشط</option><option value="locked">مقفل</option></select></label></div>
   <div className="form-section"><strong>الأدوار المعيّنة</strong>{roles.filter(r=>r.status==='active').map(r=><label className="check-row" key={r.id}><input type="checkbox" checked={roleIds.includes(r.id)} onChange={e=>setRoleIds(v=>e.target.checked?[...v,r.id]:v.filter(x=>x!==r.id))}/><span>{r.name_ar}</span></label>)}</div>
   <div className="form-section"><strong>الاستثناءات الفردية</strong><div className="modal-form-grid"><label className="modal-field">الصلاحية<select value={selectedPermission} onChange={e=>setSelectedPermission(e.target.value)}><option value="">اختر صلاحية</option>{availablePermissions.map(p=><option key={p.id} value={p.id}>{p.name_ar} — {p.id}</option>)}</select></label><label className="modal-field">النتيجة<select value={overrideEffect} onChange={e=>setOverrideEffect(e.target.value as any)}><option value="allow">منح</option><option value="deny">منع</option></select></label><label className="modal-field">النطاق<select value={overrideScope} onChange={e=>setOverrideScope(e.target.value)}><option value="company">الشركة كاملة</option><option value="management_unit">الوحدة الإدارية وفروعها</option><option value="department">الإدارة</option><option value="section">القسم</option><option value="self">الذات</option></select></label>{!['company','self'].includes(overrideScope)&&<label className="modal-field">الوحدة التنظيمية<select value={overrideScopeValue} onChange={e=>setOverrideScopeValue(e.target.value)}><option value="">اختر الوحدة</option>{scopeOptions.map(o=><option key={o.id} value={o.id}>{o.name_ar}</option>)}</select></label>}</div><button type="button" className="btn secondary" onClick={addOverride} disabled={!selectedPermission}>إضافة الاستثناء</button>
    {overrides.length>0&&<div className="table-wrap"><table><thead><tr><th>الصلاحية</th><th>النتيجة</th><th>النطاق</th><th></th></tr></thead><tbody>{overrides.map(o=><tr key={`${o.permission_id}-${o.scope}`}><td>{o.name_ar}<div className="mono">{o.permission_id}</div></td><td><span className={`badge ${o.effect==='allow'?'success':'danger'}`}>{o.effect==='allow'?'منح مباشر':'منع مباشر'}</span></td><td>{scopeLabel(o.scope)}{o.scope_value&&<div className="mono">{o.scope_value}</div>}</td><td><button className="table-link" onClick={()=>setOverrides(v=>v.filter(x=>x.permission_id!==o.permission_id))}>إزالة</button></td></tr>)}</tbody></table></div>}</div>
   <div className="form-section"><strong>الصلاحيات الفعلية</strong><div className="permission-list">{effective.map((p:any)=><div className="permission-row" key={`${p.permission_id}-${p.scope}-${p.scope_value??''}`}><span>{p.name_ar}</span><span className="mono">{p.permission_id}</span><span className={`badge ${p.effect==='deny'?'danger':'success'}`}>{p.source==='role'?'موروثة':'مباشرة'} · {p.effect==='deny'?'ممنوعة':'فعالة'}</span><small>{scopeLabel(p.scope)}</small></div>)}</div></div>
   <div className="form-actions"><button className="btn secondary" onClick={()=>void resetPasswordFor(selected)} disabled={busy}>إعادة تعيين كلمة المرور</button><button className="btn primary" onClick={()=>void saveUser()} disabled={busy}>حفظ التعديلات</button></div>
  </div></div>}
 </div>
}
function scopeLabel(scope:string){return ({company:'الشركة كاملة',management_unit:'الوحدة الإدارية',department:'الإدارة',section:'القسم',self:'الذات'} as any)[scope]||scope}
function mapError(err:unknown){
 const x=err instanceof Error?err.message:'';
 const m:any={USERNAME_OR_EMPLOYEE_EXISTS:'اسم المستخدم أو الموظف مرتبط بحساب آخر.',EMPLOYEE_NOT_FOUND:'الموظف غير موجود داخل الشركة.',EMPLOYEE_NATIONAL_ID_REQUIRED:'لا يمكن إنشاء حساب موظف قبل توفر رقم الهوية.',EMPLOYEE_USERNAME_MUST_BE_NATIONAL_ID:'اسم مستخدم حساب الموظف يجب أن يطابق رقم الهوية الوطنية.',ROLE_DISABLED:'لا يمكن تعيين دور معطل.',INVALID_ROLE:'الدور غير صالح.',SELF_PERMISSION_CHANGE_FORBIDDEN:'لا يمكن للمستخدم منح نفسه أدوارًا أو استثناءات صلاحيات.',FORBIDDEN:'لا تملك الصلاحية اللازمة.',INVALID_SCOPE:'النطاق المحدد غير صالح.'};
 return m[x]||'تعذر تنفيذ العملية.';
}
