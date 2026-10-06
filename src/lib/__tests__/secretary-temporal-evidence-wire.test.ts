import { afterEach, describe, expect, it, vi } from 'vitest';
import Ajv from 'ajv';
import { createHash } from 'node:crypto';
import { createServicesAgent, createPaidModel, runServicesTurn, withConversationRouting, decodeConversationTurn,
  decodeTemporalEvidencePayload, temporalEvidenceRoles, temporalValueRoles, temporalValueWire, SecretaryNewRequest, SecretaryResumeRequest,
  type ConversationRoutingContext, type Model, type SecretarySkill, type SchedulingInterpretation, type SchedulingTemporalEvidence } from '@everflair/salon-secretary';
import { ScriptedServicesModel } from '../../test/scripted-services-model';
import { expandedWire, operationWire, turnWire } from '../../test/secretary-wire-schema';
import { groundSchedulingTemporal } from '../scheduling-temporal-source';
import { reconcileSchedulingTemporal } from '../scheduling-temporal';
import { schedulingPatch } from '../scheduling-contract';
import actual from '../../test/fixtures/secretary-real-wire-golden8-temporal.json';
import missingWitness from '../../test/fixtures/secretary-real-wire-golden9-temporal.json';

afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
const now=new Date('2027-04-12T12:00:00Z');
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
const proof=(values:Partial<Record<typeof temporalEvidenceRoles[number],string>>={})=>({date:null,source_date:null,end_date:null,time:null,source_time:null,end_time:null,...values});
const active={plan_ref:'10000000-0000-4000-8000-000000000001',actions:[{item_key:'visit',operation:'appointment.change',status:'NEEDS_INPUT',depends_on:[]}]};
const saved={plan_ref:'20000000-0000-4000-8000-000000000001',actions:[{item_key:'prior',operation:'appointment.change',status:'NEEDS_INPUT',depends_on:[]}]};
const context={active_plan:active,suspended_plans:[saved]};
function parameters(skill:SecretarySkill|'discovery'='discovery',v2=true){
  const tool=createServicesAgent(new ScriptedServicesModel([]),()=>{},skill,v2).tools[0];
  if(tool.type!=='function')throw Error('TOOL');return tool.parameters;
}
function operation(id='appointment.change',values:Record<string,unknown>={}){
  const keys=operationWire(expandedWire(parameters()),id);
  return {...Object.fromEntries(Object.keys(keys).map(key=>[key,null])),operation:id,item_key:'visit',depends_on:[],released_slot_of:null,...values};
}
const pair=(value:unknown,literal:string)=>({value,literal});
// Synthetic current-wire adaptation only. Preserved historical provider arguments
// are unchanged; the newly required action source scope is explicitly neutral.
const coupled=(fields:Record<string,unknown>,evidence:Partial<Record<typeof temporalEvidenceRoles[number],string|null>>)=>({source_scope:null,...Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,key in temporalValueRoles&&value!=null?pair(value,evidence[temporalValueRoles[key as keyof typeof temporalValueRoles]]!):value]))});
const dated=()=>operation('appointment.change',{customer_name:'Pessoa Sintética',weekday:pair(3,'quarta'),time:pair('16:00','16h'),source_weekday:pair(2,'terça'),source_time:pair('14:00','14h')});
const source='Na quarta às 16h fica a reserva que estava na terça às 14h.';
async function sdk(raw:unknown,options:{context?:ConversationRoutingContext;skill?:SecretarySkill|'discovery';wireValid?:boolean;message?:string;v2?:boolean}={}){
  const original=JSON.stringify(raw),requests:Record<string,unknown>[]=[];
  const skill=options.skill??'discovery';
  const transport=vi.fn(async(_url:unknown,init?:RequestInit)=>{
    const request=JSON.parse(String(init?.body));requests.push(request);
    expect(request.store).toBe(false);expect(request.parallel_tool_calls).toBe(false);expect(request.tools[0].strict).toBe(true);
    expect(new Ajv({allErrors:true}).compile(request.tools[0].parameters)(raw)).toBe(options.wireValid??true);
    expect(Buffer.byteLength(String(init?.body),'utf8')+8192).toBeLessThanOrEqual(64000);
    return new Response(JSON.stringify({id:'resp_offline',object:'response',created_at:0,status:'completed',model:'gpt-6-luna',
      output:[{id:'fc_offline',call_id:'call_offline',type:'function_call',name:skill==='discovery'?'select_capabilities':'upsert_action_draft',arguments:original,status:'completed'}],
      usage:{input_tokens:10,output_tokens:10,total_tokens:20}}),{status:200,headers:{'content-type':'application/json'}});
  });
  vi.stubGlobal('fetch',transport);
  const model=await createPaidModel({SALON_SECRETARY_ALLOW_PAID_CALLS:'true',SALON_SECRETARY_MODEL:'gpt-6-luna',SALON_SECRETARY_OPENAI_API_KEY:'synthetic-offline-not-a-key',SALON_SECRETARY_OPENAI_PROJECT:'proj_offline'});
  const invoke=()=>(runServicesTurn as (m:Model,msg:string,fields:object,requirements:object,skill:SecretarySkill|'discovery',v2:boolean)=>Promise<unknown>)(model,options.message??source,{}, {},skill,options.v2??true);
  let value:unknown,error:unknown;
  try{value=await (options.context?withConversationRouting(invoke,options.context):invoke());}catch(caught){error=caught;}
  expect(transport).toHaveBeenCalledOnce();expect(JSON.stringify(raw)).toBe(original);
  return {value,error,requests};
}
function grounded(input:Record<string,unknown>,message:string){
  const fields=schedulingPatch.parse(Object.fromEntries(Object.entries(input).filter(([key,value])=>key in schedulingPatch.shape&&value!=null)));
  return groundSchedulingTemporal({},fields,message,'America/Sao_Paulo',now,undefined,String(input.operation),input.temporal_evidence as SchedulingTemporalEvidence|undefined);
}

describe('coupled value and literal is the only published temporal shape',()=>{
  it.each(['NEW','ADD','PATCH','RESUME'] as const)('serializes %s through the real SDK and structurally decodes without reassignment',async mode=>{
    const op=dated(),{item_key:ignoredKey,depends_on:ignoredEdges,released_slot_of:ignoredSlot,...fields}=op;
    void ignoredKey;void ignoredEdges;void ignoredSlot;
    const turn=mode==='PATCH'?{mode,operations:[{item_key:'visit',fields}]}:mode==='RESUME'?{mode,plan_ref:saved.plan_ref,patches:{operations:[{item_key:'prior',fields}]}}:{mode,operations:[op]};
    const result=await sdk({turn},{context});
    const selection=result.error instanceof SecretaryResumeRequest?result.error.patches:result.error instanceof SecretaryNewRequest?result.error.selection:undefined;
    expect(selection?.operations).toHaveLength(1);
    expect(selection!.operations[0]).toMatchObject({weekday:3,time:'16:00',source_weekday:2,source_time:'14:00',temporal_evidence:[
      {field:'date',text:'quarta'},{field:'source_date',text:'terça'},{field:'time',text:'16h'},{field:'source_time',text:'14h'},
    ]});
    expect(grounded(selection!.operations[0],source)).toMatchObject({fields:{date:'2027-04-14',time:'16:00',source_date:'2027-04-13',source_time:'14:00'},rejected:[]});
  });
  it.each(['scheduling','scheduling-batch'] as const)('serializes CURRENT %s with the same role object',async skill=>{
    let raw:unknown;
    await withConversationRouting(async()=>{
      const shape=turnWire(expandedWire(parameters(skill)),'CURRENT').properties!.fields.properties!;
      raw={turn:{mode:'CURRENT',fields:{...Object.fromEntries(Object.keys(shape).map(key=>[key,null])),
        ...(skill==='scheduling'?{operation:'appointment.change'}:{item_key:'visit'}),weekday:pair(3,'quarta'),time:pair('16:00','16h')}}};
    });
    const result=await sdk(raw,{context:{},skill});
    expect(result.error).toBeUndefined();expect(result.value).toMatchObject({weekday:3,time:'16:00',temporal_evidence:[{field:'date',text:'quarta'},{field:'time',text:'16h'}]});
  });
  it('publishes object evidence even in the isolated V1 adapter, with legacy decoding kept private',async()=>{
    const shape=expandedWire(parameters('scheduling',false)).properties!;
    const raw={...Object.fromEntries(Object.keys(shape).map(key=>[key,null])),operation:'appointment.list',weekday:pair(2,'terça'),period:'morning'};
    const result=await sdk(raw,{skill:'scheduling',v2:false,message:'Agenda na terça de manhã.'});
    expect(result.error).toBeUndefined();expect(result.value).toMatchObject({weekday:2,period:'morning',temporal_evidence:[{field:'date',text:'terça'}]});
  });
  it('preserves period as a semantic filter, without inventing a date/clock witness or pending clock',async()=>{
    const input={turn:{mode:'NEW',operations:[operation('appointment.list',{professional_name:'Equipe',weekday:pair(2,'terça'),period:'morning'})]}};
    const result=await sdk(input,{message:'Agenda da Equipe na terça de manhã.'});
    expect(result.error).toBeUndefined();const selected=(result.value as {operations:Record<string,unknown>[]}).operations[0];
    const value=grounded(selected,'Agenda da Equipe na terça de manhã.');
    expect(value.rejected).toEqual([]);expect(value.fields).toMatchObject({date:'2027-04-13',period:'morning'});expect(value.fields.time).toBeUndefined();
    expect(reconcileSchedulingTemporal({},{period:'morning',time:'19:00'}).rejected).toContainEqual({code:'TIME_OUTSIDE_PERIOD',field:'time',value:'19:00'});
  });
  it.each([1,2,5,10])('preserves %i scheduling actions and role-specific provenance with a single offline request',async count=>{
    const operations=Array.from({length:count},(_,index)=>({...dated(),item_key:'visit_'+index}));
    const result=await sdk({turn:{mode:'NEW',operations}});
    expect(result.error).toBeUndefined();expect((result.value as {operations:unknown[]}).operations).toHaveLength(count);
  });
  it('pairs a short daypart only with the requested live residual role, preserving the other accepted facts',async()=>{
    const {item_key:ignoredKey,depends_on:ignoredEdges,released_slot_of:ignoredSlot,...fields}=operation('appointment.change',{source_time:pair('14:00','Da tarde')});
    void ignoredKey;void ignoredEdges;void ignoredSlot;
    const result=await sdk({turn:{mode:'PATCH',operations:[{item_key:'visit',fields}]}},{context,message:'Da tarde.'});
    expect(result.error).toBeInstanceOf(SecretaryNewRequest);
    const selected=(result.error as SecretaryNewRequest).selection.operations[0] as SchedulingInterpretation;
    expect(selected).toMatchObject({source_time:'14:00',temporal_evidence:[{field:'source_time',text:'Da tarde'}]});
    const previous={date:'2027-04-14',time:'16:00',source_date:'2027-04-13'},pending={field:'source_time' as const,kind:'CLOCK_DAYPART' as const,expression:'terça às duas',candidates:['02:00','14:00'] as [string,string]};
    const value=groundSchedulingTemporal(previous,{source_time:'14:00'},'Da tarde.','America/Sao_Paulo',now,'source_time','appointment.change',selected.temporal_evidence,
      {draft_ref:'30000000-0000-4000-8000-000000000001',draft_revision:2,expires_at:'2027-04-12T12:30:00.000Z',pending_temporal_ambiguities:[pending]});
    expect(value.rejected).toEqual([]);expect(value.fields).toMatchObject({...previous,source_time:'14:00'});
    const unanchored=groundSchedulingTemporal(previous,{source_time:'14:00'},'Da tarde.','America/Sao_Paulo',now,'source_time','appointment.change',selected.temporal_evidence);
    expect(unanchored.fields.source_time).toBeUndefined();expect(unanchored.rejected).toHaveLength(1);
  });
  it.each([2,{}, {value:2}, {literal:'terça'}, {value:null,literal:'terça'}, {value:2,literal:null},
    {value:2,literal:''},{value:2,literal:'   '},{value:2,literal:'x'.repeat(601)},{value:2,literal:'terça',role:'source_date'},
    [{value:2,literal:'terça'}]])('rejects a present selector without a usable paired literal: %j',async weekday=>{
    const result=await sdk({turn:{mode:'NEW',operations:[operation('appointment.list',{weekday})]}},{wireValid:false});
    expect(result.error).toBeDefined();expect(result.value).toBeUndefined();
  });
  it.each([null,proof({date:'terça'}),[{field:'date',text:'terça'}],[{field:'date',text:'terça'},{field:'date',text:'terça'}]])('rejects separate old evidence in the new envelope: %j',async temporal_evidence=>{
    const result=await sdk({turn:{mode:'NEW',operations:[operation('appointment.list',{weekday:pair(2,'terça'),temporal_evidence})]}},{wireValid:false});
    expect(result.error).toBeDefined();expect(result.value).toBeUndefined();
  });
  it('publishes strict pairs under each exact selector key, with no independent evidence map',async()=>{
    await withConversationRouting(async()=>{
      const wire=expandedWire(parameters());
      for(const mode of ['NEW','ADD','PATCH','RESUME']){
        const selected=turnWire(wire,mode),branch=mode==='RESUME'?selected.properties!.patches.anyOf!.find(value=>value.properties)!:selected;
        const fields=operationWire(branch,'appointment.change');expect(fields).not.toHaveProperty('temporal_evidence');
        for(const key of Object.keys(temporalValueRoles)){
          const field=fields[key];expect(field.anyOf!.map(value=>value.type)).toEqual(['object','null']);
          const object=field.anyOf![0];expect(object.required).toEqual(['value','literal']);expect(object.additionalProperties).toBe(false);
          expect(object.properties!.literal).toEqual({type:'string',minLength:1,maxLength:600,pattern:'\\S'});
          expect(object.properties!.value.type).not.toBe('null');
        }
      }
    },context);
    expect(temporalValueWire('weekday').parse(null)).toBeNull();
  });
});

describe('immutable real provider evidence remains a failure, counterfactuals are labeled separately',()=>{
  it('preserves GF12 v9 correct selectors and missing proofs as a recorded failure, without repairing the original',async()=>{
    expect(sha(missingWitness.arguments)).toBe(missingWitness.argumentsSha256);
    const raw=JSON.parse(missingWitness.arguments),legacy=decodeTemporalEvidencePayload(raw.turn.operations[0]) as Record<string,unknown>;
    const rejected=grounded(legacy,missingWitness.message);
    expect(rejected.fields).toMatchObject(missingWitness.observedEffective);
    expect(rejected.rejected.map(value=>value.field)).toEqual(missingWitness.observedTemporalMissing);
    const original=await sdk(raw,{wireValid:false,message:missingWitness.message});
    expect(original.value).toBeUndefined();expect(original.error).toBeDefined();
    expect(sha(missingWitness.arguments)).toBe(missingWitness.argumentsSha256);
  });
  it('explicit GF12 v9 synthetic coupled counterfactual preserves all original semantic values, not a Luna rerun',async()=>{
    const raw=JSON.parse(missingWitness.arguments),op=raw.turn.operations[0];delete op.temporal_evidence;
    raw.turn.operations[0]=coupled(op,{date:'quarta',source_date:'terça',time:'às 16h',source_time:'às 14h'});
    const result=await sdk(raw,{message:missingWitness.message});expect(result.error).toBeUndefined();
    const selected=(result.value as {operations:Record<string,unknown>[]}).operations[0];
    expect(selected).toMatchObject({weekday:3,source_weekday:2,time:'16:00',source_time:'14:00'});
    expect(grounded(selected,missingWitness.message)).toMatchObject({fields:{date:'2027-04-14',source_date:'2027-04-13',time:'16:00',source_time:'14:00'},rejected:[]});
  });
  it.each(actual.rows.filter(row=>row.caseId!=='GF11'))('original $caseId malformed role list still fails closed and is never silently repaired',async row=>{
    expect(sha(row.arguments)).toBe(row.argumentsSha256);
    const raw=JSON.parse(row.arguments),legacy=raw.turn.operations[0];
    const before=JSON.stringify(raw);
    const originalGuard=grounded(legacy,row.message);
    expect(originalGuard.rejected.map(item=>item.field).sort()).toEqual(row.caseId==='GF12'?['date','source_date','source_time','time']:['date']);
    const result=await sdk(raw,{wireValid:false,message:row.message});
    expect(result.error).toBeDefined();expect(result.value).toBeUndefined();expect(JSON.stringify(raw)).toBe(before);
    expect(sha(row.arguments)).toBe(row.argumentsSha256);
  });
  it.each(['GF12','GF20'])('explicit synthetic counterfactual of %s validates the same semantic values with correct role keys; not a Luna rerun',async caseId=>{
    const row=actual.rows.find(value=>value.caseId===caseId)!;
    const raw=JSON.parse(row.arguments),op=raw.turn.operations[0];
    const witnesses=caseId==='GF12'?proof({date:'Na quarta',time:'às 16h',source_date:'terça às 14h',source_time:'terça às 14h'}):proof({date:'terça'});
    delete op.temporal_evidence;raw.turn.operations[0]=coupled(op,witnesses);
    const result=await sdk(raw,{message:row.message});expect(result.error).toBeUndefined();
    const selected=(result.value as {operations:Record<string,unknown>[]}).operations[0],value=grounded(selected,row.message);
    expect(value.rejected).toEqual([]);
    expect(value.fields).toMatchObject(caseId==='GF12'?{date:'2027-04-14',time:'16:00',source_date:'2027-04-13',source_time:'14:00'}:{date:'2027-04-13',period:'morning'});
    expect(sha(row.arguments)).toBe(row.argumentsSha256);
  });
  it('preserves actual GF11 unresolved twelve-hour clocks without promoting model14/16 into accepted facts',()=>{
    const row=actual.rows.find(value=>value.caseId==='GF11')!;expect(sha(row.arguments)).toBe(row.argumentsSha256);
    const raw=JSON.parse(row.arguments).turn.operations[0],value=grounded(raw,row.message);
    expect(value.fields).toMatchObject({date:'2027-04-14',source_date:'2027-04-13'});
    expect(value.fields.time).toBeUndefined();expect(value.fields.source_time).toBeUndefined();
  });
});

describe('structural transport cannot loosen factual guards or infer roles',()=>{
  it.each([
    {weekday:pair(2,'terça'),date:pair('2027-04-14','quarta')},
    {weekday:pair(2,'terça'),day_offset:pair(1,'amanhã')},
    {source_weekday:pair(2,'terça'),source_date:pair('2027-04-14','quarta')},
  ])('never merges multiple selectors into one role witness: %j',async fields=>{
    // B5 contract migration (partial acceptance): the contradicted role is dropped, never merged or chosen;
    // the rest of the turn survives. The role keeps only a value-less conflict marker (the backend asks it).
    const result=await sdk({turn:{mode:'NEW',operations:[operation('appointment.change',fields)]}});
    expect(result.error).toBeUndefined();
    const [op]=(result.value as {operations:Record<string,unknown>[]}).operations;
    const first=Object.keys(temporalValueRoles).find(key=>key in fields)! as keyof typeof temporalValueRoles,role=temporalValueRoles[first];
    for(const [field,of] of Object.entries(temporalValueRoles))if(of===role)expect(op[field]).toBeNull();
    expect(op.temporal_evidence).toEqual([{field:role,text:(fields as unknown as Record<string,{literal:string}>)[first].literal,conflict:true}]);
    expect(()=>decodeTemporalEvidencePayload(fields,true)).toThrow('TEMPORAL_SELECTOR_CONFLICT');
  });
  it('clones owned containers and preserves nulls, names and dependency metadata byte-for-byte',()=>{
    const raw={turn:{mode:'ADD',operations:[{operation:'appointment.create',item_key:'follow',depends_on:['first'],released_slot_of:'first',customer_name:'Pessoa Literal',weekday:null,time:pair('16:00','às 16h')}]}};
    const before=JSON.stringify(raw),decoded=decodeTemporalEvidencePayload(raw,true) as typeof raw;
    expect(JSON.stringify(raw)).toBe(before);expect(decoded).not.toBe(raw);
    expect(decoded.turn.operations[0]).toMatchObject({weekday:null,time:'16:00',customer_name:'Pessoa Literal',depends_on:['first'],released_slot_of:'first'});
    expect(()=>decodeTemporalEvidencePayload({weekday:pair(2,'terça'),temporal_evidence:[]},false)).toThrow('TEMPORAL_EVIDENCE_WIRE_REQUIRED');
  });
  it.each([
    ['domingo', {weekday:6}, proof({date:'domingo'}), ['date']],
    ['domingo 17/04/2027', {date:'2027-04-17'}, proof({date:'domingo 17/04/2027'}), ['date']],
    ['depois de amanhã', {day_offset:1}, proof({date:'amanhã'}), ['date']],
    ['terça, dia 14 de abril de 2027', {weekday:2}, proof({date:'terça, dia 14 de abril de 2027'}), ['date']],
    ['não terça', {weekday:2}, proof({date:'terça'}), ['date']],
    ['Transfere de terça às 10h para quarta às 16h.', {weekday:2,source_weekday:3,time:'10:00',source_time:'16:00'}, proof({date:'terça',source_date:'quarta',time:'10h',source_time:'16h'}), ['date','source_date','time','source_time']],
  ] as const)('retains fail-closed facts: %s',(message,fields,temporal_evidence,rejected)=>{
    const decoded=decodeTemporalEvidencePayload({operation:'appointment.change',...coupled(fields,temporal_evidence)},true) as SchedulingInterpretation;
    const value=grounded(decoded,message);expect(value.rejected.map(item=>item.field).sort()).toEqual([...rejected].sort());
  });
  it('freezes tomorrow using the salon timezone, not the UTC calendar day',()=>{
    const decoded=decodeTemporalEvidencePayload({day_offset:pair(1,'amanhã')},true) as SchedulingInterpretation;
    const value=groundSchedulingTemporal({}, {day_offset:1},'amanhã','America/Sao_Paulo',new Date('2027-04-13T01:30:00Z'),undefined,'appointment.list',decoded.temporal_evidence);
    expect(value.fields.date).toBe('2027-04-13');expect(value.rejected).toEqual([]);
  });
  it('does not synthesize a missing clock from its witness',()=>{
    const decoded=decodeTemporalEvidencePayload({weekday:pair(2,'terça às 10h')},true) as SchedulingInterpretation;
    const value=groundSchedulingTemporal({}, {weekday:2},'terça às 10h','America/Sao_Paulo',now,undefined,'appointment.list',decoded.temporal_evidence);
    expect(value.fields.time).toBeUndefined();expect(value.rejected).toEqual([]);
  });
  it('keeps recorded legacy evidence untouched, including duplicate role failures',()=>{
    const raw={operation:'appointment.list',day_offset:1,temporal_evidence:[{field:'date',text:'amanhã'},{field:'date',text:'amanhã'}]};
    const decoded=decodeTemporalEvidencePayload(raw) as SchedulingInterpretation;
    expect(decoded).toEqual(raw);expect(decoded).not.toBe(raw);
    expect(groundSchedulingTemporal({}, {day_offset:1},'amanhã','America/Sao_Paulo',now,undefined,'appointment.list',decoded.temporal_evidence).fields.date).toBeUndefined();
    expect(()=>decodeConversationTurn({turn:{mode:'NEW',operations:[raw]}})).toThrow('TEMPORAL_EVIDENCE_WIRE_REQUIRED');
  });
});
