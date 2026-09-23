import { FormEvent, useEffect, useState } from 'react';
import { Edit3, Plus, RefreshCw, ShieldCheck, Users, X } from 'lucide-react';
import { api } from '../lib/api';

type Role={id:string;name_ar:string;name_en:string|null;code:string;system_role:number;status:'active'|'disabled';user_count:number;permission_count:number};
type Permission={id:string;resource:string;action:string;name_ar:string;name_en?:string|null};
type Scope={permissionId:string;scope:string;scopeValue:string|null};

export function Roles(){
 const [items,setItems]=useState<Role[]>([]),[permissions,setPermissions]=useState<Permission[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [edit,setEdit]=useState<Role|null>(null),[showForm,setShowForm]=useState(false),[busy,setBusy]=useState(false);
 const [nameAr,setNameAr]=useState(''),[nameEn,setNameEn]=useState(''),[status,setStatus]=useState<'active'|'disabled'>('active'),[selected,setSelected]=useState<string[]>([]),[scopes,setScopes]=useState<Scope[]>([]),[scopeOptions,setScopeOptions]=useState<any[]>([]);
 async function load(){
  setLoading(true);setError('');
  try{
   const [r,p,s]=await Promise.all([
    api<{items:Role[]}>('/api/company/roles'),
    api<{items:Permission[]}>('/api/company/permissions'),
    api<{items:any[]}>('/api/company/scope-options')
   ]);
   setItems(r.items);setPermissions(p.items);setScopeOptions(s.items);
  }catch(err){setError(err instanceof Error&&err.message==='FORBIDDEN'?'لا تملك صلاحية إدارة الأدوار.':'تعذر تحميل الأدوار.')}
  finally{setLoading(false)}
 }
 useEffect(()=>{void load()},[]);
 function openCreate(){setEdit(null);setNameAr('');setNameEn('');setStatus('active');setSelected([]);setScopes([]);setShowForm(true)}
 async function openEdit(role:Role){
  setError('');
  try{
   const d=await api<any>(`/api/company/roles/${role.id}`);
   setEdit(role);setNameAr(d.role.name_ar);setNameEn(d.role.name_en||'');setStatus(d.role.status);
   setSelected(d.permissions.map((p:any)=>p.permission_id));
   setScopes(d.permissions.map((p:any)=>({permissionId:p.permission_id,scope:p.scope,scopeValue:p.scope_value})));
   setShowForm(true);
  }catch(err){setError(err instanceof Error&&err.message==='SYSTEM_ROLE_PROTECTED'?'لا يمكن تعديل الدور النظامي.':'تعذر تحميل الدور.')}
 }
 function togglePermission(id:string,on:boolean){
  setSelected(v=>on?[...v,id]:v.filter(x=>x!==id));
  if(!on)setScopes(v=>v.filter(x=>x.permissionId!==id));
 }
 function setScope(id:string,scope:string,value:string|null=null){
  setScopes(v=>[...v.filter(x=>x.permissionId!==id),{permissionId:id,scope,scopeValue:value}]);
 }
 async function save(e:FormEvent){
  e.preventDefault();setBusy(true);setError('');
  try{
   if(edit){
    await api(`/api/company/roles/${edit.id}`,{method:'PATCH',body:JSON.stringify({nameAr,nameEn:nameEn||null,status,permissionIds:selected,permissionScopes:scopes})});
   }else{
    await api('/api/company/roles',{method:'POST',body:JSON.stringify({nameAr,nameEn:nameEn||null,permissionIds:selected})});
   }
   setShowForm(false);await load();
  }catch(err){const x=err instanceof Error?err.message:'';setError(x==='SELF_PERMISSION_CHANGE_FORBIDDEN'?'لا يمكن تعديل صلاحيات دور مرتبط بحسابك الحالي.':x==='SYSTEM_ROLE_PROTECTED'?'الدور النظامي محمي ولا يمكن تعديله.':x==='FORBIDDEN'?'لا تملك الصلاحية اللازمة.':'تعذر حفظ الدور.')}
  finally{setBusy(false)}
 }
 return <div>
  <div className="page-header"><div><div className="eyebrow">الإدارة</div><h1>الأدوار والصلاحيات</h1><p>أنشئ أدوارًا داخل الشركة باستخدام كتالوج الصلاحيات النظامية المتاح.</p></div><div className="header-actions"><button className="btn secondary" onClick={()=>void load()}><RefreshCw size={16}/> تحديث</button><button className="btn primary" onClick={openCreate}><Plus size={16}/> إنشاء دور</button></div></div>
  {error&&<div className="login-error page-error">{error}</div>}
  <section className="panel"><div className="panel-head"><div><h3>أدوار الشركة</h3><p>الدور المعطل لا يمنح أي صلاحيات، ولا يتم حذف الأدوار من النظام.</p></div></div>
  {loading?<div className="panel-empty">جاري تحميل الأدوار...</div>:items.length===0?<div className="panel-empty">لا توجد أدوار.</div>:
  <div className="table-wrap"><table><thead><tr><th>الدور</th><th>الحالة</th><th>المستخدمون</th><th>الصلاحيات</th><th>الإجراءات</th></tr></thead><tbody>{items.map(r=><tr key={r.id}><td><strong>{r.name_ar}</strong><div className="mono">{r.system_role?'دور نظامي':r.code}</div></td><td><span className={`badge ${r.status==='active'?'success':'neutral'}`}>{r.status==='active'?'نشط':'معطل'}</span></td><td><Users size={14}/> {r.user_count}</td><td>{r.permission_count}</td><td>{r.system_role?<span className="mono">محمي</span>:<button className="table-link" onClick={()=>void openEdit(r)}><Edit3 size={14}/> تعديل</button>}</td></tr>)}</tbody></table></div>}
  </section>
  {showForm&&<div className="modal-backdrop"><form className="access-modal wide-modal" onSubmit={save}><button type="button" className="modal-close" onClick={()=>setShowForm(false)}><X size={18}/></button><div className="modal-icon pending"><ShieldCheck size={24}/></div><h3>{edit?'تعديل الدور':'إنشاء دور'}</h3><div className="modal-form-grid"><label className="modal-field">اسم الدور<input required value={nameAr} onChange={e=>setNameAr(e.target.value)}/></label><label className="modal-field">الاسم بالإنجليزية<input value={nameEn} onChange={e=>setNameEn(e.target.value)}/></label>{edit&&<label className="modal-field">الحالة<select value={status} onChange={e=>setStatus(e.target.value as any)}><option value="active">نشط</option><option value="disabled">معطل</option></select></label>}</div>
   <div className="form-section"><strong>الصلاحيات النظامية</strong><div className="permission-grid">{permissions.map(p=>{const on=selected.includes(p.id);const sc=scopes.find(x=>x.permissionId===p.id);return <div className="permission-editor" key={p.id}><label className="check-row"><input type="checkbox" checked={on} onChange={e=>togglePermission(p.id,e.target.checked)}/><span>{p.name_ar}<small className="mono">{p.id}</small></span></label>{on&&<div className="scope-inline"><select value={sc?.scope||'company'} onChange={e=>setScope(p.id,e.target.value,sc?.scopeValue||null)}><option value="company">الشركة كاملة</option><option value="management_unit">الوحدة الإدارية وفروعها</option><option value="department">الإدارة</option><option value="section">القسم</option><option value="self">الذات</option></select>{sc&&['management_unit','department','section'].includes(sc.scope)&&<select value={sc.scopeValue||''} onChange={e=>setScope(p.id,sc.scope,e.target.value||null)}><option value="">اختر الوحدة</option>{scopeOptions.map(o=><option key={o.id} value={o.id}>{o.name_ar}</option>)}</select>}</div>}</div>})}</div></div>
   <div className="form-actions"><button type="button" className="btn secondary" onClick={()=>setShowForm(false)}>إلغاء</button><button className="btn primary" disabled={busy}>{busy?'جارٍ الحفظ...':'حفظ الدور'}</button></div>
  </form></div>}
 </div>
}
