import { afterEach, describe, expect, it, vi } from "vitest";
import { financialInterpretation, runServicesTurn, selectionSchema, validateSelection } from "@everflair/salon-secretary";
import { validateBatchPlan } from "../scheduling-batch";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { intent, plan } from "../../test/secretary-capability-plan";
import golden from "../../test/fixtures/secretary-real-outputs.json";

afterEach(() => vi.unstubAllGlobals());
const batch = () => structuredClone(golden.find(g => g.id === "gate24-0")!.payload) as {
  skills:string[]; independent:boolean; operations: Record<string, unknown>[];
};
describe("local plan identity is separate from dependency", () => {
  it.each([{}, {item_key:null}, {item_key:"a"}])("accepts a simple operation with local identity %j", identity => {
    const op = validateSelection(plan([intent("financial.report",{...identity,depends_on:[]})])).operations[0];
    expect(op.depends_on).toEqual([]);expect(op.item_key).toBe(identity.item_key);
  });
  it("keeps independent labels, fields and skills separate", () => {
    const input = plan([intent("customer.create",{item_key:"a",name:"Carla"}),intent("service.change",{item_key:"b",target_name:"massagem",priceCents:8000})]);
    const parsed = validateSelection(input);
    expect(parsed.independent).toBe(true);expect(parsed.operations.map(op=>[op.item_key,op.depends_on])).toEqual([["a",[]],["b",[]]]);
    expect(parsed.operations[0].priceCents).toBeNull();expect(parsed.operations[1].name).toBeNull();
  });
  it.each(["independent-edge","missing","self","cycle","no-edges","duplicate-key","duplicate-edge","cross-plan","slot-without-edge"])("rejects %s without rewriting intent", kind => {
    const p=batch();
    if(kind==="independent-edge")p.independent=true;
    if(kind==="missing")p.operations[1].depends_on=["unknown"];
    if(kind==="cross-plan")p.operations[1].depends_on=["another_plan_a"];
    if(kind==="self")p.operations[1].depends_on=["b"];
    if(kind==="cycle")p.operations[0].depends_on=["b"];
    if(kind==="duplicate-key")p.operations[1].item_key="a";
    if(kind==="duplicate-edge")p.operations[1].depends_on=["a","a"];
    if(kind==="slot-without-edge")p.operations[1].depends_on=[];
    if(kind==="no-edges"){p.operations[1].depends_on=[];p.operations[1].released_slot_of=null;}
    const before=structuredClone(p);expect(()=>validateSelection(p)).toThrow();expect(p).toEqual(before);
  });
  it("real dependent batch preserves explicit graph through the domain validator",()=>{
    const selected=validateSelection(batch());
    const items=selected.operations.map(op=>({key:op.item_key,operation:op.operation,depends_on:op.depends_on,
      ...(op.released_slot_of?{released_slot_of:op.released_slot_of}:{}),fields:{}}));
    expect(validateBatchPlan({execution_policy:"all_or_nothing",items}).items.map(i=>[i.key,i.depends_on])).toEqual([["a",[]],["b",["a"]]]);
    const p=batch();p.independent=true;expect(()=>validateSelection(p)).toThrow("DEPENDENCY_ERROR");
  });
});

describe("recorded real outputs replay through runtime SDK and validators", () => {
  it.each(golden)("$id ($mode)",async recorded=>{
    const network=vi.fn(()=>{throw Error("NETWORK_FORBIDDEN");});vi.stubGlobal("fetch",network);
    const fake=new ScriptedServicesModel([call(recorded.tool,recorded.payload)]);
    let result:unknown;
    switch(recorded.mode){
      case "services": result=await runServicesTurn(fake,"Recorded response",{},{});break;
      case "scheduling": result=await runServicesTurn(fake,"Recorded response",{},{},"scheduling");break;
      case "scheduling-batch": result=await runServicesTurn(fake,"Recorded response",{},{},"scheduling-batch");break;
      default: result=await runServicesTurn(fake,"Recorded response",{},{},"discovery");
        expect(result).toEqual(validateSelection(recorded.payload));
    }
    expect(result).toBeDefined();expect(fake.requests).toHaveLength(1);expect(network).not.toHaveBeenCalled();
    expect(fake.requests[0].tools?.every(t=>t.type==="function")).toBe(true);
  });
});

describe("complete wire field audit",()=>{
  const shape=selectionSchema.shape.operations.element.shape;
  it.each(Object.keys(shape))("%s accepts only its published type and documented null/omission", key=>{
    const schema=shape[key as keyof typeof shape];
    expect(schema.safeParse(true).success).toBe(key==="override_requested");
    const requiredArrays=["requested_fields","clear_fields"];
    expect(schema.safeParse(null).success).toBe(!requiredArrays.includes(key)&&key!=="operation");
    // P2a migration (backup: .demo/agenda-core/contract-migration/secretary-plan-boundary.test.before-alter-appointment.ts): the
    // alteration fields of appointment.change (flag SALON_SECRETARY_ALTER_APPOINTMENT) are optional and nullable like the other roles.
    // P2b migration (backup: .demo/agenda-core/contract-migration/secretary-plan-boundary.test.before-multi-service.ts): the service
    // list of appointment.create/availability.get (flag SALON_SECRETARY_MULTI_SERVICE) is optional and nullable too.
    const optional=["source_scope","item_key","depends_on","released_slot_of","financial","inventory","communication","customer_name","service_name","professional_name","date","day_offset","weekday","time","period","source_date","source_day_offset","source_weekday","source_time","end_time","end_date","reason","temporal_evidence","destination_mode","override_requested","override_reason","target_professional_name","service_changes","service_names"];
    expect(schema.safeParse(undefined).success).toBe(optional.includes(key));
    expect(schema.safeParse([]).success).toBe([...requiredArrays,"depends_on","temporal_evidence"].includes(key));
    const acceptsEmpty=["target_name","name","phone","email","released_slot_of","reason"];
    expect(schema.safeParse("").success).toBe(acceptsEmpty.includes(key));
  });
  it.each(["item_key","released_slot_of","depends_on"])("invalid local identity/edge type %s",field=>{
    for(const value of [false,42,{},[42]])expect(()=>validateSelection(plan([intent("financial.report",{[field]:value})]))).toThrow();
  });
  it.each(["salonId","tenant","role","customer_ref","service_ref","appointment_ref","professional_ref","sql"])("rejects invented %s",field=>{
    expect(()=>validateSelection(plan([intent("appointment.create",{[field]:"invented"})]))).toThrow();
  });
  it("unknown keys, discriminators and mandatory arrays never default",()=>{
    for(const input of [{skills:null,independent:true,operations:[]},{skills:[],independent:null,operations:[]},{skills:[],independent:true,operations:null}])expect(()=>validateSelection(input)).toThrow();
    expect(()=>validateSelection(plan([intent("financial.refund")]))).toThrow();
    expect(()=>validateSelection({skills:["admin"],independent:true,operations:[]})).toThrow();
  });
  it.each(Object.keys(financialInterpretation.shape))("Financial nested %s optionality remains explicit",key=>{
    const schema=financialInterpretation.shape[key as keyof typeof financialInterpretation.shape];
    expect(schema.safeParse(undefined).success).toBe(true);expect(schema.safeParse(null).success).toBe(true);
    for(const invalid of [[],"",true,42,{},["invented"]])expect(schema.safeParse(invalid).success).toBe(false);
  });
  it.each(["services","customers","scheduling","scheduling-batch","financial"] as const)("%s continuation rejects unknown domain refs",async mode=>{
    const fake=new ScriptedServicesModel([call("upsert_action_draft",{appointment_ref:"invented"})]);
    const run=()=>{
      switch(mode){
        case "services":return runServicesTurn(fake,"test",{},{});
        case "customers":return runServicesTurn(fake,"test",{},{},"customers");
        case "scheduling":return runServicesTurn(fake,"test",{},{},"scheduling");
        case "scheduling-batch":return runServicesTurn(fake,"test",{},{},"scheduling-batch");
        case "financial":return runServicesTurn(fake,"test",{},{},"financial");
      }
    };
    await expect(run()).rejects.toThrow();expect(fake.requests).toHaveLength(1);
  });
});


describe("temporal evidence wire and factual bounds",()=>{
  it.each([
    [{field:"date",text:""}], [{field:"date",text:"x".repeat(601)}],
    [{field:"invented",text:"amanhã"}], [{field:"date",text:"amanhã",role:"invented"}],
    Array.from({length:7},()=>({field:"date",text:"amanhã"})), ["amanhã"], {field:"date",text:"amanhã"},
  ])("rejects malformed evidence %j", evidence=>{
    expect(()=>validateSelection(plan([intent("appointment.list",{day_offset:1,temporal_evidence:evidence})]))).toThrow();
  });
  it("repeated role evidence cannot become effective temporal state",async()=>{
    const {groundSchedulingTemporal}=await import("../scheduling-temporal-source");
    const input=validateSelection(plan([intent("appointment.list",{day_offset:1,temporal_evidence:[{field:"date",text:"amanhã"},{field:"date",text:"amanhã"}]})])).operations[0];
    const result=groundSchedulingTemporal({},{day_offset:1},"amanhã","America/Sao_Paulo",new Date("2026-09-26T12:00:00Z"),undefined,input.operation,input.temporal_evidence??undefined);
    expect(result.fields.date).toBeUndefined();expect(result.rejected.map(x=>x.field)).toEqual(["date"]);
  });
});
