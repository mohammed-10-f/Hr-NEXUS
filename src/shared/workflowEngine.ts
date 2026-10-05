export type WorkflowCondition = {
  fieldId: string;
  operator: 'equals'|'not_equals'|'contains'|'is_true'|'is_false'|'in'|'is_empty'|'is_not_empty';
  values: string[];
};

export type WorkflowFieldLike = { id: string; fieldKey?: string; field_key?: string; fieldType?: string; field_type?: string; options?: string[] };
export type WorkflowStageLike = { id: string; stageOrder?: number; stage_order?: number; config?: any; config_json?: string };
export type WorkflowTransitionLike = { id?: string; fromStageId?: string; from_stage_id?: string; toStageId?: string|null; to_stage_id?: string|null; action: string; condition?: WorkflowCondition|null; condition_json?: string|null; sortOrder?: number; sort_order?: number; active?: boolean|number };

export function isEmptyValue(value: any) {
  return value===undefined || value===null || value==='' || (Array.isArray(value) && value.length===0);
}

export function evaluateCondition(condition: WorkflowCondition, values: Record<string, any>, fields: WorkflowFieldLike[]) {
  const field=fields.find(f=>f.id===condition.fieldId);
  if(!field) return false;
  const key=field.fieldKey??field.field_key??'';
  const actual=values[key];
  const op=condition.operator;
  const expected=(condition.values||[]).map(String);
  const actualList=Array.isArray(actual)?actual.map(String):[String(actual??'')];
  if(op==='is_empty') return isEmptyValue(actual);
  if(op==='is_not_empty') return !isEmptyValue(actual);
  if(op==='is_true') return ['نعم','true','1','yes'].includes(String(actual).toLowerCase());
  if(op==='is_false') return ['لا','false','0','no'].includes(String(actual).toLowerCase());
  if(op==='equals') return actualList.some(v=>expected.includes(v));
  if(op==='not_equals') return actualList.every(v=>!expected.includes(v));
  if(op==='contains') return actualList.some(v=>expected.some(e=>v.includes(e)));
  if(op==='in') return actualList.some(v=>expected.includes(v));
  return false;
}

export function resolveTransition(stages: WorkflowStageLike[], transitions: WorkflowTransitionLike[], currentStageId: string, values: Record<string,any>, fields: WorkflowFieldLike[]) {
  const ordered=[...stages].sort((a,b)=>Number(a.stageOrder??a.stage_order)-Number(b.stageOrder??b.stage_order));
  const outgoing=transitions.filter(t=>(t.fromStageId??t.from_stage_id)===currentStageId && t.active!==false && t.active!==0).sort((a,b)=>Number(a.sortOrder??a.sort_order??0)-Number(b.sortOrder??b.sort_order??0));
  const conditional=outgoing.find(t=>t.condition && evaluateCondition(t.condition,values,fields));
  if(conditional) return { route: conditional, decision: 'condition' as const };
  const defaultRoute=outgoing.find(t=>!t.condition);
  if(defaultRoute) return { route: defaultRoute, decision: 'default' as const };
  const index=ordered.findIndex(s=>s.id===currentStageId);
  const next=ordered[index+1];
  if(next) return { route: { action:'next', label_ar:'تمرير المعاملة', to_stage_id:next.id }, decision:'automatic-next' as const };
  return { route: { action:'complete', label_ar:'إكمال', to_stage_id:null }, decision:'automatic-complete' as const };
}

export function getStageDelegation(stage: WorkflowStageLike) {
  const config=stage.config??(stage.config_json?parseJson(stage.config_json,{}):{});
  const delegate=config?.delegate;
  if(!delegate?.enabled) return null;
  return { enabled:true, valid:true };
}

function parseJson(value:string|undefined, fallback:any){try{return value?JSON.parse(value):fallback;}catch{return fallback;}}
