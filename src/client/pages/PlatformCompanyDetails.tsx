import { FormEvent, useEffect, useState } from 'react';
import { ArrowRight, Edit3, KeyRound, RefreshCw, ShieldCheck, UserPlus, Users, X } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';

type Company={id:string;company_identifier:string;legal_name:string;display_name:string;status:'active'|'suspended'|'archived';management_status:'active'|'inactive';created_at:string;updated_at:string};
type Admin={id:string;username:string;display_name:string|null;employee_id:string|null;status:string}|null;
type CompanyUser={id:string;username:string;employee_id:string|null;must_change_password:boolean;status:'active'|'inactive'|'locked';last_login_at:string|null;created_at:string;roles:string[]};

export function PlatformCompanyDetails(){
  const {id}=useParams();
  const [company,setCompany]=useState<Company|null>(null),[admin,setAdmin]=useState<Admin>(null),[requests,setRequests]=useState<any[]>([]),[users,setUsers]=useState<CompanyUser[]>([]),[edit,setEdit]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [displayName,setDisplayName]=useState(''),[legalName,setLegalName]=useState(''),[identifier,setIdentifier]=useState(''),[status,setStatus]=useState<'active'|'suspended'|'archived'>('active');
  const [showAdmin,setShowAdmin]=useState(false),[adminUsername,setAdminUsername]=useState(''),[adminEmployeeId,setAdminEmployeeId]=useState(''),[adminPassword,setAdminPassword]=useState('');
  const [resetUser,setResetUser]=useState<CompanyUser|null>(null),[resetPassword,setResetPassword]=useState(''),[editUser,setEditUser]=useState<CompanyUser|null>(null),[editUsername,setEditUsername]=useState(''),[editEmployeeId,setEditEmployeeId]=useState(''),[editStatus,setEditStatus]=useState<'active'|'inactive'|'locked'>('active'),[userBusy,setUserBusy]=useState(false);

  async function load(){
    if(!id)return;
    setLoading(true);setError('');
    try{
      const [r,u]=await Promise.all([
        api<{company:Company;admin:Admin;recentRequests:any[]}>(`/api/platform/companies/${id}`),
        api<{items:CompanyUser[]}>(`/api/platform/companies/${id}/users`)
      ]);
      setCompany(r.company);setAdmin(r.admin);setRequests(r.recentRequests);setUsers(u.items);
      setDisplayName(r.company.display_name);setLegalName(r.company.legal_name);setIdentifier(r.company.company_identifier);setStatus(r.company.status);
    }catch{setError('تعذر تحميل بيانات الشركة.')}finally{setLoading(false)}
  }
  useEffect(()=>{load()},[id]);

  async function save(e:FormEvent){
    e.preventDefault();setError('');
    try{await api(`/api/platform/companies/${id}`,{method:'PATCH',body:JSON.stringify({displayName,legalName,companyIdentifier:identifier,status})});setEdit(false);await load();}
    catch(err){setError(err instanceof Error&&err.message==='COMPANY_IDENTIFIER_EXISTS'?'معرّف الشركة مستخدم مسبقًا.':'تعذر تحديث الشركة.')}
  }

  async function addAdmin(e:FormEvent){
    e.preventDefault();setError('');setUserBusy(true);
    try{
      await api(`/api/platform/companies/${id}/admins`,{method:'POST',body:JSON.stringify({username:adminUsername,employeeId:adminEmployeeId||null,password:adminPassword,displayName:adminUsername})});
      setShowAdmin(false);setAdminUsername('');setAdminEmployeeId('');setAdminPassword('');await load();
    }catch(err){setError(err instanceof Error&&err.message==='USERNAME_EXISTS'?'اسم المستخدم مستخدم مسبقًا.':'تعذر إنشاء مدير الشركة.')}finally{setUserBusy(false)}
  }

  async function updateUser(user:CompanyUser){
    const nextStatus=user.status==='active'?'inactive':'active';
    try{await api(`/api/platform/companies/${id}/users/${user.id}`,{method:'PATCH',body:JSON.stringify({status:nextStatus})});await load();}
    catch{setError('تعذر تحديث حالة المستخدم.')}
  }

  function openEditUser(user:CompanyUser){setEditUser(user);setEditUsername(user.username);setEditEmployeeId(user.employee_id??'');setEditStatus(user.status);}
  async function saveUser(e:FormEvent){
    e.preventDefault();if(!editUser)return;setUserBusy(true);setError('');
    try{await api(`/api/platform/companies/${id}/users/${editUser.id}`,{method:'PATCH',body:JSON.stringify({username:editUsername,employeeId:editEmployeeId||null,status:editStatus})});setEditUser(null);await load();}
    catch(err){setError(err instanceof Error&&err.message==='USERNAME_EXISTS'?'اسم المستخدم مستخدم مسبقًا.':'تعذر تحديث المستخدم.')}finally{setUserBusy(false)}
  }

  async function savePassword(e:FormEvent){
    e.preventDefault();if(!resetUser)return;setUserBusy(true);setError('');
    try{await api(`/api/platform/companies/${id}/users/${resetUser.id}/reset-password`,{method:'POST',body:JSON.stringify({newPassword:resetPassword})});setResetUser(null);setResetPassword('');await load();}
    catch{setError('تعذر إعادة تعيين كلمة المرور.')}finally{setUserBusy(false)}
  }

  if(loading)return <div className="panel-empty">جاري تحميل بيانات الشركة...</div>;
  if(!company)return <div className="state-card"><h3>الشركة غير موجودة</h3><Link className="btn secondary" to="/platform/companies">العودة للشركات</Link></div>;

  return <div>
    <div className="page-header"><div><div className="breadcrumbs-inner"><Link to="/platform/companies">الشركات</Link><ArrowRight size={14}/><span>{company.display_name}</span></div><h1>{company.display_name}</h1><p>{company.legal_name} · <span className="mono">{company.company_identifier}</span></p></div><div className="header-actions"><span className={`badge ${company.status==='active'?'success':company.status==='suspended'?'danger':'neutral'}`}>{company.status==='active'?'نشطة':company.status==='suspended'?'موقوفة':'مؤرشفة'}</span><Link className="btn secondary" to="/platform/companies">العودة</Link></div></div>
    {error&&<div className="login-error page-error">{error}</div>}

    <div className="two-col">
      <section className="panel"><div className="panel-head"><div><h3>بيانات الشركة</h3><p>تعديل هوية الشركة وحالتها مباشرة من بيئة المنصة.</p></div><button className="icon-btn" onClick={()=>setEdit(v=>!v)} title="تعديل"><Edit3 size={16}/></button></div>
        {edit?<form className="form-grid" onSubmit={save}><label>اسم الشركة<input required value={displayName} onChange={e=>setDisplayName(e.target.value)}/></label><label>الاسم النظامي<input required value={legalName} onChange={e=>setLegalName(e.target.value)}/></label><label>المعرّف<input required value={identifier} onChange={e=>setIdentifier(e.target.value)} dir="ltr"/></label><label>الحالة<select value={status} onChange={e=>setStatus(e.target.value as any)}><option value="active">نشطة</option><option value="suspended">موقوفة</option><option value="archived">مؤرشفة</option></select></label><div className="form-actions"><button type="button" className="btn secondary" onClick={()=>setEdit(false)}>إلغاء</button><button className="btn primary">حفظ التعديلات</button></div></form>:<div className="detail-grid"><div className="detail"><span>المعرّف</span><strong>{company.company_identifier}</strong></div><div className="detail"><span>الحالة</span><strong>{company.status==='active'?'نشطة':company.status==='suspended'?'موقوفة':'مؤرشفة'}</strong></div><div className="detail"><span>تاريخ الإنشاء</span><strong>{company.created_at}</strong></div><div className="detail"><span>الاسم النظامي</span><strong>{company.legal_name}</strong></div></div>}
      </section>

      <section className="panel"><div className="panel-head"><div><h3>مديرو الشركة</h3><p>إدارة حسابات مديري الشركة وكلمات مرورهم وصلاحياتهم.</p></div><button className="btn primary" onClick={()=>setShowAdmin(true)}><UserPlus size={15}/> إضافة مدير</button></div>
        {users.filter(u=>u.roles.includes('company_admin')).length===0&&!showAdmin?<div className="panel-empty">لا يوجد مدير شركة حاليًا.</div>:<>
          {users.filter(u=>u.roles.includes('company_admin')).map(u=><div className="admin-card" key={u.id}><div className="profile-avatar"><ShieldCheck size={21}/></div><div className="user-card-main"><strong>{u.username}</strong><span>{u.status==='active'?'نشط':u.status==='locked'?'مقفل':'غير نشط'} · {u.must_change_password?'يتطلب تغيير كلمة المرور':'كلمة المرور مفعلة'}</span></div><div className="user-card-actions"><button className="icon-btn" title="تغيير كلمة المرور" onClick={()=>setResetUser(u)}><KeyRound size={16}/></button><button className="icon-btn" title={u.status==='active'?'تعطيل':'تفعيل'} onClick={()=>updateUser(u)}>{u.status==='active'?<X size={16}/>:<RefreshCw size={16}/>}</button></div></div>)}
        </>}
        {showAdmin&&<form className="form-grid" onSubmit={addAdmin}><label>اسم المستخدم<input required value={adminUsername} onChange={e=>setAdminUsername(e.target.value)}/></label><label>رقم الموظف (اختياري)<input value={adminEmployeeId} onChange={e=>setAdminEmployeeId(e.target.value)}/></label><label>كلمة المرور المؤقتة<input required minLength={8} type="password" value={adminPassword} onChange={e=>setAdminPassword(e.target.value)}/></label><div className="form-actions"><button type="button" className="btn secondary" onClick={()=>setShowAdmin(false)}>إلغاء</button><button className="btn primary" disabled={userBusy}>إنشاء المدير</button></div></form>}
      </section>
    </div>

    <section className="panel" style={{marginTop:14}}><div className="panel-head"><div><h3><Users size={17}/> مستخدمو الشركة</h3><p>تعديل حالة المستخدمين وإعادة تعيين كلمات المرور من مكان واحد.</p></div><span className="header-status">{users.length} مستخدم</span></div>
      {users.length===0?<div className="panel-empty">لا يوجد مستخدمون.</div>:<div className="table-wrap"><table><thead><tr><th>المستخدم</th><th>الدور</th><th>الحالة</th><th>آخر دخول</th><th>كلمة المرور</th><th>إجراءات</th></tr></thead><tbody>{users.map(u=><tr key={u.id}><td><strong>{u.username}</strong>{u.employee_id&&<div className="mono">{u.employee_id}</div>}</td><td>{u.roles.length?u.roles.map(r=><span className="badge neutral" key={r}>{r==='company_admin'?'مدير الشركة':r}</span>):'—'}</td><td><span className={`badge ${u.status==='active'?'success':u.status==='locked'?'danger':'neutral'}`}>{u.status==='active'?'نشط':u.status==='locked'?'مقفل':'غير نشط'}</span></td><td>{u.last_login_at??'لم يسجل دخول'}</td><td>{u.must_change_password?'تغيير مطلوب':'مفعلة'}</td><td><button className="table-link" onClick={()=>openEditUser(u)}><Edit3 size={14}/> تعديل</button> <button className="table-link" onClick={()=>setResetUser(u)}><KeyRound size={14}/> كلمة المرور</button></td></tr>)}</tbody></table></div>}
    </section>

    <section className="panel" style={{marginTop:14}}><div className="panel-head"><div><h3>آخر طلبات الدخول</h3><p>سجل مختصر لطلبات الوصول لهذه الشركة.</p></div></div>{requests.length===0?<div className="panel-empty">لا توجد طلبات دخول.</div>:<div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>الحالة</th><th>السبب</th><th>المدة</th></tr></thead><tbody>{requests.map(r=><tr key={r.id}><td>{r.requested_at}</td><td><span className={`badge ${r.status==='approved'?'success':r.status==='rejected'?'danger':'neutral'}`}>{r.status==='approved'?'مقبول':r.status==='pending'?'قيد الانتظار':r.status==='rejected'?'مرفوض':r.status}</span></td><td>{r.reason}</td><td>{r.expires_at??'—'}</td></tr>)}</tbody></table></div>}</section>

    {editUser&&<div className="modal-backdrop" role="dialog" aria-modal="true"><form className="access-modal" onSubmit={saveUser}><button type="button" className="modal-close" onClick={()=>setEditUser(null)}><X size={18}/></button><div className="modal-icon pending"><Users size={24}/></div><h3>تعديل مستخدم الشركة</h3><p>يمكنك تعديل اسم المستخدم ورقم الموظف وحالة الحساب.</p><div className="modal-form-grid"><label className="modal-field">اسم المستخدم<input required value={editUsername} onChange={e=>setEditUsername(e.target.value)}/></label><label className="modal-field">رقم الموظف<input value={editEmployeeId} onChange={e=>setEditEmployeeId(e.target.value)}/></label><label className="modal-field">حالة الحساب<select value={editStatus} onChange={e=>setEditStatus(e.target.value as any)}><option value="active">نشط</option><option value="inactive">غير نشط</option><option value="locked">مقفل</option></select></label></div><div className="form-actions"><button type="button" className="btn secondary" onClick={()=>setEditUser(null)}>إلغاء</button><button className="btn primary" disabled={userBusy}>حفظ التعديل</button></div></form></div>}

    {resetUser&&<div className="modal-backdrop" role="dialog" aria-modal="true"><form className="access-modal" onSubmit={savePassword}><button type="button" className="modal-close" onClick={()=>setResetUser(null)}><X size={18}/></button><div className="modal-icon pending"><KeyRound size={24}/></div><h3>إعادة تعيين كلمة المرور</h3><p>سيتم إلغاء الجلسات الحالية للمستخدم <strong>{resetUser.username}</strong> وسيُطلب منه تغيير كلمة المرور عند أول دخول.</p><label className="modal-field">كلمة المرور الجديدة<input required minLength={8} type="password" value={resetPassword} onChange={e=>setResetPassword(e.target.value)} autoFocus/></label><div className="form-actions"><button type="button" className="btn secondary" onClick={()=>setResetUser(null)}>إلغاء</button><button className="btn primary" disabled={userBusy}>حفظ كلمة المرور</button></div></form></div>}
  </div>
}
