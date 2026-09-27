import { afterEach, beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ role: "OWNER", auditLog: { create: vi.fn() }, $queryRaw: vi.fn(),
  find: vi.fn(), upsert: vi.fn(), propose: vi.fn(), confirm: vi.fn(), drafts: new Map<string, Record<string, unknown>>() }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: object) => unknown) => fn(db) }));
vi.mock("../service-create-mvp", async original => ({ ...await original<object>(),
  upsertActionDraft: db.upsert, proposeServiceCreate: db.propose, confirmServiceCreate: db.confirm }));
vi.mock("../service-catalog", async original => ({ ...await original<object>(), findCatalogServices: db.find }));
vi.mock("../scheduling-catalog", async original => ({...await original<object>(),schedulingTimezone:async()=>"America/Sao_Paulo",listSchedulingAppointments:async()=>[]}));
vi.mock("../scheduling-mutations",async original=>({...await original<object>(),authorizeSchedulingOperation:async()=>"OWNER"}));
vi.mock("../scheduling-actions",async original=>({...await original<object>(),upsertSchedulingDraft:async(_tx:unknown,_actor:unknown,input:{fields:Record<string,unknown>;rejected_temporal?:{field:string}[]})=>({draft_ref:crypto.randomUUID(),draft_revision:1,fields:input.fields,status:input.fields.date?"READY":"NEEDS_INPUT",missing_fields:input.fields.date?[]:["date"],temporal_missing:input.rejected_temporal?.map(x=>x.field)})}));
import { SalonSecretary } from "../salon-secretary";
import { ScriptedServicesModel, call , appendScriptedResponses} from "../../test/scripted-services-model";
import { intent, plan } from "../../test/secretary-capability-plan";
import { type ActionPlan } from "@everflair/salon-secretary";
const actor = { salonId: "synthetic-salon", userId: "synthetic-owner" };
const operations = (n: number) => Array.from({ length: n }, (_, i) => intent("service.create", { item_key: `a${i}`,
  name: `Serviço ${i}`, durationMin: 30, priceCents: 5000, depends_on: [] }));
const approval = (p: ActionPlan, i = 0) => ({ plan_ref: p.plan_ref, revision: p.revision,
  group_key: p.confirmation_groups[i].key, fingerprint: p.confirmation_groups[i].fingerprint });
beforeEach(() => {
  vi.clearAllMocks(); db.drafts.clear(); db.role = "OWNER";
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); }));
  db.auditLog.create.mockResolvedValue({});
  db.$queryRaw.mockImplementation(async (query: readonly string[] | { sql?: string }) => {
    const sql = Array.isArray(query) ? query.join("") : (query as { sql?: string }).sql ?? "";
    if (sql.includes('"Membership"')) return [{ role: db.role }];
    if (sql.includes("WITH ranges")) return [{ label: "current", revenue: 12000n, count: 2n, products: 0n, product_invalid: 0n,
      received: 0n, payment_count: 0n, payment_invalid: 0n, receivable: 0n, unpaid_count: 0n, unpaid_invalid: 0n, snapshot_invalid: 0n, groups: [] }];
    return [{ accessStatus: "APPROVED", timezone: "America/Sao_Paulo", currency: "BRL" }];
  });
  db.upsert.mockImplementation(async (_tx, _actor, input) => {
    if(!Object.keys(input.patch).length)throw Error("EMPTY_PATCH");
    const draft_ref = input.draft_ref ?? crypto.randomUUID();
    const fields = { ...db.drafts.get(draft_ref), ...input.patch }; db.drafts.set(draft_ref, fields);
    const missing_fields = ["name", "priceCents", "durationMin"].filter(key => fields[key] === undefined);
    return { draft_ref, draft_revision: (input.expected_revision ?? 0) + 1, fields,
      status: missing_fields.length ? "NEEDS_INPUT" : "READY", missing_fields };
  });
  db.propose.mockImplementation(async (_tx, _actor, input) => ({ ...input, proposal_ref: crypto.randomUUID(), payload_hash: "backend-hash",
    preview: JSON.stringify(db.drafts.get(input.draft_ref)), expires_at: new Date(Date.now() + 60_000).toISOString() }));
  db.confirm.mockImplementation(async (_tx, _actor, input) => ({ receipt_ref: crypto.randomUUID(), proposal_ref: input.proposal_ref, service: { name: "Serviço", id: "domain-id" } }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
function secretary(input: unknown, enabled = true) {
  const model = new ScriptedServicesModel([call("select_capabilities", input)]), jev = vi.fn<typeof fetch>(() => { throw Error("JEV_FORBIDDEN"); });
  const s = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined,
    { enabled: () => true, paidCallsAllowed: () => false, transport: jev }, { enabled: () => enabled });
  return { s, model, jev };
}

it("review: accepted service patch remains in ActionPlan while entity choice is pending",async()=>{
  const {s}=secretary(plan([intent("service.change",{item_key:"edit",target_name:"Massagem",priceCents:10000})]));
  const session=await s.start(actor,"auto");
  db.find.mockResolvedValue([{id:"service-a",name:"Massagem relaxante",priceCents:8000,durationMin:30},{id:"service-b",name:"Massagem terapêutica",priceCents:9000,durationMin:45}]);
  const view=await s.send(actor,{sessionId:session.sessionId,message:"Altera Massagem para cem reais."});
  expect(view.action_plan!.actions[0].fields).toMatchObject({target_name:"Massagem",priceCents:10000});
});

it("review: selected service retains its effective lookup label",async()=>{
  const {s}=secretary(plan([intent("service.change",{item_key:"edit",target_name:"Massagem",priceCents:10000})]));
  const session=await s.start(actor,"auto");
  db.find.mockResolvedValue([{id:"service-a",name:"Massagem relaxante",priceCents:8000,durationMin:30},{id:"service-b",name:"Massagem terapêutica",priceCents:9000,durationMin:45}]);
  const first=await s.send(actor,{sessionId:session.sessionId,message:"Altera Massagem para cem reais."});
  const selected=await s.selectAutomatic(actor,session.sessionId,first.operations![0].operation_ref,"service-b");
  expect(selected.action_plan!.actions[0].fields.target_name).toBe("Massagem");
});

it("review: resuming an expired proposal must not render a confirmable group",async()=>{
  vi.useFakeTimers({toFake:["Date"]});
  try {
    const {s,model}=secretary(plan(operations(1))),session=await s.start(actor,"auto");
    const first=await s.send(actor,{sessionId:session.sessionId,message:"Crie um serviço de teste."});
    appendScriptedResponses(model,[call("upsert_action_draft",{name:null,priceCents:null,durationMin:null,new_request:plan([intent("service.create",{item_key:"next",name:"Outro serviço",priceCents:7000,durationMin:30})])})]);
    await s.send(actor,{sessionId:session.sessionId,message:"Agora crie outro serviço."});
    vi.setSystemTime(Date.now()+61_000);
    const resumed=await s.resumePlan(actor,session.sessionId,first.action_plan!.plan_ref);
    expect(resumed.action_plan!.confirmation_groups[0].status).not.toBe("READY_FOR_CONFIRMATION");
  } finally {vi.useRealTimers();}
});

it("review: deferred scheduling read retains grounded date and executes without replaying old evidence against empty source",async()=>{
  const read=intent("appointment.list",{item_key:"read",depends_on:["a0"],day_offset:1,temporal_evidence:[{field:"date",text:"amanhã"}]});
  const {s}=secretary({...plan([...operations(1),read]),independent:false}),session=await s.start(actor,"auto");
  const first=await s.send(actor,{sessionId:session.sessionId,message:"Cadastre o serviço e depois mostre a agenda de amanhã."});
  const done=await s.confirmActionPlanGroup(actor,session.sessionId,approval(first.action_plan!));
  expect(done.action_plan!.actions.map(x=>x.status)).toEqual(["DONE","DONE"]);
});


it("view expires a proposal in place and continuation prepares a new revision of the same draft",async()=>{
  vi.useFakeTimers({toFake:["Date"]});
  try{
    const {s,model}=secretary(plan(operations(1))),session=await s.start(actor,"auto");
    const before=await s.send(actor,{sessionId:session.sessionId,message:"Prepare o cadastro."});
    vi.setSystemTime(Date.now()+61_000);
    const internal=s as unknown as {sessions:Map<string,unknown>;view:(session:unknown)=>typeof before};
    const expired=internal.view(internal.sessions.get(session.sessionId));
    expect(expired.operations![0].state.proposal).toBeUndefined();
    expect(expired.operations![0].state.proposal_expired).toBe(true);
    expect(expired.action_plan!.confirmation_groups[0].status).not.toBe("READY_FOR_CONFIRMATION");
    expect(expired.action_plan!.actions[0].fields).toEqual(before.action_plan!.actions[0].fields);
    await expect(s.confirmActionPlanGroup(actor,session.sessionId,approval(before.action_plan!))).rejects.toThrow("CONFIRMATION_STALE");
    appendScriptedResponses(model,[call("upsert_action_draft",{name:null,priceCents:null,durationMin:null})]);
    const refreshed=await s.send(actor,{sessionId:session.sessionId,message:"Pode preparar de novo."});
    expect(refreshed.operations![0].state.proposal_expired).not.toBe(true);
    expect(refreshed.operations![0].state.draft!.draft_ref).toBe(before.operations![0].state.draft!.draft_ref);
    expect(refreshed.operations![0].state.proposal!.proposal_ref).not.toBe(before.operations![0].state.proposal!.proposal_ref);
    expect(refreshed.action_plan!.confirmation_groups[0].status).toBe("READY_FOR_CONFIRMATION");
    expect(db.confirm).not.toHaveBeenCalled();
  }finally{vi.useRealTimers();}
});
it("expiry cannot hide an already committed receipt or break idempotent confirmation replay",async()=>{
  vi.useFakeTimers({toFake:["Date"]});
  try{
    const {s}=secretary(plan(operations(1))),session=await s.start(actor,"auto");
    const first=await s.send(actor,{sessionId:session.sessionId,message:"Prepare."}),input=approval(first.action_plan!);
    const done=await s.confirmActionPlanGroup(actor,session.sessionId,input);
    vi.setSystemTime(Date.now()+61_000);
    const replay=await s.confirmActionPlanGroup(actor,session.sessionId,input);
    expect(replay.action_plan!.status).toBe("DONE");expect(replay.operations![0].state.receipt).toEqual(done.operations![0].state.receipt);
    expect(replay.operations![0].state.proposal_expired).not.toBe(true);expect(db.confirm).toHaveBeenCalledTimes(1);
  }finally{vi.useRealTimers();}
});

it("a valid service price survives while its lookup name is still missing",async()=>{
  const {s,model}=secretary(plan([intent("service.change",{item_key:"edit",priceCents:10000})])),session=await s.start(actor,"auto");
  const pending=await s.send(actor,{sessionId:session.sessionId,message:"Quero mudar um preço para cem reais."});
  expect(pending.action_plan!.actions[0].fields.priceCents).toBe(10000);
  appendScriptedResponses(model,[call("upsert_action_draft",{operation:"service.change",target_name:"Massagem",name:null,priceCents:null,durationMin:null})]);
  db.find.mockResolvedValue([{id:"service-a",name:"Massagem",priceCents:8000,durationMin:30}]);
  const next=await s.send(actor,{sessionId:session.sessionId,message:"É da Massagem."});
  expect(next.action_plan!.actions[0].fields).toMatchObject({target_name:"Massagem",priceCents:10000});
  expect(db.upsert.mock.calls.at(-1)![2].patch.priceCents).toBe(10000);
});
it.each(["customer","inventory","scheduling","batch","communication"] as const)("expired %s proposals disappear from every public domain view",facet=>{
  const {s}=secretary(plan(operations(1)));
  const carrier={operation:facet==="batch"?"action.batch":"test",fields:{},message:"Use Confirmar.",proposal:{proposal_ref:"old",expires_at:new Date(Date.now()-1).toISOString()}};
  const internal=s as unknown as {view:(session:unknown)=>{proposal_expired?:boolean;message:string}&Record<string,unknown>};
  const state=internal.view({id:"synthetic",actor,cancelled:false,skill:facet==="batch"?"scheduling":facet,[facet]:carrier});
  expect(state.proposal_expired).toBe(true);expect((state[facet] as {proposal?:unknown}).proposal).toBeUndefined();
  expect(state.message).toContain("expirou");
});

it("deferred scheduling and financial periods stay anchored to the accepted turn across local midnight",async()=>{
  vi.useFakeTimers({toFake:["Date"]});
  vi.setSystemTime(new Date("2026-09-26T02:59:45Z"));
  try{
    const list=intent("appointment.list",{item_key:"agenda",depends_on:["a0"],day_offset:1,temporal_evidence:[{field:"date",text:"amanhã"}]});
    const finance=intent("financial.report",{item_key:"money",depends_on:["a0"],financial:{metrics:["service_revenue"],period:"yesterday"}});
    const {s}=secretary({...plan([...operations(1),list,finance]),independent:false}),session=await s.start(actor,"auto");
    const before=await s.send(actor,{sessionId:session.sessionId,message:"Cadastre o serviço e depois mostre a agenda de amanhã e o faturamento de ontem."});
    expect(before.action_plan!.actions[1].fields).toMatchObject({date:"2026-09-26"});
    expect(before.action_plan!.actions[1].fields).not.toHaveProperty("day_offset");
    expect(before.action_plan!.actions[1].fields).not.toHaveProperty("temporal_evidence");
    expect(db.$queryRaw.mock.calls.filter(([query])=>String(query.sql??query).includes("WITH ranges"))).toHaveLength(0);
    vi.setSystemTime(Date.now()+30_000);
    const done=await s.confirmActionPlanGroup(actor,session.sessionId,approval(before.action_plan!));
    expect(done.action_plan!.actions.map(a=>a.status)).toEqual(["DONE","DONE","DONE"]);
    expect(done.operations![1].state.scheduling!.fields.date).toBe("2026-09-26");
    expect(done.operations![2].state.financial!.result!.resolved_period!.from_date).toBe("2026-09-24");
    expect(done.operations![2].state.financial!.result!.as_of).toBe("2026-09-26T03:00:15.000Z");
  }finally{vi.useRealTimers();}
});
it("a rejected temporal value in a deferred read never enters the plan as accepted baseline",async()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
  try{
    const read=intent("appointment.list",{item_key:"agenda",depends_on:["a0"],date:"2026-09-26",temporal_evidence:[{field:"date",text:"domingo"}]});
    const {s,model}=secretary({...plan([...operations(1),read]),independent:false}),session=await s.start(actor,"auto");
    const before=await s.send(actor,{sessionId:session.sessionId,message:"Cadastre o serviço e depois mostre a agenda de domingo."});
    expect(before.action_plan!.actions[1].missing_fields).toContain("date");
    expect((before.action_plan!.actions[1].fields as Record<string,unknown>).date).toBeUndefined();
    await expect(s.confirmActionPlanGroup(actor,session.sessionId,approval(before.action_plan!))).rejects.toThrow("PLAN_NOT_READY");
    appendScriptedResponses(model,[call("upsert_action_draft",{operation:"appointment.list",date:"2026-09-27",temporal_evidence:[{field:"date",text:"Domingo, dia 27 de setembro"}]})]);
    const after=await s.send(actor,{sessionId:session.sessionId,message:"Domingo, dia 27 de setembro."});
    expect(after.action_plan!.actions[1].fields).toMatchObject({date:"2026-09-27"});expect(after.action_plan!.actions[1].missing_fields).toEqual([]);
    expect(db.confirm).not.toHaveBeenCalled();
  }finally{vi.useRealTimers();}
});

it("a first late confirmation fails the whole group before any domain executor",async()=>{
  vi.useFakeTimers({toFake:["Date"]});
  try{
    const {s,model}=secretary(plan(operations(2))),session=await s.start(actor,"auto");
    const before=await s.send(actor,{sessionId:session.sessionId,message:"Prepare dois serviços."});
    vi.setSystemTime(Date.now()+61_000);
    const failed=await s.confirmActionPlanGroup(actor,session.sessionId,approval(before.action_plan!));
    expect(failed.action_plan!.actions.map(action=>action.status)).toEqual(["FAILED_SAFE","FAILED_SAFE"]);
    expect(failed.action_plan!.confirmation_groups[0].status).not.toBe("READY_FOR_CONFIRMATION");
    expect(failed.operations!.every(item=>!item.state.proposal&&!item.state.receipt)).toBe(true);
    expect(db.confirm).not.toHaveBeenCalled();
    await expect(s.confirmActionPlanGroup(actor,session.sessionId,{...approval(before.action_plan!),fingerprint:"0".repeat(64)})).rejects.toThrow("CONFIRMATION_STALE");
    expect(db.confirm).not.toHaveBeenCalled();
    void model;
  }finally{vi.useRealTimers();}
});
