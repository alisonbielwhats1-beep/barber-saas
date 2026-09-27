import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const io=vi.hoisted(()=>({draft:vi.fn(),proposal:vi.fn(),confirm:vi.fn(),services:vi.fn(),query:vi.fn(),audit:vi.fn()}));
vi.mock('../prisma-tenant',()=>({withTenant:(_actor:unknown,work:(tx:object)=>unknown)=>work({$queryRaw:io.query,auditLog:{create:io.audit}})}));
vi.mock('../customer-catalog',async original=>({...await original<object>(),searchSalonCustomer:async()=>[{id:'ivo',name:'Ivo Freitas',phone:null}]}));
vi.mock('../scheduling-catalog',async original=>({...await original<object>(),schedulingTimezone:async()=> 'America/Sao_Paulo',listSchedulingServices:io.services,listSchedulingProfessionals:async()=>[{id:'raul',name:'Raul'}],getSchedulingAvailability:async()=>({plan:{startLocal:'2027-06-18T15:30'},alternatives:[],timezone:'America/Sao_Paulo'})}));
vi.mock('../scheduling-actions',async original=>({...await original<object>(),upsertSchedulingDraft:io.draft,proposeAppointmentCreate:io.proposal,confirmAppointmentCreate:io.confirm,schedulingSnapshot:async()=>({})}));
vi.mock('../scheduling-mutations',async original=>({...await original<object>(),authorizeSchedulingOperation:async()=> 'OWNER'}));
import {SalonSecretary} from '../salon-secretary';
import {ScriptedServicesModel,call} from '../../test/scripted-services-model';
import {applySchedulingInterpretation,schedulingState,type SchedulingState} from '../secretary-scheduling';
import fixture from '../../test/fixtures/secretary-candidate-clarification-v214.json';
const actor={salonId:'ours',userId:'owner'};
const options=[{id:'female',name:'Corte Feminino'},{id:'male',name:'Corte Masculino'}];
beforeEach(()=>{
 vi.clearAllMocks();vi.useFakeTimers();vi.setSystemTime(new Date('2027-06-14T12:00:00Z'));vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NETWORK_FORBIDDEN');}));
 io.query.mockImplementation(async(parts:readonly string[])=>parts.join('').includes('"Membership"')?[{role:'OWNER'}]:[{accessStatus:'APPROVED'}]);io.audit.mockResolvedValue({});
 io.services.mockImplementation(async(_tx,_actor,query:string)=>options.filter(row=>row.name.toLowerCase().includes(query.toLowerCase())));
 io.draft.mockImplementation(async(_tx,_actor,input)=>{const missing_fields=['customer_ref','service_ref','professional_ref','date','time'].filter(key=>!input.fields[key]);return {draft_ref:input.draft_ref??'dddddddd-dddd-4ddd-8ddd-dddddddddddd',draft_revision:(input.expected_revision??0)+1,operation:input.operation,fields:structuredClone(input.fields),expires_at:'2027-06-14T12:30:00Z',status:missing_fields.length?'NEEDS_INPUT':'READY',missing_fields,temporal_conflicts:[]};});
 io.proposal.mockImplementation(async(_tx,_actor,input)=>({...input,proposal_ref:'pppppppp-pppp-4ppp-8ppp-pppppppppppp',payload_hash:'hash',preview:'Ivo Freitas · Corte Masculino · Raul · 18/06/2027 15:30',expires_at:'2027-06-14T12:30:00Z'}));
});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();expect(io.confirm).not.toHaveBeenCalled();vi.unstubAllGlobals();vi.useRealTimers();});
it('replays both unchanged V214 Luna outputs through SDK, same draft and proposal projection',async()=>{
 const model=new ScriptedServicesModel(fixture.turns.map(turn=>call(turn.output[0].name,JSON.parse(turn.output[0].arguments))));
 const secretary=new SalonSecretary(async()=>model,()=> 'synthetic',undefined,{}, {enabled:()=>true});const started=await secretary.start(actor,'auto');
 const first=await secretary.send(actor,{sessionId:started.sessionId,message:fixture.turns[0].message});
 expect(first.capability_status).toBe('AMBIGUOUS');expect(first.operations![0].state.scheduling!.candidates?.items).toEqual(options);
 const initial=first.operations![0].state.scheduling!.draft!;
 const next=await secretary.send(actor,{sessionId:started.sessionId,message:fixture.turns[1].message});
 const state=next.operations![0].state.scheduling!;
 expect(state.draft?.draft_ref).toBe(initial.draft_ref);expect(state.draft?.draft_revision).toBe(initial.draft_revision+1);
 expect(state.fields).toMatchObject({customer_name:'Ivo Freitas',customer_ref:'ivo',service_name:'Corte Masculino',service_ref:'male',professional_name:'Raul',professional_ref:'raul',date:'2027-06-18',time:'15:30'});
 expect(next.action_plan!.status).toBe('READY_FOR_CONFIRMATION');expect(state.proposal).toBeDefined();expect(model.requests).toHaveLength(2);
});
function pending():SchedulingState{
 const fields={customer_name:'Ivo Freitas',customer_ref:'ivo',service_name:'corte',date:'2027-06-18',time:'15:30'};
 return {...schedulingState(),operation:'appointment.create',fields,candidates:{kind:'service_ref',items:options},draft:{draft_ref:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',draft_revision:1,operation:'appointment.create',fields:{...fields},expires_at:'2027-06-14T12:30:00Z',status:'NEEDS_INPUT',missing_fields:['service_ref'],temporal_conflicts:[]}};
}
it.each(['expired','changed-fields','other-role','retargeted-customer'] as const)('short answer cannot borrow %s candidate context',async kind=>{
 const state=pending();if(kind==='expired')state.draft!.expires_at='2027-06-14T11:59:00Z';if(kind==='changed-fields')state.fields.time='16:30';if(kind==='other-role')state.candidates!.kind='customer_ref';
 await expect(applySchedulingInterpretation(actor,state,{service_name:'Corte Masculino',...(kind==='retargeted-customer'?{customer_name:'Outra Pessoa'}:{})},'O masculino.')).rejects.toThrow('ENTITY_MENTION_CONFLICT');expect(io.draft).not.toHaveBeenCalled();expect(state.proposal).toBeUndefined();
});
