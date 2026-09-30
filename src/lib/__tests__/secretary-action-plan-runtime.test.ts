import { afterEach, beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ role: "OWNER", auditLog: { create: vi.fn() }, $queryRaw: vi.fn(),
  upsert: vi.fn(), propose: vi.fn(), confirm: vi.fn(), drafts: new Map<string, Record<string, unknown>>() }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: object) => unknown) => fn(db) }));
vi.mock("../service-create-mvp", async original => ({ ...await original<object>(),
  upsertActionDraft: db.upsert, proposeServiceCreate: db.propose, confirmServiceCreate: db.confirm }));
import { SalonSecretary, unreadAnswerNotice } from "../salon-secretary";
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
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function secretary(input: unknown, enabled = true) {
  const model = new ScriptedServicesModel([call("select_capabilities", input)]), jev = vi.fn<typeof fetch>(() => { throw Error("JEV_FORBIDDEN"); });
  const s = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined,
    { enabled: () => true, paidCallsAllowed: () => false, transport: jev }, { enabled: () => enabled });
  return { s, model, jev };
}
it("understood unsupported requests do not create an action or a draft", async () => {
  const {s,model}=secretary({skills:[],independent:true,operations:[],disposition:"UNSUPPORTED",unavailable_capability:"professional_management"});
  const session=await s.start(actor,"auto");
  const reply=await s.send(actor,{sessionId:session.sessionId,message:"Quero incluir uma cabeleireira na equipe."});
  expect(reply.capability_status).toBe("UNSUPPORTED"); expect(reply.message).toContain("profissionais");
  expect(reply.action_plan).toBeUndefined(); expect(reply.operations).toBeUndefined();
  expect(db.upsert).not.toHaveBeenCalled(); expect(db.confirm).not.toHaveBeenCalled(); expect(model.requests).toHaveLength(1);
});
it.each([1, 2, 3, 4, 5, 7, 10, 11, 12, 14])("runtime prepares %i and bypasses no confirmation or session quota", async n => {
  const { s, model, jev } = secretary(plan(operations(n))), session = await s.start(actor, "auto");
  const result = await s.send(actor, { sessionId: session.sessionId, message: "Cadastre os serviços pedidos." });
  expect(result.action_plan?.actions).toHaveLength(n); expect(result.operations).toHaveLength(n);
  expect(result.action_plan?.status).toBe("READY_FOR_CONFIRMATION");
  expect(db.confirm).not.toHaveBeenCalled(); expect(model.requests).toHaveLength(1); expect(jev).not.toHaveBeenCalled();
  const first = result.operations![0];
  await expect(s.confirm(actor, first.operation_ref, first.state.proposal && {
    proposal_ref: first.state.proposal.proposal_ref, draft_revision: first.state.proposal.draft_revision })).rejects.toThrow("CONFIRMATION_GROUP_REQUIRED");
  await expect(s.confirmAutomatic(actor, session.sessionId, first.operation_ref, {})).rejects.toThrow("CONFIRMATION_GROUP_REQUIRED");
  const p = result.action_plan!;
  for (let i = 0; i < p.confirmation_groups.length; i++) await s.confirmActionPlanGroup(actor, session.sessionId, approval(p, i));
  expect(db.confirm).toHaveBeenCalledTimes(n);
  await s.confirmActionPlanGroup(actor, session.sessionId, approval(p)); // group replay has zero second effects
  expect(db.confirm).toHaveBeenCalledTimes(n); expect(model.requests).toHaveLength(1);
});
it("OFF keeps V1 without ActionPlan and rejects five at the existing boundary", async () => {
  const first = secretary(plan(operations(4)), false), session = await first.s.start(actor, "auto");
  const result = await first.s.send(actor, { sessionId: session.sessionId, message: "Cadastre serviços." });
  expect(result.action_plan).toBeUndefined(); expect(result.operations).toHaveLength(4);
  const second = secretary(plan(operations(5)), false), session2 = await second.s.start(actor, "auto");
  await expect(second.s.send(actor, { sessionId: session2.sessionId, message: "Cadastre serviços." })).rejects.toThrow();
});
it("clarifies only two incomplete actions, preserves others, same plan and draft; fast-path zero AI", async () => {
  const ops = operations(5); ops[1].durationMin = null; ops[3].durationMin = null;
  const { s, model } = secretary(plan(ops)), session = await s.start(actor, "auto");
  const result = await s.send(actor, { sessionId: session.sessionId, message: "Cadastre serviços." }), p = result.action_plan!;
  expect(p.actions.map(action => action.missing_fields)).toEqual([[], ["durationMin"], [], ["durationMin"], []]);
  // B2: groups are per component; the incomplete action's own group is the one that cannot be confirmed.
  await expect(s.confirmActionPlanGroup(actor, session.sessionId, approval(p, p.confirmation_groups.findIndex(group => group.action_keys.includes("a1"))))).rejects.toThrow("PLAN_NOT_READY");
  expect(db.confirm).not.toHaveBeenCalled();
  const sibling = result.operations![0].state.proposal!.proposal_ref;
  const next = await s.send(actor, { sessionId: session.sessionId, operation_ref: result.operations![1].operation_ref, message: "45 minutos" });
  expect(next.action_plan!.plan_ref).toBe(p.plan_ref);
  expect(next.action_plan!.actions[1].fields.durationMin).toBe(45);
  expect(next.operations![1].state.draft!.draft_ref).toBe(result.operations![1].state.draft!.draft_ref);
  expect(next.operations![0].state.proposal!.proposal_ref).toBe(sibling);
  expect(next.action_plan!.actions[3].missing_fields).toEqual(["durationMin"]);
  expect(model.requests).toHaveLength(1);
});
it("failed dependency never executes its child; independent action can complete", async () => {
  const ops = operations(3); Object.assign(ops[1], { depends_on: ["a0"] });
  const { s } = secretary({ ...plan(ops), independent: false }), session = await s.start(actor, "auto");
  const result = await s.send(actor, { sessionId: session.sessionId, message: "Cadastre em ordem e preserve os independentes." });
  db.confirm.mockRejectedValueOnce(Error("SLOT_CONFLICT"));
  // B2: the independent action is its own group; both groups are approved explicitly in one call.
  const next = await s.confirmReadyGroups(actor, session.sessionId, result.action_plan!.confirmation_groups.map((_, i) => approval(result.action_plan!, i)));
  expect(next.action_plan!.actions.map(action => action.status)).toEqual(["FAILED_SAFE", "BLOCKED_BY_DEPENDENCY", "DONE"]);
  expect(db.confirm).toHaveBeenCalledTimes(2);
});
it("preparation failure preserves every action and forbids silent partial confirmation", async () => {
  const { s } = secretary(plan(operations(4))), session = await s.start(actor, "auto");
  db.upsert.mockRejectedValueOnce(Error("SLOT_CONFLICT"));
  const result = await s.send(actor, { sessionId: session.sessionId, message: "Cadastre serviços." });
  expect(result.action_plan!.actions.map(action => action.status)).toEqual(["DOMAIN_CONFLICT", "READY_FOR_CONFIRMATION", "READY_FOR_CONFIRMATION", "READY_FOR_CONFIRMATION"]);
  await expect(s.confirmActionPlanGroup(actor, session.sessionId, approval(result.action_plan!))).rejects.toThrow("PLAN_NOT_READY");
  expect(db.confirm).not.toHaveBeenCalled();
});
it("financial read resolves separately while mutations need confirmation; tenant/role rechecked", async () => {
  const input = plan([...operations(2), intent("financial.report", { item_key: "financial", financial: { metrics: ["service_revenue"], period: "yesterday" } })]);
  const { s } = secretary(input), session = await s.start(actor, "auto");
  const result = await s.send(actor, { sessionId: session.sessionId, message: "Cadastre os serviços e informe o faturamento de ontem." });
  expect(result.action_plan!.actions[2]).toMatchObject({ status: "DONE", mutation: false });
  expect(result.operations![2].state.financial?.result?.metrics[0].value).toBe(12000);
  expect(db.confirm).not.toHaveBeenCalled();
  const token = approval(result.action_plan!);
  await expect(s.confirmActionPlanGroup({ ...actor, salonId: "foreign" }, session.sessionId, token)).rejects.toThrow("SESSION_NOT_FOUND");
  db.role = "RECEPTIONIST";
  await expect(s.confirmActionPlanGroup(actor, session.sessionId, token)).rejects.toThrow("FORBIDDEN");
  expect(db.confirm).not.toHaveBeenCalled();
});
it("material update invalidates old preview and group cannot race", async () => {
  const { s } = secretary(plan(operations(2))), session = await s.start(actor, "auto");
  const result = await s.send(actor, { sessionId: session.sessionId, message: "Cadastre serviços." }), token = approval(result.action_plan!);
  await s.cancelAutomaticOperation(actor, session.sessionId, result.operations![0].operation_ref);
  await expect(s.confirmActionPlanGroup(actor, session.sessionId, token)).rejects.toThrow("CONFIRMATION_STALE");
  expect(db.confirm).not.toHaveBeenCalled();
});

it("post-commit plan telemetry failure preserves the committed receipt and allows safe replay", async () => {
  const { s } = secretary(plan(operations(1))), session = await s.start(actor, "auto");
  const view = await s.send(actor, { sessionId: session.sessionId, message: "Cadastre o serviço." });
  db.auditLog.create.mockRejectedValueOnce(Error("SYNTHETIC_POST_COMMIT_AUDIT_FAILURE"));
  const done = await s.confirmActionPlanGroup(actor, session.sessionId, approval(view.action_plan!));
  expect(done.action_plan!.status).toBe("DONE");
  expect(done.operations![0].state.receipt).toBeDefined();
  expect(done.execution_warnings).toEqual(["POST_COMMIT_TELEMETRY_UNAVAILABLE"]);
  await s.confirmActionPlanGroup(actor, session.sessionId, approval(view.action_plan!));
  expect(db.confirm).toHaveBeenCalledOnce();
});

it("a correction to the only ready action updates its draft and revokes the previous confirmation", async () => {
  const model = new ScriptedServicesModel([call("select_capabilities", plan(operations(1))),
    call("upsert_action_draft", { name: null, durationMin: null, priceCents: 9000 })]);
  const s = new SalonSecretary(async () => model, () => "synthetic-execution", undefined, {}, { enabled: () => true });
  const session = await s.start(actor, "auto");
  const before = await s.send(actor, { sessionId: session.sessionId, message: "Cadastre o serviço por R$50." });
  const changed = await s.send(actor, { sessionId: session.sessionId, message: "Na verdade R$90." });
  expect(changed.operations![0].state.draft?.fields.priceCents).toBe(9000);
  expect(changed.operations![0].state.draft?.draft_ref).toBe(before.operations![0].state.draft?.draft_ref);
  await expect(s.confirmActionPlanGroup(actor, session.sessionId, approval(before.action_plan!))).rejects.toThrow("CONFIRMATION_STALE");
  expect(db.confirm).not.toHaveBeenCalled();
  await s.confirmActionPlanGroup(actor, session.sessionId, approval(changed.action_plan!));
  expect(db.confirm).toHaveBeenCalledOnce();
});
it("dependent Financial waits for mutation, missing period is collected without querying early", async () => {
  const financial = intent("financial.report", { item_key: "read", depends_on: ["a0"], financial: { metrics: ["service_revenue"] } });
  const model = new ScriptedServicesModel([call("select_capabilities", { ...plan([...operations(1), financial]), independent: false }),
    call("upsert_action_draft", { metrics: null, period: "yesterday", compare_period: null, group_by: null })]);
  const s = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const session = await s.start(actor, "auto"), view = await s.send(actor, { sessionId: session.sessionId, message: "Cadastre o serviço e depois consulte faturamento." });
  expect(view.action_plan!.actions[1].missing_fields).toEqual(["period"]);
  const queryCount = () => db.$queryRaw.mock.calls.filter(([query]) => String(query.sql ?? query).includes("WITH ranges")).length;
  expect(queryCount()).toBe(0);
  const next = await s.send(actor, { sessionId: session.sessionId, message: "Ontem" });
  expect(next.action_plan!.actions[1]).toMatchObject({ status: "READY", mutation: false, fields: { financial: { metrics: ["service_revenue"], period: "yesterday" } } });
  expect(queryCount()).toBe(0);
  const done = await s.confirmActionPlanGroup(actor, session.sessionId, approval(next.action_plan!));
  expect(done.action_plan!.status).toBe("DONE"); expect(queryCount()).toBe(1); expect(db.confirm).toHaveBeenCalledOnce();
});

it("rollback disables continuation, selection and group confirmation of an existing V2 plan", async () => {
  let enabled = true;
  const model = new ScriptedServicesModel([call("select_capabilities", plan(operations(2)))]);
  const s = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => enabled });
  const session = await s.start(actor, "auto");
  const view = await s.send(actor, { sessionId: session.sessionId, message: "Cadastre dois serviços." });
  enabled = false;
  await expect(s.send(actor, { sessionId: session.sessionId, message: "45 minutos" })).rejects.toThrow("MULTI_ACTION_V2_DISABLED");
  await expect(s.selectAutomatic(actor, session.sessionId, view.operations![0].operation_ref, "foreign")).rejects.toThrow("MULTI_ACTION_V2_DISABLED");
  await expect(s.confirmActionPlanGroup(actor, session.sessionId, approval(view.action_plan!))).rejects.toThrow("MULTI_ACTION_V2_DISABLED");
  expect(db.confirm).not.toHaveBeenCalled(); expect(model.requests).toHaveLength(1);
});

it("one combined answer updates two incomplete actions without changing the other eight", async () => {
  const ops = operations(10); ops[2].durationMin = null; ops[7].durationMin = null;
  const updates = plan([intent("service.create", { item_key: "a2", durationMin: 45 }), intent("service.create", { item_key: "a7", durationMin: 60 })]);
  const model = new ScriptedServicesModel([call("select_capabilities", plan(ops)), call("select_capabilities", updates)]);
  const s = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const session = await s.start(actor, "auto");
  const before = await s.send(actor, { sessionId: session.sessionId, message: "Cadastre os dez serviços." });
  const after = await s.send(actor, { sessionId: session.sessionId, message: "45 minutos no terceiro e 60 no oitavo." });
  expect(after.action_plan!.plan_ref).toBe(before.action_plan!.plan_ref);
  expect(after.action_plan!.actions).toHaveLength(10);
  expect(after.action_plan!.actions[2].fields.durationMin).toBe(45);
  expect(after.action_plan!.actions[7].fields.durationMin).toBe(60);
  for (let i = 0; i < 10; i++) {
    expect(after.operations![i].state.draft!.draft_ref).toBe(before.operations![i].state.draft!.draft_ref);
    if (![2, 7].includes(i)) expect(after.action_plan!.actions[i]).toEqual(before.action_plan!.actions[i]);
  }
  expect(model.requests).toHaveLength(2); expect(db.confirm).not.toHaveBeenCalled();
});

it("new intent leaves the selected draft intact and can resume it without old approval", async () => {
  const {s,model}=secretary(plan(operations(1))), session=await s.start(actor,"auto");
  const first=await s.send(actor,{sessionId:session.sessionId,message:"Crie um serviço."});
  const old=structuredClone(first.action_plan!), child=first.operations![0], draft=structuredClone(child.state.draft);
  const nextOp=intent("service.create",{item_key:"other",name:"Hidratação",priceCents:8000,durationMin:40});
  appendScriptedResponses(model,[call("upsert_action_draft",{name:null,priceCents:null,durationMin:null,new_request:plan([nextOp])})]);
  const next=await s.send(actor,{sessionId:session.sessionId,operation_ref:child.operation_ref,message:"Agora crie outro serviço: Hidratação."});
  expect(model.requests).toHaveLength(2); expect(db.confirm).not.toHaveBeenCalled();
  expect(next.action_plan!.plan_ref).not.toBe(old.plan_ref);
  expect(next.suspended_plans).toEqual([{plan_ref:old.plan_ref,label:"service.create"}]);
  expect(next.action_plan!.actions[0].fields).toMatchObject({name:"Hidratação",priceCents:8000});
  await expect(s.confirmActionPlanGroup(actor,session.sessionId,approval(old))).rejects.toThrow();
  await expect(s.resumePlan({...actor,salonId:"foreign"},session.sessionId,old.plan_ref)).rejects.toThrow("SESSION_NOT_FOUND");
  await expect(s.resumePlan(actor,session.sessionId,"unknown")).rejects.toThrow("PLAN_NOT_IN_SESSION");
  const resumed=await s.resumePlan(actor,session.sessionId,old.plan_ref);
  expect(resumed.action_plan!.plan_ref).toBe(old.plan_ref);
  expect(resumed.operations![0].state.draft).toEqual(draft);
  expect(resumed.action_plan!.revision).toBeGreaterThan(old.revision);
  await expect(s.confirmActionPlanGroup(actor,session.sessionId,approval(old))).rejects.toThrow();
  expect(db.confirm).not.toHaveBeenCalled(); expect(model.requests).toHaveLength(2);
});
it("routes a selected service request to financial without touching its draft", async()=>{
  const {s,model}=secretary(plan(operations(1))),session=await s.start(actor,"auto");
  const first=await s.send(actor,{sessionId:session.sessionId,message:"Crie um serviço."});
  appendScriptedResponses(model,[call("upsert_action_draft",{name:null,priceCents:null,durationMin:null,new_request:plan([intent("financial.report",{item_key:"revenue",financial:{metrics:["service_revenue"],period:"yesterday"}})])})]);
  const count=db.upsert.mock.calls.length;
  const next=await s.send(actor,{sessionId:session.sessionId,operation_ref:first.operations![0].operation_ref,message:"Quanto entrou ontem?"});
  expect(next.action_plan!.actions[0].operation).toBe("financial.report");
  expect(db.upsert).toHaveBeenCalledTimes(count);expect(db.confirm).not.toHaveBeenCalled();
  expect(next.operations![0].state.financial?.result?.metrics[0].value).toBe(12000);
});
it("unsupported new request preserves the draft and shows capability status",async()=>{
  const {s,model}=secretary(plan(operations(1))),session=await s.start(actor,"auto");
  const first=await s.send(actor,{sessionId:session.sessionId,message:"Crie um serviço."});
  appendScriptedResponses(model,[call("upsert_action_draft",{name:null,priceCents:null,durationMin:null,new_request:{skills:[],independent:true,operations:[],disposition:"UNSUPPORTED",unavailable_capability:"professional_management"}})]);
  const next=await s.send(actor,{sessionId:session.sessionId,message:"Cadastre uma profissional."});
  expect(next.capability_status).toBe("UNSUPPORTED");expect(next.message).toContain("profissionais");
  expect(next.operations![0].state.draft).toEqual(first.operations![0].state.draft);expect(db.confirm).not.toHaveBeenCalled();
});

it("a completed read does not trap later requests in the old plan",async()=>{
  const {s,model}=secretary(plan([intent("financial.report",{item_key:"read",financial:{metrics:["service_revenue"],period:"yesterday"}})]));
  const session=await s.start(actor,"auto");
  const first=await s.send(actor,{sessionId:session.sessionId,message:"Quanto entrou ontem?"});
  appendScriptedResponses(model,[call("select_capabilities",plan(operations(1)))]);
  const next=await s.send(actor,{sessionId:session.sessionId,message:"Agora crie um serviço."});
  expect(next.action_plan!.plan_ref).not.toBe(first.action_plan!.plan_ref);
  expect(next.action_plan!.actions[0].operation).toBe("service.create");expect(model.requests).toHaveLength(2);
  db.role="RECEPTIONIST";
  await expect(s.resumePlan(actor,session.sessionId,first.action_plan!.plan_ref)).rejects.toThrow("FORBIDDEN");
  expect(db.confirm).not.toHaveBeenCalled();
});

it("a natural greeting creates no draft, action plan, or unsupported notice",async()=>{
  const {s}=secretary({skills:[],independent:true,operations:[],disposition:"CONVERSATION",conversation_response:"Bom dia! Como posso ajudar?"});
  const session=await s.start(actor,"auto");
  const view=await s.send(actor,{sessionId:session.sessionId,message:"Bom dia, tudo certo?"});
  expect(view.message).toBe("Bom dia! Como posso ajudar?");
  expect(view.action_plan).toBeUndefined();expect(db.upsert).not.toHaveBeenCalled();
});
it("adding an action retains the active plan, prior drafts and revokes prior approval",async()=>{
  const {s,model}=secretary(plan(operations(1))),session=await s.start(actor,"auto");
  const first=await s.send(actor,{sessionId:session.sessionId,message:"Crie o primeiro serviço."});
  appendScriptedResponses(model,[call("upsert_action_draft",{name:null,priceCents:null,durationMin:null,new_request_mode:"ADD",new_request:plan([intent("service.create",{item_key:"added",name:"Pedicure",priceCents:4000,durationMin:40})])})]);
  const next=await s.send(actor,{sessionId:session.sessionId,message:"Inclua também Pedicure por quarenta, quarenta minutos."});
  expect(next.action_plan!.plan_ref).toBe(first.action_plan!.plan_ref);expect(next.action_plan!.actions).toHaveLength(2);
  expect(next.operations![0].state.draft).toEqual(first.operations![0].state.draft);
  await expect(s.confirmActionPlanGroup(actor,session.sessionId,approval(first.action_plan!))).rejects.toThrow("CONFIRMATION_STALE");
  expect(db.confirm).not.toHaveBeenCalled();
});
it("a correction to one of several ready actions is a patch in the same plan",async()=>{
  const {s,model}=secretary(plan(operations(2))),session=await s.start(actor,"auto");
  const first=await s.send(actor,{sessionId:session.sessionId,message:"Crie os dois serviços."});
  appendScriptedResponses(model,[call("select_capabilities",plan([intent("service.create",{item_key:"a1",priceCents:6700})]))]);
  const next=await s.send(actor,{sessionId:session.sessionId,message:"O segundo fica por sessenta e sete."});
  expect(next.action_plan!.plan_ref).toBe(first.action_plan!.plan_ref);
  expect(next.action_plan!.actions[1].fields.priceCents).toBe(6700);
  expect(next.action_plan!.actions[0]).toEqual(first.action_plan!.actions[0]);expect(db.confirm).not.toHaveBeenCalled();
});
it("natural resumption can correct the suspended plan without duplicating it",async()=>{
  const {s,model}=secretary(plan(operations(1))),session=await s.start(actor,"auto");
  const first=await s.send(actor,{sessionId:session.sessionId,message:"Crie o serviço."});
  appendScriptedResponses(model,[call("upsert_action_draft",{name:null,priceCents:null,durationMin:null,new_request:plan([intent("financial.report",{item_key:"revenue",financial:{metrics:["service_revenue"],period:"yesterday"}})])})]);
  await s.send(actor,{sessionId:session.sessionId,message:"Agora o faturamento de ontem."});
  appendScriptedResponses(model,[call("select_capabilities",{skills:[],independent:true,operations:[],resume_request:{plan_ref:first.action_plan!.plan_ref,patches:plan([intent("service.create",{item_key:"a0",priceCents:7500})])}})]);
  const next=await s.send(actor,{sessionId:session.sessionId,message:"Voltando ao serviço, coloca setenta e cinco."});
  expect(next.action_plan!.plan_ref).toBe(first.action_plan!.plan_ref);
  expect(next.operations![0].state.draft!.draft_ref).toBe(first.operations![0].state.draft!.draft_ref);
  expect(next.action_plan!.actions[0].fields.priceCents).toBe(7500);
  expect(JSON.stringify(model.requests.at(-1))).toContain(first.action_plan!.plan_ref);expect(db.confirm).not.toHaveBeenCalled();
});

it("casual conversation during a task preserves effective state and performs no draft write",async()=>{
  const {s,model}=secretary(plan(operations(1))),session=await s.start(actor,"auto");
  const first=await s.send(actor,{sessionId:session.sessionId,message:"Crie um serviço."}),count=db.upsert.mock.calls.length;
  appendScriptedResponses(model,[call("upsert_action_draft",{name:null,priceCents:null,durationMin:null,new_request:{skills:[],independent:true,operations:[],disposition:"CONVERSATION",conversation_response:"Tudo certo por aqui. Seguimos quando quiser."}})]);
  const next=await s.send(actor,{sessionId:session.sessionId,message:"Tudo bom contigo?"});
  expect(next.capability_status).toBe("CONVERSATION");expect(next.action_plan!.plan_ref).toBe(first.action_plan!.plan_ref);
  expect(next.operations![0].state.draft).toEqual(first.operations![0].state.draft);
  expect(db.upsert).toHaveBeenCalledTimes(count);expect(db.confirm).not.toHaveBeenCalled();
  await expect(s.confirmActionPlanGroup(actor,session.sessionId,approval(first.action_plan!))).rejects.toThrow("CONFIRMATION_STALE");
});
it("an unbound correction among ready actions asks for its target and withdraws prior approval",async()=>{
  const {s,model}=secretary(plan(operations(2))),session=await s.start(actor,"auto");
  const first=await s.send(actor,{sessionId:session.sessionId,message:"Crie os dois."});
  appendScriptedResponses(model,[call("select_capabilities",{skills:[],independent:true,operations:[],disposition:"AMBIGUOUS"})]);
  const next=await s.send(actor,{sessionId:session.sessionId,message:"O preço mudou."});
  expect(next.capability_status).toBe("AMBIGUOUS");
  await expect(s.confirmActionPlanGroup(actor,session.sessionId,approval(first.action_plan!))).rejects.toThrow("CONFIRMATION_STALE");
  expect(next.action_plan!.actions).toEqual(first.action_plan!.actions);expect(db.confirm).not.toHaveBeenCalled();
});
it("an addition never duplicates a prior action key or executes either action",async()=>{
  const {s,model}=secretary(plan(operations(1))),session=await s.start(actor,"auto");
  const first=await s.send(actor,{sessionId:session.sessionId,message:"Crie o serviço."}),count=db.upsert.mock.calls.length;
  appendScriptedResponses(model,[call("upsert_action_draft",{name:null,priceCents:null,durationMin:null,new_request_mode:"ADD",new_request:plan(operations(1))})]);
  await expect(s.send(actor,{sessionId:session.sessionId,message:"Adicione outro."})).rejects.toThrow("APPEND_ACTION_EXISTS");
  expect(db.upsert).toHaveBeenCalledTimes(count);expect(db.confirm).not.toHaveBeenCalled();
  await expect(s.confirmActionPlanGroup(actor,session.sessionId,approval(first.action_plan!))).rejects.toThrow("CONFIRMATION_STALE");
});
it("the interpreter cannot resume an arbitrary or another tenant's plan",async()=>{
  const {s,model}=secretary(plan(operations(1))),session=await s.start(actor,"auto");
  const first=await s.send(actor,{sessionId:session.sessionId,message:"Crie o serviço."}),count=db.upsert.mock.calls.length;
  appendScriptedResponses(model,[call("upsert_action_draft",{name:null,priceCents:null,durationMin:null,resume_request:{plan_ref:crypto.randomUUID(),patches:null}})]);
  const failed=await s.send(actor,{sessionId:session.sessionId,message:"Volte para o pedido antigo."});
  // B5 contract migration (partial acceptance): the refused RESUME (PLAN_NOT_IN_SESSION) applies nothing
  // and no longer fails the action: the same active plan is kept and the reply asks to rephrase.
  // Review 2b: the answer was addressed to this only open unit, so its proposal is not re-offered: the action is
  // held for review (never FAILED_SAFE, never confirmable) until the owner restates or keeps it.
  expect(failed.action_plan!.plan_ref).toBe(first.action_plan!.plan_ref);
  expect(failed.action_plan!.actions[0]).toMatchObject({ status: "NEEDS_INPUT", assessment: { issue: "REVIEW_REQUIRED" } });
  expect(failed.action_plan!.confirmation_groups.some(group => group.status === "READY_FOR_CONFIRMATION")).toBe(false);
  expect(failed.message).toBe(unreadAnswerNotice);
  expect(db.upsert).toHaveBeenCalledTimes(count);expect(db.confirm).not.toHaveBeenCalled();
  await expect(s.send({...actor,salonId:"foreign"},{sessionId:session.sessionId,message:"Retome."})).rejects.toThrow("SESSION_NOT_FOUND");
  expect(first.operations![0].state.draft).toEqual(failed.operations![0].state.draft);
});
it("post-draft failure projects accepted fields while refusing confirmation",async()=>{
  const {s,model}=secretary(plan(operations(1))),session=await s.start(actor,"auto");
  await s.send(actor,{sessionId:session.sessionId,message:"Crie o serviço."});
  appendScriptedResponses(model,[call("upsert_action_draft",{name:null,priceCents:8600,durationMin:null})]);
  db.propose.mockRejectedValueOnce(Error("SYNTHETIC_PROPOSAL_FAILURE"));
  const failed=await s.send(actor,{sessionId:session.sessionId,message:"Mude o preço para oitenta e seis."});
  expect(failed.action_plan!.actions[0]).toMatchObject({status:"FAILED_SAFE",fields:{priceCents:8600}});
  expect(failed.operations![0].state.draft!.fields.priceCents).toBe(8600);
  expect(failed.capability_status).toBe("BLOCKED");expect(db.confirm).not.toHaveBeenCalled();
});

it("a combined clarification keeps dependent read fields in the authoritative plan without querying early",async()=>{
  const ops=operations(1);ops[0].durationMin=null;
  const financial=intent("financial.report",{item_key:"read",depends_on:["a0"],financial:{metrics:["service_revenue"]}});
  const {s,model}=secretary({...plan([...ops,financial]),independent:false}),session=await s.start(actor,"auto");
  const before=await s.send(actor,{sessionId:session.sessionId,message:"Cadastre e depois me mostre o faturamento."});
  appendScriptedResponses(model,[call("select_capabilities",plan([
    intent("service.create",{item_key:"a0",durationMin:35}),intent("financial.report",{item_key:"read",financial:{period:"yesterday"}})]))]);
  const after=await s.send(actor,{sessionId:session.sessionId,message:"Trinta e cinco minutos; faturamento de ontem."});
  expect(after.action_plan!.plan_ref).toBe(before.action_plan!.plan_ref);
  expect(after.action_plan!.actions[1]).toMatchObject({status:"READY",fields:{financial:{metrics:["service_revenue"],period:"yesterday"}}});
  expect(db.$queryRaw.mock.calls.filter(([query])=>String(query.sql??query).includes("WITH ranges"))).toHaveLength(0);
  expect(db.confirm).not.toHaveBeenCalled();
});
it("a correction can target a ready sibling while a different action waits for input",async()=>{
  const ops=operations(2);ops[0].durationMin=null;
  const {s,model}=secretary(plan(ops)),session=await s.start(actor,"auto");
  const before=await s.send(actor,{sessionId:session.sessionId,message:"Crie dois serviços."});
  appendScriptedResponses(model,[call("upsert_action_draft",{name:null,priceCents:null,durationMin:null,
    new_request_mode:"PATCH",new_request:plan([intent("service.create",{item_key:"a1",priceCents:8400})])})]);
  const after=await s.send(actor,{sessionId:session.sessionId,message:"No segundo, deixe o valor em oitenta e quatro."});
  expect(after.action_plan!.plan_ref).toBe(before.action_plan!.plan_ref);
  expect(after.action_plan!.actions[0].missing_fields).toEqual(["durationMin"]);
  expect(after.action_plan!.actions[0].fields.durationMin).toBeNull();
  expect(after.action_plan!.actions[1].fields.priceCents).toBe(8400);
  expect(after.operations![0].state.draft).toEqual(before.operations![0].state.draft);expect(db.confirm).not.toHaveBeenCalled();
});

it.each(["UNSUPPORTED","AMBIGUOUS","CONVERSATION"] as const)("backend refuses a fresh forged confirmation while current turn is %s",async disposition=>{
  const {s,model}=secretary(plan(operations(1))),session=await s.start(actor,"auto");
  await s.send(actor,{sessionId:session.sessionId,message:"Crie o serviço."});
  const extra=disposition==="CONVERSATION"?{conversation_response:"Tudo certo."}:disposition==="UNSUPPORTED"?{unavailable_capability:"professional_management"}:{};
  appendScriptedResponses(model,[call("upsert_action_draft",{name:null,priceCents:null,durationMin:null,
    new_request:{skills:[],operations:[],independent:true,disposition,...extra}})]);
  const after=await s.send(actor,{sessionId:session.sessionId,message:"Outro assunto."});
  await expect(s.confirmActionPlanGroup(actor,session.sessionId,approval(after.action_plan!))).rejects.toThrow("PLAN_NOT_READY");
  expect(db.confirm).not.toHaveBeenCalled();
});


it.each([11, 14])("an independent confirmation group remains supported after execution failure among %i actions",async count=>{
  vi.stubEnv("SALON_SECRETARY_CONFIRMATION_GROUPING","packed"); // pins the packed rollback (B2 default is per component)
  const {s}=secretary(plan(operations(count))),session=await s.start(actor,"auto");
  const prepared=await s.send(actor,{sessionId:session.sessionId,message:"Cadastre os serviços pedidos."});
  const firstApproval=approval(prepared.action_plan!);
  db.confirm.mockRejectedValueOnce(Error("SYNTHETIC_EXECUTION_FAILURE"));
  const partial=await s.confirmActionPlanGroup(actor,session.sessionId,firstApproval);
  expect(partial.action_plan!.status).toBe("PARTIAL_FAILURE");
  expect(partial.action_plan!.actions[0].status).toBe("FAILED_SAFE");
  expect(partial.action_plan!.confirmation_groups.map(group=>group.status)).toEqual(["NEEDS_REVIEW","READY_FOR_CONFIRMATION"]);
  expect(partial.capability_status).toBe("SUPPORTED");
  expect(db.confirm).toHaveBeenCalledTimes(10);
  const secondApproval=approval(partial.action_plan!,1);
  await expect(s.confirmActionPlanGroup(actor,session.sessionId,{...secondApproval,fingerprint:"0".repeat(64)})).rejects.toThrow("CONFIRMATION_STALE");
  expect(db.confirm).toHaveBeenCalledTimes(10);
  const completed=await s.confirmActionPlanGroup(actor,session.sessionId,secondApproval);
  expect(completed.action_plan!.confirmation_groups.map(group=>group.status)).toEqual(["NEEDS_REVIEW","DONE"]);
  expect(completed.action_plan!.actions.slice(10).every(action=>action.status==="DONE")).toBe(true);
  expect(completed.action_plan!.actions[0].status).toBe("FAILED_SAFE");
  expect(completed.capability_status).toBe("BLOCKED");
  expect(db.confirm).toHaveBeenCalledTimes(count);
  await s.confirmActionPlanGroup(actor,session.sessionId,firstApproval);
  await s.confirmActionPlanGroup(actor,session.sessionId,secondApproval);
  expect(db.confirm).toHaveBeenCalledTimes(count);
});
it.each([11, 14])("preparation failure in one group preserves an independently ready group among %i actions",async count=>{
  vi.stubEnv("SALON_SECRETARY_CONFIRMATION_GROUPING","packed"); // pins the packed rollback (B2 default is per component)
  const {s}=secretary(plan(operations(count))),session=await s.start(actor,"auto");
  db.upsert.mockRejectedValueOnce(Error("SLOT_CONFLICT"));
  const prepared=await s.send(actor,{sessionId:session.sessionId,message:"Cadastre os serviços pedidos."});
  expect(prepared.action_plan!.actions[0].status).toBe("DOMAIN_CONFLICT");
  expect(prepared.action_plan!.confirmation_groups.map(group=>group.status)).toEqual(["NEEDS_REVIEW","READY_FOR_CONFIRMATION"]);
  expect(prepared.capability_status).toBe("SUPPORTED");
  await expect(s.confirmActionPlanGroup(actor,session.sessionId,approval(prepared.action_plan!))).rejects.toThrow("PLAN_NOT_READY");
  expect(db.confirm).not.toHaveBeenCalled();
  const completed=await s.confirmActionPlanGroup(actor,session.sessionId,approval(prepared.action_plan!,1));
  expect(completed.action_plan!.actions.slice(10).every(action=>action.status==="DONE")).toBe(true);
  expect(completed.action_plan!.actions[0].status).toBe("DOMAIN_CONFLICT");
  expect(db.confirm).toHaveBeenCalledTimes(count-10);
});
