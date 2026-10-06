import { afterEach, beforeEach, expect, it, vi } from "vitest";
// Duplicate-service guard (owner, 04/10/2026; its own tests: secretary-existing-service.test.ts): these scenarios have no service
// catalog, so the guard passes the interpretation through and the flow is exactly the one this file covered before.
vi.mock("../secretary-existing-service", async original => ({ ...await original<object>(), withExistingServiceTargets: async (_actor: unknown, selection: unknown) => selection,
  existingServiceInterpretation: async (_actor: unknown, interpretation: unknown) => interpretation }));
const db = vi.hoisted(() => ({ role: "OWNER", auditLog: { create: vi.fn() }, $queryRaw: vi.fn(),
  upsert: vi.fn(), propose: vi.fn(), confirm: vi.fn(), drafts: new Map<string, Record<string, unknown>>() }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: object) => unknown) => fn(db) }));
vi.mock("../service-create-mvp", async original => ({ ...await original<object>(),
  upsertActionDraft: db.upsert, proposeServiceCreate: db.propose, confirmServiceCreate: db.confirm }));
import { SalonSecretary } from "../salon-secretary";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { intent, plan } from "../../test/secretary-capability-plan";
import { type ActionPlan } from "@everflair/salon-secretary";

/** B3 DISCARD at runtime (services adapters, offline): the owner gives up actions of the active plan.
 * Nothing is confirmed or executed; the rest of the plan stays confirmable; approvals go stale. */
const actor = { salonId: "synthetic-salon", userId: "synthetic-owner" };
const operations = (n: number) => Array.from({ length: n }, (_, i) => intent("service.create", { item_key: `a${i}`,
  name: `Serviço ${i}`, durationMin: 30, priceCents: 5000, depends_on: [] }));
const approvals = (p: ActionPlan) => p.confirmation_groups.filter(group => group.status === "READY_FOR_CONFIRMATION")
  .map(group => ({ plan_ref: p.plan_ref, revision: p.revision, group_key: group.key, fingerprint: group.fingerprint }));
const statuses = (p: ActionPlan) => Object.fromEntries(p.actions.map(action => [action.key, action.status]));
const sessions = (s: SalonSecretary) => (s as unknown as { sessions: Map<string, { cancelled: boolean; proposal?: unknown; actionPlan?: ActionPlan }> }).sessions;
const routerOutcomes = () => db.auditLog.create.mock.calls.map(([arg]) => arg.data).filter(data => data.entityType === "SECRETARY_ROUTER").map(data => data.metadata.outcome);
beforeEach(() => {
  vi.clearAllMocks(); db.drafts.clear(); db.role = "OWNER";
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); }));
  db.auditLog.create.mockResolvedValue({});
  db.$queryRaw.mockImplementation(async (query: readonly string[] | { sql?: string }) => {
    const sql = Array.isArray(query) ? query.join("") : (query as { sql?: string }).sql ?? "";
    if (sql.includes('"Membership"')) return [{ role: db.role }];
    return [{ accessStatus: "APPROVED", timezone: "America/Sao_Paulo", currency: "BRL" }];
  });
  db.upsert.mockImplementation(async (_tx, _actor, input) => {
    const draft_ref = input.draft_ref ?? crypto.randomUUID();
    const fields = { ...db.drafts.get(draft_ref), ...input.patch }; db.drafts.set(draft_ref, fields);
    const missing_fields = ["name", "priceCents", "durationMin"].filter(key => fields[key] === undefined);
    return { draft_ref, draft_revision: (input.expected_revision ?? 0) + 1, fields, status: missing_fields.length ? "NEEDS_INPUT" : "READY", missing_fields };
  });
  db.propose.mockImplementation(async (_tx, _actor, input) => ({ ...input, proposal_ref: crypto.randomUUID(), payload_hash: "backend-hash",
    preview: JSON.stringify(db.drafts.get(input.draft_ref)), expires_at: new Date(Date.now() + 60_000).toISOString() }));
  db.confirm.mockImplementation(async (_tx, _actor, input) => ({ receipt_ref: crypto.randomUUID(), proposal_ref: input.proposal_ref, service: { name: "Serviço", id: "domain-id" } }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function secretary(...outputs: unknown[]) {
  const model = new ScriptedServicesModel(outputs.map(output => call((output as { tool?: string }).tool ?? "select_capabilities", (output as { args?: unknown }).args ?? output)));
  return { s: new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true }), model };
}

it("Luna DISCARD of one of three: the other two stay confirmable, old approvals are stale, nothing executes", async () => {
  const { s, model } = secretary(plan(operations(3)), { turn: { mode: "DISCARD", item_keys: ["a1"] } });
  const session = await s.start(actor, "auto");
  const first = await s.send(actor, { sessionId: session.sessionId, message: "Cadastre os três serviços." });
  const discarded = await s.send(actor, { sessionId: session.sessionId, message: "Não, deixa o segundo. Esquece esse." });
  const p = discarded.action_plan!;
  expect(p.plan_ref).toBe(first.action_plan!.plan_ref);
  expect(statuses(p)).toEqual({ a0: "READY_FOR_CONFIRMATION", a1: "DISCARDED", a2: "READY_FOR_CONFIRMATION" });
  expect(p.confirmation_groups.flatMap(group => group.action_keys)).toEqual(["a0", "a2"]);
  expect(p.confirmation_groups.every(group => group.status === "READY_FOR_CONFIRMATION")).toBe(true);
  expect(discarded.message.startsWith("Certo, descartei o cadastro do serviço Serviço 1. Nada foi alterado.\n\n")).toBe(true);
  expect(discarded.capability_status).toBe("SUPPORTED");
  expect(discarded.operations!.map(op => op.action_keys)).toEqual([["a0"], ["a2"]]);
  const gone = first.operations![1].operation_ref;
  expect(sessions(s).get(gone)).toMatchObject({ cancelled: true, proposal: undefined });
  expect(db.confirm).not.toHaveBeenCalled(); expect(model.requests).toHaveLength(2);
  // CONFIRMATION_STALE: every approval issued before the discard is refused, even for kept actions.
  for (const approval of approvals(first.action_plan!)) await expect(s.confirmActionPlanGroup(actor, session.sessionId, approval)).rejects.toThrow("CONFIRMATION_STALE");
  await expect(s.confirmReadyGroups(actor, session.sessionId, approvals(first.action_plan!))).rejects.toThrow("CONFIRMATION_STALE");
  expect(db.confirm).not.toHaveBeenCalled();
  const done = await s.confirmReadyGroups(actor, session.sessionId, approvals(p));
  expect(statuses(done.action_plan!)).toEqual({ a0: "DONE", a1: "DISCARDED", a2: "DONE" });
  expect(done.action_plan!.status).toBe("DONE"); expect(db.confirm).toHaveBeenCalledTimes(2);
  // Codes-only outcome of the discard turn.
  expect(routerOutcomes()[1]).toMatchObject({ kind: "DISCARDED", discarded_actions: 1 });
  expect(JSON.stringify(routerOutcomes())).not.toContain("Serviço");
});

it("Luna DISCARD of the whole plan retires it (never suspended); the next request starts clean", async () => {
  const next = intent("service.create", { item_key: "novo", name: "Hidratação", durationMin: 40, priceCents: 8000, depends_on: [] });
  const { s, model } = secretary(plan(operations(2)), { turn: { mode: "DISCARD", item_keys: null } }, plan([next]));
  const session = await s.start(actor, "auto");
  const first = await s.send(actor, { sessionId: session.sessionId, message: "Cadastre os dois serviços." });
  const retired = await s.send(actor, { sessionId: session.sessionId, message: "não não pera deixa quieto não faz nada não" });
  expect(retired.action_plan).toBeUndefined(); expect(retired.operations).toBeUndefined(); expect(retired.suspended_plans).toBeUndefined();
  expect(retired.capability_status).toBeUndefined();
  expect(retired.message).toBe("Certo, descartei o cadastro do serviço Serviço 0 e o cadastro do serviço Serviço 1. Nada foi alterado.");
  for (const op of first.operations!) expect(sessions(s).get(op.operation_ref)!.cancelled).toBe(true);
  await expect(s.confirmReadyGroups(actor, session.sessionId, approvals(first.action_plan!))).rejects.toThrow();
  await expect(s.cancelAutomaticOperation(actor, session.sessionId, first.operations![0].operation_ref)).rejects.toThrow("OPERATION_NOT_IN_SESSION");
  const fresh = await s.send(actor, { sessionId: session.sessionId, message: "Agora cadastre a Hidratação." });
  expect(fresh.action_plan!.plan_ref).not.toBe(first.action_plan!.plan_ref);
  expect(fresh.action_plan!.actions.map(action => action.key)).toEqual(["novo"]);
  expect(fresh.suspended_plans).toBeUndefined(); expect(fresh.operations).toHaveLength(1);
  // The fresh request is interpreted without any routing context of the retired plan.
  expect(JSON.stringify(model.requests[2])).not.toContain(first.action_plan!.plan_ref);
  await expect(s.confirmReadyGroups(actor, session.sessionId, approvals(first.action_plan!))).rejects.toThrow("CONFIRMATION_STALE");
  expect(db.confirm).not.toHaveBeenCalled(); expect(model.requests).toHaveLength(3);
});

it("review 2b: a DISCARD repeating a key ('Não, deixa. Esquece isso.' → ['a0','a0']) is one discard, never an unread answer that leaves the plan pending", async () => {
  // One open unit: its own adapter reads the answer (upsert_action_draft), as in the real single-action plan.
  const { s } = secretary(plan(operations(1)), { tool: "upsert_action_draft", args: { turn: { mode: "DISCARD", item_keys: ["a0", "a0"] } } });
  const session = await s.start(actor, "auto");
  const first = await s.send(actor, { sessionId: session.sessionId, message: "Cadastre o serviço." });
  expect(first.action_plan!.status).toBe("READY_FOR_CONFIRMATION");
  const retired = await s.send(actor, { sessionId: session.sessionId, message: "Não, deixa. Esquece isso." });
  expect(retired.action_plan).toBeUndefined(); expect(retired.suspended_plans).toBeUndefined();
  expect(retired.message).toBe("Certo, descartei o cadastro do serviço Serviço 0. Nada foi alterado.");
  await expect(s.confirmReadyGroups(actor, session.sessionId, approvals(first.action_plan!))).rejects.toThrow();
  expect(db.confirm).not.toHaveBeenCalled();
});

it("review 2b: answering one card, DISCARD null discards only that card's unit; a key of another card discards nothing and holds the answered card for review", async () => {
  const { s } = secretary(plan(operations(3)), { tool: "upsert_action_draft", args: { turn: { mode: "DISCARD", item_keys: null } } },
    { tool: "upsert_action_draft", args: { turn: { mode: "DISCARD", item_keys: ["a0"] } } });
  const session = await s.start(actor, "auto");
  const first = await s.send(actor, { sessionId: session.sessionId, message: "Cadastre os três serviços." });
  const [, card1, card2] = first.operations!.map(op => op.operation_ref);
  const one = await s.send(actor, { sessionId: session.sessionId, operation_ref: card1, message: "esquece isso" });
  expect(statuses(one.action_plan!)).toEqual({ a0: "READY_FOR_CONFIRMATION", a1: "DISCARDED", a2: "READY_FOR_CONFIRMATION" });
  expect(one.message.startsWith("Certo, descartei o cadastro do serviço Serviço 1. Nada foi alterado.")).toBe(true);
  const other = await s.send(actor, { sessionId: session.sessionId, operation_ref: card2, message: "esquece isso" });
  expect(other.message).toBe("Não entendi essa parte; o pedido foi preservado. Pode repetir de outro jeito?"); expect(other.turn_notice_alone).toBe(true);
  expect(statuses(other.action_plan!)).toEqual({ a0: "READY_FOR_CONFIRMATION", a1: "DISCARDED", a2: "NEEDS_INPUT" });
  expect(other.action_plan!.actions[2].assessment.issue).toBe("REVIEW_REQUIRED");
  expect(other.action_plan!.confirmation_groups.filter(group => group.status === "READY_FOR_CONFIRMATION").flatMap(group => group.action_keys)).toEqual(["a0"]);
  expect(db.confirm).not.toHaveBeenCalled();
});

it("the card path discards (never FAILED_SAFE): siblings stay confirmable and the plan is not blocked", async () => {
  const { s } = secretary(plan(operations(2)));
  const session = await s.start(actor, "auto");
  const first = await s.send(actor, { sessionId: session.sessionId, message: "Cadastre os dois serviços." });
  const view = await s.cancelAutomaticOperation(actor, session.sessionId, first.operations![0].operation_ref);
  expect(statuses(view.action_plan!)).toEqual({ a0: "DISCARDED", a1: "READY_FOR_CONFIRMATION" });
  expect(view.action_plan!.actions[0].assessment).toEqual({ status: "DISCARDED", missing_fields: [], issue: "DISCARDED_BY_USER" });
  expect(view.action_plan!.status).toBe("READY_FOR_CONFIRMATION"); expect(view.capability_status).toBe("SUPPORTED");
  expect(view.message).not.toContain("não foi possível preparar");
  await expect(s.confirmActionPlanGroup(actor, session.sessionId, approvals(first.action_plan!)[1])).rejects.toThrow("CONFIRMATION_STALE");
  const done = await s.confirmReadyGroups(actor, session.sessionId, approvals(view.action_plan!));
  expect(statuses(done.action_plan!)).toEqual({ a0: "DISCARDED", a1: "DONE" }); expect(db.confirm).toHaveBeenCalledOnce();
});

it("the discard button is bound to the current plan, is idempotent and never reaches a completed action", async () => {
  const { s } = secretary(plan(operations(3)));
  const session = await s.start(actor, "auto");
  const first = await s.send(actor, { sessionId: session.sessionId, message: "Cadastre os três serviços." }), p = first.action_plan!;
  const revision = () => sessions(s).get(session.sessionId)!.actionPlan!.revision;
  await expect(s.discardAction(actor, session.sessionId, { plan_ref: crypto.randomUUID(), action_key: "a1" })).rejects.toThrow("PLAN_NOT_IN_SESSION");
  await expect(s.discardAction({ ...actor, salonId: "foreign" }, session.sessionId, { plan_ref: p.plan_ref, action_key: "a1" })).rejects.toThrow("SESSION_NOT_FOUND");
  await expect(s.discardAction(actor, session.sessionId, { plan_ref: p.plan_ref, action_key: "zz" })).rejects.toThrow("DISCARD_ACTION_MISMATCH");
  await expect(s.discardAction(actor, session.sessionId, { plan_ref: p.plan_ref, action_key: "a1", extra: true })).rejects.toThrow();
  expect(revision()).toBe(p.revision);
  const done = await s.confirmActionPlanGroup(actor, session.sessionId, approvals(p).find(approval => p.confirmation_groups.find(group => group.key === approval.group_key)!.action_keys.includes("a0"))!);
  expect(done.action_plan!.actions[0].status).toBe("DONE");
  const before = revision();
  await expect(s.discardAction(actor, session.sessionId, { plan_ref: p.plan_ref, action_key: "a0" })).rejects.toThrow("ALREADY_CONFIRMED");
  expect(revision()).toBe(before); expect(db.confirm).toHaveBeenCalledOnce();
  const view = await s.discardAction(actor, session.sessionId, { plan_ref: p.plan_ref, action_key: "a1" });
  expect(statuses(view.action_plan!)).toEqual({ a0: "DONE", a1: "DISCARDED", a2: "READY_FOR_CONFIRMATION" });
  expect(view.message.startsWith("Certo, descartei o cadastro do serviço Serviço 1. Nada foi alterado.")).toBe(true);
  const again = await s.discardAction(actor, session.sessionId, { plan_ref: p.plan_ref, action_key: "a1" });
  expect(again.action_plan!.revision).toBe(view.action_plan!.revision);
  // A discarded action's child is closed to answers, selections and a second withdrawal.
  const gone = first.operations![1].operation_ref;
  await expect(s.send(actor, { sessionId: session.sessionId, operation_ref: gone, message: "45 minutos" })).rejects.toThrow("OPERATION_NOT_IN_SESSION");
  await expect(s.selectAutomatic(actor, session.sessionId, gone, "private-ref")).rejects.toThrow("OPERATION_NOT_IN_SESSION");
  await expect(s.cancelAutomaticOperation(actor, session.sessionId, gone)).rejects.toThrow("OPERATION_NOT_IN_SESSION");
  expect(sessions(s).get(session.sessionId)!.actionPlan!.actions[1].status).toBe("DISCARDED");
  expect(db.confirm).toHaveBeenCalledOnce();
});

it("a plan left with completed and discarded actions only is retired by a new request, not suspended", async () => {
  const next = intent("service.create", { item_key: "novo", name: "Hidratação", durationMin: 40, priceCents: 8000, depends_on: [] });
  const { s, model } = secretary(plan(operations(2)), plan([next]));
  const session = await s.start(actor, "auto");
  const first = await s.send(actor, { sessionId: session.sessionId, message: "Cadastre os dois serviços." });
  const kept = await s.discardAction(actor, session.sessionId, { plan_ref: first.action_plan!.plan_ref, action_key: "a1" });
  const done = await s.confirmReadyGroups(actor, session.sessionId, approvals(kept.action_plan!));
  expect(statuses(done.action_plan!)).toEqual({ a0: "DONE", a1: "DISCARDED" });
  const fresh = await s.send(actor, { sessionId: session.sessionId, message: "Agora cadastre a Hidratação." });
  expect(fresh.action_plan!.plan_ref).not.toBe(first.action_plan!.plan_ref);
  expect(fresh.suspended_plans).toBeUndefined(); expect(model.requests).toHaveLength(2);
  // The routing context of that turn showed the discarded key as taken, never as open.
  const request = JSON.stringify(model.requests[1]);
  expect(request).toContain('\\"item_key\\":\\"a1\\",\\"status\\":\\"DISCARDED\\"');
});
