import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LockKeyhole } from 'lucide-react';
import { api } from '../lib/api';
export function ChangePassword(){
 const navigate=useNavigate();
 const [currentPassword,setCurrent]=useState(''),[newPassword,setNew]=useState(''),[error,setError]=useState(''),[ok,setOk]=useState(false),[busy,setBusy]=useState(false);
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{await api('/api/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword,newPassword})});setOk(true);setTimeout(()=>navigate('/',{replace:true}),300)}catch{setError('تعذر تغيير كلمة المرور. تأكد من كلمة المرور الحالية وأن الجديدة لا تقل عن 8 أحرف.')}finally{setBusy(false)}}
 return <div><div className="page-header"><div><div className="eyebrow">أمان الحساب</div><h1>تغيير كلمة المرور</h1><p>يجب تغيير كلمة المرور قبل متابعة استخدام النظام.</p></div></div><section className="locked-form"><div className="state-icon"><LockKeyhole size={23}/></div><form onSubmit={submit} className="login-form"><label>كلمة المرور الحالية<input required type="password" value={currentPassword} onChange={e=>setCurrent(e.target.value)}/></label><label>كلمة المرور الجديدة<input required minLength={8} type="password" value={newPassword} onChange={e=>setNew(e.target.value)}/></label>{error&&<div className="login-error">{error}</div>}{ok?<div>تم التغيير.</div>:<button className="login-submit" disabled={busy}>{busy?'جارٍ الحفظ...':'حفظ كلمة المرور'}</button>}</form></section></div>
}
