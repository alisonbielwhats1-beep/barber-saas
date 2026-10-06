import {describe,it,expect,vi} from "vitest";
import * as api from "@everflair/salon-secretary";
import {expandedWire,operationWire,turnWire} from "../../test/secretary-wire-schema";
import {call} from "../../test/scripted-services-model";
import {inventoryReferenceCatalog} from "../inventory-reference-catalog";
import type {Tx} from "../prisma-tenant";
const model=(raw:unknown):api.Model=>({getResponse:vi.fn(async()=>({usage:new api.Usage(),output:call("select_capabilities",raw)})),async *getStreamedResponse(){throw Error("NO_STREAM");}});
const planRef="10000000-0000-4000-8000-000000000001";
function wire(){const tool=api.createServicesAgent(model({}),()=>{},"discovery",true).tools[0];if(tool.type!=="function")throw Error("TOOL");return expandedWire(tool.parameters);}
function operation(shape:Record<string,api.SecretaryWireSchema>,key:string,quantity=5){return {...Object.fromEntries(Object.keys(shape).map(name=>[name,null])),operation:"stock.movement",item_key:key,source_scope:`Entraram ${quantity} unidades de Óleo Aurora`,inventory:{product_name:"Óleo Aurora",low_stock:null,mode:"IN",quantity:{value:quantity,literal:`${quantity} unidades`},reason:null,reference:{kind:"NAMED",literal:"Óleo Aurora"}}};}
describe("inventory reference live transport",()=>{
 it.each([1,2,5,10])("decodes %i live actions with their current role evidence",async size=>{
  await api.withConversationRouting(async()=>{
   const shape=operationWire(wire(),"stock.movement"),operations=Array.from({length:size},(_,index)=>operation(shape,`item${index}`,index+1));
   const raw={turn:{mode:"NEW",operations}},before=JSON.stringify(raw);
   let error:unknown;try{await api.runServicesTurn(model(raw),operations.map(op=>op.source_scope).join("; "),{}, {},"discovery",true);}catch(caught){error=caught;}
   expect(error).toBeInstanceOf(api.SecretaryNewRequest);
   const result=(error as api.SecretaryNewRequest).selection;
   expect(result.operations.map(op=>op.inventory?.quantity)).toEqual(Array.from({length:size},(_,i)=>i+1));
   expect(result.operations[0]).toMatchObject({source_scope:operations[0].source_scope,inventory:{quantity_evidence:"1 unidades",reference:{kind:"NAMED",literal:"Óleo Aurora"}}});
   expect(JSON.stringify(raw)).toBe(before);
  });
 });
 it.each([{kind:"NAMED",literal:null},{kind:"CURRENT_FIELD",literal:"Óleo Aurora"}])("rejects impossible reference shape %s before dispatch",async reference=>{
  await api.withConversationRouting(async()=>{
   const op=operation(operationWire(wire(),"stock.movement"),"a");op.inventory.reference=reference as typeof op.inventory.reference;
   await expect(api.runServicesTurn(model({turn:{mode:"NEW",operations:[op]}}),op.source_scope,{}, {},"discovery",true)).rejects.not.toBeInstanceOf(api.SecretaryNewRequest);
  });
 });
 it.each(["PATCH","RESUME"])("keeps %s proof on the exact published action",async mode=>{
  const active={plan_ref:planRef,actions:[{item_key:"stock",operation:"stock.movement",status:"NEEDS_INPUT",depends_on:[]}]};
  await api.withConversationRouting(async()=>{
   const shape=operationWire(turnWire(wire(),"PATCH"),"stock.movement");
   const fields=operation(shape,"stock");const {item_key,...patch}=fields;patch.operation="stock.movement";patch.inventory.reference={kind:"CURRENT_FIELD",literal:null} as unknown as typeof patch.inventory.reference;
   const operations=[{item_key,fields:patch}],raw={turn:mode==="PATCH"?{mode,operations}:{mode,plan_ref:planRef,patches:{operations}}};
   let error:unknown;try{await api.runServicesTurn(model(raw),fields.source_scope,{}, {},"discovery",true);}catch(caught){error=caught;}
   expect(error).toBeInstanceOf(mode==="PATCH"?api.SecretaryNewRequest:api.SecretaryResumeRequest);
  },{active_plan:active,suspended_plans:[active]});
 });
 it("catalog evidence is paginated beyond 200 and retains tenant predicates",async()=>{
  const all=Array.from({length:403},(_,index)=>({id:String(index).padStart(4,"0"),name:`Produto ${index}`}));
  const findMany=vi.fn(async(input:{where:{salonId:string};take:number;cursor?:{id:string};skip?:number;select:object})=>{
   expect(input.where).toEqual({salonId:"tenant"});expect(input.select).toEqual({id:true,name:true});expect(input.take).toBe(200);
   const from=input.cursor?all.findIndex(item=>item.id===input.cursor!.id)+(input.skip??0):0;return all.slice(from,from+input.take);
  });
  const tx={$executeRaw:async()=>0,$queryRaw:async(query:readonly string[]|{sql?:string})=>{const sql=Array.isArray(query)?query.join(""):(query as {sql?:string}).sql??"";return sql.includes('"Membership"')?[{role:"OWNER"}]:[{accessStatus:"APPROVED"}];},product:{findMany}} as unknown as Tx;
  expect(await inventoryReferenceCatalog(tx,{salonId:"tenant",userId:"owner"})).toEqual(all);expect(findMany).toHaveBeenCalledTimes(3);
 });
});
