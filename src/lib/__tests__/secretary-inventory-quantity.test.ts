import { beforeEach,afterEach,describe,it,expect,vi } from "vitest";
import { createHash } from "node:crypto";
import { inventoryState,applyInventoryInterpretation,inventoryQuantityFastPath,selectInventory } from "../secretary-inventory";
import { upsertInventoryDraft,proposeStockMovement,confirmStockMovement } from "../inventory-actions";
import * as inventoryActions from "../inventory-actions";
import { groundInventoryQuantity,missingInventoryQuantity } from "../inventory-quantity";
import { inventoryInterpretation,inventoryTransportInterpretation,decodeInventoryQuantityPayload } from "../../../packages/salon-secretary/src/inventory-skill";
import { createActionPlan,assessPlanAction } from "@everflair/salon-secretary";
import { collectedActionFields,assessmentFromView } from "../secretary-action-plan";
import { secretaryPlanMessage,planConversationContext } from "../secretary-presentation";
import { plan,intent } from "../../test/secretary-capability-plan";
import fixture from "../../test/fixtures/secretary-real-wire-golden9-inventory.json";
import type { Tx } from "../prisma-tenant";
import {SalonSecretary} from "../salon-secretary";
import {ScriptedServicesModel,call,appendScriptedResponses} from "../../test/scripted-services-model";
const db=vi.hoisted(()=>({tx:undefined as unknown as Tx,products:new Map<string,string>()}));
vi.mock("../prisma-tenant",()=>({withTenant:(_actor:unknown,fn:(tx:Tx)=>unknown)=>fn(db.tx)}));
vi.mock("../inventory-catalog",async original=>({...await original<object>(),assertInventoryAccess:async()=>undefined,
 searchProducts:async(_tx:unknown,_actor:unknown,{query}:{query:string})=>{const id=query==="Óleo Aurora"?"product-a":query==="Shampoo Polar"?"product-b":"product-"+query;db.products.set(id,query);return [{id,name:query,stock:20,minStock:1,active:true,unit:"un",revision:"a".repeat(64)}];},
 getProduct:async(_tx:unknown,_actor:unknown,id:string)=>{const name=db.products.get(id);if(!name)throw Error("PRODUCT_NOT_FOUND");return {id,name,stock:20,minStock:1,active:true,unit:"un",revision:"a".repeat(64)};}}));
const now=new Date("2027-04-12T12:00:00Z"),actor={salonId:"a",userId:"owner"};
type Row=Record<string,unknown>;let rows:Row[];
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(now);rows=[];db.products.clear();db.products.set("product-a","Óleo Aurora");
 const filter=(where:Row)=>rows.filter(row=>Object.entries(where).every(([key,value])=>row[key]===value));
 db.tx={$executeRaw:vi.fn(async()=>0),$queryRaw:vi.fn(async(query:readonly string[]|{sql?:string})=>{const sql=Array.isArray(query)?query.join(""):(query as {sql?:string}).sql??"";return sql.includes('"Membership"')?[{role:"OWNER"}]:[{accessStatus:"APPROVED",timezone:"America/Sao_Paulo",currency:"BRL"}];}),auditLog:{create:vi.fn(async({data}:{data:Row})=>{rows.push(structuredClone(data));return data;}),findMany:vi.fn(async({where}:{where:Row})=>filter(where)),findFirst:vi.fn(async({where}:{where:Row})=>filter(where)[0]??null)}} as unknown as Tx;
});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
describe("inventory effective quantity, revision and presentation",()=>{
 it.each([["2.000",2],["menos 5",5],["sete e cinco",12]])("invalid numeric atom %s cannot preserve or recreate a same-valued old proposal",async(atom,quantity)=>{
  const state=inventoryState();await applyInventoryInterpretation(actor,state,{operation:"stock.movement",product_name:"Óleo Aurora",mode:"IN",quantity},`Entraram ${quantity} unidades de Óleo Aurora.`);
  const old=state.proposal!;
  await applyInventoryInterpretation(actor,state,{quantity},`Entraram ${atom} unidades de Óleo Aurora.`);
  expect(state.fields.quantity).toBeUndefined();expect(state.draft?.fields.quantity).toBeUndefined();expect(state.proposal).toBeUndefined();
  await expect(confirmStockMovement(db.tx,actor,{proposal_ref:old.proposal_ref,draft_revision:old.draft_revision})).rejects.toThrow("REVISION_CONFLICT");
 });
 it.each([
  ["Entraram 5 unidades do Óleo Aurora Premium.","5 unidades"],
  ["Chegaram 3 caixas, todas contendo exatamente 5 unidades de Óleo Aurora.","5 unidades"],
  ["Chegaram 3 caixas com capacidade para 5 unidades de Óleo Aurora.","5 unidades"],
  ["Entraram -5 unidades do Óleo Aurora.","-5 unidades"],
  ["Nem 5 unidades do Óleo Aurora chegaram.","5 unidades"],
  ["Entraram 5 unidades de Óleo Aurora. Corrigindo: entraram 7 unidades.","5 unidades de Óleo Aurora"],
 ])("a partial witness never reaches a proposal: %s",async(source,literal)=>{
  const state=inventoryState();await applyInventoryInterpretation(actor,state,{operation:"stock.movement",product_name:"Óleo Aurora",mode:"IN",quantity:5,quantity_evidence:literal},source);
  expect(state.proposal).toBeUndefined();expect(state.fields.quantity).toBeUndefined();expect(rows.some(row=>row.action==="PROPOSAL")).toBe(false);
 });
 it("current identity contradicting the model cannot recover a historical quantity",async()=>{
  const state=inventoryState();await applyInventoryInterpretation(actor,state,{operation:"stock.movement",product_name:"Shampoo Polar",mode:"IN",quantity:5},"Entraram 5 unidades do Óleo Aurora.");
  await applyInventoryInterpretation(actor,state,{product_name:"Óleo Aurora"},"Na verdade era Shampoo Polar.");
  expect(state.target).toBeUndefined();expect(state.fields.quantity).toBeUndefined();expect(state.proposal).toBeUndefined();
  await applyInventoryInterpretation(actor,state,{product_name:"Óleo Aurora"},"Óleo Aurora");
  expect(state.proposal).toMatchObject({delta:5,product:{id:"product-a",name:"Óleo Aurora"}});
 });
 it("a current subject cannot borrow a selected product or preserve the old confirmation",async()=>{
  const state=inventoryState();await applyInventoryInterpretation(actor,state,{operation:"stock.movement",product_name:"Óleo Aurora",mode:"IN",quantity:3},"Entraram 3 unidades de Óleo Aurora.");
  const old=state.proposal!;
  await applyInventoryInterpretation(actor,state,{quantity:5,quantity_evidence:"5 unidades"},"Shampoo Polar recebeu 5 unidades.");
  expect(state.target).toBeUndefined();expect(state.fields.quantity).toBeUndefined();expect(state.proposal).toBeUndefined();
  await expect(confirmStockMovement(db.tx,actor,{proposal_ref:old.proposal_ref,draft_revision:old.draft_revision})).rejects.toThrow("REVISION_CONFLICT");
 });
 it.each([1,2,5,10])("the coordinator supplies fresh independent scopes for %i actions, including IN/OUT on one product",async count=>{
  const operations=Array.from({length:count},(_,index)=>intent("stock.movement",{item_key:`movement${index}`,depends_on:[],inventory:{mode:index%2?"OUT":"IN",product_name:"Óleo Aurora",quantity:index+1,quantity_evidence:`${index+1} unidades de Óleo Aurora`}}));
  const message=operations.map((_,index)=>`${index%2?"Saíram":"Entraram"} ${index+1} unidades de Óleo Aurora`).join("; ")+".";
  const model=new ScriptedServicesModel([call("select_capabilities",plan(operations))]),secretary=new SalonSecretary(async()=>model,()=>"offline-quantity-proof",undefined,{}, {enabled:()=>true});
  const session=await secretary.start(actor,"auto"),view=await secretary.send(actor,{sessionId:session.sessionId,message});
  expect(view.action_plan?.status).toBe("READY_FOR_CONFIRMATION");expect(view.action_plan?.actions).toHaveLength(count);
  expect(view.operations?.map(item=>item.state.inventory?.proposal?.delta)).toEqual(Array.from({length:count},(_,index)=>(index%2?-1:1)*(index+1)));
  expect(rows.some(row=>row.action==="CONFIRMED")).toBe(false);
 });
 it("PATCH uses only the current witnesses of validated existing action keys",async()=>{
  const operations=[5,2].map((quantity,index)=>intent("stock.movement",{item_key:`movement${index}`,depends_on:[],inventory:{mode:index?"OUT":"IN",product_name:"Óleo Aurora",quantity,quantity_evidence:`${quantity} unidades de Óleo Aurora`}}));
  const model=new ScriptedServicesModel([call("select_capabilities",plan(operations))]),secretary=new SalonSecretary(async()=>model,()=>"offline-quantity-proof",undefined,{}, {enabled:()=>true});
  const session=await secretary.start(actor,"auto"),first=await secretary.send(actor,{sessionId:session.sessionId,message:"Entraram 5 unidades de Óleo Aurora; saíram 2 unidades de Óleo Aurora."});
  const patches=[7,3].map((quantity,index)=>intent("stock.movement",{item_key:`movement${index}`,depends_on:[],inventory:{product_name:"Óleo Aurora",quantity,quantity_evidence:`${quantity} unidades de Óleo Aurora`}}));
  appendScriptedResponses(model,[call("select_capabilities",plan(patches))]);
  const revised=await secretary.send(actor,{sessionId:session.sessionId,message:"Corrige a entrada para 7 unidades de Óleo Aurora; a saída para 3 unidades de Óleo Aurora."});
  expect(revised.action_plan?.plan_ref).toBe(first.action_plan?.plan_ref);expect(revised.operations?.map(item=>item.state.inventory?.proposal?.delta)).toEqual([7,-3]);
  expect(revised.operations?.map(item=>item.state.inventory?.draft?.draft_revision)).toEqual([2,2]);
  appendScriptedResponses(model,[call("select_capabilities",plan([intent("stock.movement",{item_key:"movement0",depends_on:[],inventory:{quantity:8,quantity_evidence:"8 unidades de Óleo Aurora"}})]))]);
  const conflict=await secretary.send(actor,{sessionId:session.sessionId,message:"Entraram 8 unidades de Óleo Aurora; outra quantidade de 4 unidades de Óleo Aurora."});
  expect(conflict.operations?.[0].state.inventory?.proposal).toBeUndefined();expect(conflict.operations?.[0].state.inventory?.fields.quantity).toBeUndefined();
  expect(conflict.operations?.[1].state.inventory?.fields.quantity).toBe(3);
 });
 it("replays GF28 original arguments unchanged and prevents a confirmable packaging count",async()=>{
  expect(createHash("sha256").update(fixture.arguments).digest("hex")).toBe(fixture.argumentsSha256);
  const op=JSON.parse(fixture.arguments).turn.operations[0],state=inventoryState();
  await applyInventoryInterpretation(actor,state,{...op.inventory,operation:op.operation},fixture.message);
  expect(state.fields).toEqual({mode:"IN",reason:"Ajuste rápido"});expect(state.quantity_resolution).toMatchObject({status:"NEEDS_INPUT",count:2,unit_text:"caixas"});
  expect(state.draft?.missing_fields).toEqual(["quantity"]);expect(state.proposal).toBeUndefined();
  expect(rows.filter(row=>row.action==="PROPOSAL"||row.action==="CONFIRMED")).toEqual([]);
  let p=createActionPlan(plan([intent("stock.movement",{item_key:"stock",inventory:op.inventory})]));
  const view={sessionId:"child",cancelled:false,inventory:state,message:state.message};
  p.actions[0].fields=collectedActionFields(view,p.actions[0]);p=assessPlanAction(p,"stock",assessmentFromView(view,p.actions[0]));
  expect(p.actions[0].fields.inventory?.quantity).toBeUndefined();expect(p.actions[0].status).toBe("NEEDS_INPUT");
  const units=[{keys:["stock"],kind:"single" as const,child:"child"}],children=[{operation_ref:"child",state:view}];
  expect(secretaryPlanMessage(p,units,children)).toContain("Quantas unidades ao todo?");
  const context=planConversationContext(p,units,children).actions[0];
  expect(context.clarification.requested_field).toBe("quantity");expect(context.quantity_context).toMatchObject({catalog_unit:"un",resolution:{count:2,unit_text:"caixas"}});
 });
 it("a bare reply resolves only the same backend draft's catalog-unit question",async()=>{
  const state=inventoryState();await applyInventoryInterpretation(actor,state,{operation:"stock.movement",product_name:"Óleo Aurora",mode:"IN",quantity:2},"Chegaram duas caixas do Óleo Aurora.");
  const first=structuredClone(state.draft);const fast=inventoryQuantityFastPath(state,"12")!;
  await applyInventoryInterpretation(actor,state,fast,"12");
  expect(state.fields.quantity).toBe(12);expect(state.quantity_resolution).toMatchObject({status:"ACCEPTED",basis:"CLARIFICATION"});
  expect(state.draft?.draft_ref).toBe(first?.draft_ref);expect(state.draft?.draft_revision).toBe(2);expect(state.proposal?.delta).toBe(12);
 });
 it("wrong product query cannot become a selected target and the valid original measure is revalidated after correction",async()=>{
  const state=inventoryState(),source="Shampoo Polar: entraram 5 unidades.";
  await applyInventoryInterpretation(actor,state,{operation:"stock.movement",product_name:"Óleo Aurora",mode:"IN",quantity:5,quantity_evidence:"5 unidades"},source);
  expect(state.target).toBeUndefined();expect(state.query).toBeUndefined();expect(state.draft).toBeUndefined();expect(state.fields.quantity).toBeUndefined();
  expect(state.quantity_resolution?.cause).toBe("PRODUCT_UNPROVEN");expect(state.message).toContain("Qual é o produto");
  await applyInventoryInterpretation(actor,state,{product_name:"Shampoo Polar"},"Shampoo Polar");
  expect(state.query).toBe("Shampoo Polar");expect(state.fields.quantity).toBe(5);expect(state.proposal?.delta).toBe(5);
  expect(state.proposal?.product).toMatchObject({id:"product-b",name:"Shampoo Polar"});
  expect(state.pending_quantity_source).toBeUndefined();
 });
 it("correcting product identity never converts the preserved packaging count",async()=>{
  const state=inventoryState();
  await applyInventoryInterpretation(actor,state,{operation:"stock.movement",product_name:"Óleo Aurora",mode:"IN",quantity:2,quantity_evidence:"duas caixas"},"Chegaram duas caixas de Shampoo Polar.");
  await applyInventoryInterpretation(actor,state,{product_name:"Shampoo Polar"},"Shampoo Polar");
  expect(state.query).toBe("Shampoo Polar");expect(state.fields.quantity).toBeUndefined();expect(state.quantity_resolution?.cause).toBe("UNIT_UNPROVEN");expect(state.proposal).toBeUndefined();
  expect(state.message).toContain("Quantas unidades ao todo?");
 });
 it("a product contradiction invalidates the former journal and a wrong-field reply cannot steal its pending measure",async()=>{
  const state=inventoryState();await applyInventoryInterpretation(actor,state,{operation:"stock.movement",product_name:"Óleo Aurora",mode:"IN",quantity:3},"Entraram três unidades do Óleo Aurora.");
  const old=state.proposal!;
  await applyInventoryInterpretation(actor,state,{quantity:5,quantity_evidence:"5 unidades"},"Entraram 5 unidades do Shampoo Polar.");
  expect(state.target).toBeUndefined();expect(state.draft).toBeUndefined();expect(state.fields.quantity).toBeUndefined();expect(state.proposal).toBeUndefined();
  await expect(confirmStockMovement(db.tx,actor,{proposal_ref:old.proposal_ref,draft_revision:old.draft_revision})).rejects.toThrow("REVISION_CONFLICT");
  const pending=structuredClone(state.pending_quantity_source);
  await applyInventoryInterpretation(actor,state,{quantity:12},"12");expect(state.pending_quantity_source).toEqual(pending);expect(state.target).toBeUndefined();
  await applyInventoryInterpretation(actor,state,{product_name:"Shampoo Polar"},"Shampoo Polar");
  expect(state.proposal?.product.id).toBe("product-b");expect(state.proposal?.delta).toBe(5);
 });
 it("an invalid correction removes an older executable quantity instead of merging it back",async()=>{
  const state=inventoryState();await applyInventoryInterpretation(actor,state,{operation:"stock.movement",product_name:"Óleo Aurora",mode:"IN",quantity:3},"Entraram três unidades do Óleo Aurora.");
  const proposal=state.proposal!;expect(proposal.delta).toBe(3);
  await applyInventoryInterpretation(actor,state,{quantity:2,quantity_evidence:"duas caixas"},"Na verdade chegaram duas caixas.");
  expect(state.fields.quantity).toBeUndefined();expect(state.draft?.fields.quantity).toBeUndefined();expect(state.proposal).toBeUndefined();
  expect(state.draft?.missing_fields).toEqual(["quantity"]);
  await expect(confirmStockMovement(db.tx,actor,{proposal_ref:proposal.proposal_ref,draft_revision:proposal.draft_revision})).rejects.toThrow("REVISION_CONFLICT");
 });
 it("an omitted or echoed accepted quantity survives unrelated field changes",async()=>{
  const state=inventoryState();await applyInventoryInterpretation(actor,state,{operation:"stock.movement",product_name:"Óleo Aurora",mode:"IN",quantity:3},"Entraram três unidades do Óleo Aurora.");
  await applyInventoryInterpretation(actor,state,{reason:"Reposição semanal",quantity:3},"Motivo: reposição semanal.");
  expect(state.fields).toMatchObject({quantity:3,reason:"Reposição semanal"});expect(state.proposal?.delta).toBe(3);
 });
 it("failed persistence never publishes changed fields or a resolved quantity",async()=>{
  const state=inventoryState();await applyInventoryInterpretation(actor,state,{operation:"stock.movement",product_name:"Óleo Aurora",mode:"IN"},"Entrou Óleo Aurora.");
  const before=structuredClone(state);
  const original=rows.find(row=>row.action==="DRAFT")!;rows.push({...original,metadata:{...(original.metadata as object),draft_revision:2}});
  await expect(applyInventoryInterpretation(actor,state,{quantity:12},"12")).rejects.toThrow("REVISION_CONFLICT");
  expect(state).toEqual(before);
 });
 it("a proposal failure after committed draft preserves the new revision and permits retry",async()=>{
  const state=inventoryState();await applyInventoryInterpretation(actor,state,{operation:"stock.movement",product_name:"Óleo Aurora",mode:"IN",quantity:3},"Entraram três unidades do Óleo Aurora.");
  const ref=state.draft!.draft_ref,oldProposal=state.proposal!;
  vi.spyOn(inventoryActions,"proposeStockMovement").mockRejectedValueOnce(Error("PROPOSAL_TEMPORARY_FAILURE"));
  await expect(applyInventoryInterpretation(actor,state,{quantity:4},"quatro unidades")).rejects.toThrow("PROPOSAL_TEMPORARY_FAILURE");
  expect(state.draft?.draft_revision).toBe(2);expect(state.fields.quantity).toBe(4);expect(state.proposal).toBeUndefined();
  await expect(confirmStockMovement(db.tx,actor,{proposal_ref:oldProposal.proposal_ref,draft_revision:oldProposal.draft_revision})).rejects.toThrow("REVISION_CONFLICT");
  await applyInventoryInterpretation(actor,state,{quantity:5},"cinco unidades");
  expect(state.draft?.draft_ref).toBe(ref);expect(state.draft?.draft_revision).toBe(3);expect(state.proposal?.delta).toBe(5);
 });
 it("selection also publishes a committed draft when proposal preparation fails",async()=>{
  const state={...inventoryState(),operation:"stock.movement" as const,query:"Óleo Aurora",fields:{mode:"IN" as const,quantity:3},
    quantity_resolution:groundInventoryQuantity({quantity:3,source:"3 Óleo Aurora",product_names:["Óleo Aurora"]}),
    candidates:[{id:"product-a",name:"Óleo Aurora",stock:20,minStock:1,active:true,unit:"un" as const,revision:"a".repeat(64)}]};
  vi.spyOn(inventoryActions,"proposeStockMovement").mockRejectedValueOnce(Error("PROPOSAL_TEMPORARY_FAILURE"));
  await expect(selectInventory(actor,state,"product-a")).rejects.toThrow("PROPOSAL_TEMPORARY_FAILURE");
  const current=state as ReturnType<typeof inventoryState>;
  expect(current.draft?.draft_revision).toBe(1);expect(current.target).toBe("product-a");expect(current.candidates).toBeUndefined();expect(current.proposal).toBeUndefined();
  await applyInventoryInterpretation(actor,current,{quantity:4},"4 unidades");expect(current.draft?.draft_revision).toBe(2);expect(current.proposal?.delta).toBe(4);
 });
 it.each(["target","question","expired","fields"])("a bare number cannot reuse invalid %s context",async fault=>{
  const state=inventoryState();await applyInventoryInterpretation(actor,state,{operation:"stock.movement",product_name:"Óleo Aurora",mode:"IN"},"Entrou Óleo Aurora.");
  if(fault==="target")state.target="another-product";
  if(fault==="question")state.message="Qual produto?";
  if(fault==="expired")vi.setSystemTime(new Date("2027-04-12T13:00:00Z"));
  if(fault==="fields")state.fields.mode="OUT";
  try{await applyInventoryInterpretation(actor,state,{quantity:12},"12");}catch{}
  expect(state.proposal).toBeUndefined();expect(state.fields.quantity).toBeUndefined();
 });
 it("U03 preserves the explicit numeric-domain API while conversation callers require proof",async()=>{
  const direct=await upsertInventoryDraft(db.tx,actor,{product_ref:"product-a",patch:{mode:"IN",quantity:2}});
  expect(direct.status).toBe("READY");expect((await proposeStockMovement(db.tx,actor,{draft_ref:direct.draft_ref,draft_revision:direct.draft_revision})).delta).toBe(2);
  await expect(upsertInventoryDraft(db.tx,actor,{product_ref:"product-a",patch:{mode:"IN",quantity:2},quantity_origin:"CONVERSATION"})).rejects.toThrow("QUANTITY_PROOF_REQUIRED");
  const pending=await upsertInventoryDraft(db.tx,actor,{product_ref:"product-a",patch:{mode:"IN",quantity:2},quantity_origin:"CONVERSATION",quantity_resolution:missingInventoryQuantity()});
  expect(pending.fields.quantity).toBeUndefined();await expect(proposeStockMovement(db.tx,actor,{draft_ref:pending.draft_ref,draft_revision:pending.draft_revision})).rejects.toThrow("NEEDS_INPUT");
 });
 it("U03 cannot accept mismatched quantity and proof",async()=>{
  const resolution=groundInventoryQuantity({quantity:3,source:"3 unidades de Óleo Aurora",product_names:["Óleo Aurora"]});
  await expect(upsertInventoryDraft(db.tx,actor,{product_ref:"product-a",patch:{mode:"IN",quantity:2},quantity_origin:"CONVERSATION",quantity_resolution:resolution})).rejects.toThrow("QUANTITY_PROOF_MISMATCH");
 });
 it.each([1,2,5,10])("keeps %i independent quantities without sharing product proofs",async count=>{
  const names=Array.from({length:count},(_,i)=>`Produto ${String.fromCharCode(65+i)}`),message=names.map((name,i)=>`Entraram ${i+1} unidades do ${name}`).join("; ")+".";
  for(const [index,name] of names.entries()){
   const state=inventoryState();await applyInventoryInterpretation(actor,state,{operation:"stock.movement",product_name:name,mode:"IN",quantity:index+1,quantity_evidence:`${index+1} unidades do ${name}`},message);
   expect(state.proposal?.delta).toBe(index+1);
  }
 });
});
describe("coupled inventory quantity transport",()=>{
 it.each([
  {quantity:{value:2,literal:"duas caixas"}},
  {turn:{mode:"NEW",operations:[{inventory:{quantity:{value:2,literal:"duas caixas"}}}]}},
  {turn:{mode:"PATCH",operations:[{fields:{inventory:{quantity:{value:2,literal:"duas caixas"}}}}]}},
  {turn:{mode:"RESUME",resume_request:{patches:{operations:[{inventory:{quantity:{value:2,literal:"duas caixas"}}}]}}}},
 ])("decodes only the coupled literal/value pair structurally",payload=>{
  const decoded=decodeInventoryQuantityPayload(payload,true);
  expect(JSON.stringify(decoded)).toContain('"quantity":2');expect(JSON.stringify(decoded)).toContain('"quantity_evidence":"duas caixas"');
  expect(JSON.stringify(payload)).toContain('"literal":"duas caixas"');
 });
 it.each([{quantity:2},{quantity:{value:2,literal:"  "}},{quantity:{value:2,literal:null}},{quantity:{value:2,literal:"duas"},quantity_evidence:null},{quantity:{value:2,literal:"duas",unit:"un"}}])("rejects scalar, empty, mixed or extra authority %j",payload=>{
  expect(()=>inventoryTransportInterpretation.parse(payload)).toThrow();
  expect(()=>decodeInventoryQuantityPayload(payload,true)).toThrow();
 });
 it("does not expose backend quantity resolution to the model",()=>{
  expect(()=>inventoryInterpretation.parse({quantity_resolution:{status:"ACCEPTED",quantity:2}})).toThrow();
 });
});
