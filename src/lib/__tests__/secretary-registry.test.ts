import { describe, expect, it, vi } from "vitest";
import { loadSkills, skillRegistry, validateSelection, createServicesAgent, runServicesTurn, servicesSkill, customersSkill } from "@everflair/salon-secretary";
import { getOperationRequirements } from "../service-contract";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { intent, plan } from "../../test/secretary-capability-plan";
describe("Registry / U01 / progressive disclosure, fake model only",()=>{
  it("only published IDs; immutable registry and shared capability deduplication",()=>{
    expect(skillRegistry.map(s=>s.skill_id)).toEqual(["inventory","financial","scheduling","services","customers","communication"]);
    const loaded=loadSkills({skill_ids:["services","customers","services"]});expect(loaded.manuals).toHaveLength(2);expect(loaded.capabilities).toEqual(["U02","U03","T17","T18","T01","T02","T19"]);
    expect(loaded.manuals.every(m=>m.manual_hash.length===64 && m.version==="1.0.0")).toBe(true);
    expect(loadSkills({skill_ids:["customers"]}).manuals[0].manual).toBe(customersSkill);
  });
  it.each(["admin","sql","crm","campaigns","../services","https://example.test","__proto__"])("rejects injected/unpublished Skill %s",id=>{
    expect(()=>loadSkills({skill_ids:[id]})).toThrow();expect(()=>validateSelection({skills:[id],operations:[],independent:true})).toThrow();
  });
  it("rejects arbitrary loader fields, operation and cross-domain fields",()=>{
    expect(()=>loadSkills({skill_ids:["services"],path:"secret"})).toThrow();
    expect(()=>validateSelection(plan([intent("customer.delete")]))).toThrow();
    expect(()=>validateSelection(plan([intent("service.change",{phone:"11999990011"})]))).toThrow();
    expect(()=>validateSelection({...plan([intent("customer.create")]),skills:["services"]})).toThrow();
    expect(()=>validateSelection(plan([intent("customer.create",{customer_ref:"invented"})]))).toThrow();
  });
  it.each([
    ["Cadastre uma massagem por R$50.",intent("service.create",{name:"massagem",priceCents:5000}),"services"],
    ["Altere a massagem para R$80.",intent("service.change",{target_name:"massagem",priceCents:8000}),"services"],
    ["Cadastre Amanda Souza.",intent("customer.create",{name:"Amanda Souza"}),"customers"],
    ["Altere o telefone da Amanda.",intent("customer.change",{target_name:"Amanda",requested_fields:["phone"]}),"customers"],
  ])("A-D selection + interpretation in one request: %s",async(message,operation,skill)=>{
    const model=new ScriptedServicesModel([call("select_capabilities",plan([operation as ReturnType<typeof intent>]))]);
    const selected=await runServicesTurn(model,message as string,{}, {},"discovery");expect(selected.skills).toEqual([skill]);expect(model.requests).toHaveLength(1);
    const input=JSON.stringify(model.requests[0]);expect(input).not.toContain(JSON.stringify(servicesSkill).slice(1,-1));expect(input).not.toContain(JSON.stringify(customersSkill).slice(1,-1));
    expect(createServicesAgent(model,vi.fn(),"discovery").tools.map(t=>[t.type,t.name])).toEqual([["function","select_capabilities"]]);
  });
  it("E/F/G/M/N: compound plan, selected manuals only on continuation, no future/hosted tools",async()=>{
    const selected=validateSelection(plan([intent("customer.create",{name:"Amanda Souza"}),intent("service.change",{target_name:"massagem",priceCents:8000})]));expect(selected.skills).toEqual(["customers","services"]);
    const fake=new ScriptedServicesModel([]);const customer=createServicesAgent(fake,vi.fn(),"customers"),service=createServicesAgent(fake,vi.fn(),"services");
    expect(customer.instructions).toBe(customersSkill);expect(service.instructions).toBe(servicesSkill);
    for(const agent of [customer,service]){expect(agent.tools.map(t=>t.name)).toEqual(["upsert_action_draft"]);expect(agent.tools.every(t=>t.type==="function")).toBe(true);expect(agent.handoffs).toEqual([]);}
  });
  it("measures actual request payload characters, manual bytes, Tools and inferences before/after",async()=>{
    const req={create:getOperationRequirements(),change:getOperationRequirements("service.change")};
    const before=new ScriptedServicesModel([call("upsert_action_draft",{name:"Massagem",priceCents:5000,durationMin:null})]);await runServicesTurn(before,"Cadastre uma massagem por R$50.",{},req);
    const after=new ScriptedServicesModel([call("select_capabilities",plan([intent("service.create",{name:"massagem",priceCents:5000})]))]);await runServicesTurn(after,"Cadastre uma massagem por R$50.",{}, {services:req,customers:{create:getOperationRequirements("customer.create"),change:getOperationRequirements("customer.change")}},"discovery");
    const metrics={before:{manualCharacters:servicesSkill.length,payloadCharacters:JSON.stringify(before.requests[0]).length,tools:1,inferences:before.requests.length},after:{manualCharacters:0,payloadCharacters:JSON.stringify(after.requests[0]).length,tools:1,inferences:after.requests.length},customerManualCharacters:customersSkill.length};
    process.stdout.write(`DISCLOSURE_METRICS ${JSON.stringify(metrics)}\n`);expect(metrics.after.inferences).toBe(metrics.before.inferences);expect(metrics.after.manualCharacters).toBe(0);
    const customerReq={create:getOperationRequirements("customer.create"),change:getOperationRequirements("customer.change")};
    const beforeCustomer=new ScriptedServicesModel([call("upsert_action_draft",{operation:"customer.create",target_name:null,name:"Amanda Souza",phone:null,email:null,requested_fields:[],clear_fields:[]})]);
    await runServicesTurn(beforeCustomer,"Cadastre Amanda Souza.",{},customerReq,"customers");
    const afterCustomer=new ScriptedServicesModel([call("select_capabilities",plan([intent("customer.create",{name:"Amanda Souza"})]))]);
    await runServicesTurn(afterCustomer,"Cadastre Amanda Souza.",{}, {services:req,customers:customerReq},"discovery");
    const beforeChange=new ScriptedServicesModel([call("upsert_action_draft",{operation:"service.change",target_name:"massagem",name:null,priceCents:8000,durationMin:null})]);await runServicesTurn(beforeChange,"Altere a massagem para R$80.",{},req);
    const compound=new ScriptedServicesModel([call("select_capabilities",plan([intent("customer.create",{name:"Amanda Souza"}),intent("service.change",{target_name:"massagem",priceCents:8000})]))]);
    await runServicesTurn(compound,"Cadastre Amanda Souza e altere a massagem para R$80.",{}, {services:req,customers:customerReq},"discovery");
    const chars=(m:ScriptedServicesModel)=>JSON.stringify(m.requests[0]).length;
    process.stdout.write(`DISCLOSURE_CUSTOMER_COMPOUND ${JSON.stringify({customer:{before:chars(beforeCustomer),after:chars(afterCustomer),inferencesBefore:1,inferencesAfter:afterCustomer.requests.length},compound:{beforeTwoRequests:chars(beforeCustomer)+chars(beforeChange),after:chars(compound),inferencesBefore:2,inferencesAfter:compound.requests.length}})}\n`);
  });
});
