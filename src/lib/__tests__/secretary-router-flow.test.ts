import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Duplicate-service guard (owner, 04/10/2026; its own tests: secretary-existing-service.test.ts): these scenarios have no service
// catalog, so the guard passes the interpretation through and the flow is exactly the one this file covered before.
vi.mock("../secretary-existing-service", async original => ({ ...await original<object>(), withExistingServiceTargets: async (_actor: unknown, selection: unknown) => selection,
  existingServiceInterpretation: async (_actor: unknown, interpretation: unknown) => interpretation }));
const db = vi.hoisted(()=>({role:"OWNER",$queryRaw:vi.fn(),auditLog:{create:vi.fn()},product:{findMany:vi.fn(),fields:{minStock:"minStock"}},upsert:vi.fn(),propose:vi.fn()}));
vi.mock("../prisma-tenant",()=>({withTenant:(_actor:unknown,fn:(tx:object)=>unknown)=>fn(db)}));
vi.mock("../service-create-mvp",async original=>({...await original<object>(),upsertActionDraft:db.upsert,proposeServiceCreate:db.propose}));
import { SalonSecretary } from "../salon-secretary";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { intent, plan } from "../../test/secretary-capability-plan";
import { JEV_MODEL, type JevWireRequest } from "../../../packages/salon-secretary/evaluation/jev-provider";
import type { RouterOptions } from "../secretary-router";
const actor={salonId:"synthetic-salon",userId:"synthetic-owner"};
const financial="Quanto faturei ontem?",inventory="Quais produtos estão com estoque baixo?";
const financialPlan=plan([intent("financial.report",{financial:{metrics:["service_revenue"],period:"yesterday"}})]);
function transport(skill="financial") {
  return vi.fn<typeof fetch>(async(_,init)=>{
    const req=JSON.parse(init!.body as string) as JevWireRequest;
    const selected:Record<string,string>={skill,shape:"single",metric:"service_revenue",period:"yesterday",inventory:"low_stock"};
    return new Response(JSON.stringify({model:JEV_MODEL,answers:Object.fromEntries(Object.entries(req.questions).map(([id,q])=>[id,{type:"choice",choice:selected[id],confidence:.8,probabilities:Object.fromEntries(Object.keys(q.criteria).map(c=>[c,c===selected[id]?1:0]))}])),usage:{input_tokens:100,output_tokens:0}}));
  });
}
const options=(t:typeof fetch):RouterOptions=>({enabled:()=>true,paidCallsAllowed:()=>true,credential:()=>"local-mock-key",transport:t});
const events=()=>db.auditLog.create.mock.calls.map(c=>c[0].data).filter(d=>d.entityType==="SECRETARY_ROUTER");
beforeEach(()=>{
  vi.clearAllMocks();db.role="OWNER";
  vi.stubGlobal("fetch",vi.fn(()=>{throw Error("REAL_NETWORK_FORBIDDEN");}));
  db.auditLog.create.mockResolvedValue({});
  db.$queryRaw.mockImplementation(async(query:readonly string[]|{sql?:string})=>{
    const sql=Array.isArray(query)?query.join(""):(query as {sql?:string}).sql??"";
    if(sql.includes('"Membership"'))return [{role:db.role}];
    if(sql.includes("WITH ranges"))return [{label:"current",revenue:12000n,count:2n,products:0n,product_invalid:0n,received:0n,payment_count:0n,payment_invalid:0n,receivable:0n,unpaid_count:0n,unpaid_invalid:0n,snapshot_invalid:0n,groups:[]}];
    return [{accessStatus:"APPROVED",timezone:"America/Sao_Paulo",currency:"BRL"}];
  });
  db.product.findMany.mockResolvedValue([{id:"backend-only-ref",name:"Synthetic product",stock:2,minStock:2,active:false,updatedAt:new Date("2026-09-22T00:00:00Z")}]);
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe("Router -> existing Secretary -> backend, SQL and providers mocked",()=>{
  it.each(["auto","financial"] as const)("JEV accepted in %s retains T09 authority and avoids model factory",async scope=>{
    const t=transport(),factory=vi.fn(()=>{throw Error("LUNA_NOT_EXPECTED");});const s=new SalonSecretary(factory,()=>"gpt-6-luna",undefined,options(t));
    const session=await s.start(actor,scope);const result=await s.send(actor,{sessionId:session.sessionId,message:financial});
    const view=scope==="auto"?result.operations![0].state:result;
    expect(view.financial).toMatchObject({status:"DONE",result:{metrics:[{id:"service_revenue",value:12000}]}});
    expect(factory).not.toHaveBeenCalled();expect(t).toHaveBeenCalledTimes(2);expect(events()[0].metadata).toMatchObject({router_path:"JEV_ACCEPTED",luna_called:false,policy_result:"ACCEPT_JEV"});
    expect(global.fetch).not.toHaveBeenCalled();expect(db.upsert).not.toHaveBeenCalled();
  });
  it.each(["auto","inventory"] as const)("low_stock %s uses canonical <= and includes inactive, only backend refs",async scope=>{
    const t=transport("inventory"),factory=vi.fn(()=>{throw Error("LUNA_NOT_EXPECTED");});const s=new SalonSecretary(factory,()=>"gpt-6-luna",undefined,options(t));
    const session=await s.start(actor,scope);const result=await s.send(actor,{sessionId:session.sessionId,message:inventory});
    const view=scope==="auto"?result.operations![0].state:result;
    expect(view.inventory).toMatchObject({status:"DONE",operation:"product.search",products:[{id:"backend-only-ref",stock:2,active:false}]});
    expect(db.product.findMany.mock.calls[0][0].where).toEqual({salonId:actor.salonId,stock:{lte:"minStock"}});
    expect(JSON.stringify(t.mock.calls)).not.toContain("backend-only-ref");expect(factory).not.toHaveBeenCalled();
  });
  it("OFF restores existing SDK discovery, one function, unchanged result",async()=>{
    const t=transport();const model=new ScriptedServicesModel([call("select_capabilities",financialPlan)]);
    const s=new SalonSecretary(async()=>model,()=>"gpt-6-luna",undefined,{...options(t),enabled:()=>false});
    const session=await s.start(actor,"auto");const result=await s.send(actor,{sessionId:session.sessionId,message:financial});
    expect(result.operations![0].state.financial?.result?.metrics[0].value).toBe(12000);
    expect(model.requests).toHaveLength(1);expect(t).not.toHaveBeenCalled();expect(events()[0].metadata.router_path).toBe("DIRECT_LUNA");
    expect(model.requests[0].tools.map(t=>t.name)).toEqual(["select_capabilities"]);
  });
  it.each(["500","invalid","unavailable"])("%s does not take down Secretary: exactly one Luna fallback",async failure=>{
    const t=transport();t.mockImplementation(async()=>{if(failure==="unavailable")throw Error("private-error");return new Response(failure==="500"?"":"invalid",{status:failure==="500"?500:200});});
    const model=new ScriptedServicesModel([call("select_capabilities",financialPlan)],{input_tokens:200,output_tokens:50,total_tokens:250});
    const s=new SalonSecretary(async()=>model,()=>"gpt-6-luna",undefined,options(t));const session=await s.start(actor,"auto");
    const result=await s.send(actor,{sessionId:session.sessionId,message:financial});expect(result.operations![0].state.financial?.status).toBe("DONE");
    expect(t).toHaveBeenCalledTimes(1);expect(model.requests).toHaveLength(1);
    expect(events()[0].metadata).toMatchObject({router_path:"JEV_FALLBACK_LUNA",jev_http_calls:1,luna_calls:1,policy_result:"FALLBACK_REQUIRED",usage_luna:[{input_tokens:200,output_tokens:50}]});
    expect(JSON.stringify(events())).not.toContain("private-error");expect(JSON.stringify(events())).not.toContain(financial);
  });
  it("fast-path in an automatic child precedes both AIs and emits one trace",async()=>{
    const t=transport();const model=new ScriptedServicesModel([call("select_capabilities",plan([intent("service.create",{name:"massagem",priceCents:5000})]))]);
    const ref=crypto.randomUUID();
    db.upsert.mockResolvedValueOnce({draft_ref:ref,draft_revision:1,fields:{name:"Massagem",priceCents:5000},status:"NEEDS_INPUT",missing_fields:["durationMin"]})
      .mockResolvedValueOnce({draft_ref:ref,draft_revision:2,fields:{name:"Massagem",priceCents:5000,durationMin:45},status:"READY",missing_fields:[]});
    db.propose.mockResolvedValue({preview:"Synthetic proposal only"});
    const s=new SalonSecretary(async()=>model,()=>"gpt-6-luna",undefined,options(t));const session=await s.start(actor,"auto");
    await s.send(actor,{sessionId:session.sessionId,message:"Cadastre uma massagem por R$50."});
    await s.send(actor,{sessionId:session.sessionId,message:"45 minutos"});
    expect(model.requests).toHaveLength(1);expect(t).not.toHaveBeenCalled();expect(events()).toHaveLength(2);
    expect(events()[1].metadata).toMatchObject({router_path:"FAST_PATH",luna_calls:0,jev_http_calls:0,estimated_cost_usd:{jev:0,openai:0,total:0}});
    expect(db.upsert.mock.calls[1][2].patch).toEqual({durationMin:45});
  });
  it("accepted interpretation never grants authorization; revoked role fails before T09",async()=>{
    const t=transport();const real=t.getMockImplementation()!;t.mockImplementation(async(...args)=>{const r=await real(...args);db.role="RECEPTIONIST";return r;});
    const factory=vi.fn(()=>{throw Error("LUNA_NOT_EXPECTED");});const s=new SalonSecretary(factory,()=>"gpt-6-luna",undefined,options(t));const session=await s.start(actor,"auto");
    await expect(s.send(actor,{sessionId:session.sessionId,message:financial})).rejects.toThrow("FORBIDDEN");
    expect(factory).not.toHaveBeenCalled();expect(db.product.findMany).not.toHaveBeenCalled();
    expect(db.$queryRaw.mock.calls.some(c=>String(c[0]?.sql).includes("WITH ranges"))).toBe(false);
  });
  it("cross-tenant and cross-user cannot invoke router for a foreign session",async()=>{
    const t=transport(),factory=vi.fn(()=>{throw Error("NO_MODEL");});const s=new SalonSecretary(factory,()=>"gpt-6-luna",undefined,options(t));const session=await s.start(actor,"auto");
    for(const other of [{...actor,salonId:"foreign"},{...actor,userId:"foreign"}])await expect(s.send(other,{sessionId:session.sessionId,message:financial})).rejects.toThrow("SESSION_NOT_FOUND");
    expect(t).not.toHaveBeenCalled();expect(factory).not.toHaveBeenCalled();expect(events()).toHaveLength(0);
  });
  it("an automatic child with prior interpretation is context, even before its first continuation",async()=>{
    const t=transport();const model=new ScriptedServicesModel([
      call("select_capabilities",plan([intent("financial.report",{financial:{metrics:["service_revenue"]}})])),
      call("upsert_action_draft",{metrics:["service_revenue"],period:"yesterday",compare_period:null,group_by:null}),
    ]);
    const s=new SalonSecretary(async()=>model,()=>"gpt-6-luna",undefined,options(t));const session=await s.start(actor,"auto");
    const first=await s.send(actor,{sessionId:session.sessionId,message:"Quanto faturei?"});expect(first.operations![0].state.financial?.status).toBe("NEEDS_INPUT");
    await s.send(actor,{sessionId:session.sessionId,message:financial});
    expect(t).not.toHaveBeenCalled();expect(model.requests).toHaveLength(2);expect(events()).toHaveLength(2);
    expect(events()[1].metadata).toMatchObject({router_path:"DIRECT_LUNA",jev_eligible:false});
  });
  it("a concurrent send cannot launch another provider request",async()=>{
    const t=transport(),real=t.getMockImplementation()!;
    let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
    let entered!:()=>void;const dispatched=new Promise<void>(resolve=>{entered=resolve;});
    t.mockImplementation(async(...args)=>{entered();await pending;return real(...args);});
    const s=new SalonSecretary(async()=>{throw Error("NO_MODEL");},()=>"gpt-6-luna",undefined,options(t));const session=await s.start(actor,"auto");
    const first=s.send(actor,{sessionId:session.sessionId,message:financial});await dispatched;
    await expect(s.send(actor,{sessionId:session.sessionId,message:financial})).rejects.toThrow("SESSION_BUSY");
    expect(t).toHaveBeenCalledTimes(1);release();await first;expect(t).toHaveBeenCalledTimes(2);
  });
  it("expired session after JEV cannot reach domain resolution",async()=>{
    let now=Date.now();vi.spyOn(Date,"now").mockImplementation(()=>now);const t=transport();const real=t.getMockImplementation()!;
    t.mockImplementation(async(...args)=>{const r=await real(...args);now+=21*60_000;return r;});
    const s=new SalonSecretary(async()=>{throw Error("NO_MODEL");},()=>"gpt-6-luna",undefined,options(t));const session=await s.start(actor,"auto");
    await expect(s.send(actor,{sessionId:session.sessionId,message:financial})).rejects.toThrow("SESSION_NOT_FOUND");expect(db.product.findMany).not.toHaveBeenCalled();
  });
});
