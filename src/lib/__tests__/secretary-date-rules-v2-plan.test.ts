import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** Candidate 4, track R1 through the real multi-action plan path (decoder, ActionPlan, adapters, presentation, journal) with
 * scripted component frames (flag SALON_SECRETARY_DATE_RULES_V2): the dropped past day is part of the card the owner confirms,
 * and a DATE_CHOICE answered with the same ambiguity is never shown again silently. Fixtures only; no DB, no network. */
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[], located: [] as unknown[] }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, filter: { query?: string }) => /jade/i.test(filter.query ?? "") ? [{ id: "p-jade", name: "Jade Moura" }] : [],
  listSchedulingAppointments: async () => [],
  getSchedulingAppointment: async (_tx: unknown, _actor: unknown, ref: string) => ({ appointment_ref: ref, start_local: "2026-10-01T17:30" }) }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, name: string) => /ot[aá]vio/i.test(name) ? [{ id: "c-otavio", name: "Otávio Reis" }] : /lurdes/i.test(name) ? [{ id: "c-lurdes", name: "Lurdes Maia" }] : [] }));
vi.mock("../scheduling-entity-mentions", () => ({ validateSchedulingEntityMentions: async () => undefined }));
vi.mock("../scheduling-mutations", async importOriginal => {
  const original = await importOriginal<typeof import("../scheduling-mutations")>();
  const base = { timezone: "America/Sao_Paulo", services: [], resource_ids: [], waiting_count: 0, waiting_hash: "", requires_acceptance: false, affected: [] };
  return { ...original, authorizeSchedulingOperation: async () => "OWNER",
    locateSchedulingAppointments: async (_tx: unknown, _actor: unknown, f: { customer_ref?: string; date?: string; source_date?: string }, operation: string) => {
      db.located.push(operation === "appointment.change" ? f.source_date ?? "ANY" : f.date);
      if (f.customer_ref === "c-lurdes") return [{ appointment_ref: "a-lurdes", customer_name: "Lurdes Maia", start_local: "2026-10-06T10:00", professional_name: "Jade Moura" }];
      return f.customer_ref === "c-otavio" && f.date === "2026-10-01" ? [{ appointment_ref: "a-otavio", customer_name: "Otávio Reis", start_local: "2026-10-01T17:30", professional_name: "Jade Moura" }] : [];
    },
    inspectSchedulingMove: async () => ({ result: {}, alternatives: [] }),
    schedulingActionSnapshot: async (_tx: unknown, _actor: unknown, operation: string, f: Record<string, string>) => original.actionSnapshot.parse(operation === "appointment.change"
      ? { ...base, kind: operation, appointment_ref: "a-lurdes", revision: 1, customer_ref: "c-lurdes", customer_name: "Lurdes Maia", professional_ref: "p-jade", professional_name: "Jade Moura",
        before_start: "2026-10-06T10:00", before_end: "2026-10-06T11:00", before_timezone: "America/Sao_Paulo", startLocal: `${f.date}T${f.time}`, endLocal: `${f.date}T${f.time}`, priceCents: 6000 }
      : { ...base, kind: operation, appointment_ref: "a-otavio", revision: 1,
      customer_ref: "c-otavio", customer_name: "Otávio Reis", professional_ref: "p-jade", professional_name: "Jade Moura", before_start: "2026-10-01T17:30", before_end: "2026-10-01T18:30",
      before_timezone: "America/Sao_Paulo", startLocal: "2026-10-01T17:30", endLocal: "2026-10-01T18:30", priceCents: 6000 }) };
});
import { SalonSecretary } from "../salon-secretary";
import { ScriptedServicesModel, call, appendScriptedResponses } from "../../test/scripted-services-model";
import { dateChoiceRetry } from "../scheduling-calendar-conflict";

const actor = { salonId: "esmalteria-lua", userId: "dona-lua" };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-29T15:00:00Z")); // Tuesday, 12h in São Paulo
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", "true");
  db.rows = []; db.located = [];
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(row); return row; }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null),
  } } as unknown as Tx;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); expect(db.rows.some(row => row.action === "CONFIRMED")).toBe(false); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const rules = (on: boolean) => vi.stubEnv("SALON_SECRETARY_DATE_RULES_V2", on ? "true" : "false");

const day = (value: Record<string, unknown>) => ({ offset: null, weekday: null, week: null, day: null, month: null, year: null, days: null, ...value });
const clock = (hour: number, minute = 0) => ({ hour, minute, daypart: "UNSPECIFIED" });
const none = { date: null, source_date: null, end_date: null, time: null, source_time: null, end_time: null };
const legacyNulls = { date: null, day_offset: null, weekday: null, time: null, period: null, source_date: null, source_day_offset: null, source_weekday: null, source_time: null, end_time: null, end_date: null };
const op = (operation: string, item_key: string, source_scope: string, fields: Record<string, unknown>, components: Record<string, unknown>) => ({
  operation, item_key, depends_on: null, released_slot_of: null, source_scope, customer_name: null, service_name: null, professional_name: null, reason: null,
  ...legacyNulls, ...fields, components: { ...none, ...components } });
async function session(first: unknown) {
  const model = new ScriptedServicesModel([call("select_capabilities", first)]);
  const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const started = await secretary.start(actor, "auto");
  return { model, say: (message: string) => secretary.send(actor, { sessionId: started.sessionId, message }) };
}

describe("plan path: the cancel 'do dia 1' said on 29/09", () => {
  const MESSAGE = "Desmarque o horário do Otávio do dia 1 das 17h30 porque ele viajou.";
  const frame = { turn: { mode: "NEW", operations: [op("appointment.cancel", "cancelar_otavio", MESSAGE, { customer_name: "Otávio", reason: "ele viajou" },
    { date: { value: day({ kind: "DAY_OF_MONTH", day: 1 }), literal: "dia 1" }, time: { value: clock(17, 30), literal: "das 17h30" } })] } };
  it("is a confirmable card for 01/10 that says 01/09 já passou", async () => {
    rules(true);
    const view = await (await session(frame)).say(MESSAGE);
    expect(view.action_plan!.actions[0].status).toBe("READY_FOR_CONFIRMATION");expect(db.located).toEqual(["2026-10-01"]);
    expect(view.message).toContain("“dia 1” é qui, 01/10 (ter, 01/09 já passou).");
  });
  it("flag off: today's past-vs-next question, nothing located", async () => {
    rules(false);
    const view = await (await session(frame)).say(MESSAGE);
    expect(view.action_plan!.actions[0].status).toBe("NEEDS_INPUT");expect(db.located).toEqual([]);
    expect(view.message).toContain("“dia 1” é ter, 01/09 ou qui, 01/10?");
  });
});

describe("plan path: 'a Lurdes não pode no dia 06/10. Remarque ela pro dia 02/10'", () => {
  const MESSAGE = "Tchê, a Lurdes não pode no dia 06/10. Remarque ela pro dia 02/10 às 20:00.";
  const frame = { turn: { mode: "NEW", operations: [op("appointment.change", "remarcar_lurdes", MESSAGE, { customer_name: "Lurdes" }, {
    source_date: { value: day({ kind: "DAY_OF_MONTH", day: 6, month: 10 }), literal: "no dia 06/10" }, date: { value: day({ kind: "DAY_OF_MONTH", day: 2, month: 10 }), literal: "dia 02/10" },
    time: { value: clock(20), literal: "às 20:00" } })] } };
  it("locates her only appointment (on 06/10) without the date as a selector and prepares the move for Confirmar", async () => {
    rules(true);
    const view = await (await session(frame)).say(MESSAGE);
    expect(db.located).toEqual(["ANY"]);expect(view.action_plan!.actions[0].status).toBe("READY_FOR_CONFIRMATION");
  });
  it("flag off: the original day is asked (historical denial)", async () => {
    rules(false);
    const view = await (await session(frame)).say(MESSAGE);
    expect(view.action_plan!.actions[0].status).toBe("NEEDS_INPUT");expect(db.located).toEqual([]);
  });
});

describe("plan path: a DATE_CHOICE answered with the same ambiguity", () => {
  const MESSAGE = "o que a Jade tem dia 25?";
  const frame = { turn: { mode: "NEW", operations: [op("appointment.list", "agenda_jade", MESSAGE, { professional_name: "Jade" },
    { date: { value: day({ kind: "DAY_OF_MONTH", day: 25 }), literal: "dia 25" } })] } };
  const answer = (literal: string, value: Record<string, unknown>) => call("upsert_action_draft", { turn: { mode: "PATCH", operations: [{ item_key: "agenda_jade", choice: null,
    fields: { components: { ...none, date: { value: day(value), literal } } } }] } });
  it("says what was not understood above the same question; the month then settles it", async () => {
    rules(true);
    const { model, say } = await session(frame);
    const first = await say(MESSAGE);
    expect(first.message).toContain("“dia 25” é sex, 25/09 ou dom, 25/10?");expect(first.message).not.toContain(dateChoiceRetry);
    appendScriptedResponses(model, [answer("dia 25", { kind: "DAY_OF_MONTH", day: 25 })]);
    const again = await say("dia 25");
    expect(again.message).toContain(dateChoiceRetry);expect(again.message).toContain("“dia 25” é sex, 25/09 ou dom, 25/10?");expect(again.message).not.toBe(first.message);
    appendScriptedResponses(model, [answer("o de outubro", { kind: "DAY_OF_MONTH", day: 25, month: 10 })]);
    const settled = await say("o de outubro");
    expect(settled.action_plan!.actions[0].status).toBe("DONE");expect(settled.message).not.toContain("25/09 ou");
  });
});
