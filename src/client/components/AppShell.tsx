import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Bell, Building2, CalendarDays, ChevronLeft, CircleDollarSign, FileClock, FileText, LayoutDashboard, Menu, Search, Settings, ShieldCheck, Users, WalletCards, Workflow, X, BriefcaseBusiness, ChartNoAxesCombined } from './Icons';

const nav = [
  { label: 'الرئيسية', to: '/', icon: LayoutDashboard },
  { label: 'الموظفون', icon: Users, children: [{label:'قائمة الموظفين',to:'/employees'},{label:'إضافة موظف',to:'/employees/new'},{label:'الهيكل التنظيمي',to:'/organization'}] },
  { label: 'المعاملات', icon: Workflow, children: [{label:'الواردة',to:'#'},{label:'الصادرة',to:'#'},{label:'معاملاتي',to:'#'},{label:'البحث عن معاملة',to:'#'}] },
  { label: 'الإجازات', to:'#', icon: CalendarDays },
  { label: 'السلف', to:'#', icon: WalletCards },
  { label: 'الخصومات', to:'#', icon: CircleDollarSign },
  { label: 'الإضافات', to:'#', icon: BanknoteArrowDown },
  { label: 'الرواتب', to:'#', icon: FileClock },
  { label: 'التسويات', to:'#', icon: FileText },
  { label: 'التقارير', to:'#', icon: ChartNoAxesCombined },
  { label: 'الإشعارات', to:'#', icon: Bell },
  { label: 'الإعدادات', to:'#', icon: Settings },
  { label: 'الصلاحيات', to:'#', icon: ShieldCheck }
];

function BanknoteArrowDown(props:any){ return <CircleDollarSign {...props}/> }

export function AppShell(){
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string[]>(['الموظفون']);
  const location = useLocation();
  const title = location.pathname === '/' ? 'الرئيسية' : location.pathname.startsWith('/employees') ? 'الموظفون' : location.pathname.startsWith('/organization') ? 'الهيكل التنظيمي' : 'HR Nexus';
  const toggle = (label:string) => setExpanded(v => v.includes(label) ? v.filter(x=>x!==label) : [...v,label]);
  return <div className="app-shell">
    <aside className={`sidebar ${open?'is-open':''}`}>
      <div className="brand"><div className="brand-mark">N</div><div><strong>HR Nexus</strong><span>Enterprise HR Platform</span></div><button className="icon-btn mobile-only" onClick={()=>setOpen(false)}><X size={18}/></button></div>
      <nav className="nav-list">
        {nav.map(item => item.children ? <div className="nav-group" key={item.label}>
          <button className="nav-parent" onClick={()=>toggle(item.label)}><item.icon size={19}/><span>{item.label}</span><ChevronLeft className={expanded.includes(item.label)?'rotated':''} size={15}/></button>
          {expanded.includes(item.label) && <div className="nav-children">{item.children.map(child => child.to==='#' ? <button key={child.label} className="nav-child disabled" disabled><span>{child.label}</span><em>لاحقاً</em></button> : <NavLink onClick={()=>setOpen(false)} key={child.label} className="nav-child" to={child.to}>{child.label}</NavLink>)}</div>}
        </div> : item.to==='#' ? <button key={item.label} className="nav-parent disabled" disabled><item.icon size={19}/><span>{item.label}</span><em>لاحقاً</em></button> : <NavLink onClick={()=>setOpen(false)} key={item.label} className="nav-parent" to={item.to}><item.icon size={19}/><span>{item.label}</span></NavLink>)}
      </nav>
      <div className="sidebar-footer"><div className="secure-dot"></div><div><strong>بيئة مؤسسية</strong><span>صلاحيات آمنة</span></div></div>
    </aside>
    {open && <button className="mobile-backdrop" onClick={()=>setOpen(false)} aria-label="إغلاق القائمة"/>}
    <main className="main-area">
      <header className="topbar"><button className="icon-btn mobile-only" onClick={()=>setOpen(true)}><Menu size={21}/></button><div className="breadcrumbs"><span>HR Nexus</span><b>/</b><strong>{title}</strong></div><div className="top-actions"><div className="company-context"><Building2 size={17}/><div><span>الشركة الحالية</span><strong>لم يتم اختيار شركة</strong></div></div><button className="icon-btn"><Search size={19}/></button><button className="icon-btn notification"><Bell size={19}/><i></i></button><button className="user-chip"><div className="avatar">م</div><div><strong>المستخدم</strong><span>حساب النظام</span></div><ChevronLeft size={14}/></button></div></header>
      <div className="page-wrap"><Outlet/></div>
    </main>
  </div>
}
