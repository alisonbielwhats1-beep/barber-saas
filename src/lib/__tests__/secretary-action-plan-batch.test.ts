import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ batchDraft: vi.fn(), batchProposal: vi.fn(), batchConfirm: vi.fn(),
  messageDraft: vi.fn(), messageProposal: vi.fn(), messageConfirm: vi.fn(), serviceDraft: vi.fn(), serviceProposal: vi.fn(), serviceConfirm: vi.fn(),
  auditLog: { create: vi.fn() }, $queryRaw: vi.fn(), salon: { findUniqueOrThrow: vi.fn() } }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: object) => unknown) => fn(mocks) }));
vi.mock("../customer-catalog", async original => ({ ...await original<object>(), assertCustomerAccess: async () => {},
  searchSalonCustomer: async () => [{ id: "amanda-backend", name: "Amanda Souza" }] }));
vi.mock("../service-catalog", async original => ({ ...await original<object>(), assertServiceWriter: async () => ({ currency: "BRL" }),
  findCatalogServices: async () => [{ id: "massagem-backend", name: "Massagem" }] }));
vi.mock("../scheduling-batch", async original => ({ ...await original<object>(), upsertBatchDraft: mocks.batchDraft,
  proposeActionBatch: mocks.batchProposal, confirmActionBatch: mocks.batchConfirm }));
vi.mock("../service-create-mvp", async original => ({ ...await original<object>(), upsertActionDraft: mocks.serviceDraft,
  proposeServiceChange: mocks.serviceProposal, confirmServiceCreate: mocks.serviceConfirm }));
vi.mock("../communication-actions", async original => ({ ...await original<object>(), assertCommunicationAccess: async () => {},
  getCustomerMessageContext: async () => ({ channel_eligible: true }), upsertMessageDraft: mocks.messageDraft,
  proposeCustomerMessage: mocks.messageProposal, confirmCustomerMessage: mocks.messageConfirm,
  dispatchLocalMessage: async () => ({ status: "SIMULATED", metrics: {} }), communicationMetrics: async () => {} }));
import { SalonSecretary } from "../salon-secretary";
import { validateBatchPlan } from "../scheduling-batch";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { intent, plan } from "../../test/secretary-capability-plan";
import type { ActionPlan } from "@everflair/salon-secretary";
const actor = { salonId: "synthetic", userId: "synthetic" };
const exact = "  Seu horário foi cancelado.\nObrigada! 😊  ";
// B2: the independent Massagem change is its own ready group, named once before the single question.
const readyLead = "Já dá para confirmar: alteração do serviço Massagem.\n\n";
const readyApprovals = (p: ActionPlan) => p.confirmation_groups.filter(group => group.status === "READY_FOR_CONFIRMATION")
  .map(group => ({ plan_ref: p.plan_ref, revision: p.revision, group_key: group.key, fingerprint: group.fingerprint }));
const input = (message = false) => ({ ...plan([
  intent("appointment.cancel", { item_key: "a", depends_on: [], customer_name: "Amanda Souza", day_offset: 1, time: "10:00", reason: "Pedido dela" }),
  intent("appointment.create", { item_key: "b", depends_on: ["a"], released_slot_of: "a", customer_name: "Fábio Santos", service_name: "Corte Completo" }),
  intent("service.change", { item_key: "c", depends_on: [], target_name: "Massagem", priceCents: 8000 }),
  intent("financial.report", { item_key: "d", depends_on: [], financial: { metrics: ["service_revenue"], period: "yesterday" } }),
  ...(message ? [intent("customer.message", { item_key: "e", depends_on: ["a"], communication: {
    recipient_name: "Amanda Souza", channel: "WHATSAPP", message_mode: "EXACT", content: "rewritten by fake interpreter" } })] : []),
]), independent: false });
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  mocks.auditLog.create.mockResolvedValue({}); mocks.salon.findUniqueOrThrow.mockResolvedValue({ timezone: "America/Sao_Paulo" });
  mocks.$queryRaw.mockImplementation(async (query: readonly string[] | { sql?: string }) => {
    const sql = Array.isArray(query) ? query.join("") : (query as { sql?: string }).sql ?? "";
    if (sql.includes('"Membership"')) return [{ role: "OWNER" }];
    if (sql.includes("WITH ranges")) return [{ label: "current", revenue: 12000n, count: 2n, products: 0n, product_invalid: 0n,
      received: 0n, payment_count: 0n, payment_invalid: 0n, receivable: 0n, unpaid_count: 0n, unpaid_invalid: 0n, snapshot_invalid: 0n, groups: [] }];
    return [{ accessStatus: "APPROVED", timezone: "America/Sao_Paulo", currency: "BRL" }];
  });
  const draft_ref = crypto.randomUUID(), proposal_ref = crypto.randomUUID();
  mocks.batchDraft.mockImplementation(async (_tx, _actor, value) => ({ plan: validateBatchPlan(value.plan), draft_ref,
    draft_revision: 1, status: "READY", missing_fields: [], message: "Cancelamento + criação, disponibilidade projetada backend", metrics: {},
    snapshot: { cancel: { customer_ref: "amanda-backend" } } }));
  mocks.batchProposal.mockResolvedValue({ draft_ref, draft_revision: 1, proposal_ref, payload_hash: "batch-hash", preview: "Cancelar Amanda; Fábio — Corte Completo" });
  mocks.batchConfirm.mockResolvedValue({ receipt_ref: "batch-receipt", results: [{ key: "a", outcome: "CANCELLED" }, { key: "b", outcome: "CONFIRMED" }] });
  mocks.serviceDraft.mockResolvedValue({ change: true, draft_ref: crypto.randomUUID(), draft_revision: 1, fields: { name: "Massagem", priceCents: 8000, durationMin: 30 }, status: "READY", missing_fields: [] });
  mocks.serviceProposal.mockResolvedValue({ draft_revision: 1, proposal_ref: crypto.randomUUID(), payload_hash: "service-hash", preview: "Massagem R$80", change: true });
  mocks.serviceConfirm.mockResolvedValue({ receipt_ref: "service-receipt", service: { id: "massagem-backend", name: "Massagem" } });
  mocks.messageDraft.mockImplementation(async (_tx, _actor, value) => ({ draft_ref: crypto.randomUUID(), draft_revision: 1, fields: value.patch, status: "READY", missing_fields: [] }));
  mocks.messageProposal.mockResolvedValue({ draft_revision: 1, proposal_ref: crypto.randomUUID(), payload_hash: "message-hash", preview: exact });
  mocks.messageConfirm.mockResolvedValue({ receipt_ref: "message-receipt", message_ref: "fake-outbox-ref" });
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("x46-style natural continuation asks once, retains five actions and the same batch draft", async () => {
  const selected = input(true); Object.assign(selected.operations[1], { service_name: null });
  const draft = crypto.randomUUID();
  mocks.batchDraft.mockImplementation(async (_tx, _actor, value) => {
    const prepared = validateBatchPlan(value.plan), missing = !prepared.items[1].fields.service_name;
    return { plan: prepared, draft_ref: value.draft_ref ?? draft, draft_revision: (value.expected_revision ?? 0) + 1,
      status: missing ? "NEEDS_INPUT" : "READY", missing_fields: missing ? ["b.service_name"] : [],
      message: missing ? "Qual é o serviço do novo agendamento?" : "Agendar Fábio para Corte Completo", metrics: {},
      ...(missing ? {} : { snapshot: { cancel: { customer_ref: "amanda-backend" } } }) };
  });
  const model = new ScriptedServicesModel([call("select_capabilities", selected), call("upsert_action_draft", { item_key: "b", service_name: "Corte Completo" })]);
  const s = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const session = await s.start(actor, "auto");
  const before = await s.send(actor, { sessionId: session.sessionId, message: `Cancele Amanda, coloque Fábio no lugar, altere Massagem e consulte ontem. Motivo: Pedido dela. Envie exatamente “${exact}”` });
  expect(before.message).toBe(readyLead + "Qual serviço Fábio Santos vai fazer?");
  const after = await s.send(actor, { sessionId: session.sessionId, message: "Corte Completo." });
  expect(after.action_plan!.plan_ref).toBe(before.action_plan!.plan_ref);
  expect(after.action_plan!.dependencies).toEqual(before.action_plan!.dependencies);
  expect(after.action_plan!.actions).toHaveLength(5);
  expect(after.action_plan!.status,JSON.stringify(after.action_plan)).toBe("READY_FOR_CONFIRMATION");
  expect(after.operations![0].state.batch!.draft!.draft_ref).toBe(before.operations![0].state.batch!.draft!.draft_ref);
  for (const i of [0, 2, 3, 4]) expect(after.action_plan!.actions[i].fields).toEqual(before.action_plan!.actions[i].fields);
  expect(after.action_plan!.actions[1].fields).toMatchObject({ service_name: "Corte Completo" });
  expect(after.message).not.toContain("Qual é o serviço"); expect(after.message).toContain(exact);
  expect(model.requests).toHaveLength(2); expect(mocks.batchConfirm).not.toHaveBeenCalled(); expect(mocks.messageConfirm).not.toHaveBeenCalled();
});
it.each([false, true])("runtime u02-equivalent with branching message=%s reuses atomic adapter and EXACT", async message => {
  const model = new ScriptedServicesModel([call("select_capabilities", input(message))]);
  const s = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const session = await s.start(actor, "auto"), view = await s.send(actor, { sessionId: session.sessionId,
    message: `Cancele Amanda. Motivo: Pedido dela; agende Fábio para Corte Completo; altere Massagem para R$80 e consulte ontem.${message ? ` Envie exatamente “${exact}”` : ""}` });
  expect(view.action_plan!.actions).toHaveLength(message ? 5 : 4);
  expect(view.action_plan!.status).toBe("READY_FOR_CONFIRMATION");
  expect(view.action_plan!.actions[1].fields).toMatchObject({ service_name: "Corte Completo" });
  expect(mocks.batchDraft.mock.calls[0][2].plan.items[1].fields.service_name).toBe("Corte Completo");
  expect(mocks.batchConfirm).not.toHaveBeenCalled(); expect(mocks.messageConfirm).not.toHaveBeenCalled();
  if (message) expect(mocks.messageDraft.mock.calls[0][2].patch.content).toBe(exact);
  const done = await s.confirmReadyGroups(actor, session.sessionId, readyApprovals(view.action_plan!));
  expect(done.action_plan!.status).toBe("DONE");
  expect(mocks.batchConfirm).toHaveBeenCalledOnce(); expect(mocks.serviceConfirm).toHaveBeenCalledOnce();
  expect(mocks.messageConfirm).toHaveBeenCalledTimes(message ? 1 : 0); expect(model.requests).toHaveLength(1);
});
it("failed atomic cancellation blocks both creation and message; independent service survives", async () => {
  const model = new ScriptedServicesModel([call("select_capabilities", input(true))]);
  const s = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const session = await s.start(actor, "auto"), view = await s.send(actor, { sessionId: session.sessionId, message: `Prepare cancelamento/criação, serviço e relatório. Motivo: Pedido dela. Envie “${exact}”` });
  mocks.batchConfirm.mockRejectedValue(Error("SLOT_CONFLICT"));
  const done = await s.confirmReadyGroups(actor, session.sessionId, readyApprovals(view.action_plan!));
  expect(done.action_plan!.actions.map(action => action.status)).toEqual(["FAILED_SAFE", "BLOCKED_BY_DEPENDENCY", "DONE", "DONE", "BLOCKED_BY_DEPENDENCY"]);
  expect(mocks.messageConfirm).not.toHaveBeenCalled(); expect(mocks.serviceConfirm).toHaveBeenCalledOnce();
});

it.each(["override", "alternative"])("T21 %s continuation preserves the five-action plan and EXACT without confirming", async mode => {
  vi.stubEnv("SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED","true");
  const selected=input(true);Object.assign(selected.operations[1],{service_name:null});
  const draft=crypto.randomUUID();
  mocks.batchDraft.mockImplementation(async (_tx,_actor,value)=>{
    const prepared=validateBatchPlan(value.plan),f=prepared.items[1].fields;
    const field=!f.service_name?"service_name":f.destination_mode==="ALTERNATIVE_SLOT"?(!f.time?"time":null):!f.override_requested?"override_requested":!f.override_reason?"override_reason":null;
    const message=field==="service_name"?"Qual serviço Fábio Santos vai fazer?":field==="override_requested"?"Corte Completo vai até 10h45. Quer fazer o encaixe ou escolher outro horário?":field==="override_reason"?"Qual o motivo do encaixe?":field==="time"?"Tenho 11h. Qual horário você prefere?":"Pronto para revisão.";
    return {plan:prepared,draft_ref:value.draft_ref??draft,draft_revision:(value.expected_revision??0)+1,status:field?"NEEDS_INPUT":"READY",missing_fields:field?[`b.${field}`]:[],message,metrics:{},
      ...(field&&field!=="service_name"?{review:{message}}:{}),...(field?{}:{snapshot:{cancel:{customer_ref:"amanda-backend"}}})};
  });
  const replies=mode==="override"?[call("upsert_action_draft",{item_key:"b",override_requested:true}),call("upsert_action_draft",{item_key:"b",override_reason:"Cliente já está aguardando"})]:[call("upsert_action_draft",{item_key:"b",destination_mode:"ALTERNATIVE_SLOT",override_requested:false}),call("upsert_action_draft",{item_key:"b",time:"11:00"})];
  const model=new ScriptedServicesModel([call("select_capabilities",selected),call("upsert_action_draft",{item_key:"b",service_name:"Corte Completo"}),...replies]);
  const s=new SalonSecretary(async()=>model,()=>"gpt-6-luna",undefined,{}, {enabled:()=>true});
  const session=await s.start(actor,"auto");
  const before=await s.send(actor,{sessionId:session.sessionId,message:`Cancela Amanda, coloca Fábio no lugar, altera Massagem e consulta ontem. Motivo: Pedido dela. Envie exatamente “${exact}”`});
  expect(before.message).toBe(readyLead+"Qual serviço Fábio Santos vai fazer?");
  const messages=mode==="override"?["Corte Completo.","Pode encaixar.","Cliente já está aguardando."]:["Corte Completo.","Outro horário.","11h."];
  let after=before;
  for(const [i,message]of messages.entries()){
    after=await s.send(actor,{sessionId:session.sessionId,message});
    expect(after.action_plan!.plan_ref).toBe(before.action_plan!.plan_ref);
    expect(after.action_plan!.dependencies).toEqual(before.action_plan!.dependencies);
    expect(after.action_plan!.actions.map(a=>a.key)).toEqual(before.action_plan!.actions.map(a=>a.key));
    expect(after.operations![0].state.batch!.draft!.draft_ref).toBe(draft);
    for(const key of ["a","c","d","e"])expect(after.action_plan!.actions.find(a=>a.key===key)!.fields).toEqual(before.action_plan!.actions.find(a=>a.key===key)!.fields);
    expect(after.message).not.toMatch(/override_reason|override_requested|destination_mode|service_ref|professional_ref/);
    if(i<2)expect(after.message.match(/\?/g)).toHaveLength(1);
    if(i===1)expect(after.message).toBe(readyLead+(mode==="override"?"Qual o motivo do encaixe?":"Tenho 11h. Qual horário você prefere?"));
  }
  expect(after.action_plan!.status).toBe("READY_FOR_CONFIRMATION");
  expect(after.message).toContain(exact);
  expect(mocks.batchConfirm).not.toHaveBeenCalled();expect(mocks.messageConfirm).not.toHaveBeenCalled();
  expect(after.action_plan!.actions.find(a=>a.key==="b")!.fields).toMatchObject(mode==="override"?{override_requested:true,override_reason:"Cliente já está aguardando"}:{destination_mode:"ALTERNATIVE_SLOT",time:"11:00",override_requested:false});
});

it("the original synthetic input never supplied the scripted cancellation cause",async()=>{
 const {groundSchedulingReasons,pendingSourceFields}=await import("../scheduling-literal-source");
 const original=`Cancele Amanda, coloque Fábio no lugar, altere Massagem e consulte ontem. Envie exatamente “${exact}”`;
 const patch={reason:"Pedido dela"};const result=groundSchedulingReasons(patch,{},original);
 expect(result.rejected).toEqual([{code:"SOURCE_REASON_CONFLICT",field:"reason",value:"Pedido dela"}]);expect(patch).toEqual({});expect(pendingSourceFields(undefined,result)).toEqual(["reason"]);
});
