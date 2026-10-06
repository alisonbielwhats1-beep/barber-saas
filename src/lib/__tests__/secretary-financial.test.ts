import { describe,it,expect,vi } from "vitest";
import { financialInterpretation, financialSkill, createServicesAgent, runServicesTurn, loadSkills, validateSelection } from "@everflair/salon-secretary";
import { resolveFinancialPeriod, financialDifference, getFinancialSummary } from "../secretary-financial";
import type { Tx } from "../prisma-tenant";
import { ScriptedServicesModel,call } from "../../test/scripted-services-model";
import { intent,plan } from "../../test/secretary-capability-plan";
const now=new Date("2026-09-23T01:00:00Z"),tz="America/Sao_Paulo";
describe("Financial interpretation and deterministic period contract",()=>{
  it.each([
    ["today","2026-09-22T03:00:00.000Z","2026-09-23T03:00:00.000Z"],
    ["yesterday","2026-09-21T03:00:00.000Z","2026-09-22T03:00:00.000Z"],
    ["this_week","2026-09-20T03:00:00.000Z","2026-09-27T03:00:00.000Z"],
    ["last_week","2026-09-13T03:00:00.000Z","2026-09-20T03:00:00.000Z"],
    ["this_month","2026-09-01T03:00:00.000Z","2026-10-01T03:00:00.000Z"],
    ["last_month","2026-08-01T03:00:00.000Z","2026-09-01T03:00:00.000Z"],
  ] as const)("resolves %s in actual salon timezone",(selector,start_at,end_at)=>{
    expect(resolveFinancialPeriod(selector,tz,now)).toMatchObject({start_at,end_at,timezone:tz});
  });
  it("calendar year transition and DST day have correct absolute boundaries",()=>{
    expect(resolveFinancialPeriod("last_month",tz,new Date("2026-01-15T15:00Z")).from_date).toBe("2025-12-01");
    const r=resolveFinancialPeriod("today","America/New_York",new Date("2026-03-08T15:00Z"));
    expect(new Date(r.end_at).getTime()-new Date(r.start_at).getTime()).toBe(23*3600000);
  });
  it("comparison never divides by zero or converts unavailable into zero",()=>{
    expect(financialDifference(6000,5000)).toMatchObject({difference:1000,percent:20});
    expect(financialDifference(100,0)).toMatchObject({difference:100,percent:null,reason:"ZERO_BASE"});
    expect(financialDifference(0,0).percent).toBeNull();expect(financialDifference(null,100).difference).toBeNull();
  });
  it("schema rejects SQL, refs, selectors, unsupported metrics and write operations",()=>{
    for(const p of [{sql:"select 1"},{salonId:"other"},{metrics:["net_profit"]},{period:"last_7_days"},{amountCents:123},{filters:["arbitrary"]}])expect(()=>financialInterpretation.parse(p)).toThrow();
    expect(()=>validateSelection(plan([intent("financial.refund")]))).toThrow();
    expect(()=>validateSelection(plan([intent("financial.report",{name:"bad"})]))).toThrow();
    expect(()=>validateSelection(plan([intent("service.create",{financial:{period:"today"}})]))).toThrow();
  });
  it("discovery interprets Financial and independent Services together with one inference",async()=>{
    const model=new ScriptedServicesModel([call("select_capabilities",plan([intent("financial.report",{financial:{metrics:["service_revenue"],period:"yesterday"}}),intent("service.change",{target_name:"massagem",priceCents:8000})]))]);
    const selected=await runServicesTurn(model,"Quanto faturei ontem e altere massagem para 80?",{}, {},"discovery");
    expect(selected.skills).toEqual(["financial","services"]);expect(model.requests).toHaveLength(1);
    expect(JSON.stringify(model.requests[0])).not.toContain(JSON.stringify(financialSkill).slice(1,-1));
  });
  it("only Financial full manual on continuation; function tools only, no raw results",async()=>{
    const model=new ScriptedServicesModel([call("upsert_action_draft",{period:"yesterday"})]);
    await runServicesTurn(model,"Ontem",{metrics:["received_revenue"]},{},"financial");
    const agent=createServicesAgent(model,vi.fn(),"financial");
    expect(agent.instructions).toBe(financialSkill);expect(agent.tools.map(t=>[t.name,t.type])).toEqual([["upsert_action_draft","function"]]);
    expect(agent.handoffs).toEqual([]);expect(agent.modelSettings.store).toBe(false);
    expect(loadSkills({skill_ids:["financial"]}).capabilities).toEqual(["U02","T09"]);
    for(const id of ["services","customers","scheduling"])expect(loadSkills({skill_ids:[id]}).manuals.some(m=>m.skill_id==="financial")).toBe(false);
  });
  it("database error never becomes a zero-valued financial answer",async()=>{
    const $queryRaw=vi.fn().mockResolvedValueOnce([{accessStatus:"APPROVED",timezone:tz,currency:"BRL"}]).mockResolvedValueOnce([{role:"OWNER"}]).mockRejectedValueOnce(Error("QUERY_FAILED"));
    await expect(getFinancialSummary({$queryRaw} as unknown as Tx,{salonId:"s",userId:"u"},{period:"today"},now)).rejects.toThrow("QUERY_FAILED");
  });
});
