import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchedulingFields } from "../scheduling-contract";
import { applySchedulingInterpretation, schedulingState, selectScheduling, type SchedulingState } from "../secretary-scheduling";
import { prepareBatch, sendBatchTurn, selectBatch, startBatch, type BatchState } from "../secretary-batch";
import { validateBatchPlan, type BatchDraft } from "../scheduling-batch";
import { validateSelectionV2 } from "@everflair/salon-secretary";
import { intent, plan } from "../../test/secretary-capability-plan";

const mock=vi.hoisted(()=>({draft:vi.fn(),proposal:vi.fn(),read:vi.fn(),batchDraft:vi.fn(),batchProposal:vi.fn(),revision:1,batchRevision:1,precommit:false}));
vi.mock("../prisma-tenant",()=>({withTenant:(_actor:unknown,run:(tx:object)=>unknown)=>run({})}));
vi.mock("../scheduling-actions",async original=>({...await original<object>(),upsertSchedulingDraft:mock.draft,proposeSchedulingAction:mock.proposal}));
vi.mock("../scheduling-batch",async original=>({...await original<object>(),upsertBatchDraft:mock.batchDraft,proposeActionBatch:mock.batchProposal}));
vi.mock("../scheduling-catalog",async original=>({...await original<object>(),schedulingTimezone:async()=>"America/Sao_Paulo",listSchedulingAppointments:mock.read}));
vi.mock("../scheduling-mutations",async original=>({...await original<object>(),authorizeSchedulingOperation:async()=>"OWNER",schedulingActionSnapshot:async()=>({}),locateSchedulingAppointments:async()=>[{appointment_ref:"appointment-a"}]}));
vi.mock("../customer-catalog",async original=>({...await original<object>(),searchSalonCustomer:async()=>[{id:"customer-a",name:"Lara"}]}));
vi.mock("../scheduling-entity-mentions",()=>({validateSchedulingEntityMentions:async()=>undefined}));

const actor={salonId:"commit-tenant",userId:"commit-owner"},ref="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const expires_at="2027-04-12T12:30:00.000Z";
const originalFields:SchedulingFields={customer_name:"Lara",customer_ref:"customer-a",appointment_ref:"appointment-a",date:"2027-04-13",time:"10:00",reason:"por viagem"};
function single(operation:"appointment.cancel"|"appointment.list"="appointment.cancel"):SchedulingState{
  return {...schedulingState(),operation,fields:{...originalFields},message:"Dados coletados",draft:{draft_ref:ref,draft_revision:1,operation,fields:{...originalFields},expires_at,status:"READY",missing_fields:[],temporal_conflicts:[]}};
}
const batchPlan=()=>validateBatchPlan({execution_policy:"all_or_nothing",items:[
  {key:"cancel",operation:"appointment.cancel",depends_on:[],fields:{...originalFields}},
  {key:"replace",operation:"appointment.create",depends_on:["cancel"],released_slot_of:"cancel",fields:{customer_name:"Vera",service_name:"Corte"}},
]});
function batch():BatchState{
  const p=batchPlan();return {operation:"action.batch",plan:p,message:"Dados coletados",metrics:{},interpretation_source:"MODEL",
    draft:{batch_ref:ref,batch_revision:1,draft_ref:ref,draft_revision:1,operation:"action.batch",plan:structuredClone(p),status:"NEEDS_INPUT",missing_fields:["cancel.time"],message:"Qual horário?",expires_at}};
}
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2027-04-12T12:00:00Z"));vi.clearAllMocks();mock.revision=1;mock.batchRevision=1;mock.precommit=false;
  vi.stubGlobal("fetch",vi.fn(()=>{throw Error("NETWORK_FORBIDDEN")}));
  mock.draft.mockImplementation(async(_tx:unknown,_actor:unknown,input:{operation:string;fields:SchedulingFields;expected_revision?:number;draft_ref?:string})=>{
    if(mock.precommit)throw Error("DRAFT_WRITE_FAILED");
    if(input.expected_revision!==undefined&&input.expected_revision!==mock.revision)throw Error("REVISION_CONFLICT");
    mock.revision++;
    return {draft_ref:input.draft_ref??ref,draft_revision:mock.revision,operation:input.operation,fields:structuredClone(input.fields),expires_at,status:"READY",missing_fields:[],temporal_conflicts:[]};
  });
  mock.batchDraft.mockImplementation(async(_tx:unknown,_actor:unknown,input:{plan:BatchDraft["plan"];expected_revision?:number;draft_ref?:string})=>{
    if(mock.precommit)throw Error("DRAFT_WRITE_FAILED");
    if(input.expected_revision!==undefined&&input.expected_revision!==mock.batchRevision)throw Error("REVISION_CONFLICT");
    mock.batchRevision++;
    return {batch_ref:input.draft_ref??ref,batch_revision:mock.batchRevision,draft_ref:input.draft_ref??ref,draft_revision:mock.batchRevision,operation:"action.batch",plan:structuredClone(input.plan),status:"READY",missing_fields:[],message:"Validado",expires_at};
  });
  mock.proposal.mockResolvedValue({proposal_ref:"proposal-current",draft_ref:ref,draft_revision:3,payload_hash:"current",preview:"Revisar"});
  mock.batchProposal.mockResolvedValue({proposal_ref:"proposal-current",draft_ref:ref,draft_revision:3,payload_hash:"current",preview:"Revisar"});
  mock.read.mockResolvedValue([]);
});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();vi.useRealTimers();});

describe("single scheduling adopts only committed revisions",()=>{
  it("preserves the committed revision after a proposal fails and continues on the same draft",async()=>{
    const state=single();mock.proposal.mockRejectedValueOnce(Error("PROPOSAL_UNAVAILABLE"));
    await expect(applySchedulingInterpretation(actor,state,{time:"11:00"},"às 11h")).rejects.toThrow("PROPOSAL_UNAVAILABLE");
    expect(state.draft?.draft_revision).toBe(2);expect(state.fields.time).toBe("11:00");expect(state.fields).toEqual(state.draft?.fields);expect(state.proposal).toBeUndefined();
    expect(state.message).toContain("dados estão preservados");
    await applySchedulingInterpretation(actor,state,{time:"12:00"},"às 12h");
    expect(state.draft?.draft_revision).toBe(3);expect(state.draft?.draft_ref).toBe(ref);expect(state.fields.time).toBe("12:00");expect(state.proposal).toBeDefined();
    expect(mock.draft.mock.calls.map(call=>call[2].expected_revision)).toEqual([1,2]);
  });
  it("a read failure after draft commit retains its date and permits the next turn",async()=>{
    const state=single("appointment.list");mock.read.mockRejectedValueOnce(Error("READ_UNAVAILABLE"));
    await expect(applySchedulingInterpretation(actor,state,{date:"2027-04-14"},"14/04/2027")).rejects.toThrow("READ_UNAVAILABLE");
    expect(state.draft?.draft_revision).toBe(2);expect(state.fields.date).toBe("2027-04-14");expect(state.appointments).toBeUndefined();
    await applySchedulingInterpretation(actor,state,{date:"2027-04-15"},"15/04/2027");expect(state.draft?.draft_revision).toBe(3);expect(state.appointments).toEqual([]);
  });
  it("a failed draft write does not publish the uncommitted fields",async()=>{
    const state=single(),before=structuredClone(state);mock.precommit=true;
    await expect(applySchedulingInterpretation(actor,state,{time:"11:00"},"às 11h")).rejects.toThrow("DRAFT_WRITE_FAILED");
    expect(state.fields).toEqual(before.fields);expect(state.draft).toEqual(before.draft);expect(mock.proposal).not.toHaveBeenCalled();
  });
  it.each([false,true])("selection publication follows the same boundary, committed=%s",async committed=>{
    const state=single();delete state.fields.customer_ref;state.draft!.fields={...state.fields};
    state.candidates={kind:"customer_ref",items:[{id:"customer-a",name:"Lara"}]};const before=structuredClone(state);
    if(committed)mock.proposal.mockRejectedValueOnce(Error("PROPOSAL_UNAVAILABLE"));else mock.precommit=true;
    await expect(selectScheduling(actor,state,"customer-a")).rejects.toThrow(committed?"PROPOSAL_UNAVAILABLE":"DRAFT_WRITE_FAILED");
    expect(state.fields.customer_ref).toBe(committed?"customer-a":undefined);expect(state.draft?.draft_revision).toBe(committed?2:1);
    if(!committed){expect(state.fields).toEqual(before.fields);expect(state.candidates).toEqual(before.candidates);}expect(state.proposal).toBeUndefined();
  });
});

describe("atomic batch graph and draft revision share the commit boundary",()=>{
  it("proposal failure adopts the committed graph and permits a later revision",async()=>{
    const state=batch(),changed=structuredClone(state.plan);changed.items[0].fields.time="11:00";mock.batchProposal.mockRejectedValueOnce(Error("PROPOSAL_UNAVAILABLE"));
    await expect(prepareBatch(actor,state,changed)).rejects.toThrow("PROPOSAL_UNAVAILABLE");
    expect(state.draft?.draft_revision).toBe(2);expect(state.plan).toEqual(state.draft?.plan);expect(state.plan.items[0].fields.time).toBe("11:00");expect(state.proposal).toBeUndefined();
    await prepareBatch(actor,state);expect(state.draft?.draft_revision).toBe(3);expect(state.proposal).toBeDefined();expect(mock.batchDraft.mock.calls.map(call=>call[2].expected_revision)).toEqual([1,2]);
  });
  it("a rejected batch patch never leaves the new graph paired with the old draft",async()=>{
    const state=batch(),before=structuredClone(state),changed=structuredClone(state.plan);changed.items[0].fields.time="11:00";mock.precommit=true;
    await expect(prepareBatch(actor,state,changed)).rejects.toThrow("DRAFT_WRITE_FAILED");expect(state.plan).toEqual(before.plan);expect(state.draft).toEqual(before.draft);
  });
  it("short-answer send does not publish its patch when U03 fails",async()=>{
    const state=batch(),before=structuredClone(state);mock.precommit=true;
    await expect(sendBatchTurn(actor,state,"11h",async()=>{throw Error("MODEL_FORBIDDEN")},()=>undefined)).rejects.toThrow("DRAFT_WRITE_FAILED");
    expect(state.plan).toEqual(before.plan);expect(state.draft).toEqual(before.draft);expect(mock.batchProposal).not.toHaveBeenCalled();
  });
  it("selection does not publish an uncommitted reference",async()=>{
    const state=batch();state.draft!.candidates={item_key:"cancel",field:"customer_ref",items:[{id:"customer-new",name:"Lara"}]};const before=structuredClone(state);mock.precommit=true;
    await expect(selectBatch(actor,state,"customer-new")).rejects.toThrow("DRAFT_WRITE_FAILED");expect(state.plan).toEqual(before.plan);expect(state.draft).toEqual(before.draft);
  });
  it("publishes an initial committed batch to its owner even if its first proposal fails",async()=>{
    const selection=validateSelectionV2({...plan([intent("appointment.cancel",{item_key:"cancel",customer_name:"Lara",reason:"por viagem"}),intent("appointment.create",{item_key:"replace",depends_on:["cancel"],released_slot_of:"cancel",customer_name:"Vera",service_name:"Corte"})]),independent:false});
    mock.batchProposal.mockRejectedValueOnce(Error("PROPOSAL_UNAVAILABLE"));const adopt=vi.fn();
    await expect(startBatch(actor,selection,"Cancela Lara por viagem e coloca Vera no lugar",adopt)).rejects.toThrow("PROPOSAL_UNAVAILABLE");
    expect(adopt).toHaveBeenCalledOnce();const saved=adopt.mock.calls[0][0] as BatchState;expect(saved.plan).toEqual(saved.draft?.plan);expect(saved.draft?.draft_revision).toBe(2);expect(saved.proposal).toBeUndefined();
    await prepareBatch(actor,saved);expect(saved.draft?.draft_revision).toBe(3);
  });
});
