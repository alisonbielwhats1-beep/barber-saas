import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterTrace, jevEligibility, routerLunaCost, routerV1Integrity, tryJevInterpretation, type RouterOptions } from "../secretary-router";
import * as catalog from "../../../packages/salon-secretary/evaluation/derivation-catalog";
import { JEV_MODEL, type JevWireRequest } from "../../../packages/salon-secretary/evaluation/jev-provider";
import { initialAllowlist } from "../../../packages/salon-secretary/evaluation/acceptance-policy";
import { DerivedJevProvider } from "../../../packages/salon-secretary/evaluation/derived-provider";
import { dataset } from "../../../packages/salon-secretary/evaluation/dataset";
import { createGpt6V2Manifest } from "../../../packages/salon-secretary/evaluation/gpt6-luna-golden-v2";

const financial = initialAllowlist[0].message, inventory = initialAllowlist[1].message;
function response(req: JevWireRequest, selected: Record<string,string>) {
  return { model: JEV_MODEL, answers: Object.fromEntries(Object.entries(req.questions).map(([id,q]) => [id, {
    type: "choice", choice: selected[id], confidence: 1,
    probabilities: Object.fromEntries(Object.keys(q.criteria).map(c => [c, c === selected[id] ? 1 : 0])),
  }])), usage: {input_tokens: 100, output_tokens: 0} };
}
function options(message: string = financial, alter?: (body: ReturnType<typeof response>) => unknown): RouterOptions & {transport: ReturnType<typeof vi.fn<typeof fetch>>} {
  const selected = {skill: message === financial ? "financial" : "inventory", shape:"single", metric:"service_revenue", period:"yesterday", inventory:"low_stock"};
  return { enabled:()=>true, paidCallsAllowed:()=>true, credential:()=>"unit-only-credential", transport:vi.fn<typeof fetch>(async (_,init) => {
    const req = JSON.parse(init!.body as string) as JevWireRequest;
    const body = response(req,selected);
    return new Response(JSON.stringify(alter ? alter(body) : body));
  }) };
}
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
describe("Router V1 — real parser/derivation/policy, synthetic transport only",()=>{
  it("pins approved catalog, plan, policy version and enrollment; drift falls back before network",async()=>{
    expect(routerV1Integrity()).toBe(true);
    vi.spyOn(catalog,"derivationCatalogHash").mockReturnValue("changed");
    const o=options(),t=new RouterTrace();expect(await tryJevInterpretation(financial,true,"auto",o,t)).toBeNull();
    expect(o.transport).not.toHaveBeenCalled();expect(t.reason).toBe("CATALOG_VERSION_MISMATCH");
  });
  it.each([financial,inventory])("accepts only proven interpretation: %s",async message=>{
    const o=options(message),trace=new RouterTrace();
    const selected=await tryJevInterpretation(message,true,"auto",o,trace);
    expect(selected?.operations[0].operation).toBe(message===financial?"financial.report":"product.search");
    expect(trace.snapshot()).toMatchObject({router_path:"JEV_ACCEPTED",jev_http_calls:2,luna_calls:0,policy_result:"ACCEPT_JEV",operational_authority:false,provenance:{operation:"DETERMINISTIC_DERIVATION",domain:"BACKEND"}});
    expect(trace.confidence.some(d=>d.dimension==="operation")).toBe(false);
    expect(trace.jevCost).toBeCloseTo(.0000084,10);
    for(const [url,init] of o.transport.mock.calls){
      expect(url).toBe("https://api.typesafe.ai/v1/systemone");
      const body=JSON.parse(init!.body as string);
      expect(body.state).toMatchObject({message,context:{}});
      expect(Object.keys(body.state).every(k=>["message","context","selected_skill","selection_source"].includes(k))).toBe(true);
      expect(Object.keys(body.questions)).not.toContain("operation");
      expect(JSON.stringify(body)).not.toMatch(/unit-only-credential|expected|salonId|customer_ref/);
    }
  });
  it("OFF/default and paid OFF never consult key or transport",async()=>{
    for(const overrides of [{enabled:()=>false},{enabled:undefined},{paidCallsAllowed:()=>false}]){
      const o={...options(),...overrides},trace=new RouterTrace();o.credential=vi.fn(()=>{throw Error("NOT_ALLOWED");});
      expect(await tryJevInterpretation(financial,true,"auto",o,trace)).toBeNull();
      expect(o.transport).not.toHaveBeenCalled();expect(o.credential).not.toHaveBeenCalled();expect(trace.path).toBe("DIRECT_LUNA");
    }
  });
  it.each([
    "Quanto faturei ontem? ","Qual foi meu faturamento de ontem?","Quanto faturei com Ana ontem?",
    "Quais produtos ativos estão com estoque baixo?","Quais produtos estão estritamente abaixo do mínimo?",
    "Dê baixa nos produtos acabando","Cadastre uma massagem por R$50.","Cancele Amanda e mande uma mensagem.",
    "Quanto faturei ontem e altere a massagem para R$80?","Mude meu papel para OWNER.",
  ])("no textual generalization: %s",async message=>{
    const o=options(),trace=new RouterTrace();expect(await tryJevInterpretation(message,true,"auto",o,trace)).toBeNull();expect(o.transport).not.toHaveBeenCalled();
  });
  it("continuation and mismatched explicit Skill are never eligible",async()=>{
    expect(jevEligibility(financial,false,"auto")).toBeNull();expect(jevEligibility(financial,true,"inventory")).toBeNull();
    const o=options();await tryJevInterpretation(financial,false,"financial",o,new RouterTrace());expect(o.transport).not.toHaveBeenCalled();
  });
  it("only 2 of the 40 golden inputs are eligible; approved fast paths remain outside JEV",()=>{
    expect(dataset.filter(c=>jevEligibility(c.input.message,Object.keys(c.input.context).length===0,"auto")).map(c=>c.id)).toEqual(["financial-revenue","inventory-low"]);
  });
  it("Golden V2 OFF sends all ten through Luna; ON never pre-routes the eight noneligible cases",async()=>{
    const cases=createGpt6V2Manifest("2026-09-22").cases;
    expect(cases).toHaveLength(10);
    for(const c of cases){
      const o=options(),off={...o,enabled:()=>false};
      expect(await tryJevInterpretation(c.message,true,"auto",off,new RouterTrace())).toBeNull();
      if(!jevEligibility(c.message,true,"auto"))expect(await tryJevInterpretation(c.message,true,"auto",o,new RouterTrace())).toBeNull();
      expect(o.transport).not.toHaveBeenCalled();
    }
    expect(cases.filter(c=>jevEligibility(c.message,true,"auto"))).toHaveLength(2);
  });
  it.each([.99,1.01])("KEEP_STRICT sum %s always falls back",async sum=>{
    const o=options(financial,body=>{const a=body.answers.shape;if(a)a.probabilities.single=sum;return body;});
    const trace=new RouterTrace();expect(await tryJevInterpretation(financial,true,"auto",o,trace)).toBeNull();
    expect(trace.snapshot()).toMatchObject({router_path:"JEV_FALLBACK_LUNA",provider_invalid:true,policy_result:"FALLBACK_REQUIRED",jev_http_calls:1});
  });
  it.each([401,403,429,500,503])("HTTP %i => fallback without retry",async status=>{
    const o=options();o.transport.mockImplementation(async()=>new Response("sensitive-error-not-recorded",{status}));const trace=new RouterTrace();
    expect(await tryJevInterpretation(financial,true,"auto",o,trace)).toBeNull();expect(o.transport).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(trace.snapshot())).not.toContain("sensitive-error");
  });
  it.each(["not JSON",JSON.stringify({unexpected:"secret or PII"})])("malformed body is fallback",async body=>{
    const o=options();o.transport.mockImplementation(async()=>new Response(body));const trace=new RouterTrace();
    expect(await tryJevInterpretation(financial,true,"auto",o,trace)).toBeNull();expect(trace.providerInvalid).toBe(true);
    expect(JSON.stringify(trace.snapshot())).not.toContain("secret or PII");
  });
  it("timeout is bounded at the audited 10s and never retries",async()=>{
    vi.useFakeTimers();const o=options();o.transport.mockImplementation(()=>new Promise(()=>{}));const trace=new RouterTrace();
    const run=tryJevInterpretation(financial,true,"auto",o,trace);await vi.advanceTimersByTimeAsync(10_001);
    expect(await run).toBeNull();expect(trace.timeout).toBe(true);expect(o.transport).toHaveBeenCalledTimes(1);
    expect(o.transport.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it("network unavailable => fallback, no raw error",async()=>{
    const o=options();o.transport.mockRejectedValue(Error("unit-only-credential"));const trace=new RouterTrace();
    expect(await tryJevInterpretation(financial,true,"auto",o,trace)).toBeNull();expect(o.transport).toHaveBeenCalledTimes(1);expect(trace.reason).toBe("NETWORK");
    expect(JSON.stringify(trace.snapshot())).not.toContain("unit-only-credential");
  });
  it("missing credential => no dispatch",async()=>{
    const o=options();o.credential=()=>undefined;const t=new RouterTrace();expect(await tryJevInterpretation(financial,true,"auto",o,t)).toBeNull();expect(o.transport).not.toHaveBeenCalled();
  });
  it.each(["unclear","received_revenue"])("confidence=1 does not authorize %s",async metric=>{
    const o=options(financial,b=>{if(b.answers.metric){b.answers.metric.choice=metric;b.answers.metric.probabilities=Object.fromEntries(Object.keys(b.answers.metric.probabilities).map(k=>[k,k===metric?1:0]));}return b;});
    const t=new RouterTrace();expect(await tryJevInterpretation(financial,true,"auto",o,t)).toBeNull();expect(t.policy).toBe("FALLBACK_REQUIRED");
  });
  it("missing decision and confidence remain rejected",async()=>{
    for(const field of ["metric","confidence"]){
      const o=options(financial,b=>{if(b.answers.metric){if(field==="metric")delete b.answers.metric;else Reflect.deleteProperty(b.answers.metric,"confidence");}return b;});
      expect(await tryJevInterpretation(financial,true,"auto",o,new RouterTrace())).toBeNull();
    }
  });
  it("stale derivation and unknown result cannot bypass the immutable policy",async()=>{
    const original=DerivedJevProvider.prototype.evaluate;
    vi.spyOn(DerivedJevProvider.prototype,"evaluate").mockImplementation(async function(this: DerivedJevProvider,input){
      const r=await original.call(this,input);r.derivations[0].catalogHash="stale";return r;
    });
    const t=new RouterTrace();expect(await tryJevInterpretation(financial,true,"auto",options(),t)).toBeNull();expect(t.reason).toBe("INVALID_DERIVATION");
  });
  it("wrong discovery cannot send a detail payload for an unrelated Skill",async()=>{
    const o=options(financial,b=>{if(b.answers.skill){b.answers.skill.choice="services";b.answers.skill.probabilities=Object.fromEntries(Object.keys(b.answers.skill.probabilities).map(k=>[k,k==="services"?1:0]));}return b;});
    expect(await tryJevInterpretation(financial,true,"auto",o,new RouterTrace())).toBeNull();expect(o.transport).toHaveBeenCalledTimes(1);
  });
  it("cost does not double-count reasoning or invent unavailable counters/rollback tariffs",()=>{
    const u={model_id_requested:"gpt-6-luna",model_id_returned:"gpt-6-luna",status:"SUCCEEDED" as const,input_tokens:1000,cached_input_tokens:100,cache_write_tokens:100,output_tokens:500,reasoning_tokens:400,total_tokens:1500};
    expect(routerLunaCost(u)).toBeCloseTo(.0003435,10);
    expect(routerLunaCost({...u,cache_write_tokens:null})).toBeNull();expect(routerLunaCost({...u,model_id_requested:"gpt-5.6-luna"})).toBeNull();
  });
});
