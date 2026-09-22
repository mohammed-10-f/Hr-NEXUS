import { useEffect,useState } from 'react';
import { Check, X } from 'lucide-react';
import { api } from '../lib/api';
export function AccessRequests(){
 const [items,setItems]=useState<any[]>([]);
 async function load(){try{setItems((await api<{items:any[]}>('/api/platform/company-access-requests')).items)}catch{}}
 useEffect(()=>{load()},[]);
 async function decide(id:string,decision:'allow'|'reject'){await api(`/api/platform/company-access-requests/${id}/decision`,{method:'POST',body:JSON.stringify({decision})});load()}
 return <div><div className="page-header"><div><div className="eyebrow">أمن الشركة</div><h1>طلبات دخول مدير المنصة</h1><p>طلبات مؤقتة تتطلب موافقة مدير الشركة عند وجود مدير نشط.</p></div></div>
 <section className="panel"><div className="panel-head"><div><h3>الطلبات المعلقة</h3></div></div>{items.length===0?<div className="panel-empty">لا توجد طلبات معلقة.</div>:<div className="table-wrap"><table><thead><tr><th>مدير المنصة</th><th>الشركة</th><th>التاريخ</th><th>السبب</th><th></th></tr></thead><tbody>{items.map(x=><tr key={x.id}><td>{x.super_admin_name}</td><td>{x.display_name} <span className="mono">{x.company_identifier}</span></td><td>{x.requested_at}</td><td>{x.reason}</td><td><button className="icon-btn" onClick={()=>decide(x.id,'allow')} title="سماح"><Check size={17}/></button><button className="icon-btn" onClick={()=>decide(x.id,'reject')} title="رفض"><X size={17}/></button></td></tr>)}</tbody></table></div>}</section></div>
}
