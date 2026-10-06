import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyCustomerInterpretation, customerState, selectCustomer } from "../secretary-customers";
import { applyCommunicationInterpretation, communicationState, selectCommunication, startCancellationMessage, type CommunicationState } from "../secretary-communication";
import { applyDraftTransition } from "../secretary-draft-transition";
import { validateSelectionV2 } from "@everflair/salon-secretary";
import { intent,plan } from "../../test/secretary-capability-plan";

const ports=vi.hoisted(()=>({customerDraft:vi.fn(),customerProposal:vi.fn(),messageDraft:vi.fn(),messageProposal:vi.fn(),search:vi.fn(),cancel:vi.fn()}));
vi.mock("../prisma-tenant",()=>({withTenant:async(_actor:unknown,fn:(tx:object)=>unknown)=>fn({})}));
vi.mock("../customer-catalog",async original=>({...await original<object>(),searchSalonCustomer:ports.search,getCustomer:vi.fn(),customerDuplicates:async()=>[]}));
vi.mock("../customer-actions",()=>({upsertCustomerDraft:ports.customerDraft,proposeCustomerChange:ports.customerProposal,confirmCustomerChange:vi.fn()}));
vi.mock("../communication-actions",async original=>({...await original<object>(),
  getCustomerMessageContext:async()=>({channel_eligible:true}),upsertMessageDraft:ports.messageDraft,proposeCustomerMessage:ports.messageProposal}));
vi.mock("../secretary-scheduling",async original=>({...await original<object>(),applySchedulingInterpretation:ports.cancel}));
const actor={salonId:"tenant-a",userId:"owner-a"};
type DraftInput={draft_ref?:string;expected_revision?:number;patch:Record<string,unknown>};
let customerRevision:number,messageRevision:number;
beforeEach(()=>{
  vi.clearAllMocks();customerRevision=0;messageRevision=0;
  ports.search.mockResolvedValue([{id:"client-a",name:"Marina"}]);
  ports.customerDraft.mockImplementation(async(_tx:unknown,_actor:unknown,input:DraftInput)=>{
    if(input.draft_ref&&input.expected_revision!==customerRevision)throw Error("REVISION_CONFLICT");
    return {draft_ref:"customer-draft",draft_revision:++customerRevision,fields:{...input.patch},status:"READY",missing_fields:[]};
  });
  ports.messageDraft.mockImplementation(async(_tx:unknown,_actor:unknown,input:DraftInput)=>{
    if(input.draft_ref&&input.expected_revision!==messageRevision)throw Error("REVISION_CONFLICT");
    return {draft_ref:"message-draft",draft_revision:++messageRevision,fields:{...input.patch},status:"READY",missing_fields:[]};
  });
  ports.customerProposal.mockImplementation(async(_tx:unknown,_actor:unknown,input:object)=>({...input,preview:"Cadastro revisado"}));
  ports.messageProposal.mockImplementation(async(_tx:unknown,_actor:unknown,input:object)=>({...input,preview:"Mensagem revisada"}));
  ports.cancel.mockImplementation(async(_actor:unknown,state:object)=>{Object.assign(state,{fields:{customer_name:"Marina",reason:"A cliente pediu."},
    draft:{draft_ref:"cancel-draft",draft_revision:1,action_snapshot:{customer_ref:"client-a"}}});});
});
async function existingCustomer(){
  const state=customerState();state.operation="customer.change";state.query="Marina";state.target="client-a";
  await applyCustomerInterpretation(actor,state,{phone:"11999990022"});return state;
}
async function existingMessage(){
  const state=communicationState();state.query="Marina";state.target="client-a";
  await applyCommunicationInterpretation(actor,state,{channel:"WHATSAPP",message_mode:"EXACT",content:"Texto anterior."},'Envie exatamente "Texto anterior."');return state;
}
describe("contact adapters follow the persisted draft revision",()=>{
  it("customer failure before draft commit preserves effective fields",async()=>{
    const state=await existingCustomer(),before=structuredClone(state);
    ports.customerDraft.mockRejectedValueOnce(Error("WRITE_FAILED"));
    await expect(applyCustomerInterpretation(actor,state,{phone:"11999990033"})).rejects.toThrow("WRITE_FAILED");
    expect(state.patch).toEqual(before.patch);expect(state.draft).toEqual(before.draft);expect(state.proposal).toBeUndefined();
  });
  it("message failure before draft commit preserves the accepted EXACT content",async()=>{
    const state=await existingMessage(),before=structuredClone(state);
    ports.messageDraft.mockRejectedValueOnce(Error("WRITE_FAILED"));
    await expect(applyCommunicationInterpretation(actor,state,{message_mode:"EXACT",content:"Texto novo."},'Envie exatamente "Texto novo."')).rejects.toThrow("WRITE_FAILED");
    expect(state.fields).toEqual(before.fields);expect(state.draft).toEqual(before.draft);expect(state.proposal).toBeUndefined();
  });
  it("customer proposal failure after commit retains revision and next patch recovers",async()=>{
    const state=await existingCustomer();ports.customerProposal.mockRejectedValueOnce(Error("PROPOSAL_FAILED"));
    await expect(applyCustomerInterpretation(actor,state,{phone:"11999990033"})).rejects.toThrow("PROPOSAL_FAILED");
    expect(state.patch.phone).toBe("11999990033");expect(state.draft?.draft_revision).toBe(2);expect(state.proposal).toBeUndefined();
    await applyCustomerInterpretation(actor,state,{email:"marina@example.test"});
    expect(state.draft?.draft_revision).toBe(3);expect(state.proposal?.draft_revision).toBe(3);expect(state.patch.phone).toBe("11999990033");
  });
  it("message proposal failure after commit retains revision and next patch recovers",async()=>{
    const state=await existingMessage();ports.messageProposal.mockRejectedValueOnce(Error("PROPOSAL_FAILED"));
    await expect(applyCommunicationInterpretation(actor,state,{message_mode:"EXACT",content:"Texto novo."},'Envie exatamente "Texto novo."')).rejects.toThrow("PROPOSAL_FAILED");
    expect(state.fields.content).toBe("Texto novo.");expect(state.draft?.draft_revision).toBe(2);expect(state.proposal).toBeUndefined();
    await applyCommunicationInterpretation(actor,state,{channel:"WHATSAPP"},"WhatsApp");
    expect(state.draft?.draft_revision).toBe(3);expect(state.proposal?.draft_revision).toBe(3);expect(state.fields.content).toBe("Texto novo.");
  });
  it("customer selection does not publish a target when draft persistence fails",async()=>{
    const state=customerState();state.operation="customer.change";state.query="Marina";state.patch={phone:"11999990022"};
    state.candidates=await ports.search();const before=structuredClone(state);
    ports.customerDraft.mockRejectedValueOnce(Error("WRITE_FAILED"));
    await expect(selectCustomer(actor,state,"client-a")).rejects.toThrow("WRITE_FAILED");
    expect(state.target).toBeUndefined();expect(state.candidates).toEqual(before.candidates);expect(state.draft).toBeUndefined();
  });
  it("message selection does not publish a target when draft persistence fails",async()=>{
    const state=communicationState();state.query="Marina";state.fields={channel:"WHATSAPP",message_mode:"EXACT",content:"Texto."};
    state.candidates=await ports.search();const before=structuredClone(state);
    ports.messageDraft.mockRejectedValueOnce(Error("WRITE_FAILED"));
    await expect(selectCommunication(actor,state,"client-a")).rejects.toThrow("WRITE_FAILED");
    expect(state.target).toBeUndefined();expect(state.candidates).toEqual(before.candidates);expect(state.draft).toBeUndefined();
  });
  it("a dependent child commit survives a parent failure without adopting the parent's uncommitted content",async()=>{
    const state={message:"Anterior",fields:{content:"Texto aceito"},draft:{draft_ref:"parent",draft_revision:1},proposal:{id:"old"},
      cancel:{message:"Cancelar",fields:{reason:"Motivo aceito"},draft:{draft_ref:"child",draft_revision:1},proposal:undefined}};
    await expect(applyDraftTransition(state,async next=>{
      next.cancel.fields.reason="Novo motivo persistido";next.cancel.draft.draft_revision=2;
      next.fields.content="Conteúdo que falhou";throw Error("PARENT_WRITE_FAILED");
    })).rejects.toThrow("PARENT_WRITE_FAILED");
    expect(state.cancel.draft.draft_revision).toBe(2);expect(state.cancel.fields.reason).toBe("Novo motivo persistido");
    expect(state.draft.draft_revision).toBe(1);expect(state.fields.content).toBe("Texto aceito");expect(state.proposal).toBeUndefined();
  });
  it("an uncommitted dependent child is not published after failure",async()=>{
    const state={message:"Anterior",fields:{content:"Texto aceito"},draft:{draft_ref:"parent",draft_revision:1},
      cancel:{message:"Cancelar",fields:{reason:"Motivo aceito"},draft:{draft_ref:"child",draft_revision:1}}};
    const before=structuredClone(state);
    await expect(applyDraftTransition(state,async next=>{next.cancel.fields.reason="Não persistido";throw Error("CHILD_WRITE_FAILED");})).rejects.toThrow("CHILD_WRITE_FAILED");
    expect(state.cancel).toEqual(before.cancel);expect(state.fields).toEqual(before.fields);
  });
  it("the first dependent draft stays reachable if preparation of its message fails",async()=>{
    const selection=validateSelectionV2({...plan([
      intent("appointment.cancel",{item_key:"cancel",depends_on:[],customer_name:"Marina",reason:"A cliente pediu."}),
      intent("customer.message",{item_key:"message",depends_on:["cancel"],communication:{recipient_name:"Marina",channel:"WHATSAPP",message_mode:"EXACT",content:"Aviso."}}),
    ]),independent:false});
    let published:CommunicationState|undefined;
    ports.messageDraft.mockRejectedValueOnce(Error("WRITE_FAILED"));
    await expect(startCancellationMessage(actor,selection,'Cancele porque a cliente pediu e envie exatamente "Aviso."',state=>{published=state;})).rejects.toThrow("WRITE_FAILED");
    expect(published?.cancel?.draft?.draft_ref).toBe("cancel-draft");expect(published?.cancel?.draft?.draft_revision).toBe(1);
    expect(published?.draft).toBeUndefined();expect(published?.fields.content).toBeUndefined();expect(published?.proposal).toBeUndefined();
    await applyCommunicationInterpretation(actor,published!,{recipient_name:"Marina",channel:"WHATSAPP",message_mode:"EXACT",content:"Aviso."},'Envie exatamente "Aviso."');
    expect(ports.cancel).toHaveBeenCalledTimes(1);expect(published?.draft?.draft_revision).toBe(1);expect(published?.proposal).toBeDefined();
  });
});
