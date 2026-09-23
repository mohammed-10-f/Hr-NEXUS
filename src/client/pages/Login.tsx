import { FormEvent, useState } from 'react';
import { ArrowLeft, Building2, LockKeyhole, UserRound, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';

export function Login(){
  const [mode,setMode]=useState<'company'|'platform'>('company');
  const [companyId,setCompanyId]=useState(''); const [loginIdentifier,setLoginIdentifier]=useState('');
  const [username,setUsername]=useState(''); const [password,setPassword]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  async function submit(e:FormEvent){
    e.preventDefault();setBusy(true);setError('');
    try{
      const result=await api<any>(mode==='company'?'/api/auth/login':'/api/auth/platform-login',{method:'POST',body:JSON.stringify(mode==='company'?{companyId,loginIdentifier,password}:{username,password})});
      window.location.assign(result?.session?.mustChangePassword?'/change-password':'/');
    }catch(err){
      const code=err instanceof Error?err.message:'';
      setError(code==='ACCOUNT_LOCKED'?'الحساب مقفل مؤقتًا.':code==='COMPANY_INACTIVE'?'الشركة غير نشطة حاليًا.':'بيانات الدخول غير صحيحة أو الحساب غير متاح.');
    }
    finally{setBusy(false)}
  }
  return <div className="login-page"><div className="login-panel">
    <div className="login-brand"><div className="brand-mark">N</div><div><strong>HR Nexus</strong><span>Enterprise HR Platform</span></div></div>
    <div className="login-copy"><span>{mode==='company'?'تسجيل دخول الشركة':'دخول مدير المنصة'}</span><h1>مرحباً بعودتك</h1><p>{mode==='company'?'أدخل بيانات حسابك للوصول إلى بيئة الشركة.':'الوصول إلى بيئة المنصة وإدارة الشركات.'}</p></div>
    <div className="login-tabs"><button className={mode==='company'?'active':''} onClick={()=>{setMode('company');setError('')}}>حساب شركة</button><button className={mode==='platform'?'active':''} onClick={()=>{setMode('platform');setError('')}}><ShieldCheck size={15}/>مدير المنصة</button></div>
    <form onSubmit={submit} className="login-form">
      {mode==='company' ? <>
        <label>معرّف الشركة<div className="input-wrap"><Building2 size={17}/><input required value={companyId} onChange={e=>setCompanyId(e.target.value)} placeholder="مثال: A001"/></div></label>
        <label>رقم الهوية / معرف المستخدم<div className="input-wrap"><UserRound size={17}/><input required value={loginIdentifier} onChange={e=>setLoginIdentifier(e.target.value)} placeholder="أدخل رقم الهوية أو معرف المستخدم"/></div></label>
      </> : <label>اسم مستخدم مدير المنصة<div className="input-wrap"><ShieldCheck size={17}/><input required value={username} onChange={e=>setUsername(e.target.value)} placeholder="اسم المستخدم"/></div></label>}
      <label>كلمة المرور<div className="input-wrap"><LockKeyhole size={17}/><input required type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="أدخل كلمة المرور"/></div></label>
      {error&&<div className="login-error">{error}</div>}
      <button className="login-submit" disabled={busy}>{busy?'جاري التحقق...':<>دخول آمن <ArrowLeft size={17}/></>}</button>
    </form>
    <div className="login-note">الوصول محكوم بالنطاق والصلاحيات والتحقق الخادمي.</div>
  </div><div className="login-side"><span>HR NEXUS</span><h2>بنية مؤسسية واحدة<br/>لعمليات الموارد البشرية</h2><p>تأسيس متعدد المستأجرين، جلسات آمنة، عزل للشركات، وسجل تدقيق مصمم للتوسع.</p></div></div>
}
