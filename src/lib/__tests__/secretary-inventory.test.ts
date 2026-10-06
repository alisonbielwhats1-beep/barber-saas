import { afterEach, describe, expect, it, vi } from "vitest";
import { inventoryInterpretation, inventorySkill, loadSkills, createServicesAgent, runServicesTurn, validateSelection } from "@everflair/salon-secretary";
import { inventoryQuantityFastPath, inventoryState, type InventoryState } from "../secretary-inventory";
import { getOperationRequirements } from "../service-contract";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { intent, plan } from "../../test/secretary-capability-plan";

afterEach(()=>vi.unstubAllGlobals());
function waiting():InventoryState{
  return {...inventoryState(),operation:"stock.movement",target:"backend-product",fields:{mode:"IN"},draft:{operation:"stock.movement",draft_ref:"d",draft_revision:1,expires_at:"",fields:{mode:"IN"},status:"NEEDS_INPUT",missing_fields:["quantity"],product:{id:"backend-product",name:"Shampoo X",stock:12,minStock:3,active:true,unit:"un",revision:"r"}}};
}
describe("Inventory structured boundary and deterministic quantity",()=>{
  it.each(["1","10","100000"," 10 "])("only safe positive integer %s when exclusively waiting quantity",text=>{
    expect(inventoryQuantityFastPath(waiting(),text)).toEqual({quantity:Number(text.trim())});
  });
  it.each(["0","-3","1.5","1,5","01","1e2","100001","dez","10 caixas","umas dez","+10","11h",""])("unsafe/ambiguous %s does not enter fast-path",text=>{
    expect(inventoryQuantityFastPath(waiting(),text)).toBeUndefined();
  });
  it("never parse number without exclusively missing quantity, or across candidate/proposal/receipt state",()=>{
    for(const state of [inventoryState(),{...waiting(),draft:undefined},{...waiting(),candidates:[]},{...waiting(),operation:"stock.balance" as const},{...waiting(),draft:{...waiting().draft!,missing_fields:["mode","quantity"] as ("mode"|"quantity")[]}}])expect(inventoryQuantityFastPath(state,"10")).toBeUndefined();
  });
  it("U02 matches domain: integer units, bounded delta, visible existing reason default",()=>{
    expect(getOperationRequirements("stock.movement")).toMatchObject({required_fields:["product","mode","quantity"],modes:["IN","OUT"],quantity:{integer:true,min:1,max:100000},unit:"un",negative_stock_allowed:false,defaults:{reason:"Ajuste rápido",kind:"ADJUSTMENT"}});
  });
  it.each(["product_ref","stock","delta","projected_stock","salonId","role","costCents","sql"])("model cannot send %s",key=>{
    expect(()=>inventoryInterpretation.parse({[key]:"invented"})).toThrow();
    expect(()=>validateSelection(plan([intent("stock.movement",{inventory:{[key]:"invented"}})]))).toThrow();
  });
  it.each([{mode:"COUNT"},{quantity:0},{quantity:-1},{quantity:1.5},{quantity:100001},{quantity:"10"},{product_name:""},{reason:""},{low_stock:"true"}])("rejects malformed Inventory fields %j",input=>{
    expect(()=>inventoryInterpretation.parse(input)).toThrow();
  });
  it("nullable omission safe, no cross-domain fields, no mutation fields in reads",()=>{
    expect(inventoryInterpretation.parse({quantity:null,reason:null})).toEqual({quantity:null,reason:null});
    for(const input of [intent("service.create",{inventory:{quantity:10}}),intent("stock.balance",{inventory:{quantity:10}}),intent("stock.movement",{inventory:{low_stock:true}}),intent("stock.movement",{priceCents:10})])expect(()=>validateSelection(plan([input]))).toThrow("CAPABILITY_FIELD_MISMATCH");
  });
  it("one fake discovery; only Inventory manual on continuation; no hosted tools or other full manuals",async()=>{
    const network=vi.fn(()=>{throw Error("NETWORK_FORBIDDEN");});vi.stubGlobal("fetch",network);
    const fake=new ScriptedServicesModel([call("select_capabilities",plan([intent("stock.movement",{item_key:"a",depends_on:null,inventory:{product_name:"Shampoo X",mode:"IN",quantity:10}})]))]);
    const selected=await runServicesTurn(fake,"Entraram 10 unidades do Shampoo X.",{},{},"discovery");
    expect(selected.skills).toEqual(["inventory"]);expect(selected.operations[0].depends_on).toEqual([]);expect(fake.requests).toHaveLength(1);
    const loaded=loadSkills({skill_ids:selected.skills});expect(loaded.manuals.map(m=>m.manual)).toEqual([inventorySkill]);expect(loaded.capabilities).toEqual(["U02","U03","T24","T25","T26","T30"]);
    const agent=createServicesAgent(fake,vi.fn(),"inventory");expect(agent.instructions).toBe(inventorySkill);expect(agent.handoffs).toEqual([]);expect(agent.tools.map(t=>[t.type,t.name])).toEqual([["function","upsert_action_draft"]]);expect(agent.modelSettings.store).toBe(false);
    const input=JSON.stringify(fake.requests[0]);expect(input).not.toContain(JSON.stringify(inventorySkill).slice(1,-1));
    for(const id of ["services","customers","scheduling","financial"]){expect(loadSkills({skill_ids:[id]}).manuals.some(m=>m.skill_id==="inventory")).toBe(false);}
    expect(network).not.toHaveBeenCalled();
  });
  it("Financial + Inventory stays independent, capabilities shared only once",()=>{
    const selected=validateSelection(plan([intent("financial.report",{financial:{period:"yesterday"}}),intent("stock.movement",{inventory:{product_name:"Shampoo X",mode:"IN",quantity:10}})]));
    expect(selected.skills).toEqual(["financial","inventory"]);expect(selected.independent).toBe(true);
    const loaded=loadSkills({skill_ids:selected.skills});expect(loaded.capabilities.filter(t=>t==="U02")).toHaveLength(1);expect(loaded.capabilities).not.toContain("T28");expect(loaded.capabilities).not.toContain("T27");
  });
});
