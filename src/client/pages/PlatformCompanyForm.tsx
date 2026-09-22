import { FormEvent, useState } from 'react';
import { ArrowRight, Building2, ShieldCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

export function PlatformCompanyForm(){
  const navigate=useNavigate();
  const [companyIdentifier,setCompanyIdentifier]=useState('');
  const [legalName,setLegalName]=useState('');
  const [displayName,setDisplayName]=useState('');
  const [managementStatus,setManagementStatus]=useState<'active'|'inactive'>('active');
  const [createAdmin,setCreateAdmin]=useState(true);
  const [adminUsername,setAdminUsername]=useState('');
  const [adminDisplayName,setAdminDisplayName]=useState('');
  const [adminPassword,setAdminPassword]=useState('');
  const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  async function submit(e:FormEvent){
    e.preventDefault();setBusy(true);setError('');
    try{
      const body:any={companyIdentifier,legalName,displayName,managementStatus};
      if(createAdmin) body.admin={username:adminUsername,displayName:adminDisplayName,password:adminPassword};
      const r=await api<{id:string}>('/api/platform/companies',{method:'POST',body:JSON.stringify(body)});
      navigate(`/platform/companies/${r.id}`);
    }catch(err){setError(err instanceof Error && err.message==='COMPANY_IDENTIFIER_EXISTS'?'معرّف الشركة مستخدم مسبقًا.':err instanceof Error && err.message==='INVALID_INPUT'?'تحقق من البيانات المدخلة.':'تعذر حفظ الشركة.');}
    finally{setBusy(false)}
  }
  return <div>
    <div className="page-header"><div><div className="breadcrumbs-inner"><Link to="/platform/companies">الشركات</Link><ArrowRight size={14}/><span>إضافة شركة</span></div><h1>إضافة شركة</h1><p>إنشاء شركة جديدة وربط مدير الشركة الأول عند الحاجة.</p></div><div className="header-status"><ShieldCheck size={16}/> مدير المنصة</div></div>
    <form className="panel form-panel" onSubmit={submit}>
      <div className="panel-head"><div><h3>بيانات الشركة</h3><p>تُحفظ البيانات مباشرة في قاعدة بيانات HR Nexus.</p></div></div>
      <div className="form-grid">
        <label>اسم الشركة<input required value={displayName} onChange={e=>setDisplayName(e.target.value)}/></label>
        <label>الاسم النظامي<input required value={legalName} onChange={e=>setLegalName(e.target.value)}/></label>
        <label>معرّف الشركة<input required value={companyIdentifier} onChange={e=>setCompanyIdentifier(e.target.value)} placeholder="A001" dir="ltr"/></label>
        <label>الحالة<select value={managementStatus} onChange={e=>setManagementStatus(e.target.value as any)}><option value="active">نشطة</option><option value="inactive">غير نشطة</option></select></label>
      </div>
      <div className="form-divider"/>
      <div className="panel-head"><div><h3>مدير الشركة الأول</h3><p>يمكن إنشاء الحساب الآن أو إضافته لاحقًا.</p></div></div>
      <label className="check-row"><input type="checkbox" checked={createAdmin} onChange={e=>setCreateAdmin(e.target.checked)}/> إنشاء مدير شركة عند إنشاء الشركة</label>
      {createAdmin&&<div className="form-grid">
        <label>اسم المستخدم<input required value={adminUsername} onChange={e=>setAdminUsername(e.target.value)} /></label>
        <label>اسم المدير<input required value={adminDisplayName} onChange={e=>setAdminDisplayName(e.target.value)} /></label>
        <label>كلمة المرور المؤقتة<input required minLength={8} type="password" value={adminPassword} onChange={e=>setAdminPassword(e.target.value)} /></label>
      </div>}
      {error&&<div className="login-error">{error}</div>}
      <div className="form-actions"><Link className="btn secondary" to="/platform/companies">إلغاء</Link><button className="btn primary" disabled={busy}><Building2 size={16}/>{busy?'جاري الحفظ...':'حفظ الشركة'}</button></div>
    </form>
  </div>
}
