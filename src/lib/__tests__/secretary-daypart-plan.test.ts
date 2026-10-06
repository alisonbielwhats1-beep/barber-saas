import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** Candidate 4, track R2 through the real multi-action plan path (decoder, ActionPlan, adapters, presentation, journal) with
 * scripted component frames: the C1 excerpt shape ("passa X pras 2 e Y pras 3") answered with 24h clocks is absorbed, each
 * action is settled by ITS professional's hours, the open half-day readings are click options from the first ask (a click is
 * a deterministic short answer: zero model calls, stale screens refused), and an answer not applied is said in the plan.
 * Fixtures only (an esmalteria with one full-day and one morning-only professional, and a 24h spa); no DB, no network. */
type Appt = { id: string; customer_ref: string; customer_name: string; professional_ref: string; start_local: string };
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[], appointments: [] as Appt[],
  hours: [] as { salonId: string; professionalId: string; weekday: number; startMinutes: number; endMinutes: number }[] }));
const pros: Record<string, string> = { "p-jade": "Jade Moura", "p-nando": "Nando Alves" };
const utc = (local: string) => new Date(Date.parse(`${local}:00Z`) + 3 * 3600_000);
const dto = (a: Appt) => ({ appointment_ref: a.id, customer_ref: a.customer_ref, customer_name: a.customer_name, professional_ref: a.professional_ref, professional_name: pros[a.professional_ref],
  service_ref: "s-pe", services: [], start_at: utc(a.start_local).toISOString(), end_at: new Date(utc(a.start_local).getTime() + 3600_000).toISOString(), start_local: a.start_local,
  end_local: a.start_local, timezone: "America/Sao_Paulo", status: "CONFIRMED", revision: 1, priceCents: 6000 });
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, filter: { query?: string }) => Object.entries(pros).filter(([, name]) => !filter.query || name.toLowerCase().includes(filter.query.toLowerCase())).map(([id, name]) => ({ id, name })),
  listSchedulingAppointments: async (_tx: unknown, _actor: unknown, input: { date: string; customer_ref?: string }) => db.appointments.filter(a => a.start_local.startsWith(input.date) && (!input.customer_ref || a.customer_ref === input.customer_ref)).map(dto),
  getSchedulingAppointment: async (_tx: unknown, _actor: unknown, ref: string) => { const a = db.appointments.find(row => row.id === ref); if (!a) throw Error("NOT_FOUND"); return dto(a); },
  getSchedulingAvailability: async () => ({ timezone: "America/Sao_Paulo", plan: null, quote: null, alternatives: [], as_of: new Date().toISOString() }) }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, name: string) => [...new Map(db.appointments.map(a => [a.customer_ref, a])).values()]
    .filter(a => a.customer_name.toLowerCase().includes(name.toLowerCase())).map(a => ({ id: a.customer_ref, name: a.customer_name, phone: null })) }));
vi.mock("../scheduling-entity-mentions", () => ({ validateSchedulingEntityMentions: async () => undefined }));
vi.mock("../scheduling-mutations", async importOriginal => {
  const original = await importOriginal<typeof import("../scheduling-mutations")>();
  const base = { timezone: "America/Sao_Paulo", services: [], resource_ids: [], waiting_count: 0, waiting_hash: "", requires_acceptance: false, affected: [] };
  return { ...original, authorizeSchedulingOperation: async () => "OWNER", inspectSchedulingMove: async () => ({ result: {}, alternatives: [] }),
    schedulingActionSnapshot: async (_tx: unknown, _actor: unknown, operation: string, f: Record<string, string>) => {
      const a = db.appointments.find(row => row.id === f.appointment_ref)!;
      return original.actionSnapshot.parse({ ...base, kind: operation, appointment_ref: a.id, revision: 1, customer_ref: a.customer_ref, customer_name: a.customer_name, professional_ref: a.professional_ref,
        professional_name: pros[a.professional_ref], before_start: a.start_local, before_end: a.start_local, before_timezone: "America/Sao_Paulo", startLocal: `${f.date}T${f.time}`, endLocal: `${f.date}T${f.time}`, priceCents: 6000 });
    } };
});
import { SalonSecretary, type SecretaryView } from "../salon-secretary";
import { ScriptedServicesModel, call, appendScriptedResponses } from "../../test/scripted-services-model";
import { daypartChoiceRetry } from "../scheduling-temporal-ambiguity";
import { secretaryFastPath } from "../secretary-fast-path";

const actor = { salonId: "esmalteria-aurora", userId: "dona-aurora" };
const hoursOf = (professionalId: string, from: number, to: number) => [2, 3, 4].map(weekday => ({ salonId: actor.salonId, professionalId, weekday, startMinutes: from * 60, endMinutes: to * 60 }));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-29T15:00:00Z")); // Tuesday, 12h in São Paulo
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", "true");
  db.rows = []; db.hours = [...hoursOf("p-jade", 8, 20), ...hoursOf("p-nando", 8, 12)];
  db.appointments = [{ id: "a-maria", customer_ref: "c-maria", customer_name: "Maria Eduarda Lopes", professional_ref: "p-jade", start_local: "2026-09-30T10:00" },
    { id: "a-kevin", customer_ref: "c-kevin", customer_name: "Kevin Sato", professional_ref: "p-jade", start_local: "2026-09-30T11:00" }];
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), membership: { findFirstOrThrow: async () => ({ role: "OWNER" }) },
    workingHours: { findFirst: async ({ where }: { where: { salonId: string } }) => db.hours.find(row => row.salonId === where.salonId) ?? null,
      findMany: async ({ where }: { where: { salonId: string; professionalId: { in: string[] }; weekday: number } }) => db.hours.filter(row => row.salonId === where.salonId && where.professionalId.in.includes(row.professionalId) && row.weekday === where.weekday) },
    professionalOpening: { findMany: async () => [] }, salonClosure: { findMany: async () => [] }, timeOff: { findMany: async () => [] },
    appointment: { findMany: async ({ where }: { where: { clientId?: string; startAt: { gt: Date } } }) => db.appointments.filter(a => (!where.clientId || a.customer_ref === where.clientId) && utc(a.start_local) > where.startAt.gt).map(a => ({ id: a.id })) },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(row); return row; }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null) } } as unknown as Tx;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); expect(db.rows.some(row => row.action === "CONFIRMED")).toBe(false); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const flags = (hours: boolean, v2: boolean) => { vi.stubEnv("SALON_SECRETARY_DAYPART_BY_HOURS", hours ? "true" : "false"); vi.stubEnv("SALON_SECRETARY_DAYPART_RULES_V2", v2 ? "true" : "false"); };

const day = (value: Record<string, unknown>) => ({ offset: null, weekday: null, week: null, day: null, month: null, year: null, days: null, ...value });
const clock = (hour: number, minute = 0, daypart = "UNSPECIFIED") => ({ hour, minute, daypart });
const none = { date: null, source_date: null, end_date: null, time: null, source_time: null, end_time: null };
const legacyNulls = { date: null, day_offset: null, weekday: null, time: null, period: null, source_date: null, source_day_offset: null, source_weekday: null, source_time: null, end_time: null, end_date: null };
const op = (operation: string, item_key: string, source_scope: string, fields: Record<string, unknown>, components: Record<string, unknown>) => ({
  operation, item_key, depends_on: null, released_slot_of: null, source_scope, customer_name: null, service_name: null, professional_name: null, reason: null,
  ...legacyNulls, ...fields, components: { ...none, ...components } });
/** A plan with several open actions is answered through the capability router; a single open action through its draft tool. */
const patch = (items: [string, Record<string, unknown>][], tool = "upsert_action_draft") =>
  call(tool, { turn: { mode: "PATCH", operations: items.map(([item_key, components]) => ({ item_key, choice: null, fields: { components: { ...none, ...components } } })) } });
async function session(first: unknown) {
  const model = new ScriptedServicesModel([call("select_capabilities", first)]);
  const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const started = await secretary.start(actor, "auto");
  return { model, secretary, sessionId: started.sessionId, say: (message: string) => secretary.send(actor, { sessionId: started.sessionId, message }) };
}
const status = (view: SecretaryView, key: string) => view.action_plan!.actions.find(action => action.key === key)!.status;
const child = (view: SecretaryView, index = 0) => view.operations![index].state;

const TWO = "passa a Maria Eduarda pras 2 e o Kevin pras 3, os dois com a Jade";
const twoMoves = { turn: { mode: "NEW", operations: [
  op("appointment.change", "maria", "passa a Maria Eduarda pras 2", { customer_name: "Maria Eduarda", professional_name: "Jade" }, { time: { value: clock(2), literal: "pras 2" } }),
  op("appointment.change", "kevin", "o Kevin pras 3", { customer_name: "Kevin", professional_name: "Jade" }, { time: { value: clock(3), literal: "pras 3" } })] } };
const answer = patch([["maria", { time: { value: clock(2, 0, "TARDE"), literal: "às 14h" } }], ["kevin", { time: { value: clock(3, 0, "TARDE"), literal: "às 15h" } }]], "select_capabilities");

describe("C1 excerpt shape: two half-day questions answered with 24h clocks", () => {
  it("the answer '… às 14h e … às 15h' (Luna tagging TARDE) settles both: no loop", async () => {
    flags(false, true);
    const { model, say } = await session(twoMoves);
    const asked = await say(TWO);
    expect(asked.message).toContain("“pras 2” significa 02h ou 14h?");expect(asked.message).toContain("“pras 3” significa 03h ou 15h?");
    appendScriptedResponses(model, [answer]);
    const settled = await say("a Maria Eduarda às 14h e o Kevin às 15h");
    expect(status(settled, "maria")).toBe("READY_FOR_CONFIRMATION");expect(status(settled, "kevin")).toBe("READY_FOR_CONFIRMATION");
    expect(child(settled, 0).scheduling!.fields.time).toBe("14:00");expect(child(settled, 1).scheduling!.fields.time).toBe("15:00");
  });
  it("flag off: the same answer is not absorbed and both questions stay (the historical loop)", async () => {
    flags(false, false);
    const { model, say } = await session(twoMoves);
    await say(TWO);
    appendScriptedResponses(model, [answer]);
    const again = await say("a Maria Eduarda às 14h e o Kevin às 15h");
    expect(status(again, "maria")).toBe("NEEDS_INPUT");expect(status(again, "kevin")).toBe("NEEDS_INPUT");
  });
  it("with the tenant's hours (Jade 08-20) nothing is asked: 14h and 15h, each said before Confirmar", async () => {
    flags(true, true);
    const { say } = await session(twoMoves);
    const view = await say(TWO);
    expect(status(view, "maria")).toBe("READY_FOR_CONFIRMATION");expect(status(view, "kevin")).toBe("READY_FOR_CONFIRMATION");
    expect(child(view, 0).scheduling!.message).toContain("Considerei 14h: às 2h Jade Moura não atende.");
    expect(child(view, 1).scheduling!.message).toContain("Considerei 15h: às 3h Jade Moura não atende.");
  });
  it("multi-action: each move is settled by ITS professional (Kevin's is with a morning-only professional)", async () => {
    flags(true, true);
    db.appointments[1].professional_ref = "p-nando";
    const { say } = await session(twoMoves);
    const view = await say(TWO);
    expect(status(view, "maria")).toBe("READY_FOR_CONFIRMATION");expect(child(view, 0).scheduling!.fields.time).toBe("14:00");
    expect(status(view, "kevin")).toBe("NEEDS_INPUT");expect(child(view, 1).scheduling!.fields.time).toBeUndefined();
    expect(view.message).toContain("Esse horário não está disponível em qua, 30/09: às 3h e às 15h Nando Alves não atende.");
  });
});

describe("the open readings are click options from the first ask (zero model calls)", () => {
  const ONE = "passa a Maria Eduarda pra amanhã às 2";
  const move = { turn: { mode: "NEW", operations: [op("appointment.change", "maria", ONE, { customer_name: "Maria Eduarda" },
    { date: { value: day({ kind: "RELATIVE_DAY", offset: 1 }), literal: "amanhã" }, time: { value: clock(2), literal: "às 2" } })] } };
  it("a 24h professional: both readings offered; a stale click is refused; opt_2 prepares 14h for Confirmar", async () => {
    flags(true, true); db.hours = hoursOf("p-jade", 0, 24);
    const { model, secretary, sessionId, say } = await session(move);
    const asked = await say(ONE), ref = asked.operations![0].operation_ref;
    expect(child(asked).options).toEqual([{ option_id: "opt_1", label: "qua, 30/09 às 2h" }, { option_id: "opt_2", label: "qua, 30/09 às 14h" }]);
    await expect(secretary.selectOption(actor, sessionId, { operation_ref: ref, option_id: "opt_2", revision: asked.action_plan!.revision - 1 })).rejects.toThrow("OPTION_UNAVAILABLE");
    await expect(secretary.selectOption(actor, sessionId, { operation_ref: ref, option_id: "opt_3", revision: asked.action_plan!.revision })).rejects.toThrow("OPTION_UNAVAILABLE");
    const picked = await secretary.selectOption(actor, sessionId, { operation_ref: ref, option_id: "opt_2", revision: asked.action_plan!.revision });
    expect(child(picked).scheduling!.fields).toMatchObject({ date: "2026-09-30", time: "14:00", appointment_ref: "a-maria" });
    expect(child(picked).scheduling!.interpretation_source).toBe("DETERMINISTIC_FAST_PATH");expect(status(picked, "maria")).toBe("READY_FOR_CONFIRMATION");
    expect(model.requests).toHaveLength(1);expect(child(picked).options).toBeUndefined();
    // Typing the option id is not a click (the short-answer parser reads only a clock).
    expect(secretaryFastPath("time", "opt_2")).toBeUndefined();
  });
  it("a reading the tenant's hours rule out is never pending, so never offered; flag V2 off offers nothing", async () => {
    flags(true, true);
    const { say } = await session(move);
    const settled = await say(ONE);
    expect(child(settled).options).toBeUndefined();expect(child(settled).scheduling!.fields.time).toBe("14:00");
    flags(false, false);
    const before = await (await session(move)).say(ONE);
    expect(child(before).options).toBeUndefined();expect(before.message).toContain("“às 2” significa 02h ou 14h?");
  });
});

describe("an answer not applied is said in the plan, never a silent identical re-ask (flag V2)", () => {
  const ONE = "passa a Maria Eduarda pra amanhã às 2";
  const move = { turn: { mode: "NEW", operations: [op("appointment.change", "maria", ONE, { customer_name: "Maria Eduarda" },
    { date: { value: day({ kind: "RELATIVE_DAY", offset: 1 }), literal: "amanhã" }, time: { value: clock(2), literal: "às 2" } })] } };
  it("the same ambiguity answered again: what was not understood, then the question (flag off: identical)", async () => {
    flags(false, true);
    const { model, say } = await session(move);
    const first = await say(ONE);
    appendScriptedResponses(model, [patch([["maria", { time: { value: clock(2), literal: "às 2" } }]])]);
    const again = await say("às 2");
    expect(again.message).toContain(daypartChoiceRetry);expect(again.message).toContain("“às 2” significa 02h ou 14h?");expect(again.message).not.toBe(first.message);
    flags(false, false);
    const off = await session(move), before = await off.say(ONE);
    appendScriptedResponses(off.model, [patch([["maria", { time: { value: clock(2), literal: "às 2" } }]])]);
    expect((await off.say("às 2")).message).toBe(before.message);
  });
  it("a rejected answer to a missing time is said above the question (flag off: dropped from the plan)", async () => {
    const noTime = { turn: { mode: "NEW", operations: [op("appointment.change", "maria", "passa a Maria Eduarda pra amanhã", { customer_name: "Maria Eduarda" },
      { date: { value: day({ kind: "RELATIVE_DAY", offset: 1 }), literal: "amanhã" } })] } };
    const wrong = patch([["maria", { time: { value: clock(15), literal: "às 14h" } }]]);
    flags(false, true);
    const { model, say } = await session(noTime);
    await say("passa a Maria Eduarda pra amanhã");
    appendScriptedResponses(model, [wrong]);
    const said = await say("às 14h");
    expect(said.message).toContain("Não consegui associar essa resposta com segurança à informação solicitada.");expect(status(said, "maria")).toBe("NEEDS_INPUT");
    flags(false, false);
    const off = await session(noTime);
    await off.say("passa a Maria Eduarda pra amanhã");
    appendScriptedResponses(off.model, [wrong]);
    expect((await off.say("às 14h")).message).not.toContain("Não consegui associar");
  });
});
