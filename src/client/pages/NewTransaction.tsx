import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Save } from 'lucide-react';
import { api } from '../lib/api';

export function NewTransaction(){
 const nav=useNavigate();
 const [types,setTypes]=useState<any[]>([]);
 const [typeId,setTypeId]=useState('');
 const [wf,setWf]=useState<any>(null);
 const [employeeId,setEmployeeId]=useState('');
 const [employees,setEmployees]=useState<any[]>([]);
 const [data,setData]=useState<any>({});
 const [answers,setAnswers]=useState<any>({});
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 useEffect(()=>{void (async()=>{try{const [t,e]=await Promise.all([api<any>('/api/workflows/types'),api<any>('/api/employees?page=1&pageSize=50')]);setTypes(t.items);setEmployees(e.items);}catch{setError('تعذر تحميل نموذج المعاملة.')}})();},[]);
 useEffect(()=>{if(!typeId){setWf(null);return;}void (async()=>{try{setWf(await api<any>(`/api/workflows/types/${typeId}/workflow`));setData({});setAnswers({});}catch{setError('تعذر تحميل مسار المعاملة.')}})();},[typeId]);
 async function save(){setBusy(true);setError('');try{const d=await api<any>('/api/workflows/transactions',{method:'POST',body:JSON.stringify({transactionTypeId:typeId,employeeId:employeeId||null,data,answers})});nav(`/transactions/${d.id}`);}catch(e){setError(e instanceof Error?e.message:'تعذر إنشاء المعاملة.');}finally{setBusy(false);}}
 return <div>
  <div className="page-header"><div><div className="eyebrow">المعاملات</div><h1>إنشاء معاملة</h1><p>أكمل الحقول الأولية التي يحددها مسار العمل.</p></div><Link className="btn secondary" to="/transactions"><ArrowRight size={16}/>العودة</Link></div>
  {error&&<div className="login-error page-error">تعذر إنشاء المعاملة. رمز الخطأ: {error}</div>}
  <section className="panel form-panel">
   <label className="form-field"><span>نوع المعاملة</span><select value={typeId} onChange={e=>setTypeId(e.target.value)}><option value="">اختر نوع المعاملة</option>{types.map(x=><option key={x.id} value={x.id}>{x.name_ar}</option>)}</select></label>
   {wf&&<>
    <label className="form-field" style={{marginTop:14}}><span>الموظف المرتبط (اختياري)</span><select value={employeeId} onChange={e=>setEmployeeId(e.target.value)}><option value="">بدون موظف</option>{employees.map(x=><option key={x.id} value={x.id}>{x.employee_number} — {x.name}</option>)}</select></label>
    <div className="form-grid" style={{marginTop:18}}>{wf.fields.filter((f:any)=>!f.stage_id).map((f:any)=><label className="form-field" key={f.id}><span>{f.label_ar}{f.required?' *':''}</span>{f.field_type==='textarea'?<textarea rows={4} value={data[f.field_key]??''} onChange={e=>setData({...data,[f.field_key]:e.target.value})}/>:<input type={f.field_type==='date'?'date':f.field_type==='number'?'number':'text'} value={data[f.field_key]??''} onChange={e=>setData({...data,[f.field_key]:f.field_type==='number'?Number(e.target.value):e.target.value})}/>}</label>)}</div>
    <div className="panel" style={{marginTop:16,background:'#fafbfd'}}><div className="panel-head"><div><h3>{wf.stages[0]?.name_ar}</h3><p>الأسئلة المطلوبة للمرحلة الأولى</p></div></div>{wf.questions.filter((q:any)=>q.stage_id===wf.stages[0]?.id).map((q:any)=><label className="form-field" style={{marginTop:12}} key={q.id}><span>{q.question_ar}{q.required?' *':''}</span>{q.question_type==='yes_no'?<select value={answers[q.question_key]===undefined?'':String(answers[q.question_key])} onChange={e=>setAnswers({...answers,[q.question_key]:e.target.value==='true'})}><option value="">اختر</option><option value="true">نعم</option><option value="false">لا</option></select>:<textarea rows={3} value={answers[q.question_key]??''} onChange={e=>setAnswers({...answers,[q.question_key]:e.target.value})}/>}</label>)}</div>
    <div className="form-actions" style={{marginTop:18}}><button className="btn primary" disabled={busy||!typeId} onClick={()=>void save()}><Save size={16}/>{busy?'جارٍ الإنشاء...':'إنشاء المعاملة'}</button></div>
   </>}
  </section>
 </div>;
}
