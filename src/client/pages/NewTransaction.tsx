import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Save } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

function friendlyError(error:any){const code=error instanceof Error?error.message:'';return ({'TRANSACTION-001':'تحقق من بيانات المعاملة ثم حاول مرة أخرى.','TRANSACTION-002':'نوع المعاملة غير متاح حاليًا.','TRANSACTION-003':'الموظف المرتبط غير صالح أو لا ينتمي إلى هذه الشركة.','TRANSACTION-004':'أكمل بيانات مقدم الطلب المطلوبة أولًا.','WORKFLOW-006':'لا توجد نسخة منشورة صالحة لسير العمل لهذه المعاملة.','AUTH-001':'لا تملك الصلاحية اللازمة لإنشاء هذه المعاملة.','REQUEST_FAILED':'تعذر تنفيذ الطلب. حاول مرة أخرى.'} as any)[code]||'تعذر إنشاء المعاملة. حاول مرة أخرى.';}

function FieldInput({field,value,onChange,employees}:{field:any;value:any;onChange:(value:any)=>void;employees:any[]}){
 const options=Array.isArray(field.options)?field.options:[];
 if(field.field_type==='textarea')return <textarea rows={4} value={value??''} onChange={e=>onChange(e.target.value)}/>;
 if(field.field_type==='boolean')return <select value={value===undefined?'':String(value)} onChange={e=>onChange(e.target.value===''?undefined:e.target.value==='true')}><option value="">اختر</option><option value="true">نعم</option><option value="false">لا</option></select>;
 if(field.field_type==='select')return <select value={value??''} onChange={e=>onChange(e.target.value)}><option value="">اختر</option>{options.map((o:any,i:number)=><option key={i} value={String(o?.value??o)}>{String(o?.label_ar??o?.label??o?.value??o)}</option>)}</select>;
 if(field.field_type==='multiselect')return <select multiple value={Array.isArray(value)?value.map(String):[]} onChange={e=>onChange(Array.from(e.target.selectedOptions).map(x=>x.value))}>{options.map((o:any,i:number)=><option key={i} value={String(o?.value??o)}>{String(o?.label_ar??o?.label??o?.value??o)}</option>)}</select>;
 if(field.field_type==='employee')return <select value={value??''} onChange={e=>onChange(e.target.value||null)}><option value="">بدون موظف مرتبط</option>{employees.map(x=><option key={x.id} value={x.id}>{x.employee_number} — {x.name}</option>)}</select>;
 return <input type={field.field_type==='number'?'number':field.field_type==='date'?'date':field.field_type==='datetime'?'datetime-local':'text'} value={value??''} onChange={e=>onChange(field.field_type==='number'?(e.target.value===''?'':Number(e.target.value)):e.target.value)}/>;
}

export function NewTransaction(){
 const nav=useNavigate();
 const [types,setTypes]=useState<any[]>([]),[typeId,setTypeId]=useState(''),[wf,setWf]=useState<any>(null),[employees,setEmployees]=useState<any[]>([]),[data,setData]=useState<any>({}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{void (async()=>{try{const [t,e]=await Promise.all([api<any>('/api/workflows/types'),api<any>('/api/employees?page=1&pageSize=50')]);setTypes(Array.isArray(t.items)?t.items:[]);setEmployees(Array.isArray(e.items)?e.items:[]);}catch{setError('تعذر تحميل نموذج المعاملة.')}})();},[]);
 useEffect(()=>{if(!typeId){setWf(null);setData({});return;}void (async()=>{try{setWf(await api<any>(`/api/workflows/types/${typeId}/workflow`));setData({});setError('');}catch{setError('تعذر تحميل مسار المعاملة.')}})();},[typeId]);
 const requesterFields=useMemo(()=>wf?.fields?.filter((f:any)=>!f.stage_id)||[],[wf]);
 async function save(){setBusy(true);setError('');try{for(const f of requesterFields){if(f.required&&(data[f.field_key]===undefined||data[f.field_key]===null||data[f.field_key]==='')){setError(`أكمل الحقل المطلوب: ${f.label_ar}`);setBusy(false);return;}}const employeeField=requesterFields.find((f:any)=>f.field_type==='employee');const employeeId=employeeField?.field_key?data[employeeField.field_key]||null:null;const d=await api<any>('/api/workflows/transactions',{method:'POST',body:JSON.stringify({transactionTypeId:typeId,employeeId,data,answers:{}})});nav(`/transactions/${d.id}`);}catch(e){setError(friendlyError(e))}finally{setBusy(false);}}
 return <div>
  <div className="page-header"><div><div className="eyebrow">المعاملات</div><h1>إنشاء معاملة</h1><p>أدخل بيانات مقدم الطلب فقط. بعد التقديم تبدأ مراحل المسؤولين وفق سير العمل المنشور.</p></div><Link className="btn secondary" to="/transactions"><ArrowRight size={16}/>العودة</Link></div>
  {error&&<div className="login-error page-error">{error}</div>}
  <section className="panel form-panel">
   <label className="form-field"><span>نوع المعاملة</span><select value={typeId} onChange={e=>setTypeId(e.target.value)}><option value="">اختر نوع المعاملة</option>{types.map(x=><option key={x.id} value={x.id}>{x.name_ar}</option>)}</select></label>
   {wf&&<>
    <section className="panel requester-foundation-panel" style={{marginTop:18,background:'#fafbfd'}}><div className="panel-head"><div><span className="section-eyebrow">قبل سير العمل</span><h3>بيانات مقدم الطلب</h3><p>هذه البيانات تخص الطلب نفسه، وليست المرحلة الأولى ولا تظهر كحقول لمسؤول المرحلة.</p></div></div>
     {requesterFields.length===0?<div className="empty-soft">لا توجد بيانات إضافية مطلوبة. يمكنك تقديم المعاملة مباشرة.</div>:<div className="form-grid">{requesterFields.map((f:any)=><label className="form-field" key={f.id}><span>{f.label_ar}{f.required?' *':''}</span><FieldInput field={f} value={data[f.field_key]} employees={employees} onChange={value=>setData((v:any)=>({...v,[f.field_key]:value}))}/></label>)}</div>}
     <div className="form-actions" style={{marginTop:18}}><button className="btn primary" disabled={busy||!typeId} onClick={()=>void save()}><Save size={16}/>{busy?'جارٍ تقديم المعاملة...':'تقديم المعاملة'}</button></div>
    </section>
    <div className="empty-soft" style={{marginTop:14}}>بعد التقديم لن تظهر هنا أسئلة المرحلة الأولى؛ ستظهر للمسؤول عنها داخل صفحة المعاملة.</div>
   </>}
  </section>
 </div>;
}
