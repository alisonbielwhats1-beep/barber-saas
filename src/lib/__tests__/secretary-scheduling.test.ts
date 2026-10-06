import { describe,expect,it,vi } from "vitest";
import { createServicesAgent,loadSkills,runServicesTurn,schedulingSkill,validateSelection } from "@everflair/salon-secretary";
import { resolveSchedulingDate,schedulingPatch } from "../scheduling-contract";
import { ScriptedServicesModel,call } from "../../test/scripted-services-model";
import { intent,plan } from "../../test/secretary-capability-plan";

describe("Scheduling contracts/disclosure without network",()=>{
  it("relative dates resolve at salon midnight, not server date; one selector only",()=>{
    const now=new Date("2026-01-02T01:00:00Z");
    expect(resolveSchedulingDate({day_offset:1,time:"10:00"},"America/Sao_Paulo",now)).toEqual({date:"2026-01-02",time:"10:00"});
    expect(resolveSchedulingDate({weekday:2},"America/Sao_Paulo",now).date).toBe("2026-01-06");
    expect(()=>resolveSchedulingDate({day_offset:1,date:"2026-01-03"},"America/Sao_Paulo",now)).toThrow("AMBIGUOUS_DATE");
    expect(()=>schedulingPatch.parse({time:"25:00"})).toThrow();
    expect(()=>schedulingPatch.parse({date:"2026-02-30"})).toThrow();
    expect(resolveSchedulingDate({period:"afternoon"},"America/Sao_Paulo",now)).not.toHaveProperty("time");
  });
  it("forged refs/prices and future operations fail before any handler",()=>{
    for(const op of [intent("appointment.unblock"),intent("appointment.create",{customer_ref:"invented"}),intent("appointment.create",{priceCents:100}),intent("service.create",{customer_name:"Amanda"})])expect(()=>validateSelection(plan([op]))).toThrow();
  });
  it("O: Scheduling only when selected, no hosted tools, one inference",async()=>{
    const fake=new ScriptedServicesModel([call("select_capabilities",plan([intent("appointment.create",{customer_name:"Amanda",service_name:"Progressiva",day_offset:1,time:"10:00"})]))]);
    const result=await runServicesTurn(fake,"Marque Amanda amanhã às 10h para Progressiva.",{}, {},"discovery");
    expect(result.skills).toEqual(["scheduling"]);expect(fake.requests).toHaveLength(1);
    for(const id of ["services","customers"] as const)expect(createServicesAgent(fake,vi.fn(),id).instructions).not.toContain(schedulingSkill);
    const a=createServicesAgent(fake,vi.fn(),"scheduling");expect(a.instructions).toBe(schedulingSkill);expect(a.tools.map(t=>t.type)).toEqual(["function"]);
    const loaded=loadSkills({skill_ids:["scheduling","customers","services"]});expect(loaded.capabilities.filter(t=>t==="T01")).toHaveLength(1);
    expect(loaded.capabilities).toContain("T12");expect(loaded.capabilities).toContain("T13");expect(loaded.capabilities).not.toContain("T08");
  });
});
