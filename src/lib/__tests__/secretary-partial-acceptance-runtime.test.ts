import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** B5 through the real plan path (decoder, ActionPlan, adapters, journal drafts/proposals) with recorded
 * frames. Tenant lookups are fixtures; no DB, no network; only the last test confirms (fresh approvals). */
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[] }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, filter: { query?: string }) => /rodrigo/i.test(filter.query ?? "") ? [{ id: "pro-rodrigo", name: "Rodrigo Lima" }] : [],
  getSchedulingAppointment: async (_tx: unknown, _actor: unknown, ref: string) => ({ appointment_ref: ref, start_local: ref === "a-fabio" ? "2026-09-30T16:00" : "2026-10-01T11:00" }) }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, name: string) => /f[aá]bio/i.test(name) ? [{ id: "c-fabio", name: "Fábio Santos" }] : /amanda/i.test(name) ? [{ id: "c-amanda", name: "Amanda Souza" }] : [] }));
const confirmed = vi.hoisted(() => ({ refs: [] as string[] }));
vi.mock("../scheduling-actions", async importOriginal => ({ ...await importOriginal<object>(),
  confirmAppointmentCreate: async (_tx: unknown, _actor: unknown, input: { proposal_ref: string; draft_revision: number }) => {
    confirmed.refs.push(input.proposal_ref);
    return { proposal_ref: input.proposal_ref, draft_ref: "synthetic-draft", draft_revision: input.draft_revision, outcome: "CONFIRMED", appointment_ref: "synthetic-appointment" };
  } }));
vi.mock("../scheduling-mutations", async importOriginal => {
  const original = await importOriginal<typeof import("../scheduling-mutations")>();
  const plusHour = (time: string) => `${String(Number(time.slice(0, 2)) + 1).padStart(2, "0")}${time.slice(2)}`;
  const base = { timezone: "America/Sao_Paulo", services: [], resource_ids: [], waiting_count: 0, waiting_hash: "", requires_acceptance: false, affected: [] };
  return { ...original, authorizeSchedulingOperation: async () => "OWNER",
    locateSchedulingAppointments: async (_tx: unknown, _actor: unknown, f: { customer_ref?: string }) => f.customer_ref === "c-fabio" ? [{ appointment_ref: "a-fabio" }] : f.customer_ref === "c-amanda" ? [{ appointment_ref: "a-amanda" }] : [],
    inspectSchedulingMove: async () => ({ result: {}, alternatives: [] }),
    schedulingActionSnapshot: async (_tx: unknown, _actor: unknown, operation: string, f: Record<string, string>) => original.actionSnapshot.parse(operation === "schedule.block"
      ? { ...base, kind: operation, professional_ref: "pro-rodrigo", professional_name: "Rodrigo Lima", startLocal: `${f.date}T${f.time}`, endLocal: `${f.end_date ?? f.date}T${f.end_time}` }
      : operation === "appointment.change"
        ? { ...base, kind: operation, appointment_ref: "a-fabio", revision: 1, customer_ref: "c-fabio", customer_name: "Fábio Santos", professional_ref: "pro-tatiana", professional_name: "Tatiana Rocha",
          before_start: "2026-09-30T16:00", before_end: "2026-09-30T17:00", before_timezone: "America/Sao_Paulo", startLocal: `${f.date}T${f.time}`, endLocal: `${f.date}T${plusHour(f.time)}`, priceCents: 8000 }
        : { ...base, kind: operation, appointment_ref: "a-amanda", revision: 1, customer_ref: "c-amanda", customer_name: "Amanda Souza", professional_ref: "pro-tatiana", professional_name: "Tatiana Rocha",
          before_start: "2026-10-01T11:00", before_end: "2026-10-01T12:00", before_timezone: "America/Sao_Paulo", startLocal: "2026-10-01T11:00", endLocal: "2026-10-01T12:00", priceCents: 9000 }) };
});
import { SalonSecretary, unreadAnswerNotice, type SecretaryView } from "../salon-secretary";
import { applySchedulingInterpretation, schedulingState, unprovenServiceQuestion } from "../secretary-scheduling";
import { ScriptedServicesModel, call, appendScriptedResponses } from "../../test/scripted-services-model";
import { V01_LUNA, V01_MESSAGE } from "../../test/secretary-v01-recorded";
import type { TurnOutcome } from "../secretary-router";

const actor = { salonId: "synthetic-salon", userId: "synthetic-owner" };
beforeEach(() => {
  // Monday 2026-09-28 12:00 in São Paulo: amanhã = dia 29.
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-28T15:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  db.rows = []; confirmed.refs = [];
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(row); return row; }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null),
  } } as unknown as Tx;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const outcomes = () => db.rows.filter(row => row.entityType === "SECRETARY_ROUTER").map(row => (row.metadata as { outcome: TurnOutcome }).outcome);
async function run(raw: string, message: string) {
  const model = new ScriptedServicesModel([call("select_capabilities", JSON.parse(raw))]);
  const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const session = await secretary.start(actor, "auto");
  const view = await secretary.send(actor, { sessionId: session.sessionId, message });
  expect(model.requests).toHaveLength(1);
  return { view, model, secretary, sessionId: session.sessionId, ...lookups(view) };
}
function lookups(view: SecretaryView) {
  return { action: (key: string) => view.action_plan!.actions.find(item => item.key === key),
    child: (key: string) => view.operations!.find(item => item.action_keys?.includes(key))!.state as SecretaryView };
}
const recorded = JSON.parse(V01_LUNA).turn.operations as Record<string, unknown>[];
const shape = (operation: string, fields: Record<string, unknown>) => ({ ...recorded.find(item => item.operation === operation)!,
  date: null, day_offset: null, weekday: null, time: null, end_time: null, reason: null, ...fields });
const pair = (value: unknown, literal: string) => ({ value, literal });
const turn = (...operations: Record<string, unknown>[]) => JSON.stringify({ turn: { mode: "NEW", operations } });
const change = (fields: Record<string, unknown> = {}) => shape("appointment.change", { day_offset: pair(1, "amanhã"), time: pair("10:00", "às 10 horas"), ...fields });
const cancel = (fields: Record<string, unknown> = {}) => shape("appointment.cancel", fields);
const block = (fields: Record<string, unknown> = {}) => shape("schedule.block", { date: pair("2026-09-29", "dia 29"), time: pair("10:00", "das 10"), end_time: pair("11:00", "às 11"), ...fields });

describe("B5 partial acceptance: one bad operation never loses the rest of the turn", () => {
  it("3 operations with one invalid: the other 2 are prepared and the reply says which part was left out", async () => {
    // An invalid capability field on Amanda's cancel (CAPABILITY_FIELD_MISMATCH) used to reject all three.
    const r = await run(turn(change(), cancel({ name: "Amanda" }), block()), V01_MESSAGE);
    expect(r.view.action_plan!.actions.map(action => [action.key, action.status])).toEqual([["alterar_fabio", "READY_FOR_CONFIRMATION"], ["bloquear_rodrigo", "READY_FOR_CONFIRMATION"]]);
    const notice = "Não entendi com segurança esta parte do pedido e a deixei de fora: “cancele o horário da Amanda”. Pode repetir essa parte de outro jeito?";
    expect(r.view.turn_notice).toBe(notice); expect(r.view.message.startsWith(`${notice}\n\n`)).toBe(true);
    expect(r.view.message).toContain("Confira os detalhes antes de confirmar.");
    expect(outcomes()[0]).toMatchObject({ kind: "PROPOSAL_READY", rejected_operations: 1 });
    expect(outcomes()[0].divergence.failed_codes).toContain("CAPABILITY_FIELD_MISMATCH");
    expect(JSON.stringify(outcomes()[0])).not.toContain("Amanda");
    expect(db.rows.some(row => row.action === "CONFIRMED")).toBe(false);
  });
  it("the dependent of an invalid operation is dropped with it and named; the independent block proceeds", async () => {
    const message = "cancele o horário da Amanda e coloque a Carla no lugar dela, e feche a agenda do profissional Rodrigo das 10 às 11 do dia 29";
    const create = { ...shape("appointment.change", {}), operation: "appointment.create", item_key: "colocar_carla", customer_name: "Carla", depends_on: ["cancelar_amanda"],
      released_slot_of: "cancelar_amanda", source_scope: "coloque a Carla no lugar dela" };
    const r = await run(turn(cancel({ name: "Amanda" }), create, block()), message);
    expect(r.view.action_plan!.actions.map(action => [action.key, action.status])).toEqual([["bloquear_rodrigo", "READY_FOR_CONFIRMATION"]]);
    expect(r.view.turn_notice).toBe("Não entendi com segurança esta parte do pedido e a deixei de fora: “cancele o horário da Amanda”. " +
      "Também deixei de fora “coloque a Carla no lugar dela”, que dependia dela. Pode repetir essas partes de outro jeito?");
    expect(outcomes()[0]).toMatchObject({ rejected_operations: 2 });
    expect(outcomes()[0].divergence.failed_codes).toEqual(expect.arrayContaining(["CAPABILITY_FIELD_MISMATCH", "DEPENDENT_OF_REJECTED"]));
  });
  // Review 2b contract migration: a left-out correction of an EXISTING action no longer leaves that action's old
  // proposal confirmable (it was READY_FOR_CONFIRMATION here, under a notice saying it was "left out"). It is held
  // for review (proposal withdrawn, draft kept) and the notice says the requested change was not applied.
  it("a correction left out of a PATCH is not applied: its action is held for review, never confirmable, while the other correction applies", async () => {
    const corrected = turn(change(), cancel(), block());
    const r = await run(corrected, V01_MESSAGE);
    expect(r.action("cancelar_amanda")).toMatchObject({ status: "NEEDS_INPUT", missing_fields: ["reason"] });
    const fabioDraft = r.child("alterar_fabio").scheduling!.draft!;
    appendScriptedResponses(r.model, [call("upsert_action_draft", { turn: { mode: "PATCH", operations: [
      { item_key: "cancelar_amanda", choice: null, fields: { operation: null, reason: "ela viajou" } },
      { item_key: "alterar_fabio", choice: null, fields: { operation: "appointment.cancel", reason: null } }] } })]);
    // Only Amanda's reason is pending: her card's adapter reads the answer, which routes as a plan PATCH.
    const next = await r.secretary.send(actor, { sessionId: r.sessionId, message: "O motivo da Amanda é que ela viajou e cancela o Fábio" });
    const { action, child } = lookups(next);
    expect(action("cancelar_amanda")!.status).toBe("READY_FOR_CONFIRMATION");
    expect(action("alterar_fabio")).toMatchObject({ status: "NEEDS_INPUT", missing_fields: [], assessment: { issue: "REVIEW_REQUIRED" } });
    // The targeted action is in no confirmable group; its accepted draft is kept (nothing was changed or executed).
    const ready = next.action_plan!.confirmation_groups.filter(group => group.status === "READY_FOR_CONFIRMATION").flatMap(group => group.action_keys);
    expect(ready).not.toContain("alterar_fabio"); expect(ready).toContain("cancelar_amanda");
    expect(child("alterar_fabio").scheduling!.proposal).toBeUndefined(); expect(child("alterar_fabio").scheduling!.draft).toEqual(fabioDraft);
    expect(next.turn_notice).toBe("Não apliquei a alteração que você pediu para a remarcação de Fábio; esse item continua como estava e precisa ser revisto antes de confirmar. Pode repetir essa parte de outro jeito?");
    expect(next.turn_notice).not.toContain("deixei de fora");
    expect(outcomes()[1]).toMatchObject({ rejected_operations: 1 }); expect(outcomes()[1].divergence.failed_codes).toContain("CONTINUATION_ACTION_MISMATCH");
    // "Confirmar tudo que está pronto" executes only Amanda's cancellation; Fábio's old reschedule is never reached.
    const approvals = next.action_plan!.confirmation_groups.filter(group => group.status === "READY_FOR_CONFIRMATION")
      .map(group => ({ plan_ref: next.action_plan!.plan_ref, revision: next.action_plan!.revision, group_key: group.key, fingerprint: group.fingerprint }));
    const done = await r.secretary.confirmReadyGroups(actor, r.sessionId, approvals);
    expect(done.action_plan!.actions.find(item => item.key === "alterar_fabio")!.status).toBe("NEEDS_INPUT");
    expect(confirmed.refs).not.toContain(r.child("alterar_fabio").scheduling!.proposal!.proposal_ref);
  });
});

describe("B5 TEMPORAL_SELECTOR_CONFLICT: only the contradicted role is asked", () => {
  it.each(["false", "true"])("components flag %s: Fábio's contradictory day is asked; his clock and the other actions are kept", async flag => {
    vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", flag);
    const message = "altere o horário do Fábio para amanhã, na quinta, às 10 horas, cancele o horário da Amanda e feche a agenda do profissional Rodrigo das 10 às 11 do dia 29";
    const r = await run(turn(change({ source_scope: "altere o horário do Fábio para amanhã, na quinta, às 10 horas", weekday: pair(4, "na quinta") }), cancel(), block()), message);
    expect(r.action("alterar_fabio")).toMatchObject({ status: "NEEDS_INPUT" }); expect(r.action("alterar_fabio")!.missing_fields).toContain("date");
    const fabio = r.child("alterar_fabio").scheduling!;
    expect(fabio.proposal).toBeUndefined(); expect(fabio.fields.date).toBeUndefined(); expect(fabio.waiting_for).toBe("date");
    expect(fabio.message).toBe("Recebi indicações diferentes para a mesma data ou horário e não escolhi nenhuma. Preciso confirmar data de destino. Pode informar?");
    expect(fabio.draft!.temporal_missing).toContain("date");
    expect(r.view.message).toContain("Para qual dia devo passar Fábio?");
    expect(r.action("bloquear_rodrigo")!.status).toBe("READY_FOR_CONFIRMATION");
    expect(r.action("cancelar_amanda")).toMatchObject({ status: "NEEDS_INPUT", missing_fields: ["reason"] });
    expect(outcomes()[0].divergence.failed_codes).toContain("TEMPORAL_SELECTOR_CONFLICT");
    const drafts = db.rows.filter(row => row.entityType === "SECRETARY_SCHEDULING" && JSON.stringify(row.metadata).includes("SELECTOR_CONFLICT"));
    expect(drafts.length).toBeGreaterThan(0);
  });
  it("components flag on: a component contradicting the legacy quote of its role is asked the same way", async () => {
    vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", "true");
    const message = "altere o horário do Fábio para amanhã, na quinta, às 10 horas, cancele o horário da Amanda e feche a agenda do profissional Rodrigo das 10 às 11 do dia 29";
    const day = { kind: "WEEKDAY", offset: null, weekday: 4, week: null, day: null, month: null, year: null, days: null };
    const empty = { date: null, source_date: null, end_date: null, time: null, source_time: null, end_time: null };
    const r = await run(turn(change({ source_scope: "altere o horário do Fábio para amanhã, na quinta, às 10 horas", components: { ...empty, date: { value: day, literal: "na quinta" } } }), cancel(), block()), message);
    expect(r.child("alterar_fabio").scheduling!.waiting_for).toBe("date");
    expect(r.child("alterar_fabio").scheduling!.proposal).toBeUndefined();
    expect(r.action("bloquear_rodrigo")!.status).toBe("READY_FOR_CONFIRMATION");
  });
});

describe("B5 ENTITY_MENTION_CONFLICT on the service: only the service is asked", () => {
  it("create: an unproven service is asked; customer, day and clock are kept; nothing is proposed", async () => {
    const message = "Marca a Amanda amanhã às 10h para coloração";
    const op = { ...shape("appointment.change", {}), operation: "appointment.create", item_key: "marcar_amanda", source_scope: null, customer_name: "Amanda", service_name: "Progressiva",
      day_offset: pair(1, "amanhã"), time: pair("10:00", "às 10h") };
    const r = await run(turn(op), message);
    const amanda = r.child("marcar_amanda").scheduling!;
    expect(amanda.message).toBe(unprovenServiceQuestion); expect(amanda.waiting_for).toBe("service_name"); expect(amanda.proposal).toBeUndefined();
    expect(amanda.fields).toMatchObject({ customer_name: "Amanda", customer_ref: "c-amanda", date: "2026-09-29", time: "10:00" });
    expect(amanda.fields.service_name).toBeUndefined(); expect(amanda.fields.service_ref).toBeUndefined();
    expect(r.action("marcar_amanda")).toMatchObject({ status: "NEEDS_INPUT" });
    // B7: once resolved, the question names the customer as registered (backup: contract-migration/secretary-partial-acceptance-runtime.test.before-b7.ts).
    expect(r.view.message).toBe("Não consegui confirmar o serviço na sua mensagem.\n\nQual serviço Amanda Souza vai fazer?");
    expect(outcomes()[0].divergence.failed_codes).toContain("ENTITY_MENTION_CONFLICT");
  });
  it("change: an unproven service locator is asked instead of locating or proposing; the new day and clock are kept", async () => {
    const message = "Remarca o corte do Fábio para amanhã às 10 horas";
    const r = await run(turn(change({ source_scope: null, service_name: "Corte Masculino" })), message);
    const fabio = r.child("alterar_fabio").scheduling!;
    expect(fabio.waiting_for).toBe("service_name"); expect(fabio.proposal).toBeUndefined(); expect(fabio.fields.appointment_ref).toBeUndefined();
    expect(fabio.fields).toMatchObject({ customer_name: "Fábio", date: "2026-09-29", time: "10:00" });
    expect(r.view.message).toContain("Qual é o serviço do agendamento de Fábio Santos?");
  });
  it("the isolated adapter API keeps refusing the whole patch (validator pinned; no option given)", async () => {
    const state = { ...schedulingState(), operation: "appointment.create" as const, fields: { customer_name: "Amanda" } };
    await expect(applySchedulingInterpretation(actor, state, { service_name: "Progressiva" }, "Marca a Amanda para coloração")).rejects.toThrow("ENTITY_MENTION_CONFLICT");
  });
});

describe("B5 continuation whose answer cannot be read keeps the plan", () => {
  it("single pending action: nothing fails, proposals stay behind a new revision, old approvals are stale, fresh ones work", async () => {
    const r = await run(turn(change(), cancel(), block()), V01_MESSAGE);
    const before = r.view.action_plan!, refs = ["alterar_fabio", "bloquear_rodrigo"].map(key => r.child(key).scheduling!.proposal!.proposal_ref);
    const old = before.confirmation_groups.filter(group => group.status === "READY_FOR_CONFIRMATION")
      .map(group => ({ plan_ref: before.plan_ref, revision: before.revision, group_key: group.key, fingerprint: group.fingerprint }));
    // Amanda's reason is the only pending question: her card's adapter reads the next answer (unknown key).
    appendScriptedResponses(r.model, [call("upsert_action_draft", { turn: { mode: "PATCH", operations: [{ item_key: "ghost", choice: null, fields: {} }] } })]);
    const kept = await r.secretary.send(actor, { sessionId: r.sessionId, message: "é por causa da viagem" });
    expect(kept.message).toBe(unreadAnswerNotice); expect(kept.turn_notice).toBe(unreadAnswerNotice);
    expect(kept.action_plan!.plan_ref).toBe(before.plan_ref); expect(kept.action_plan!.revision).toBeGreaterThan(before.revision);
    expect(kept.action_plan!.actions.map(action => action.status)).toEqual(before.actions.map(action => action.status));
    const { child } = lookups(kept);
    expect(["alterar_fabio", "bloquear_rodrigo"].map(key => child(key).scheduling!.proposal!.proposal_ref)).toEqual(refs);
    expect(outcomes()[1]).toMatchObject({ kind: "NOT_UNDERSTOOD", error_code: null });
    expect(outcomes()[1].divergence.failed_codes).toContain("CONTINUATION_ACTION_MISMATCH");
    await expect(r.secretary.confirmReadyGroups(actor, r.sessionId, old)).rejects.toThrow("CONFIRMATION_STALE");
    expect(confirmed.refs).toEqual([]);
    const plan = kept.action_plan!, fresh = plan.confirmation_groups.filter(group => group.status === "READY_FOR_CONFIRMATION")
      .map(group => ({ plan_ref: plan.plan_ref, revision: plan.revision, group_key: group.key, fingerprint: group.fingerprint }));
    const done = await r.secretary.confirmReadyGroups(actor, r.sessionId, fresh);
    expect(confirmed.refs).toEqual(refs);
    expect(done.action_plan!.actions.map(action => [action.key, action.status])).toEqual([["alterar_fabio", "DONE"], ["cancelar_amanda", "NEEDS_INPUT"], ["bloquear_rodrigo", "DONE"]]);
    // The notice belonged to that one reply only.
    expect(done.turn_notice).toBeUndefined(); expect(done.message).toBe("Qual o motivo do cancelamento?");
  });
  it("several pending actions (combined continuation): an unreadable envelope fails nothing", async () => {
    const r = await run(V01_LUNA, V01_MESSAGE);
    const before = r.view.action_plan!;
    expect(before.actions.map(action => action.status)).toEqual(["NEEDS_INPUT", "NEEDS_INPUT", "READY_FOR_CONFIRMATION"]);
    appendScriptedResponses(r.model, [call("select_capabilities", { turn: { mode: "PATCH", operations: [] } })]);
    const kept = await r.secretary.send(actor, { sessionId: r.sessionId, message: "amanhã e ela viajou" });
    expect(kept.message).toBe(unreadAnswerNotice);
    expect(kept.action_plan!.actions.map(action => [action.status, action.assessment.issue])).toEqual(before.actions.map(action => [action.status, action.assessment.issue]));
    expect(kept.action_plan!.actions.some(action => action.status === "FAILED_SAFE")).toBe(false);
    expect(lookups(kept).child("bloquear_rodrigo").scheduling!.proposal).toBeDefined();
    expect(outcomes()[1].kind).toBe("NOT_UNDERSTOOD");
  });
  it("review 2b: an unreadable answer addressed to the only ready unit holds it for review: no fresh approval, only the notice", async () => {
    const r = await run(turn(change()), "altere o horário do Fábio para amanhã às 10 horas");
    expect(r.action("alterar_fabio")!.status).toBe("READY_FOR_CONFIRMATION");
    const old = r.view.action_plan!, draft = r.child("alterar_fabio").scheduling!.draft;
    appendScriptedResponses(r.model, [call("upsert_action_draft", { turn: { mode: "PATCH", operations: [{ item_key: "ghost", choice: null, fields: {} }] } })]);
    const held = await r.secretary.send(actor, { sessionId: r.sessionId, message: "não, na verdade às 11" });
    expect(held.message).toBe(unreadAnswerNotice); expect(held.turn_notice_alone).toBe(true);
    const { action, child } = lookups(held);
    expect(action("alterar_fabio")).toMatchObject({ status: "NEEDS_INPUT", assessment: { issue: "REVIEW_REQUIRED" } });
    expect(child("alterar_fabio").scheduling!.proposal).toBeUndefined(); expect(child("alterar_fabio").scheduling!.draft).toEqual(draft);
    expect(held.action_plan!.confirmation_groups.some(group => group.status === "READY_FOR_CONFIRMATION")).toBe(false);
    const stale = old.confirmation_groups.map(group => ({ plan_ref: old.plan_ref, revision: old.revision, group_key: group.key, fingerprint: group.fingerprint }));
    await expect(r.secretary.confirmReadyGroups(actor, r.sessionId, stale)).rejects.toThrow("CONFIRMATION_STALE");
    const plan = held.action_plan!, fresh = plan.confirmation_groups.map(group => ({ plan_ref: plan.plan_ref, revision: plan.revision, group_key: group.key, fingerprint: group.fingerprint }));
    await expect(r.secretary.confirmActionPlanGroup(actor, r.sessionId, fresh[0])).rejects.toThrow();
    expect(confirmed.refs).toEqual([]);
    expect(outcomes()[1].kind).toBe("NOT_UNDERSTOOD");
  });
  it("without a plan an unreadable first answer is still a lost turn (nothing to keep)", async () => {
    const model = new ScriptedServicesModel([call("select_capabilities", { turn: { mode: "NEW", operations: [] } })]);
    const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
    const session = await secretary.start(actor, "auto");
    await expect(secretary.send(actor, { sessionId: session.sessionId, message: "Remarca o Fábio" })).rejects.toThrow();
    expect(outcomes()[0].kind).toBe("LOST_TURN");
  });
});
