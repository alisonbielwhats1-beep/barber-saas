import { describe, expect, it, vi, afterEach } from "vitest";
import { createServicesAgent, runServicesTurn, customersSkill, servicesSkill } from "@everflair/salon-secretary";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { customerPatch } from "../customer-contract";
import { normalizedCustomerPatch } from "../customer-catalog";
import { potentialClientMatchWhere } from "../client-identity";
import { getOperationRequirements } from "../service-contract";
const payload = (extra: object) => ({operation:"customer.create",target_name:null,name:null,phone:null,email:null,requested_fields:[],clear_fields:[],...extra});
afterEach(()=>vi.unstubAllGlobals());
describe("Customers contracts and scoped Agent; no real API",()=>{
  it("discloses only selected manual; one normal Agent/function, no hosted tools",()=>{
    const model=new ScriptedServicesModel([]);
    const agent=createServicesAgent(model,vi.fn(),"customers");expect(agent.instructions).toBe(customersSkill);expect(agent.instructions).not.toBe(servicesSkill);
    expect(agent.tools.map(t=>[t.type,t.name])).toEqual([["function","upsert_action_draft"]]);expect(agent.handoffs).toEqual([]);expect(agent.modelSettings.store).toBe(false);
    expect(createServicesAgent(model,vi.fn()).instructions).toBe(servicesSkill);
  });
  it.each([
    ["Cadastre Amanda Souza",{name:"Amanda Souza"}],
    ["Altere o telefone da Amanda Souza para 11999990011",{operation:"customer.change",target_name:"Amanda Souza",phone:"11999990011"}],
    ["Mude o e-mail da Amanda Souza",{operation:"customer.change",target_name:"Amanda Souza",requested_fields:["email"]}],
    ["Quem é a Amanda Souza?",{operation:"customer.read",target_name:"Amanda Souza"}],
  ])("one inference for %s with explicit interpretation",async(message,extra)=>{
    const network=vi.fn(()=>{throw Error("NETWORK_FORBIDDEN");});vi.stubGlobal("fetch",network);
    const model=new ScriptedServicesModel([call("upsert_action_draft",payload(extra as object))]);
    const result=await runServicesTurn(model,message as string,{},getOperationRequirements("customer.create"),"customers");
    expect(result).toEqual(Object.fromEntries(Object.entries(payload(extra as object)).filter(([,v])=>v!==null)));expect(model.requests).toHaveLength(1);expect(network).not.toHaveBeenCalled();
  });
  it("only name required, omission distinct from clear and invalid values rejected",()=>{
    expect(getOperationRequirements("customer.create").required_fields).toEqual(["name"]);
    expect(normalizedCustomerPatch({name:"Amanda Souza"})).toEqual({name:"Amanda Souza"});
    expect(normalizedCustomerPatch({phone:null})).toEqual({phone:null});
    expect(normalizedCustomerPatch({phone:"+55 (11) 99999-0011",email:"AMANDA@example.test"})).toEqual({phone:"11999990011",email:"amanda@example.test"});
    expect(()=>customerPatch.parse({phone:"123"})).toThrow();expect(()=>customerPatch.parse({email:"bad"})).toThrow();expect(()=>customerPatch.parse({name:null})).toThrow();
  });
  it.each(["role","salonId","passwordHash","customer_ref","media_ref","consentGiven"])("rejects forbidden model/backend field %s",async field=>{
    const model=new ScriptedServicesModel([call("upsert_action_draft",payload({[field]:"forged"}))]);
    await expect(runServicesTurn(model,"forged",{}, {},"customers")).rejects.toThrow();
    expect(()=>customerPatch.parse({[field]:"forged"})).toThrow();
  });
  it("duplicate criterion is the existing domain rule, excludes tenant/merged/target",()=>{
    expect(potentialClientMatchWhere("salon",{phone:"+55 11 99999-0011",email:"AMANDA@example.test"},"current")).toEqual({salonId:"salon",mergedIntoId:null,id:{not:"current"},OR:[
      {email:{equals:"amanda@example.test",mode:"insensitive"}},{phoneNormalized:"11999990011"},{phone:"11999990011"},{phone:"5511999990011"}]});
    expect(potentialClientMatchWhere("salon",{})).toBeNull();
  });
});
