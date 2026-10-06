import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** Candidate 4, fixer of the R1 review, through the real multi-action plan path (decoder, ActionPlan, adapters, presentation,
 * journal) with scripted component frames (flag SALON_SECRETARY_DATE_RULES_V2): a cancel whose day's past reading was dropped
 * is never ready for Confirmar by itself when the customer really had an appointment on that passed day; the plan keeps the
 * "Não encontrei … que já passou" notice beside the card. A negated sentence about a passed day asks the original day.
 * Fixtures only; no DB, no network, no model. */
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[], located: [] as unknown[], past: [] as { date: string; customer_ref: string; salonId: string }[] }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  listSchedulingProfessionals: async () => [],
  listSchedulingAppointments: async (_tx: unknown, actor: { salonId: string }, input: { date: string; customer_ref?: string }) =>
    db.past.filter(row => row.salonId === actor.salonId && row.date === input.date && row.customer_ref === input.customer_ref).map(row => ({ appointment_ref: `past-${row.date}`, start_local: `${row.date}T09:00`, status: "NO_SHOW" })),
  getSchedulingAppointment: async (_tx: unknown, _actor: unknown, ref: string) => ({ appointment_ref: ref, start_local: "2026-10-03T09:00" }) }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, name: string) => /davi lucca/i.test(name) ? [{ id: "c-jv", name: "Davi Lucca Mendes" }] : [] }));
vi.mock("../scheduling-entity-mentions", () => ({ validateSchedulingEntityMentions: async () => undefined }));
vi.mock("../scheduling-mutations", async importOriginal => {
  const original = await importOriginal<typeof import("../scheduling-mutations")>();
  const base = { timezone: "America/Sao_Paulo", services: [], resource_ids: [], waiting_count: 0, waiting_hash: "", requires_acceptance: false, affected: [] };
  return { ...original, authorizeSchedulingOperation: async () => "OWNER",
    locateSchedulingAppointments: async (_tx: unknown, _actor: unknown, f: { customer_ref?: string; date?: string; source_date?: string }, operation: string) => {
      db.located.push(operation === "appointment.change" ? f.source_date ?? "ANY" : f.date);
      return f.customer_ref === "c-jv" && (f.date ?? f.source_date) === "2026-10-03"
        ? [{ appointment_ref: "a-jv-out", customer_ref: "c-jv", customer_name: "Davi Lucca Mendes", start_local: "2026-10-03T09:00", professional_name: "Luz Andrade" }] : [];
    },
    inspectSchedulingMove: async () => ({ result: {}, alternatives: [] }),
    schedulingActionSnapshot: async (_tx: unknown, _actor: unknown, operation: string) => original.actionSnapshot.parse({ ...base, kind: operation, appointment_ref: "a-jv-out", revision: 1,
      customer_ref: "c-jv", customer_name: "Davi Lucca Mendes", professional_ref: "p-luz", professional_name: "Luz Andrade", before_start: "2026-10-03T09:00", before_end: "2026-10-03T10:00",
      before_timezone: "America/Sao_Paulo", startLocal: "2026-10-03T09:00", endLocal: "2026-10-03T10:00", priceCents: 4500 }) };
});
import { SalonSecretary } from "../salon-secretary";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";

const actor = { salonId: "estudio-cilios-aurora", userId: "dona-aurora" };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-29T15:00:00Z")); // Tuesday, 12h in São Paulo
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", "true"); vi.stubEnv("SALON_SECRETARY_DATE_RULES_V2", "true");
  db.rows = []; db.located = []; db.past = [];
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(row); return row; }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null),
  } } as unknown as Tx;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); expect(db.rows.some(row => row.action === "CONFIRMED")).toBe(false); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const day = (value: Record<string, unknown>) => ({ offset: null, weekday: null, week: null, day: null, month: null, year: null, days: null, ...value });
const clock = (hour: number, minute = 0) => ({ hour, minute, daypart: "UNSPECIFIED" });
const none = { date: null, source_date: null, end_date: null, time: null, source_time: null, end_time: null };
const legacyNulls = { date: null, day_offset: null, weekday: null, time: null, period: null, source_date: null, source_day_offset: null, source_weekday: null, source_time: null, end_time: null, end_date: null };
const op = (operation: string, item_key: string, source_scope: string, fields: Record<string, unknown>, components: Record<string, unknown>) => ({
  operation, item_key, depends_on: null, released_slot_of: null, source_scope, customer_name: null, service_name: null, professional_name: null, reason: null,
  ...legacyNulls, ...fields, components: { ...none, ...components } });
async function say(message: string, first: unknown) {
  const model = new ScriptedServicesModel([call("select_capabilities", first)]);
  const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const started = await secretary.start(actor, "auto");
  return secretary.send(actor, { sessionId: started.sessionId, message });
}

describe("plan path: the cancel 'do dia 3' said on 29/09 (03/09 passed, 03/10 is next)", () => {
  const MESSAGE = "O Davi Lucca faltou dia 3, desmarca o horário dele porque faltou";
  const frame = { turn: { mode: "NEW", operations: [op("appointment.cancel", "cancelar_jv", MESSAGE, { customer_name: "Davi Lucca", reason: "faltou" },
    { date: { value: day({ kind: "DAY_OF_MONTH", day: 3 }), literal: "dia 3" } })] } };
  it("he had an appointment on 03/09: the card of 03/10 with the notice kept in the plan; never ready for Confirmar", async () => {
    db.past = [{ date: "2026-09-03", customer_ref: "c-jv", salonId: actor.salonId }];
    const view = await say(MESSAGE, frame);
    expect(view.action_plan!.actions[0].status).toBe("NEEDS_INPUT");expect(db.located).toEqual(["2026-10-03"]);
    expect(view.message).toContain("Não encontrei agendamento de Davi Lucca Mendes que a Secretária possa alterar em qui, 03/09, que já passou; “dia 3” também é sáb, 03/10.");
  });
  it("adversarial: the same client in another salon had it: this salon's plan keeps B1's ready card for 03/10", async () => {
    db.past = [{ date: "2026-09-03", customer_ref: "c-jv", salonId: "outro-salao" }];
    const view = await say(MESSAGE, frame);
    expect(view.action_plan!.actions[0].status).toBe("READY_FOR_CONFIRMATION");expect(view.message).toContain("“dia 3” é sáb, 03/10 (qui, 03/09 já passou).");
  });
});

describe("plan path: a negated sentence about a passed day on a move", () => {
  const MESSAGE = "O Davi Lucca não veio dia 3. Remarca ele pro dia 8 às 10h";
  const frame = { turn: { mode: "NEW", operations: [op("appointment.change", "remarcar_jv", MESSAGE, { customer_name: "Davi Lucca" }, {
    source_date: { value: day({ kind: "DAY_OF_MONTH", day: 3 }), literal: "dia 3" }, date: { value: day({ kind: "DAY_OF_MONTH", day: 8 }), literal: "dia 8" }, time: { value: clock(10), literal: "às 10h" } })] } };
  // Candidate 4 DEV fix round (29/09; backup .demo/agenda-core/contract-migration/secretary-c4-fixer-plan.test.before-dev-fix-b6.ts):
  // the negated passed day now runs the tenant locator on its next occurrence and discloses the dropped day; with nothing
  // there it still asks the appointment. Never located silently, never ready for Confirmar.
  it("asks the original appointment with the dropped day disclosed; nothing is ready", async () => {
    const view = await say(MESSAGE, frame);
    expect(view.action_plan!.actions[0].status).toBe("NEEDS_INPUT");expect(db.located).toEqual(["ANY"]);
    expect(view.message).toContain("“dia 3” é sáb, 03/10 (qui, 03/09 já passou).");expect(view.message).toContain("Qual agendamento você deseja alterar?");
  });
});
