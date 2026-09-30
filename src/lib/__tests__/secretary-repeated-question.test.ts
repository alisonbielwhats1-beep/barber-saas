import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** B6 repeated-question limit through the real plan path (decoder, ActionPlan, scheduling adapters, journal) with
 * recorded frames. Tenant lookups are fixtures; no DB, no network. V01: Fábio and Rodrigo are ready, Amanda's
 * cancellation waits for its reason. */
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
import { agendaFallbackNotice } from "../secretary-clarification-history";
import { ScriptedServicesModel, call, appendScriptedResponses } from "../../test/scripted-services-model";
import { V01_LUNA, V01_MESSAGE } from "../../test/secretary-v01-recorded";
import type { TurnOutcome } from "../secretary-router";

const actor = { salonId: "synthetic-salon", userId: "synthetic-owner" };
beforeEach(() => {
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
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const recorded = JSON.parse(V01_LUNA).turn.operations as Record<string, unknown>[];
const shape = (operation: string, fields: Record<string, unknown>) => ({ ...recorded.find(item => item.operation === operation)!,
  date: null, day_offset: null, weekday: null, time: null, end_time: null, reason: null, ...fields });
const pair = (value: unknown, literal: string) => ({ value, literal });
const v01 = { turn: { mode: "NEW", operations: [
  shape("appointment.change", { day_offset: pair(1, "amanhã"), time: pair("10:00", "às 10 horas") }), shape("appointment.cancel", {}),
  shape("schedule.block", { date: pair("2026-09-29", "dia 29"), time: pair("10:00", "das 10"), end_time: pair("11:00", "às 11") })] } };
/** Amanda's card reads the next answer (her question is the only pending one): an unknown key cannot be read. */
const unreadable = call("upsert_action_draft", { turn: { mode: "PATCH", operations: [{ item_key: "ghost", choice: null, fields: {} }] } });
type Session = { clarificationHistory?: Record<string, { count: number; fingerprint: string }> };
async function started() {
  const model = new ScriptedServicesModel([call("select_capabilities", v01)]);
  const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const session = await secretary.start(actor, "auto");
  const say = (message: string) => secretary.send(actor, { sessionId: session.sessionId, message });
  const parent = () => (secretary as unknown as { sessions: Map<string, Session> }).sessions.get(session.sessionId)!;
  const view = () => (secretary as unknown as { view: (s: unknown) => SecretaryView }).view(parent());
  return { model, secretary, sessionId: session.sessionId, say, parent, view, first: await say(V01_MESSAGE) };
}
const amanda = (view: SecretaryView) => view.clarifications?.find(item => item.action_key === "cancelar_amanda");
const approvals = (view: SecretaryView) => view.action_plan!.confirmation_groups.filter(group => group.status === "READY_FOR_CONFIRMATION")
  .map(group => ({ plan_ref: view.action_plan!.plan_ref, revision: view.action_plan!.revision, group_key: group.key, fingerprint: group.fingerprint }));
const outcomes = () => db.rows.filter(row => row.entityType === "SECRETARY_ROUTER").map(row => (row.metadata as { outcome: TurnOutcome }).outcome);
/** The request as sent (the routing context is JSON inside the system text). */
const contextOf = (request: unknown) => JSON.stringify(request).replace(/\\"/g, '"');

describe("B6 repeated question: counted once per user message", () => {
  it("attempt 1, 2, 3 across messages; never counted by view(); no options for a reason; the agenda form from the 3rd time", async () => {
    const r = await started();
    expect(r.first.clarifications).toEqual([{ action_key: "cancelar_amanda", field: "reason", attempt: 1 }]);
    const firstMessage = r.first.message;
    expect(firstMessage).not.toContain(agendaFallbackNotice);
    // Projecting the view any number of times never counts.
    for (let i = 0; i < 3; i++) expect(amanda(r.view())).toEqual({ action_key: "cancelar_amanda", field: "reason", attempt: 1 });
    expect(Object.values(r.parent().clarificationHistory!).map(entry => entry.count)).toEqual([1]);

    appendScriptedResponses(r.model, [unreadable]);
    const second = await r.say("é por causa da viagem");
    // Second time: a reason has no options (literal proof) and the reply text stays exactly the same.
    expect(amanda(second)).toEqual({ action_key: "cancelar_amanda", field: "reason", attempt: 2 });
    expect(second.message).toBe(unreadAnswerNotice);
    expect(contextOf(r.model.requests[1])).not.toContain("repeat_count");
    for (let i = 0; i < 3; i++) expect(amanda(r.view())!.attempt).toBe(2);

    // Confirming the other (ready) actions moves the plan, not Amanda's question.
    const done = await r.secretary.confirmReadyGroups(actor, r.sessionId, approvals(second));
    expect(done.action_plan!.actions.map(action => action.status)).toEqual(["DONE", "NEEDS_INPUT", "DONE"]);
    expect(amanda(done)!.attempt).toBe(2);

    appendScriptedResponses(r.model, [unreadable]);
    const third = await r.say("já falei, por causa da viagem");
    // Luna knows it is a repeated question (count shown so far) in the active plan's clarification.
    expect(contextOf(r.model.requests[2])).toContain('"repeat_count":2');
    const asked = amanda(third)!;
    expect(asked).toEqual({ action_key: "cancelar_amanda", field: "reason", attempt: 3, fallback: { href: "/agenda?appointment=a-amanda", label: "Abrir no formulário da agenda" } });
    expect(third.message).toBe(`${unreadAnswerNotice}\n\n${agendaFallbackNotice}`);
    // No names, phones or reasons in the link or the history.
    for (const text of ["Amanda", "Souza", "viagem"]) { expect(asked.fallback!.href).not.toContain(text); expect(JSON.stringify(r.parent().clarificationHistory)).not.toContain(text); }
    expect(outcomes().every(outcome => !JSON.stringify(outcome).includes("Amanda"))).toBe(true);
    // Nothing was confirmed for Amanda by any of this.
    expect(confirmed.refs).toHaveLength(2);
  });

  it("a message about another action keeps the count (no reset, no increment); casual talk is not an attempt", async () => {
    const r = await started();
    appendScriptedResponses(r.model, [unreadable]);
    expect(amanda(await r.say("hmm"))!.attempt).toBe(2);
    // A correction to Fábio (read by Amanda's card, routed as a plan PATCH) changes Fábio only.
    appendScriptedResponses(r.model, [call("upsert_action_draft", { turn: { mode: "PATCH", operations: [
      { item_key: "alterar_fabio", choice: null, fields: { time: pair("11:00", "às 11") } }] } })]);
    const corrected = await r.say("passa o Fábio para às 11");
    expect(corrected.action_plan!.actions.find(action => action.key === "alterar_fabio")!.fields).toMatchObject({ time: "11:00" });
    expect(corrected.action_plan!.revision).toBeGreaterThan(r.first.action_plan!.revision);
    expect(amanda(corrected)!.attempt).toBe(2);
    appendScriptedResponses(r.model, [call("upsert_action_draft", { turn: { mode: "CONVERSATION", response: "Tudo bem!" } })]);
    expect(amanda(await r.say("obrigado, tudo bem?"))!.attempt).toBe(2);
    appendScriptedResponses(r.model, [unreadable]);
    expect(amanda(await r.say("não sei"))!.attempt).toBe(3);
  });

  it("an answered question leaves the history and the view", async () => {
    const r = await started();
    appendScriptedResponses(r.model, [unreadable]);
    await r.say("hmm");
    appendScriptedResponses(r.model, [call("upsert_action_draft", { turn: { mode: "PATCH", operations: [
      { item_key: "cancelar_amanda", choice: null, fields: { reason: "ela viajou" } }] } })]);
    const answered = await r.say("ela viajou");
    expect(answered.action_plan!.actions.map(action => action.status)).toEqual(["READY_FOR_CONFIRMATION", "READY_FOR_CONFIRMATION", "READY_FOR_CONFIRMATION"]);
    expect(answered.clarifications).toBeUndefined();
    expect(r.parent().clarificationHistory).toEqual({});
  });

  it("a lost (thrown) message counts too; one sent to another action's card does not count this one", async () => {
    const r = await started();
    const secretary = r.secretary as unknown as { routerTrace: { getStore: () => { interpreted: (n: number) => void } }; sendActionPlanTurn: () => Promise<unknown>; failActionUnit: () => void };
    // An interpreted message whose preparation then fails and leaves the card as it was.
    const lose = () => { vi.spyOn(secretary, "sendActionPlanTurn").mockImplementationOnce(async () => { secretary.routerTrace.getStore().interpreted(1); throw Error("MODEL_TIMEOUT"); });
      vi.spyOn(secretary, "failActionUnit").mockImplementation(() => undefined); };
    lose();
    await expect(r.say("por causa da viagem")).rejects.toThrow("MODEL_TIMEOUT");
    expect(outcomes().at(-1)).toMatchObject({ kind: "LOST_TURN" });
    expect(amanda(r.view())!.attempt).toBe(2);
    lose();
    const fabio = r.first.operations!.find(operation => operation.action_keys?.includes("alterar_fabio"))!.operation_ref;
    await expect(r.secretary.send(actor, { sessionId: r.sessionId, message: "às 11", operation_ref: fabio })).rejects.toThrow("MODEL_TIMEOUT");
    expect(amanda(r.view())!.attempt).toBe(2);
    // Rejected before any interpretation (e.g. a busy session) is not a lost answer.
    vi.spyOn(secretary, "sendActionPlanTurn").mockImplementationOnce(async () => { throw Error("SESSION_BUSY"); });
    await expect(r.say("de novo")).rejects.toThrow("SESSION_BUSY");
    expect(amanda(r.view())!.attempt).toBe(2);
  });
});
