import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tx } from '../prisma-tenant';
import type { SchedulingFields } from '../scheduling-contract';
import type { PendingTemporalAmbiguity } from '../scheduling-temporal-ambiguity';
const state=vi.hoisted(()=>({logs:[] as Record<string,unknown>[],authorize:vi.fn(),lookup:vi.fn(),locate:vi.fn(),create:vi.fn(),cancel:vi.fn(),tx:null as unknown as Tx}));
vi.mock('../prisma-tenant',()=>({withTenant:(_actor:unknown,fn:(tx:Tx)=>unknown)=>fn(state.tx)}));
vi.mock('../customer-catalog',async original=>({...await original<object>(),searchSalonCustomer:state.lookup}));
vi.mock('../scheduling-catalog',async original=>({...await original<object>(),schedulingTimezone:async()=> 'America/Sao_Paulo'}));
vi.mock('../scheduling-mutations',async original=>({...await original<object>(),authorizeSchedulingOperation:state.authorize,locateSchedulingAppointments:state.locate,executeSchedulingMutation:state.cancel}));
vi.mock('../scheduling-actions',async original=>({...await original<object>(),executeSchedulingCreate:state.create}));
import { groundBatchPatch, startBatch, sendBatchTurn, type BatchState } from '../secretary-batch';
import { validateSelectionV2, createActionPlan, assessPlanAction } from '@everflair/salon-secretary';
import { assessmentFromView, collectedActionFields } from '../secretary-action-plan';
import { planConversationContext, secretaryPlanMessage } from '../secretary-presentation';
import { validateBatchPlan, upsertBatchDraft, proposeActionBatch, latestBatch, type BatchPlan } from '../scheduling-batch';
import { ScriptedServicesModel, call } from '../../test/scripted-services-model';
import { intent, plan } from '../../test/secretary-capability-plan';
const actor={salonId:'synthetic-salon',userId:'synthetic-owner'};
const timezone='America/Sao_Paulo';
const residual=(expression='às duas',candidates:[string,string]=['02:00','14:00']):PendingTemporalAmbiguity=>({field:'time',kind:'CLOCK_DAYPART',expression,candidates});
function base(both=false):BatchPlan{
  return validateBatchPlan({execution_policy:'all_or_nothing',items:[
    {key:'cancel',operation:'appointment.cancel',depends_on:[],fields:{customer_name:'Lia Costa',date:'2027-04-13',reason:'por viagem'},pending_temporal_ambiguities:[residual()]},
    {key:'replace',operation:'appointment.create',depends_on:['cancel'],released_slot_of:'cancel',fields:{customer_name:'Rui Melo',service_name:'Corte',...(both?{destination_mode:'ALTERNATIVE_SLOT',date:'2027-04-14'}:{})},
      ...(both?{pending_temporal_ambiguities:[residual('às quatro',['04:00','16:00'])]}:{})},
  ]});
}
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2027-04-12T12:00:00Z'));vi.clearAllMocks();state.logs=[];
  vi.stubEnv('SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED','true');
  vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NETWORK_FORBIDDEN');}));
  state.authorize.mockResolvedValue('OWNER');state.lookup.mockImplementation(async(_tx:unknown,_actor:unknown,name:string)=>[{id:name.startsWith('Lia')?'customer-lia':'customer-rui',name}]);state.locate.mockResolvedValue([]);
  const find=({where}:{where:Record<string,unknown>})=>state.logs.filter(row=>Object.entries(where).every(([key,value])=>row[key]===value));
  state.tx={$executeRaw:vi.fn().mockResolvedValue(1),auditLog:{
    create:vi.fn(async({data}:{data:Record<string,unknown>})=>{state.logs.push(structuredClone(data));return data;}),
    findMany:vi.fn(async(args:{where:Record<string,unknown>})=>find(args)),findFirst:vi.fn(async(args:{where:Record<string,unknown>})=>find(args)[0]??null),
  }} as unknown as Tx;
});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();expect(state.create).not.toHaveBeenCalled();expect(state.cancel).not.toHaveBeenCalled();vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});
const qualifier=[{field:'time' as const,text:'da tarde'}];

describe('batch residual state is persisted independently per item and cannot prepare a proposal',()=>{
  it('stores the active literal/candidates, asks only the component and rejects proposal before lookups',async()=>{
    const input=base(true),before=structuredClone(input),draft=await upsertBatchDraft(state.tx,actor,{plan:input});
    expect(draft.status).toBe('NEEDS_INPUT');expect(draft.missing_fields).toEqual(['cancel.time']);
    expect(draft.message).toContain('às duas');expect(draft.message).toContain('2h ou 14h');
    expect(draft.plan.items[0].fields.time).toBeUndefined();expect(draft.plan.items[1].fields.time).toBeUndefined();
    expect((await latestBatch(state.tx,actor,draft.draft_ref)).plan).toEqual(draft.plan);expect(input).toEqual(before);
    await expect(proposeActionBatch(state.tx,actor,{draft_ref:draft.draft_ref,draft_revision:draft.draft_revision})).rejects.toThrow('NEEDS_INPUT');
    expect(state.lookup).not.toHaveBeenCalled();expect(state.locate).not.toHaveBeenCalled();
  });
  it('resolves only the requested item, then asks the next residual and preserves the dependency graph/revision',async()=>{
    const first=await upsertBatchDraft(state.tx,actor,{plan:base(true)});
    const changed=groundBatchPatch(first.plan,'cancel',{time:'14:00'},'Da tarde.','America/Sao_Paulo',[{field:'time',text:'Da tarde'}],first);
    expect(changed.items[0].fields.time).toBe('14:00');expect(changed.items[0].pending_temporal_ambiguities).toBeUndefined();
    expect(changed.items[1]).toEqual(first.plan.items[1]);expect(changed.items[0].temporal_missing).toBeUndefined();
    const second=await upsertBatchDraft(state.tx,actor,{plan:changed,draft_ref:first.draft_ref,expected_revision:first.draft_revision});
    expect(second.draft_ref).toBe(first.draft_ref);expect(second.draft_revision).toBe(first.draft_revision+1);
    expect(second.status).toBe('NEEDS_INPUT');expect(second.missing_fields).toEqual(['replace.time']);expect(second.message).toContain('4h ou 16h');
    const final=groundBatchPatch(second.plan,'replace',{time:'16:00'},'da tarde',timezone,qualifier,second);
    expect(final.items.map(item=>({key:item.key,depends_on:item.depends_on,released_slot_of:item.released_slot_of}))).toEqual(first.plan.items.map(item=>({key:item.key,depends_on:item.depends_on,released_slot_of:item.released_slot_of})));
    expect(final.items[0].fields.time).toBe('14:00');expect(final.items[1].fields.time).toBe('16:00');
    expect(final.items.every(item=>!item.pending_temporal_ambiguities?.length&&!item.temporal_missing?.length)).toBe(true);
    // Old draft state cannot be persisted after another accepted revision.
    await expect(upsertBatchDraft(state.tx,actor,{plan:final,draft_ref:first.draft_ref,expected_revision:first.draft_revision})).rejects.toThrow('REVISION_CONFLICT');
  });
  it('finds new residuals at the start of a dependent plan without losing the date or inheriting guesses',async()=>{
    const selection=validateSelectionV2({...plan([
      intent('appointment.cancel',{item_key:'cancel',depends_on:[],customer_name:'Lia Costa',weekday:2,time:'14:00',reason:'por viagem',temporal_evidence:[{field:'date',text:'terça'},{field:'time',text:'às duas'}]}),
      intent('appointment.create',{item_key:'replace',depends_on:['cancel'],released_slot_of:'cancel',customer_name:'Rui Melo',service_name:'Corte'}),
    ]),independent:false});
    const state=await startBatch(actor,selection,'Cancela a Lia Costa de terça às duas por viagem e coloca Rui Melo no lugar para Corte.');
    expect(state.proposal).toBeUndefined();expect(state.plan.items[0].fields).toMatchObject({date:'2027-04-13',reason:'por viagem'});
    expect(state.plan.items[0].fields.time).toBeUndefined();expect(state.plan.items[0].pending_temporal_ambiguities).toEqual([residual()]);
    expect(state.plan.items[0].temporal_missing).toBeUndefined();expect(state.plan.items[1].fields.date).toBeUndefined();expect(state.plan.items[1].fields.time).toBeUndefined();
    expect(state.draft?.missing_fields).toEqual(['cancel.time']);
  });
});

describe('daypart resolution remains tied to the exact backend batch context',()=>{
it("reason remains the only question before a residual in draft, UI and model context",async()=>{
    const input=base();input.items[0].source_missing=['reason'];delete input.items[0].fields.reason;
    const draft=await upsertBatchDraft(state.tx,actor,{plan:input});
    expect(draft.missing_fields).toEqual(['cancel.reason']);
    const batch:BatchState={operation:'action.batch',plan:draft.plan,draft,message:draft.message,metrics:{},interpretation_source:'MODEL'};
    const view={sessionId:'child',cancelled:false,message:draft.message,batch};
    let actionPlan=createActionPlan({...plan([intent('appointment.cancel',{item_key:'cancel',customer_name:'Lia Costa'}),intent('appointment.create',{item_key:'replace',depends_on:['cancel'],released_slot_of:'cancel',customer_name:'Rui Melo',service_name:'Corte'})]),independent:false});
    for(const action of actionPlan.actions){action.fields=collectedActionFields(view,action);actionPlan=assessPlanAction(actionPlan,action.key,assessmentFromView(view,action));}
    const units=[{keys:['cancel','replace'],kind:'scheduling-batch' as const,child:'child'}],children=[{operation_ref:'child',state:view}];
    expect(secretaryPlanMessage(actionPlan,units,children)).toBe(draft.message);
    const context=planConversationContext(actionPlan,units,children).actions.find(action=>action.item_key==='cancel')!;
    expect(context.clarification.requested_field).toBe('reason');expect(context.clarification).not.toHaveProperty('requested_component');
    expect(context.pending_temporal_ambiguities).toHaveLength(1);
  });
  it("a resolved clock consumes the qualifier without introducing an unrelated period",async()=>{
    const draft=await upsertBatchDraft(state.tx,actor,{plan:base(true)});
    const next=groundBatchPatch(draft.plan,'cancel',{time:'14:00',period:'morning'},'da tarde',timezone,qualifier,draft);
    expect(next.items[0].fields.time).toBe('14:00');expect(next.items[0].fields.period).toBeUndefined();
    expect(next.items[0].temporal_missing).toBeUndefined();expect(next.items[1]).toEqual(draft.plan.items[1]);
  });
  it.each(['source_time','end_time'] as const)('retarget to %s cannot create residual or change a normal pending role',async emitted=>{
    const input=base();delete input.items[0].pending_temporal_ambiguities;input.items[0].temporal_missing=['time'];
    const draft=await upsertBatchDraft(state.tx,actor,{plan:input});
    expect(draft.missing_fields).toEqual(['cancel.time']);
    for(const [message,value] of [['às onze','23:00'],['pelas três e meia','15:30'],['às 2h','14:00']]){
      const next=groundBatchPatch(draft.plan,'cancel',{[emitted]:value},message,timezone,[{field:emitted,text:message}],draft);
      expect(next).toEqual(draft.plan);expect(next.items[0].pending_temporal_ambiguities).toBeUndefined();
      expect(next.items[0].temporal_missing).toEqual(['time']);
    }
  });
  it.each(['wrong_item','expired','changed_graph','changed_item','different_slot','different_customer','wrong_candidate','negative','empty','missing_proof','wrong_role'])(
    'keeps pending literal/fields unchanged for %s',async kind=>{
      const draft=await upsertBatchDraft(state.tx,actor,{plan:base(true)}),current=structuredClone(draft.plan);
      let selected='cancel',patch:SchedulingFields={time:'14:00'},message='da tarde',evidence:typeof qualifier|undefined=qualifier;
      const context=structuredClone(draft);
      if(kind==='wrong_item'){selected='replace';patch={time:'16:00'};}
      if(kind==='expired')context.expires_at='2027-04-12T11:59:00Z';
      if(kind==='changed_graph')current.items[1].released_slot_of='other';
      if(kind==='changed_item')current.items[1].fields.service_name='Outro Corte';
      if(kind==='different_slot')patch.date='2027-04-14';
      if(kind==='different_customer')patch.customer_name='Outra Pessoa';
      if(kind==='wrong_candidate')patch.time='15:00';
      if(kind==='negative')message='não da tarde';
      if(kind==='empty')message='';
      if(kind==='missing_proof')evidence=undefined;
      if(kind==='wrong_role')evidence=[{field:'source_time',text:'da tarde'}] as unknown as typeof qualifier;
      const next=groundBatchPatch(current,selected,patch,message,timezone,evidence,context);
      expect(next).toEqual(current);expect(next).not.toBe(current);expect(draft.plan).toEqual(base(true));
    });
  it('never accepts a qualifier with no pending state even if the model supplies a clock',()=>{
    const input=base();delete input.items[0].pending_temporal_ambiguities;
    const next=groundBatchPatch(input,'cancel',{time:'14:00'},'da tarde',timezone,qualifier);
    expect(next.items[0].fields.time).toBeUndefined();expect(next.items[0].temporal_missing).toContain('time');
  });
  it('uses a full explicit replacement clock normally, removing only that role residual',async()=>{
    const draft=await upsertBatchDraft(state.tx,actor,{plan:base(true)});
    const next=groundBatchPatch(draft.plan,'cancel',{time:'17:30'},'O correto é às 17h30.',timezone,[{field:'time',text:'às 17h30'}],draft);
    expect(next.items[0].fields.time).toBe('17:30');expect(next.items[0].pending_temporal_ambiguities).toBeUndefined();expect(next.items[1]).toEqual(draft.plan.items[1]);
  });
  it('retains backend authorization before any pending-draft read or proposal',async()=>{
    state.authorize.mockRejectedValue(Error('FORBIDDEN'));
    await expect(upsertBatchDraft(state.tx,actor,{plan:base()})).rejects.toThrow('FORBIDDEN');expect(state.logs).toEqual([]);
  });
  it('sends the same residual role to the interpreter and persists accepted short response without executor use',async()=>{
    const draft=await upsertBatchDraft(state.tx,actor,{plan:base(true)});
    const batch:BatchState={operation:'action.batch',plan:draft.plan,draft,message:draft.message,metrics:{},interpretation_source:'MODEL'};
    const model=new ScriptedServicesModel([call('upsert_action_draft',{item_key:'cancel',time:'14:00',temporal_evidence:qualifier})]);
    await sendBatchTurn(actor,batch,'da tarde',async()=>model,()=>{});
    expect(batch.plan.items[0].fields.time).toBe('14:00');expect(batch.draft?.missing_fields).toEqual(['replace.time']);expect(batch.proposal).toBeUndefined();
    expect(model.requests).toHaveLength(1);expect(JSON.stringify(model.requests[0])).toContain('pending_temporal_ambiguities');
    expect(JSON.stringify(model.requests[0])).toContain('requested_component');
    expect(batch.plan.items[1].pending_temporal_ambiguities).toEqual([residual('às quatro',['04:00','16:00'])]);
  });
});
