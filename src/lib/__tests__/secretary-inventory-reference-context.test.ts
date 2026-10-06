import { beforeEach,afterEach,describe,it,expect,vi } from "vitest";
import { inventoryState,applyInventoryInterpretation } from "../secretary-inventory";
import { confirmStockMovement } from "../inventory-actions";

import {decodeInventoryQuantityPayload} from "../../../packages/salon-secretary/src/inventory-skill";
import * as catalogPort from "../inventory-catalog";
import type { Tx } from "../prisma-tenant";
const db=vi.hoisted(()=>({tx:undefined as unknown as Tx,products:new Map<string,string>()}));
vi.mock("../prisma-tenant",()=>({withTenant:(_actor:unknown,fn:(tx:Tx)=>unknown)=>fn(db.tx)}));
vi.mock("../inventory-catalog",async original=>({...await original<object>(),assertInventoryAccess:async()=>undefined,
 searchProducts:async(_tx:unknown,_actor:unknown,{query}:{query:string})=>{if(![...db.products.values()].includes(query))return [];const id=query==="Óleo Aurora"?"product-a":query==="Shampoo Polar"?"product-b":"product-"+query;db.products.set(id,query);return [{id,name:query,stock:20,minStock:1,active:true,unit:"un",revision:"a".repeat(64)}];},
 getProduct:async(_tx:unknown,_actor:unknown,id:string)=>{const name=db.products.get(id);if(!name)throw Error("PRODUCT_NOT_FOUND");return {id,name,stock:20,minStock:1,active:true,unit:"un",revision:"a".repeat(64)};}}));
vi.mock("../inventory-reference-catalog",()=>({inventoryReferenceCatalog:async()=>[...db.products].map(([id,name])=>({id,name}))}));
const now=new Date("2027-04-12T12:00:00Z"),actor={salonId:"a",userId:"owner"};
type Row=Record<string,unknown>;let rows:Row[];
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(now);rows=[];db.products.clear();db.products.set("product-a","Óleo Aurora");db.products.set("product-b","Shampoo Polar");
 const filter=(where:Row)=>rows.filter(row=>Object.entries(where).every(([key,value])=>row[key]===value));
 db.tx={$executeRaw:vi.fn(async()=>0),$queryRaw:vi.fn(async(query:readonly string[]|{sql?:string})=>{const sql=Array.isArray(query)?query.join(""):(query as {sql?:string}).sql??"";return sql.includes('"Membership"')?[{role:"OWNER"}]:[{accessStatus:"APPROVED",timezone:"America/Sao_Paulo",currency:"BRL"}];}),auditLog:{create:vi.fn(async({data}:{data:Row})=>{rows.push(structuredClone(data));return data;}),findMany:vi.fn(async({where}:{where:Row})=>filter(where)),findFirst:vi.fn(async({where}:{where:Row})=>filter(where)[0]??null)}} as unknown as Tx;
});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
import original from "../../test/fixtures/secretary-real-wire-golden10-inventory.json";
import golden11 from "../../test/fixtures/secretary-real-wire-golden11-inventory.json";

const replay=(row:typeof original.cases[number])=>{
 const parsed=decodeInventoryQuantityPayload(JSON.parse(row.raw_arguments)) as {turn:{operations:Array<{operation?:string;fields?:{inventory:object};inventory?:object}>}};
 const op=parsed.turn.operations[0];return {...(op.fields?.inventory??op.inventory),operation:"stock.movement" as const};
};
const initial=async()=>{const state=inventoryState();await applyInventoryInterpretation(actor,state,{operation:"stock.movement",product_name:"Óleo Aurora",mode:"IN",quantity:2},"Chegaram duas caixas do Óleo Aurora.");return state;};
describe("inventory reference and quantity have separate effective state",()=>{
 it("GF28 v11 original first turn keeps product and asks only units; synthetic continuation completes",async()=>{
  const row=golden11.cases.find(value=>value.case_id==="GF28")!,state=inventoryState();
  const parsed=decodeInventoryQuantityPayload(JSON.parse(row.raw_arguments)) as {turn:{operations:{source_scope:string;inventory:object}[]}};
  const op=parsed.turn.operations[0];
  await applyInventoryInterpretation(actor,state,{...op.inventory,source_scope:op.source_scope,operation:"stock.movement"},row.source);
  expect(state.target).toBe("product-a");expect(state.draft?.missing_fields).toEqual(["quantity"]);expect(state.proposal).toBeUndefined();expect(state.fields.quantity).toBeUndefined();
  const ref=state.draft!.draft_ref;
  // v11 did not send turn 2. This continuation is an explicit offline control.
  await applyInventoryInterpretation(actor,state,{quantity:12,quantity_evidence:"doze unidades"},"São doze unidades no total.");
  expect(state.proposal).toMatchObject({delta:12,product:{id:"product-a"}});expect(state.draft?.draft_ref).toBe(ref);
 });
 it("GF29 v11 original repaired inventory call prepares four units with actual sibling scopes",async()=>{
  const row=golden11.cases.find(value=>value.case_id==="GF29"&&value.attempt===42)!,state=inventoryState();
  const parsed=decodeInventoryQuantityPayload(JSON.parse(row.raw_arguments)) as {turn:{operations:{operation:string;item_key:string;source_scope:string;inventory?:object}[]}};
  const op=parsed.turn.operations.find(value=>value.operation==="stock.movement")!;
  await applyInventoryInterpretation(actor,state,{...op.inventory,source_scope:op.source_scope,operation:"stock.movement"},row.source,undefined,parsed.turn.operations.filter(value=>value!==op).map(value=>({key:value.item_key,operation:value.operation,literal:value.source_scope})));
  expect(state.proposal).toMatchObject({delta:4,product:{id:"product-a"}});expect(state.draft?.missing_fields).toEqual([]);
 });
 it("GF27 original raw now prepares the correct output without adapted evidence",async()=>{
  const row=original.cases.find(value=>value.case_id==="GF27")!,state=inventoryState();
  await applyInventoryInterpretation(actor,state,replay(row),row.source);
  expect(state.proposal).toMatchObject({delta:-3,product:{id:"product-a",name:"Óleo Aurora"}});
  expect(state.fields.reason).toBe("para uso nos atendimentos");
 });
 it("GF28 original two turns preserve the same backend product and draft",async()=>{
  const [first,second]=original.cases.filter(value=>value.case_id==="GF28"),state=inventoryState();
  await applyInventoryInterpretation(actor,state,replay(first),first.source);
  const draft=structuredClone(state.draft);expect(state.proposal).toBeUndefined();expect(draft?.fields.quantity).toBeUndefined();
  await applyInventoryInterpretation(actor,state,replay(second),second.source);
  expect(state.proposal).toMatchObject({delta:12,product:{id:"product-a",name:"Óleo Aurora"}});
  expect(state.draft?.draft_ref).toBe(draft?.draft_ref);expect(state.draft?.draft_revision).toBe(draft!.draft_revision+1);
 });
 it("GF29 original raw retains pending literal/count without inventing a sibling scope",async()=>{
  const row=original.cases.find(value=>value.case_id==="GF29")!;
  const raw=decodeInventoryQuantityPayload(JSON.parse(row.raw_arguments)) as {turn:{operations:Array<{operation:string;inventory:object}>}};
  const op=raw.turn.operations.find(item=>item.operation==="stock.movement")!,state=inventoryState();
  await applyInventoryInterpretation(actor,state,{...op.inventory,operation:"stock.movement"},row.source);
  expect(state.fields.mode).toBe("IN");expect(state.fields.quantity).toBeUndefined();expect(state.proposal).toBeUndefined();
  expect(state.quantity_resolution).toMatchObject({status:"NEEDS_INPUT",count:4,expression:"quatro Óleos Aurora"});
  expect(state.pending_quantity_source).toMatchObject({quantity:4,source:row.source,literal:"quatro Óleos Aurora"});
 });
 it("invalid current proof preserves accepted identity but no executable quantity",async()=>{
  const state=await initial(),draft=structuredClone(state.draft);
  await applyInventoryInterpretation(actor,state,{quantity:12,quantity_evidence:"doze unidades"},"São duas caixas.");
  expect(state.target).toBe("product-a");expect(state.query).toBe("Óleo Aurora");expect(state.draft?.draft_ref).toBe(draft?.draft_ref);
  expect(state.fields.quantity).toBeUndefined();expect(state.draft?.fields.quantity).toBeUndefined();expect(state.proposal).toBeUndefined();
  await applyInventoryInterpretation(actor,state,{quantity:12,quantity_evidence:"doze unidades no total"},"São doze unidades no total.");
  expect(state.proposal?.delta).toBe(12);
 });
 it.each([undefined,{kind:"CURRENT_FIELD" as const,literal:null}])("explicit truncated identity cannot use the previous target with tag %j",async reference=>{
  const state=await initial();
  await applyInventoryInterpretation(actor,state,{quantity:5,quantity_evidence:"5 unidades",reference},"São 5 unidades de Óleo Aurora Premium.");
  expect(state.target).toBeUndefined();expect(state.proposal).toBeUndefined();expect(state.fields.quantity).toBeUndefined();
  expect(state.quantity_resolution).toMatchObject({status:"NEEDS_INPUT",identity_status:"CONFLICT"});
  await applyInventoryInterpretation(actor,state,{quantity:5},"5");
  expect(state.target).toBeUndefined();expect(state.proposal).toBeUndefined();
 });
 it.each([false,true])("explicit unknown new selector never returns to old product; ready=%s",async ready=>{
  const state=await initial();if(ready)await applyInventoryInterpretation(actor,state,{quantity:3},"3");
  const old=state.proposal;
  await applyInventoryInterpretation(actor,state,{product_name:"Produto Desconhecido",quantity:2,quantity_evidence:"duas caixas",reference:{kind:"NAMED",literal:"Produto Desconhecido"}},"São duas caixas do Produto Desconhecido.");
  expect(state.target).toBeUndefined();expect(state.query).toBe("Produto Desconhecido");expect(state.proposal).toBeUndefined();
  await applyInventoryInterpretation(actor,state,{quantity:12},"12");
  expect(state.target).toBeUndefined();expect(state.proposal).toBeUndefined();
  if(old)await expect(confirmStockMovement(db.tx,actor,{proposal_ref:old.proposal_ref,draft_revision:old.draft_revision})).rejects.toThrow("REVISION_CONFLICT");
 });
 it("explicit different real target invalidates old approval and only proposes new target",async()=>{
  const state=await initial();await applyInventoryInterpretation(actor,state,{quantity:3},"3");const old=state.proposal!;
  await applyInventoryInterpretation(actor,state,{product_name:"Shampoo Polar",quantity:5,quantity_evidence:"5 unidades",reference:{kind:"NAMED",literal:"Shampoo Polar"}},"Corrige para 5 unidades de Shampoo Polar.");
  expect(state.proposal).toMatchObject({delta:5,product:{id:"product-b"}});
  await expect(confirmStockMovement(db.tx,actor,{proposal_ref:old.proposal_ref,draft_revision:old.draft_revision})).rejects.toThrow("REVISION_CONFLICT");
 });
 it("CURRENT_FIELD cannot consume a changed product revision",async()=>{
  const state=await initial();state.draft!.product.revision="b".repeat(64);
  await expect(applyInventoryInterpretation(actor,state,{quantity:12,quantity_evidence:"doze unidades",reference:{kind:"CURRENT_FIELD",literal:null}},"São doze unidades.")).rejects.toThrow("PRODUCT_STALE");
  expect(state.fields.quantity).toBeUndefined();expect(state.proposal).toBeUndefined();
 });
 it("committed target release survives a later lookup failure and can recover",async()=>{
  const state=await initial();await applyInventoryInterpretation(actor,state,{quantity:3},"3");const old=state.proposal!;
  vi.spyOn(catalogPort,"searchProducts").mockRejectedValueOnce(Error("LOOKUP_UNAVAILABLE"));
  await expect(applyInventoryInterpretation(actor,state,{product_name:"Shampoo Polar",quantity:5,quantity_evidence:"5 unidades",reference:{kind:"NAMED",literal:"Shampoo Polar"}},"Corrige para 5 unidades de Shampoo Polar.")).rejects.toThrow("LOOKUP_UNAVAILABLE");
  expect(state.query).toBe("Shampoo Polar");expect(state.target).toBeUndefined();expect(state.fields.quantity).toBeUndefined();expect(state.proposal).toBeUndefined();
  await expect(confirmStockMovement(db.tx,actor,{proposal_ref:old.proposal_ref,draft_revision:old.draft_revision})).rejects.toThrow("REVISION_CONFLICT");
  await applyInventoryInterpretation(actor,state,{quantity:5,quantity_evidence:"5 unidades de Shampoo Polar"},"5 unidades de Shampoo Polar");
  expect(state.proposal).toMatchObject({delta:5,product:{id:"product-b"}});
 });
});
