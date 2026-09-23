import { useEffect,useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, Building2, CalendarDays, ChevronLeft, CircleDollarSign, FileClock, FileText, LayoutDashboard, Menu, Search, Settings, ShieldCheck, Users, WalletCards, Workflow, X, ChartNoAxesCombined, LogOut, KeyRound } from './Icons';
import { api } from '../lib/api';

const companyNav=[
  {label:'الرئيسية',to:'/',icon:LayoutDashboard},
  {label:'الموظفون',icon:Users,children:[{label:'قائمة الموظفين',to:'/employees'},{label:'إضافة موظف',to:'/employees/new'},{label:'الهيكل التنظيمي',to:'/organization'}]},
  {label:'المعاملات',icon:Workflow,children:[{label:'الواردة',to:'#'},{label:'الصادرة',to:'#'},{label:'معاملاتي',to:'#'},{label:'البحث عن معاملة',to:'#'}]},
  {label:'الإجازات',to:'#',icon:CalendarDays},{label:'السلف',to:'#',icon:WalletCards},{label:'الخصومات',to:'#',icon:CircleDollarSign},
  {label:'الرواتب',to:'#',icon:FileClock},{label:'التسويات',to:'#',icon:FileText},{label:'التقارير',to:'#',icon:ChartNoAxesCombined},
  {label:'الإشعارات',to:'#',icon:Bell},{label:'الإعدادات',to:'#',icon:Settings}
];
export function AppShell(){
 const [open,setOpen]=useState(false),[expanded,setExpanded]=useState<string[]>(['الموظفون']),[ctx,setCtx]=useState<any>(null),[error,setError]=useState(false),[retryKey,setRetryKey]=useState(0),[busyAction,setBusyAction]=useState<'logout'|'exit'|null>(null);
 const location=useLocation(),navigate=useNavigate();
 useEffect(()=>{
   let alive=true;
   let timer:number|undefined;
   let attempts=0;
   setError(false);
   const load=async()=>{
     attempts+=1;
     try{
       const value=await api<any>('/api/context');
       if(alive){setCtx(value);setError(false);}
     }catch(err){
       if(!alive)return;
       if(err instanceof Error && err.message==='AUTH_REQUIRED'){
         setCtx(null);
         navigate('/login',{replace:true});
         return;
       }
       // A newly-created session can take a moment to become visible to the
       // next request. Retry a few times before showing a real error state.
       if(attempts<4){
         timer=window.setTimeout(load,250*attempts);
         return;
       }
       setError(true);
     }
   };
   void load();
   return()=>{alive=false;if(timer)window.clearTimeout(timer)};
 },[navigate,retryKey]);
 if(error) return <div className="panel-empty"><h3>تعذر تحميل الجلسة</h3><p>تعذر الاتصال بجلسة المستخدم. أعد المحاولة.</p><button className="login-submit" onClick={()=>{setError(false);setRetryKey(v=>v+1)}}>إعادة المحاولة</button></div>;
 if(!ctx) return <div className="panel-empty">جاري التحقق من الجلسة...</div>;
 const s=ctx.session, platform=Boolean(s.platformUserId), inCompany=s.accessMode==='super_admin_company_access'||s.accessMode==='company_user';
 const nav=platform&&!inCompany?[{label:'الرئيسية',to:'/',icon:LayoutDashboard},{label:'الشركات',to:'/platform/companies',icon:Building2},{label:'سجل التدقيق',to:'#',icon:FileText}]:s.roles?.includes('company_admin')?[...companyNav,{label:'طلبات دخول مدير المنصة',to:'/access-requests',icon:ShieldCheck}]:companyNav;
 const title=location.pathname==='/'?'الرئيسية':location.pathname.startsWith('/platform/companies/new')?'إضافة شركة':location.pathname.startsWith('/platform/companies/')?'تفاصيل الشركة':location.pathname.startsWith('/platform')?'الشركات':location.pathname.startsWith('/employees')?'الموظفون':location.pathname.startsWith('/organization')?'الهيكل التنظيمي':location.pathname.startsWith('/access-requests')?'طلبات الدخول':'HR Nexus';
 const toggle=(label:string)=>setExpanded(v=>v.includes(label)?v.filter(x=>x!==label):[...v,label]);
 async function logout(){
  if(busyAction)return;
  setBusyAction('logout');
  try{
    await api('/api/auth/logout',{method:'POST'});
  }catch{
    // The local navigation must still complete even if the server-side revoke
    // request fails. The login screen is the safe recovery point.
  }finally{
    setCtx(null);
    setError(false);
    setBusyAction(null);
    navigate('/login',{replace:true});
  }
 }
 async function exitCompany(){
  if(busyAction)return;
  setBusyAction('exit');
  try{
    await api('/api/platform/exit-company',{method:'POST'});
    const next=await api<any>('/api/context');
    setCtx(next);
    navigate('/',{replace:true});
  }catch{setError(true);}
  finally{setBusyAction(null);}
 }
 if(s.mustChangePassword && location.pathname!=='/change-password') return <div className="app-shell"><main className="main-area"><div className="page-wrap"><div className="locked-form"><KeyRound size={24}/><h2>تغيير كلمة المرور مطلوب</h2><p>يجب تحديث كلمة المرور قبل الوصول إلى بقية النظام.</p><button className="login-submit" onClick={()=>navigate('/change-password')}>تغيير كلمة المرور</button></div></div></main></div>;
 return <div className="app-shell"><aside className={`sidebar ${open?'is-open':''}`}><div className="brand"><div className="brand-mark">N</div><div><strong>HR Nexus</strong><span>Enterprise HR Platform</span></div><button className="icon-btn mobile-only" onClick={()=>setOpen(false)}><X size={18}/></button></div>
 <nav className="nav-list">{nav.map((item:any)=>{const Icon=item.icon; if(item.children){return <div className="nav-group" key={item.label}><button className="nav-parent" onClick={()=>toggle(item.label)}><Icon size={19}/><span>{item.label}</span><ChevronLeft className={expanded.includes(item.label)?'rotated':''} size={15}/></button>{expanded.includes(item.label)&&<div className="nav-children">{item.children.map((child:any)=>child.to==='#'?<button key={child.label} className="nav-child disabled" disabled><span>{child.label}</span><em>لاحقاً</em></button>:<NavLink onClick={()=>setOpen(false)} key={child.label} className="nav-child" to={child.to}>{child.label}</NavLink>)}</div>}</div>;} if(item.to==='#'){return <button key={item.label} className="nav-parent disabled" disabled><Icon size={19}/><span>{item.label}</span><em>لاحقاً</em></button>;} return <NavLink onClick={()=>setOpen(false)} key={item.label} className="nav-parent" to={item.to}><Icon size={19}/><span>{item.label}</span></NavLink>;})}</nav>
 <div className="sidebar-footer"><div className="secure-dot"></div><div><strong>بيئة مؤسسية</strong><span>{platform&&!inCompany?'مستوى المنصة':'نطاق الشركة'}</span></div></div></aside>
 {open&&<button className="mobile-backdrop" onClick={()=>setOpen(false)} aria-label="إغلاق القائمة"/>}
 <main className="main-area"><header className="topbar"><button className="icon-btn mobile-only" onClick={()=>setOpen(true)}><Menu size={21}/></button><div className="breadcrumbs"><span>HR Nexus</span><b>/</b><strong>{title}</strong></div>
 <div className="top-actions"><div className="company-context"><Building2 size={17}/><div><span>{inCompany?'الشركة الحالية':'بيئة المنصة'}</span><strong>{inCompany?s.company?.displayName:'إدارة المنصة'}</strong></div></div><button className="icon-btn"><Search size={19}/></button><button className="icon-btn notification"><Bell size={19}/><i></i></button>
 {inCompany&&platform&&<button className="icon-btn" title="الخروج من الشركة" onClick={exitCompany} disabled={busyAction==='exit'}>{busyAction==='exit'?<span className="mini-spinner"/>:<LogOut size={18}/>}</button>}
 <button className="user-chip" onClick={logout} disabled={busyAction==='logout'}><div className="avatar">{platform?'م':'م'}</div><div><strong>{platform?'مدير المنصة':'مستخدم الشركة'}</strong><span>{platform&&inCompany?'Super Admin · Company Access':platform?'Platform':'Company User'}</span></div><ChevronLeft size={14}/></button></div></header>
 <div className="page-wrap"><Outlet/></div></main></div>
}
