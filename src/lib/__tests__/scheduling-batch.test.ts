import { describe,it,expect } from "vitest";
import { validateBatchPlan,patchBatch } from "../scheduling-batch";
import { loadSkills,runServicesTurn } from "@everflair/salon-secretary";
import { ScriptedServicesModel,call } from "../../test/scripted-services-model";
import { intent } from "../../test/secretary-capability-plan";
const plan=()=>({execution_policy:"all_or_nothing",items:[{key:"a",operation:"appointment.cancel",depends_on:[],fields:{customer_name:"Amanda",time:"10:00"}},{key:"b",operation:"appointment.create",depends_on:["a"],released_slot_of:"a",fields:{customer_name:"Fábio"}}]});
describe("T21 graph and interpretation",()=>{
  it("explicit edges, not array position, determine execution order",()=>{const p=plan();p.items.reverse();expect(validateBatchPlan(p).items.map(i=>i.key)).toEqual(["a","b"]);});
  it.each(["cycle","missing","duplicate","limit","independent","slot","unsupported"])("rejects %s",kind=>{
    const p=plan();if(kind==="cycle")p.items[0].depends_on=["b"];if(kind==="missing")p.items[1].depends_on=["unknown"];
    if(kind==="duplicate")p.items[1].key="a";if(kind==="limit")p.items.push({...p.items[0],key:"c"});if(kind==="independent")p.items[1].depends_on=[];
    if(kind==="slot")p.items[1].fields.time="11:00";if(kind==="unsupported")p.items[1].operation="schedule.block";
    expect(()=>validateBatchPlan(p)).toThrow();
  });
  it("continuation keeps graph and unrelated fields isolated",()=>{const p=validateBatchPlan(plan());const n=patchBatch(p,"b",{service_name:"Corte masculino"});expect(n.items[0]).toEqual(p.items[0]);expect(n.items[1]).toMatchObject({depends_on:["a"],fields:{customer_name:"Fábio",service_name:"Corte masculino"}});});
  it("rejects invented tenant/ref or arbitrary operation",()=>{const p=plan();Object.assign(p.items[1].fields,{salonId:"other"});expect(()=>validateBatchPlan(p)).toThrow();});
  it("single discovery inference returns dependency structure, no hosted tools",async()=>{
    const selection={skills:["scheduling"],independent:false,operations:[intent("appointment.cancel",{item_key:"a",depends_on:[],customer_name:"Amanda",time:"10:00"}),intent("appointment.create",{item_key:"b",depends_on:["a"],released_slot_of:"a",customer_name:"Fábio",service_name:"Corte masculino"})]};
    const fake=new ScriptedServicesModel([call("select_capabilities",selection)]);
    expect(await runServicesTurn(fake,"Cancele Amanda e coloque Fábio no lugar",{}, {},"discovery")).toMatchObject(selection);
    expect(fake.requests).toHaveLength(1);expect(fake.requests[0].tools).toHaveLength(1);
    expect(fake.requests[0].tools?.every(t=>t.type==="function")).toBe(true);
    expect(loadSkills({skill_ids:["scheduling"]}).capabilities).toContain("T21");
    expect(loadSkills({skill_ids:["services"]}).capabilities).not.toContain("T21");
  });
});
