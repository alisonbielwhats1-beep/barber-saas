import {beforeEach,expect,it,vi} from "vitest";
const ports=vi.hoisted(()=>({serviceSearch:vi.fn(),serviceDraft:vi.fn(),customerDraft:vi.fn(),inventoryDraft:vi.fn(),propose:vi.fn()}));
vi.mock("../prisma-tenant",()=>({withTenant:(_actor:unknown,work:(tx:object)=>unknown)=>work({auditLog:{create:async()=>({})}})}));
vi.mock("../service-catalog",async original=>({...await original<object>(),assertServiceWriter:async()=>({currency:"BRL"}),findCatalogServices:ports.serviceSearch}));
vi.mock("../service-create-mvp",async original=>({...await original<object>(),upsertActionDraft:ports.serviceDraft,proposeServiceChange:ports.propose}));
vi.mock("../customer-catalog",async original=>({...await original<object>(),customerDuplicates:async()=>[]}));
vi.mock("../customer-actions",async original=>({...await original<object>(),upsertCustomerDraft:ports.customerDraft,proposeCustomerChange:ports.propose}));
vi.mock("../inventory-catalog",async original=>({...await original<object>(),assertInventoryAccess:async()=>{}}));
vi.mock("../inventory-actions",async original=>({...await original<object>(),upsertInventoryDraft:ports.inventoryDraft,proposeStockMovement:ports.propose}));
import {SalonSecretary} from "../salon-secretary";
import {applyCustomerInterpretation,customerState} from "../secretary-customers";
import {applyInventoryInterpretation,inventoryState} from "../secretary-inventory";
import {ScriptedServicesModel,call} from "../../test/scripted-services-model";
const actor={salonId:"synthetic",userId:"owner"};
beforeEach(()=>{
  vi.clearAllMocks();
  ports.propose.mockResolvedValue({proposal_ref:crypto.randomUUID(),draft_revision:1,preview:"Confira"});
  ports.serviceSearch.mockResolvedValue([{id:"resolved-service",name:"Massagem",priceCents:5000,durationMin:30}]);
  ports.serviceDraft.mockImplementation(async(_tx,_a,input)=>({draft_ref:input.draft_ref??crypto.randomUUID(),draft_revision:(input.expected_revision??0)+1,
    fields:{name:"Massagem",durationMin:30,...input.patch},change:{service_ref:"resolved-service",before:{name:"Massagem",priceCents:5000,durationMin:30}},status:"READY",missing_fields:[]}));
  ports.customerDraft.mockImplementation(async(_tx,_a,input)=>({draft_ref:input.draft_ref??crypto.randomUUID(),draft_revision:(input.expected_revision??0)+1,fields:input.patch,status:"READY",missing_fields:[]}));
  ports.inventoryDraft.mockImplementation(async(_tx,_a,input)=>({draft_ref:input.draft_ref??crypto.randomUUID(),draft_revision:(input.expected_revision??0)+1,fields:input.patch,status:"READY",missing_fields:[]}));
});
it("customer label reassertion preserves resolved identity and rejects a different target",async()=>{
  const state={...customerState(),operation:"customer.change" as const,query:"Lia Mattos",target:"resolved-customer"};
  await applyCustomerInterpretation(actor,state,{target_name:"Lia Mattos",email:"new@example.test"});
  expect(state.target).toBe("resolved-customer");expect(ports.customerDraft.mock.calls[0][2].customer_ref).toBe("resolved-customer");
  await expect(applyCustomerInterpretation(actor,state,{target_name:"Rita Castro",email:"other@example.test"})).rejects.toThrow("TARGET_ALREADY_SELECTED");
  expect(ports.customerDraft).toHaveBeenCalledTimes(1);
});
it("inventory label reassertion keeps the selected product without resolving again",async()=>{
  const state={...inventoryState(),operation:"stock.movement" as const,query:"Pomada Fosca",target:"resolved-product",fields:{mode:"IN" as const}};
  await applyInventoryInterpretation(actor,state,{product_name:"Pomada Fosca",quantity:3});
  expect(state.target).toBe("resolved-product");expect(ports.inventoryDraft.mock.calls[0][2].product_ref).toBe("resolved-product");
  await expect(applyInventoryInterpretation(actor,state,{product_name:"Cera",quantity:4})).rejects.toThrow("TARGET_ALREADY_SELECTED");
  expect(ports.inventoryDraft).toHaveBeenCalledTimes(1);
});
it("service lookup label survives draft preparation for repeated-label corrections",async()=>{
  const model=new ScriptedServicesModel([
    call("upsert_action_draft",{operation:"service.change",target_name:"Massagem",name:null,priceCents:10000,durationMin:null}),
    call("upsert_action_draft",{operation:"service.change",target_name:"Massagem",name:null,priceCents:9000,durationMin:null}),
    call("upsert_action_draft",{operation:"service.change",target_name:"Manicure",name:null,priceCents:8000,durationMin:null}),
  ]);
  const secretary=new SalonSecretary(async()=>model,()=>"synthetic-execution"),session=await secretary.start(actor,"services");
  const before=await secretary.send(actor,{sessionId:session.sessionId,message:"Altere Massagem para cem."});
  const after=await secretary.send(actor,{sessionId:session.sessionId,message:"Massagem fica por noventa."});
  expect(after.draft!.draft_ref).toBe(before.draft!.draft_ref);expect(after.draft!.fields.priceCents).toBe(9000);
  expect(ports.serviceSearch).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(model.requests.at(-1))).toContain("Massagem");
  await expect(secretary.send(actor,{sessionId:session.sessionId,message:"Altere Manicure para oitenta."})).rejects.toThrow("SECRETARY_TURN_FAILED");
  expect(ports.serviceDraft).toHaveBeenCalledTimes(2);
});
