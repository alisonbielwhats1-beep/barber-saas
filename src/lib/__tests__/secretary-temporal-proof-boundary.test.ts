import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {applySchedulingInterpretation,schedulingState,type SchedulingState} from '../secretary-scheduling';
import {withTemporalTurnDrafts,type TemporalTurnDraft} from '../secretary-temporal-turn';
import type {SchedulingInterpretation} from '@everflair/salon-secretary';
const io=vi.hoisted(()=>({draft:vi.fn(),proposal:vi.fn(),confirm:vi.fn()}));
vi.mock('../prisma-tenant',()=>({withTenant:(_a:unknown,work:(tx:object)=>unknown)=>work({})}));
vi.mock('../scheduling-catalog',async original=>({...await original<object>(),schedulingTimezone:async()=> 'America/Sao_Paulo',getSchedulingAvailability:async()=>({plan:{},alternatives:[],timezone:'America/Sao_Paulo'})}));
vi.mock('../scheduling-actions',async original=>({...await original<object>(),upsertSchedulingDraft:io.draft,proposeAppointmentCreate:io.proposal,confirmAppointmentCreate:io.confirm,schedulingSnapshot:async()=>({})}));
vi.mock('../scheduling-mutations',async original=>({...await original<object>(),authorizeSchedulingOperation:async()=> 'OWNER'}));
const actor={salonId:'ours',userId:'owner'};
const consent={negative_context:[{role:'OVERRIDE_CONSENT',literal:'Não autorizo sobreposição.',anchor:{field:'override_requested',value:false,literal:'sobreposição'}}]};
const prior={negative_context:[{role:'PRIOR_CALENDAR_CONDITION',literal:'Se sábado não abre',anchor:{field:'date',literal:'sábado'}}]};
const source='Se sábado não abre, tenta no domingo seguinte às 12h.';
const previous={customer_name:'Lia',customer_ref:'customer',service_name:'Corte',service_ref:'service',professional_name:'Bel',professional_ref:'professional',date:'2028-06-17',time:'12:00'};
function state():SchedulingState {return {...schedulingState(),operation:'appointment.create',fields:{...previous},draft:{draft_ref:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',draft_revision:7,operation:'appointment.create',fields:{...previous},expires_at:'2028-06-12T12:20:00Z',status:'NEEDS_INPUT',missing_fields:['destination_mode'],temporal_conflicts:[]},proposal:{proposal_ref:'old'} as SchedulingState['proposal']};}
function captured(s:SchedulingState):TemporalTurnDraft {return structuredClone({...s.draft!,scope_valid:true});}
function interpretation(proof:unknown=prior):SchedulingInterpretation {return {date:'2028-06-18',time:'12:00',destination_mode:'ALTERNATIVE_SLOT',temporal_evidence:[{field:'date',text:'domingo seguinte'},{field:'time',text:'às 12h'}],temporal_negative_context:proof} as SchedulingInterpretation;}
beforeEach(()=>{vi.clearAllMocks();vi.useFakeTimers();vi.setSystemTime(new Date('2028-06-12T12:00:00Z'));vi.stubEnv('SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED','true');vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NETWORK_FORBIDDEN')}));
 io.draft.mockImplementation(async(_tx,_actor,input)=>({...input,draft_ref:input.draft_ref??'dddddddd-dddd-4ddd-8ddd-dddddddddddd',draft_revision:(input.expected_revision??0)+1,status:'READY',missing_fields:[],temporal_conflicts:[],expires_at:'2028-06-12T12:20:00Z'}));
 io.proposal.mockResolvedValue({proposal_ref:'current',preview:'Revisar'});
});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();expect(io.confirm).not.toHaveBeenCalled();vi.unstubAllEnvs();vi.unstubAllGlobals();vi.useRealTimers();});
describe('semantic metadata is transient and rejected deltas preserve accepted state',()=>{
 it('prepares a literal requested date while keeping overlap consent false',async()=>{
  const s=state();await applySchedulingInterpretation(actor,s,{weekday:2,time:'09:45',override_requested:false,temporal_evidence:[{field:'date',text:'Terça'},{field:'time',text:'às 9h45'}],temporal_negative_context:consent} as SchedulingInterpretation,'Terça às 9h45. Não autorizo sobreposição.');
  expect(s.fields).toMatchObject({date:'2028-06-13',time:'09:45',override_requested:false});expect(s.proposal).toBeDefined();expect(s.fields).toEqual(s.draft?.fields);expect(JSON.stringify(s.draft)).not.toContain('negative_context');
 });
 it('binds a prior condition to the same draft captured before interpretation',async()=>{
  const s=state();await withTemporalTurnDrafts([captured(s)],()=>applySchedulingInterpretation(actor,s,interpretation(),source));
  expect(s.fields).toMatchObject({...previous,date:'2028-06-18',destination_mode:'ALTERNATIVE_SLOT'});expect(s.draft?.draft_revision).toBe(8);expect(s.proposal).toBeDefined();expect(s.fields).toEqual(s.draft?.fields);
 });
 it.each(['no-turn','changed-revision','changed-fields','expired','other-draft','invalid-literal','residual-refusal'] as const)('rejects %s without erasing any accepted field or keeping old CTA',async kind=>{
  const s=state(),snapshot=captured(s);let message=source;const raw=interpretation();
  if(kind==='changed-revision')s.draft!.draft_revision++;
  if(kind==='changed-fields'){s.fields.time='13:00';s.draft!.fields.time='13:00';}
  if(kind==='expired')s.draft!.expires_at='2028-06-12T11:59:00Z';
  if(kind==='other-draft')s.draft!.draft_ref='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  if(kind==='invalid-literal')message='Se segunda não abre, tenta no domingo seguinte às 12h.';
  if(kind==='residual-refusal')message+=' Não faça isso.';
  const before=structuredClone(s);
  await expect(withTemporalTurnDrafts(kind==='no-turn'?[]:[snapshot],()=>applySchedulingInterpretation(actor,s,raw,message))).rejects.toThrow('TEMPORAL_CONTEXT_UNVERIFIED');
  expect(s.fields).toEqual(before.fields);expect(s.draft).toEqual(before.draft);expect(s.proposal).toBeUndefined();expect(io.draft).not.toHaveBeenCalled();expect(io.proposal).not.toHaveBeenCalled();
 });
 it('cannot reuse another completed turn binding',async()=>{
  const s=state();await withTemporalTurnDrafts([captured(s)],async()=>undefined);
  await expect(applySchedulingInterpretation(actor,s,interpretation(),source)).rejects.toThrow('TEMPORAL_CONTEXT_UNVERIFIED');expect(s.fields).toEqual(previous);expect(s.proposal).toBeUndefined();
 });
});
