import assert from 'node:assert/strict';
import { evaluateCondition, resolveTransition, getStageDelegation } from '../src/shared/workflowEngine.ts';

const s1={id:'s1',stageOrder:1,config:{delegate:{enabled:false}}};
const s2={id:'s2',stageOrder:2,config:{delegate:{enabled:false}}};
const s3={id:'s3',stageOrder:3,config:{delegate:{enabled:true}}};
const q={id:'q1',fieldKey:'approval',fieldType:'boolean',options:[]};
const employee={id:'q2',fieldKey:'reviewer',fieldType:'employee',options:[]};

let r=resolveTransition([s1,s2,s3],[], 's1', {}, [q]);
assert.equal(r.decision,'automatic-next'); assert.equal(r.route.to_stage_id,'s2');

r=resolveTransition([s1,s2,s3],[], 's3', {}, [q]);
assert.equal(r.decision,'automatic-complete'); assert.equal(r.route.action,'complete');

const conditionalReturn={id:'t1',fromStageId:'s3',toStageId:'s1',action:'return',label_ar:'إعادة للمدير',condition:{fieldId:'q1',operator:'equals',values:['لا']},sortOrder:0,active:true};
r=resolveTransition([s1,s2,s3],[conditionalReturn],'s3',{approval:'لا'},[q]);
assert.equal(r.decision,'condition'); assert.equal(r.route.action,'return'); assert.equal(r.route.toStageId,'s1');

r=resolveTransition([s1,s2,s3],[conditionalReturn],'s3',{approval:'نعم'},[q]);
assert.equal(r.decision,'automatic-complete'); assert.equal(r.route.action,'complete');

assert.equal(evaluateCondition({fieldId:'q2',operator:'is_not_empty',values:[]},{reviewer:'sim-001'},[employee]),true);
assert.equal(evaluateCondition({fieldId:'q2',operator:'is_not_empty',values:[]},{reviewer:''},[employee]),false);
assert.deepEqual(getStageDelegation(s3),{enabled:true,valid:true});
assert.equal(getStageDelegation(s2),null);

console.log('PHASE6_ENGINE_SELFTEST: PASS');
