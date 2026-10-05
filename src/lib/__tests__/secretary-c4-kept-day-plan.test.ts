import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** Candidate 4 (flag SALON_SECRETARY_DATE_RULES_V2): review of the kept-day guard (30/09), through the real plan path (decoder,
 * ActionPlan, adapter, journal drafts, proposals) with the run's full candidate flags. A change whose destination day the
 * interpretation dropped never gets a confirmable proposal on the ORIGIN's day when the owner stated another day: a negator elsewhere
 * in the day's clause, a day no component can carry, an end_date quote, a later correction turn, or a compound request whose clause
 * is not verified. Only tenant lookups are fixtures. No network, no model, no DB. Today is Wednesday 30/09/2026 in São Paulo; the
 * customer's appointment is Friday 02/10 at 14h ("amanhã" = Thursday 01/10). Synthetic names (not a battery scenario). */
const FLAGS: Record<string, string> = { ALTER_APPOINTMENT: "true", COPY_V2: "true", CUSTOMER_OVERLAP_GUARD: "true", DATE_RULES_V2: "true", DAYPART_BY_HOURS: "true",
  DAYPART_RULES_V2: "true", EXAMPLES: "selected", EXAMPLES_V2: "true", EXCEPTION_RULES_V2: "true", JEV_ROUTER_ENABLED: "false", JIT_INSTRUCTIONS: "true",
  MULTI_ACTION_V2_ENABLED: "true", MULTI_SERVICE: "true", NAME_SUGGESTIONS: "true", PERSISTED_STATE: "true", READS_V2: "true", RECURRENCE_GUARD: "true", REFERENCES_V2: "true",
  SAME_AS: "true", SCHEDULING_OVERLAP_ENABLED: "true", STRUCTURED_CONTEXT: "true", TEMPORAL_COMPONENTS: "true", TEMPORAL_POLARITY: "true" };
const IVONE = { appointment_ref: "a-ivone", customer_ref: "c-ivone", customer_name: "Ivone Prado", professional_ref: "p-lais", professional_name: "Laís Nunes", service_ref: "s-escova",
  services: [{ serviceName: "Escova" }], start_local: "2026-10-02T14:00", end_local: "2026-10-02T14:45", start_at: "2026-10-02T17:00:00.000Z", status: "CONFIRMED" };
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[], moves: [] as string[] }));
const plus45 = (local: string) => { const minutes = Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16)) + 45;
  return `${local.slice(0, 11)}${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; };
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  listSchedulingServices: async () => [{ id: "s-escova", name: "Escova" }],
  listSchedulingProfessionals: async () => [{ id: "p-lais", name: "Laís Nunes" }],
  schedulingSelfProfessional: async () => undefined, listUpcomingCustomerAppointments: async () => [], listSchedulingAppointments: async () => [],
  getSchedulingAppointment: async (_tx: unknown, _actor: unknown, ref: string) => { if (ref !== IVONE.appointment_ref) throw Error("APPOINTMENT_NOT_FOUND"); return IVONE; } }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, name: string) => /^ivone/i.test(name.trim()) ? [{ id: "c-ivone", name: "Ivone Prado" }] : [],
  getCustomer: async () => ({ id: "c-ivone", name: "Ivone Prado" }) }));
vi.mock("../scheduling-entity-mentions", async importOriginal => ({ ...await importOriginal<object>(), validateSchedulingEntityMentions: async () => undefined }));
vi.mock("../scheduling-mutations", async importOriginal => {
  const original = await importOriginal<typeof import("../scheduling-mutations")>();
  return { ...original, authorizeSchedulingOperation: async () => "OWNER",
    locateSchedulingAppointments: async (_tx: unknown, _actor: unknown, f: { customer_ref?: string; source_date?: string }) =>
      f.customer_ref === IVONE.customer_ref && (!f.source_date || IVONE.start_local.startsWith(f.source_date)) ? [IVONE] : [],
    inspectSchedulingMove: async (_tx: unknown, _actor: unknown, _ref: string, date: string, time: string) => { db.moves.push(`${date}T${time}`); return { result: {}, alternatives: [] }; },
    schedulingActionSnapshot: async (_tx: unknown, _actor: unknown, operation: string, f: Record<string, string>) => original.actionSnapshot.parse({ kind: operation,
      appointment_ref: IVONE.appointment_ref, revision: 1, customer_ref: IVONE.customer_ref, customer_name: IVONE.customer_name, professional_ref: IVONE.professional_ref,
      professional_name: IVONE.professional_name, timezone: "America/Sao_Paulo", startLocal: `${f.date}T${f.time}`, endLocal: plus45(`${f.date}T${f.time}`), before_start: IVONE.start_local,
      before_end: IVONE.end_local, before_timezone: "America/Sao_Paulo", priceCents: 6000, services: [{ id: "s-escova", name: "Escova", durationMin: 45, priceCents: 6000, priceType: "FIXED",
        priceNote: null, processingMin: 0, finishingMin: 0 }], requires_acceptance: false, resource_ids: [], waiting_count: 0, waiting_hash: "", affected: [] }) };
});
import { SalonSecretary, type SecretaryView } from "../salon-secretary";
import { ScriptedServicesModel, appendScriptedResponses, call } from "../../test/scripted-services-model";

const actor = { salonId: "c4-kept-day-plan", userId: "c4-kept-day-owner" };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-30T15:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  for (const [name, value] of Object.entries(FLAGS)) vi.stubEnv(`SALON_SECRETARY_${name}`, value);
  Object.assign(db, { rows: [], moves: [] });
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(row); return row; }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null),
  } } as unknown as Tx;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); expect(db.rows.some(row => row.action === "CONFIRMED")).toBe(false); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const nulls = { date: null, source_date: null, end_date: null, time: null, source_time: null, end_time: null };
const dayBase = { offset: null, weekday: null, week: null, day: null, month: null, year: null, days: null };
const relative = (offset: number, literal: string) => ({ value: { ...dayBase, kind: "RELATIVE_DAY", offset }, literal });
const weekday = (value: number, literal: string) => ({ value: { ...dayBase, kind: "WEEKDAY", weekday: value, week: "NEAREST" }, literal });
const clock = (hour: number, minute: number, literal: string) => ({ value: { hour, minute, daypart: "UNSPECIFIED" }, literal });
function change(fields: Record<string, unknown>, components: Record<string, unknown>) {
  return { operation: "appointment.change", item_key: "a", depends_on: null, released_slot_of: null, same_as: null, source_scope: null, customer_name: "Ivone", service_names: null,
    service_name: null, professional_name: null, components: { ...nulls, ...components }, date: null, time: null, period: null, source_date: null, source_time: null, end_time: null,
    end_date: null, excluded: null, reason: null, target_professional_name: null, service_changes: null, ...fields };
}
const turn = (...operations: unknown[]) => JSON.stringify({ turn: { mode: "NEW", operations } });
const patch = (components: Record<string, unknown>) => [call("upsert_action_draft", { turn: { mode: "PATCH", operations: [{ item_key: "a", choice: null, fields: { components: { ...nulls, ...components } } }] } })];
async function session(first: string) {
  const model = new ScriptedServicesModel([[{ type: "function_call" as const, callId: crypto.randomUUID(), name: "select_capabilities", arguments: first }]]);
  const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const started = await secretary.start(actor, "auto");
  return { model, say: (message: string) => secretary.send(actor, { sessionId: started.sessionId, message }) };
}
const moved = (view: SecretaryView) => view.action_plan!.actions.find(action => action.operation === "appointment.change")!;
const codes = () => db.rows.filter(row => row.entityType === "SECRETARY_ROUTER").flatMap(row => (row.metadata as { outcome?: { divergence: { failed_codes: string[] } } }).outcome?.divergence.failed_codes ?? []);
/** Asked, never proposed: no move inspected, no confirmable action, the origin's Friday never shown as the destination. */
function asksDay(view: SecretaryView) {
  expect(moved(view).status).toBe("NEEDS_INPUT");expect(moved(view).missing_fields).toContain("date");expect((moved(view).fields as Record<string, unknown>).date).toBeUndefined();
  expect(db.moves).toEqual([]);expect(JSON.stringify(view)).not.toContain("DEPOIS: sex, 02/10");expect(codes()).toContain("TEMPORAL_KEPT_DAY_UNCLAIMED");
}

describe("one-action requests the first guard let through", () => {
  it.each([
    ["a negator of another predicate in the day's clause", "Não esquece de passar a Ivone pra amanhã, às 10h e meia.", "às 10h e meia"],
    ["a negated predicate about the customer before the day", "A Ivone não pode sexta então passa ela pra amanhã. 10h e meia.", "10h e meia"],
    ["a day no component can carry", "Passa a Ivone pro dia seguinte às 10h e meia.", "10h e meia"],
  ] as const)("%s: the destination day is asked", async (_label, message, literal) => {
    asksDay(await (await session(turn(change({ source_scope: message }, { time: clock(10, 30, literal) })))).say(message));
  });
  it("the destination day quoted as an end_date (no change has one) is asked", async () => {
    const message = "Passa a Ivone para amanhã às 10h e meia.";
    asksDay(await (await session(turn(change({ source_scope: message }, { end_date: relative(1, "amanhã"), time: clock(10, 30, "10h e meia") })))).say(message));
  });
});

describe("a later correction turn: the origin's day kept in turn 1 is not a held day", () => {
  const first = "Passa a Ivone pras 10h.";
  it("the correction's day the interpretation dropped is asked; the owner's answer then moves to Thursday", async () => {
    const { model, say } = await session(turn(change({ source_scope: first }, { time: clock(10, 0, "10h") })));
    const kept = await say(first);
    expect(moved(kept).status).toBe("READY_FOR_CONFIRMATION");expect(kept.message).toContain("DEPOIS: sex, 02/10 às 10h");
    appendScriptedResponses(model, patch({ time: clock(10, 30, "10h e meia") }));db.moves.length = 0;
    asksDay(await say("Não, pra amanhã às 10h e meia."));
    appendScriptedResponses(model, patch({ date: relative(1, "amanhã") }));
    const answered = await say("amanhã");
    expect(moved(answered).status).toBe("READY_FOR_CONFIRMATION");expect(moved(answered).fields).toMatchObject({ date: "2026-10-01", time: "10:30" });
    expect(answered.message).toContain("DEPOIS: qui, 01/10 às 10h30");
  });
  it("a correction that states no day keeps the origin's day (nothing asked)", async () => {
    const { model, say } = await session(turn(change({ source_scope: first }, { time: clock(10, 0, "10h") })));
    await say(first);
    appendScriptedResponses(model, patch({ time: clock(11, 0, "11h") }));
    const view = await say("Na verdade pras 11h.");
    expect(moved(view).status).toBe("READY_FOR_CONFIRMATION");expect(view.message).toContain("DEPOIS: sex, 02/10 às 11h");expect(codes()).not.toContain("TEMPORAL_KEPT_DAY_UNCLAIMED");
  });
  it("a correction whose day Luna sent moves to it (nothing asked)", async () => {
    const { model, say } = await session(turn(change({ source_scope: first }, { time: clock(10, 0, "10h") })));
    await say(first);
    appendScriptedResponses(model, patch({ date: relative(1, "amanhã"), time: clock(10, 30, "10h e meia") }));
    const view = await say("Não, pra amanhã às 10h e meia.");
    expect(moved(view).status).toBe("READY_FOR_CONFIRMATION");expect(view.message).toContain("DEPOIS: qui, 01/10 às 10h30");expect(codes()).not.toContain("TEMPORAL_KEPT_DAY_UNCLAIMED");
  });
});

describe("a compound request whose change clause is not verified", () => {
  const message = "Passa a Ivone para amanhã às 10h e meia e me mostra a agenda de sexta.";
  const read = (scope: string | null) => change({ operation: "appointment.list", item_key: "b", customer_name: null, source_scope: scope }, { date: weekday(5, "sexta") });
  it.each([
    ["no scopes", null, null],
    ["overlapping scopes", message, "e me mostra a agenda de sexta."],
  ] as const)("%s: the change's dropped day is asked; the read still answers", async (_label, own, other) => {
    const view = await (await session(turn(change({ source_scope: own }, { time: clock(10, 30, "10h e meia") }), read(other)))).say(message);
    asksDay(view);expect(view.action_plan!.actions.find(action => action.operation === "appointment.list")!.status).toBe("DONE");
  });
  it("a greedy scope of the other action (the whole message, holding this change's words) is not theirs: the change's day is asked", async () => {
    asksDay(await (await session(turn(change({}, { time: clock(10, 30, "10h e meia") }), read(message)))).say(message));
  });
  it("a day only the other action said is theirs: the change keeps its origin's day, nothing asked", async () => {
    const text = "Passa a Ivone pras 10h e meia e me mostra a agenda de sexta.";
    const view = await (await session(turn(change({}, { time: clock(10, 30, "10h e meia") }), read(null)))).say(text);
    expect(moved(view).status).toBe("READY_FOR_CONFIRMATION");expect(view.message).toContain("DEPOIS: sex, 02/10 às 10h30");expect(codes()).not.toContain("TEMPORAL_KEPT_DAY_UNCLAIMED");
  });
  it("a day inside another action's own clause or quote (not quoted as its date) is theirs", async () => {
    const text = "Passa a Ivone pras 10h e meia e cancela a Tereza porque ela viaja amanhã.";
    const cancel = change({ operation: "appointment.cancel", item_key: "b", customer_name: "Tereza", reason: "ela viaja amanhã", source_scope: "e cancela a Tereza porque ela viaja amanhã." }, {});
    const view = await (await session(turn(change({ source_scope: "Passa Ivone pras 10h e meia" }, { time: clock(10, 30, "10h e meia") }), cancel))).say(text);
    expect(moved(view).status).toBe("READY_FOR_CONFIRMATION");expect(moved(view).assessment?.preview).toContain("DEPOIS: sex, 02/10 às 10h30");
    expect(codes()).not.toContain("TEMPORAL_KEPT_DAY_UNCLAIMED");
  });
  it("flag off (SALON_SECRETARY_DATE_RULES_V2=false): the historical behaviour (the origin's Friday proposed)", async () => {
    vi.stubEnv("SALON_SECRETARY_DATE_RULES_V2", "false");
    const view = await (await session(turn(change({}, { time: clock(10, 30, "10h e meia") }), read(null)))).say(message);
    expect(moved(view).status).toBe("READY_FOR_CONFIRMATION");expect(view.message).toContain("DEPOIS: sex, 02/10 às 10h30");expect(codes()).not.toContain("TEMPORAL_KEPT_DAY_UNCLAIMED");
  });
});
