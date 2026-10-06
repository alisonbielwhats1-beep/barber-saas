import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** S1b part A (flag SALON_SECRETARY_AGENT, default off): the agent's fact validator, with its S1b changes (one role per word and per temporal
 * atom, the professional derived from the salon's data, the owner's words of an empty customer, the clause's origin facts, the C4 clock
 * reading, one premise per interval, the open plan's patches; S2 part A: the specificity of the owner's words, the delegated pick, a patch's repeated
 * values, a released slot only for a create), runs only on the agent path. Off or unset, a new request is the C4's exactly
 * as before: the validator is never called and no agent key reaches the view or the session. Recorded frames only (no network, no model, no
 * database); synthetic tenant and texts, no name of any evaluation set. */
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[], validated: 0 }));
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  listSchedulingServices: async () => [], listSchedulingProfessionals: async () => [], schedulingSelfProfessional: async () => undefined,
  listSchedulingAppointments: async () => [], listUpcomingCustomerAppointments: async () => [],
  getSchedulingAppointment: async () => { throw Error("APPOINTMENT_NOT_FOUND"); } }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined, searchSalonCustomer: async () => [] }));
vi.mock("../scheduling-entity-mentions", async importOriginal => ({ ...await importOriginal<object>(), validateSchedulingEntityMentions: async () => undefined }));
vi.mock("../scheduling-mutations", async importOriginal => ({ ...await importOriginal<object>(), authorizeSchedulingOperation: async () => "OWNER", locateSchedulingAppointments: async () => [] }));
vi.mock("../salon-secretary-usage", async importOriginal => ({ ...await importOriginal<object>(), usageRecorder: () => async () => undefined }));
// Every entry of the validator counts its calls (and still answers as the real one would).
vi.mock("../secretary-agent-validator", async importOriginal => {
  const actual = await importOriginal<typeof import("../secretary-agent-validator")>();
  return { ...actual,
    validateAgentPlan: (...args: Parameters<typeof actual.validateAgentPlan>) => { db.validated++; return actual.validateAgentPlan(...args); },
    validateAgentPlanInTenant: (...args: Parameters<typeof actual.validateAgentPlanInTenant>) => { db.validated++; return actual.validateAgentPlanInTenant(...args); } };
});
import { SalonSecretary } from "../salon-secretary";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import type { Model } from "@everflair/salon-secretary";

const actor = { salonId: "synthetic-validator-studio", userId: "synthetic-validator-owner" };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2031-04-14T15:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  Object.assign(db, { rows: [], validated: 0 });
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(row); return row; }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null),
  } } as unknown as Tx;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

/** One new request (no plan yet): a read with nothing said, which the C4 plans and asks its day. */
const read = { operation: "appointment.list", item_key: "leitura", depends_on: null, released_slot_of: null, same_as: null, source_scope: null, customer_name: null, service_name: null,
  professional_name: null, date: null, day_offset: null, weekday: null, time: null, period: null, source_date: null, source_day_offset: null, source_weekday: null, source_time: null,
  end_time: null, end_date: null, reason: null, destination_mode: null, override_requested: null, override_reason: null };
async function newRequest(message = "agenda sintética do estúdio") {
  const model = new ScriptedServicesModel([call("select_capabilities", { turn: { mode: "NEW", operations: [read] } })]);
  const s = new SalonSecretary(async () => model as unknown as Model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const { sessionId } = await s.start(actor, "auto");
  const view = await s.send(actor, { sessionId, message });
  const stored = (s as unknown as { sessions: Map<string, Record<string, unknown>> }).sessions.get(sessionId)!;
  return { view, stored, requests: model.requests.length };
}

describe("SALON_SECRETARY_AGENT off: the fact validator never runs", () => {
  it("off: a new request is the C4's (one interpretation call), the validator is never called, no agent key is kept", async () => {
    vi.stubEnv("SALON_SECRETARY_AGENT", "false");
    const run = await newRequest();
    expect(db.validated).toBe(0);
    expect(run.requests).toBe(1);
    expect(run.view.action_plan?.actions.map(action => action.key)).toEqual(["leitura"]);
    expect("agent_plan" in run.view).toBe(false);
    expect("agentPlan" in run.stored).toBe(false);
    for (const row of db.rows.filter(item => item.entityType === "SECRETARY_ROUTER")) expect((row.metadata as { outcome?: { agent?: unknown } | null }).outcome?.agent).toBeUndefined();
  });
  it("unset behaves as off", async () => {
    const run = await newRequest();
    expect(db.validated).toBe(0);
    expect(run.requests).toBe(1);
    expect("agentPlan" in run.stored).toBe(false);
  });
  it("S2 part A off: a message naming a service and a freed slot is the C4's; the specificity rule, the delegated pick and the patch checks never run", async () => {
    vi.stubEnv("SALON_SECRETARY_AGENT", "false");
    const run = await newRequest("agenda sintética da ozonioterapia capilar na lacuna que surgir");
    expect(db.validated).toBe(0);
    expect(run.view.action_plan?.actions.map(action => action.key)).toEqual(["leitura"]);
    expect("agentPlan" in run.stored).toBe(false);
    for (const row of db.rows.filter(item => item.entityType === "SECRETARY_ROUTER")) expect((row.metadata as { outcome?: { agent?: unknown } | null }).outcome?.agent).toBeUndefined();
  });
});
