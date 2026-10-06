import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** D1 fidelity through the real multi-action plan path (recorded V01 frame; tenant lookups are the fixtures of
 * secretary-b7-sessions.test.ts; no DB, no network): the same conversation run (a) on one in-memory SalonSecretary and
 * (b) alternating between two workers that share a persisted store produces the same replies at every step, and the saved
 * aggregate is exactly the in-memory one (ids and hashes normalized). Includes an unreadable answer (B5), a discard (B3),
 * a casual turn and a cancel. */
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[] }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined,
  secretaryDirectory: async () => ({ professionals: ["Rodrigo Lima"], services: [], today: { date: "2026-09-28", weekday: "segunda-feira", timezone: "America/Sao_Paulo" } }),
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, filter: { query?: string }) => /rodrigo/i.test(filter.query ?? "") ? [{ id: "pro-rodrigo", name: "Rodrigo Lima" }] : [],
  getSchedulingAppointment: async (_tx: unknown, _actor: unknown, ref: string) => ({ appointment_ref: ref, start_local: ref === "a-fabio" ? "2026-09-30T16:00" : "2026-10-01T11:00" }) }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, name: string) => /f[aá]bio/i.test(name) ? [{ id: "c-fabio", name: "Fábio Santos" }] : /amanda/i.test(name) ? [{ id: "c-amanda", name: "Amanda Souza" }] : [] }));
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
import { SalonSecretary, type SecretaryView } from "../salon-secretary";
import { InMemorySessionStore } from "../secretary-session-store";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { V01_LUNA, V01_MESSAGE } from "../../test/secretary-v01-recorded";

const actor = { salonId: "synthetic-salon", userId: "synthetic-owner" };
const T0 = Date.parse("2026-09-28T15:00:00Z");
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(T0);
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function freshDatabase() {
  db.rows = [];
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(row); return row; }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null),
  } } as unknown as Tx;
}

const recorded = JSON.parse(V01_LUNA).turn.operations as Record<string, unknown>[];
const shape = (operation: string, fields: Record<string, unknown>) => ({ ...recorded.find(item => item.operation === operation)!,
  date: null, day_offset: null, weekday: null, time: null, end_time: null, reason: null, ...fields });
const pair = (value: unknown, literal: string) => ({ value, literal });
const v01 = { turn: { mode: "NEW", operations: [
  shape("appointment.change", { day_offset: pair(1, "amanhã"), time: pair("10:00", "às 10 horas") }), shape("appointment.cancel", {}),
  shape("schedule.block", { date: pair("2026-09-29", "dia 29"), time: pair("10:00", "das 10"), end_time: pair("11:00", "às 11") })] } };
const unreadable = call("upsert_action_draft", { turn: { mode: "PATCH", operations: [{ item_key: "ghost", choice: null, fields: {} }] } });
const chat = call("select_capabilities", { turn: { mode: "CONVERSATION", response: "Tudo bem!" } });

/** Ids (uuids) and hashes (keyed fingerprints, group fingerprints) differ between runs: numbered by first appearance.
 * Adapter latency metrics (performance.now) differ too and are left out. */
function normalized(value: unknown) {
  const names = new Map<string, string>(), parsed = typeof value === "string" ? JSON.parse(value) : value;
  return JSON.stringify(parsed, (key, item) => key === "metrics" ? undefined : item).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\b[0-9a-f]{64}\b/g,
    match => names.get(match) ?? (names.set(match, `<${match.length === 64 ? "h" : "id"}${names.size}>`), names.get(match)!));
}
type Step = (s: SalonSecretary, sessionId: string, last?: SecretaryView) => Promise<SecretaryView>;
const steps: Step[] = [
  (s, id) => s.send(actor, { sessionId: id, message: V01_MESSAGE }),
  (s, id) => s.send(actor, { sessionId: id, message: "é por causa da viagem" }),
  (s, id, last) => s.discardAction(actor, id, { plan_ref: last!.action_plan!.plan_ref, action_key: last!.action_plan!.actions.find(action => action.operation === "schedule.block")!.key }),
  (s, id) => s.send(actor, { sessionId: id, message: "obrigado" }),
  (s, id) => s.cancel(actor, id),
];
async function run(persisted: boolean) {
  freshDatabase(); vi.setSystemTime(T0);
  const model = new ScriptedServicesModel([call("select_capabilities", v01), unreadable, chat]);
  const store = persisted ? new InMemorySessionStore() : undefined;
  const make = () => new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true }, () => store);
  const workers = persisted ? [make(), make()] : [make()];
  const { sessionId } = await workers[0].start(actor, "auto");
  const views: SecretaryView[] = [], states: string[] = [];
  for (const [index, step] of steps.entries()) {
    vi.setSystemTime(T0 + (index + 1) * 60_000);
    const worker = workers[(index + 1) % workers.length];
    views.push(await step(worker, sessionId, views.at(-1)));
    // The aggregate as the in-memory worker holds it, or as the store saved it.
    const internal = worker as unknown as { sessions: Map<string, unknown>; conversationRecord(root: unknown): { state: string } };
    states.push(store ? store.rows.get(sessionId)!.state : internal.conversationRecord(internal.sessions.get(sessionId)).state);
  }
  return { views, states, store, workers };
}

describe("D1: persisted state is the in-memory state", () => {
  it("the same conversation gives the same replies and the same saved aggregate, one process or two workers", async () => {
    const memory = await run(false), persisted = await run(true);
    expect(persisted.views.map(view => view.message)).toEqual(memory.views.map(view => view.message));
    for (const [index] of steps.entries()) {
      expect(normalized(persisted.views[index])).toBe(normalized(memory.views[index]));
      expect(normalized(persisted.states[index])).toBe(normalized(memory.states[index]));
    }
    // The steps really exercised the plan path: three actions, a kept plan after the unreadable answer, one discard, a close.
    expect(memory.views[0].action_plan!.actions).toHaveLength(3);
    expect(memory.views[1].turn_notice_alone).toBe(true);
    expect(memory.views[2].action_plan!.actions.map(action => action.status)).toContain("DISCARDED");
    expect(memory.views[4].cancelled).toBe(true);
    for (const worker of persisted.workers) expect((worker as unknown as { sessions: Map<string, unknown> }).sessions.size).toBe(0);
    expect(persisted.store!.events.map(event => event.kind)).toEqual(["TURN_STARTED", "TURN_OUTCOME", "TURN_STARTED", "TURN_OUTCOME", "DISCARD", "TURN_STARTED", "TURN_OUTCOME", "CANCEL"]);
    expect(JSON.stringify(persisted.store!.events)).not.toMatch(/Fábio|Amanda|Rodrigo|viagem|amanhã/);
  });
});
