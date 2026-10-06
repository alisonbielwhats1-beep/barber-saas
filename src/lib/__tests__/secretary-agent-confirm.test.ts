import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** C5 agent (docs/c5-spike/11-especificacao-agente.md §5.1 V23, §8.1 "V23", §6.2): a plan the agent built reaches the SAME C4 plan, proposals
 * and group confirmation; at the Confirmar, every value the backend derived is re-checked against fresh rows for the WHOLE group before its
 * first write (a changed basis holds the group: zero writes, REVIEW_REQUIRED), again before each group of "Confirmar tudo" (an earlier group
 * may change it), and inside the confirm's own transaction (the precondition handed to the domain confirm). The loop runs over the offline
 * fake model (one propor_plano round); the validator's result and the tenant's rows are fixtures; the domain confirm only records what it
 * would write. Synthetic salon, diverse names; no gender is inferred from a name. */
type Reader = { performers: () => Promise<{ id: string; name: string }[]>; bookable: () => Promise<boolean>; activeCount: (id: string) => Promise<number> };
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[], writes: [] as { proposal: string; precondition: boolean }[],
  validation: undefined as unknown, reader: undefined as unknown as Reader }));
const plusHour = (local: string) => `${local.slice(0, 11)}${String(Number(local.slice(11, 13)) + 1).padStart(2, "0")}${local.slice(13)}`;
const SERVICES: Record<string, string> = { "srv-pedi": "Pedicure spa" };
const TEAM = [{ id: "pro-otavio", name: "Otávio Brandt" }, { id: "pro-petra", name: "Petra Lindqvist" }];
const CUSTOMERS: Record<string, string> = { "cli-ilka": "Ilka Moraes", "cli-wendel": "Wendel Okafor" };
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  listSchedulingServices: async () => [], listSchedulingProfessionals: async () => TEAM.map(row => ({ ...row })), schedulingSelfProfessional: async () => undefined,
  getSchedulingAvailability: async (_tx: unknown, _actor: unknown, input: { date: string; time: string }) => ({ plan: { startLocal: `${input.date}T${input.time}` }, alternatives: [], timezone: "America/Sao_Paulo" }),
  listSchedulingAppointments: async () => [], listUpcomingCustomerAppointments: async () => [],
  getSchedulingAppointment: async () => { throw Error("APPOINTMENT_NOT_FOUND"); } }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined, searchSalonCustomer: async () => [] }));
vi.mock("../scheduling-entity-mentions", async importOriginal => ({ ...await importOriginal<object>(), validateSchedulingEntityMentions: async () => undefined }));
vi.mock("../scheduling-actions", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingSnapshot: async (_tx: unknown, _actor: unknown, f: Record<string, unknown>) => {
    const time = f.time as string, date = f.date as string;
    return { customer_ref: f.customer_ref, customer_name: CUSTOMERS[f.customer_ref as string], service_ref: f.service_ref, service_revision: "1", service_name: SERVICES[f.service_ref as string],
      professional_ref: f.professional_ref, professional_name: TEAM.find(row => row.id === f.professional_ref)?.name ?? "sem cadastro", date, startLocal: `${date}T${time}`,
      endLocal: plusHour(`${date}T${time}`), timezone: "America/Sao_Paulo", priceCents: 9000, priceType: "FIXED", durationMin: 60, quote: "q" };
  },
  proposeAppointmentCreate: async (_tx: unknown, _actor: unknown, input: { draft_ref: string; draft_revision: number }) =>
    ({ proposal_ref: crypto.randomUUID(), draft_ref: input.draft_ref, draft_revision: input.draft_revision, payload_hash: "h".repeat(64), preview: "NOVO AGENDAMENTO", expires_at: new Date(Date.now() + 600_000).toISOString() }),
  // A confirmed write is only recorded, with whether the in-transaction precondition (V23 (2)) was handed to it.
  confirmAppointmentCreate: async (_tx: unknown, _actor: unknown, input: { proposal_ref: string; draft_revision: number }, options?: { precondition?: unknown }) => {
    db.writes.push({ proposal: input.proposal_ref, precondition: typeof options?.precondition === "function" });
    return { proposal_ref: input.proposal_ref, draft_ref: "synthetic-draft", draft_revision: input.draft_revision, outcome: "CONFIRMED", appointment_ref: crypto.randomUUID() };
  } }));
vi.mock("../scheduling-mutations", async importOriginal => ({ ...await importOriginal<object>(), authorizeSchedulingOperation: async () => "OWNER", locateSchedulingAppointments: async () => [] }));
// The message's lookups: a directory and nothing to read (the fixture plan needs no lookup round).
vi.mock("../secretary-agent-lookups", async importOriginal => ({ ...await importOriginal<object>(),
  createAgentLookupExecutor: () => ({ directory: async () => ({ ok: true, directory: { today: { date: "2031-06-10", weekday: "terça-feira", timezone: "America/Sao_Paulo" }, professionals: [], services: [] } }),
    round: async (calls: readonly unknown[]) => calls.map(() => "{}") }) }));
// The validator's verdict and the tenant's fresh rows at the Confirmar are fixtures (the validator itself: secretary-agent-validator.test.ts).
vi.mock("../secretary-agent-validator", async importOriginal => ({ ...await importOriginal<object>(), validateAgentPlanInTenant: async () => db.validation, agentFactReader: async () => db.reader }));
import { SalonSecretary, agentBasisChangedMessage, type SecretaryView } from "../salon-secretary";
import { createAgentFakeModel, fakePlanCall, fakeReasoning } from "../../test/secretary-agent-fake-model";
import type { AgentActionOutcome, AgentBasis } from "../secretary-agent-validator";
import type { SchedulingFields } from "../scheduling-contract";
import { AGENT_DEPENDENCY_FLAGS } from "../../../packages/salon-secretary/src/agent-context";
import type { ActionPlan, Model } from "@everflair/salon-secretary";

const actor = { salonId: "synthetic-confirm-studio", userId: "synthetic-confirm-owner" };
const DAY = "2031-06-12";
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2031-06-10T12:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  vi.stubEnv("SALON_SECRETARY_AGENT", "true");
  for (const flag of AGENT_DEPENDENCY_FLAGS) vi.stubEnv(flag, "true");
  Object.assign(db, { rows: [], writes: [], validation: undefined });
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(row); return row; }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null),
  } } as unknown as Tx;
  counts({ "pro-otavio": 3, "pro-petra": 0 });
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

/** The fresh rows at the Confirmar: both professionals do the service and are free; `busy` gives each one's appointments that day. */
function counts(busy: Record<string, number> | (() => Record<string, number>)) {
  const now = () => typeof busy === "function" ? busy() : busy;
  db.reader = { performers: async () => TEAM.map(row => ({ ...row })), bookable: async () => true, activeCount: async (id: string) => now()[id] ?? 0 };
}
const outcome = (key: string, fields: SchedulingFields, extra: Partial<AgentActionOutcome> = {}): AgentActionOutcome => ({
  key, operation: "appointment.create", status: "READY", fields, cleared: [], card: null, question: null, asked: null, ambiguities: [], origin: null, derived: null, recurrence: null,
  dependsOn: [], releasedSlotOf: null, basis: [], premises: [], note: [], notice: null, codes: [], names: {}, ...extra });
const delegated = (start: string): AgentBasis => ({ type: "DELEGADO", field: "profissional", chosen: "pro-petra", set: ["pro-otavio", "pro-petra"], counts: { "pro-otavio": 3, "pro-petra": 0 },
  start, services: ["srv-pedi"] });
/** Two bookings: the first with the professional said, the second with the one the backend picked for the owner (least busy that day). */
function plan(linked: boolean) {
  db.validation = { ok: true, result: "PLANO", notices: [], question: null, reply: null, codes: [], actions: [
    outcome("primeira", { customer_ref: "cli-ilka", service_ref: "srv-pedi", professional_ref: "pro-otavio", date: DAY, time: "10:00" }, { names: { "cli-ilka": "Ilka Moraes" } }),
    outcome("segunda", { customer_ref: "cli-wendel", service_ref: "srv-pedi", professional_ref: "pro-petra", date: DAY, time: "14:00" },
      { names: { "cli-wendel": "Wendel Okafor", "pro-petra": "Petra Lindqvist" }, basis: [delegated(`${DAY}T14:00`)], dependsOn: linked ? ["primeira"] : [],
        premises: ["Premissa sintética da escolha delegada."] })] };
}
/** The model's plan (any valid propor_plano: the validator's verdict above is what the backend uses). */
const acao = (chave: string, inicio: string) => ({ chave, operacao: "appointment.create", citacao_acao: "trecho sintético", atendimento: null, cliente: null, profissional: null,
  novo_profissional: null, servicos: null, inicio, fim: null, dia: null, motivo: null, recorrencia: null, depende_de: [], ocupa_horario_de: null,
  bases: [{ campo: "inicio", tipo: "DITO", ref: null, citacao: "trecho" }], premissas: [] });
const lunaPlan = { resultado: "PLANO", resposta: null, acoes_fora: 0, pergunta: null, acoes: [acao("primeira", `${DAY}T10:00`), acao("segunda", `${DAY}T14:00`)] };
async function conversation() {
  const model = createAgentFakeModel([{ output: [fakeReasoning("rs_1"), fakePlanCall(lunaPlan, "call_plano")] }]);
  const s = new SalonSecretary(async () => model as Model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const { sessionId } = await s.start(actor, "auto");
  const view = await s.send(actor, { sessionId, message: "pedido sintético" });
  expect(model.mismatches).toEqual([]);
  return { s, sessionId, view };
}
const approvalOf = (p: ActionPlan, key: string) => { const group = p.confirmation_groups.find(item => item.action_keys.includes(key))!;
  return { plan_ref: p.plan_ref, revision: p.revision, group_key: group.key, fingerprint: group.fingerprint }; };
const action = (view: SecretaryView, key: string) => view.action_plan!.actions.find(item => item.key === key)!;
type Child = { scheduling?: { agent_basis?: unknown[]; fields: SchedulingFields; proposal?: unknown } };
const child = (s: SalonSecretary, view: SecretaryView, key: string) => {
  const ref = view.operations!.find(item => item.action_keys?.includes(key))!.operation_ref;
  return (s as unknown as { sessions: Map<string, Child> }).sessions.get(ref)!;
};

describe("the agent's plan is the C4's plan", () => {
  it("proposals ready in the same groups; backend premises before the plan; the agent plan is marked for the review dialog", async () => {
    plan(true);
    const { view } = await conversation();
    expect(action(view, "primeira").status).toBe("READY_FOR_CONFIRMATION"); expect(action(view, "segunda").status).toBe("READY_FOR_CONFIRMATION");
    expect(view.action_plan!.confirmation_groups.map(group => [group.status, group.action_keys])).toEqual([["READY_FOR_CONFIRMATION", ["primeira", "segunda"]]]);
    expect(view.agent_plan).toBe(true);
    expect(view.turn_notice).toBe("Premissa sintética da escolha delegada.");
    expect(view.message.startsWith(view.turn_notice!)).toBe(true);
    expect(db.writes).toEqual([]);
    const router = db.rows.filter(row => row.entityType === "SECRETARY_ROUTER").map(row => (row.metadata as { outcome?: { agent?: { path: string; premises_backend: number } } | null }).outcome?.agent);
    expect(router.at(-1)).toMatchObject({ path: "AGENT", premises_backend: 1 });
  });
});

describe("V23 at the Confirmar", () => {
  it("the basis still holds: the group runs, and the derived action's confirm carries the in-transaction precondition", async () => {
    plan(true);
    const { s, sessionId, view } = await conversation();
    const done = await s.confirmActionPlanGroup(actor, sessionId, approvalOf(view.action_plan!, "segunda"));
    expect(db.writes.map(write => write.precondition)).toEqual([false, true]);
    expect(action(done, "primeira").status).toBe("DONE"); expect(action(done, "segunda").status).toBe("DONE");
  });
  it("the basis changed (the delegated professional is no longer the least busy): the whole group is held, zero writes", async () => {
    plan(true);
    const { s, sessionId, view } = await conversation();
    counts({ "pro-otavio": 0, "pro-petra": 2 });
    const held = await s.confirmActionPlanGroup(actor, sessionId, approvalOf(view.action_plan!, "segunda"));
    expect(db.writes).toEqual([]);
    for (const key of ["primeira", "segunda"]) expect(action(held, key)).toMatchObject({ status: "NEEDS_INPUT", assessment: { issue: "REVIEW_REQUIRED", preview: agentBasisChangedMessage } });
    expect(held.action_plan!.confirmation_groups.some(group => group.status === "READY_FOR_CONFIRMATION")).toBe(false);
    // The derived value left with its basis: the next preparation asks who attends (never the stale pick).
    const second = child(s, held, "segunda").scheduling!;
    expect(second.agent_basis).toBeUndefined(); expect(second.fields.professional_ref).toBeUndefined(); expect(second.proposal).toBeUndefined();
    // The old approval is stale now.
    await expect(s.confirmActionPlanGroup(actor, sessionId, approvalOf(view.action_plan!, "segunda"))).rejects.toThrow("CONFIRMATION_STALE");
    expect(db.writes).toEqual([]);
  });
  it("\"Confirmar tudo\": a group that ran first changes the basis of the next one, which is not executed", async () => {
    plan(false);
    const { s, sessionId, view } = await conversation();
    expect(view.action_plan!.confirmation_groups).toHaveLength(2);
    // After the first write the second professional is the busier one.
    counts(() => db.writes.length ? { "pro-otavio": 0, "pro-petra": 4 } : { "pro-otavio": 3, "pro-petra": 0 });
    const approvals = view.action_plan!.confirmation_groups.map(group => ({ plan_ref: view.action_plan!.plan_ref, revision: view.action_plan!.revision, group_key: group.key, fingerprint: group.fingerprint }));
    const done = await s.confirmReadyGroups(actor, sessionId, approvals);
    expect(db.writes).toHaveLength(1);
    const second = approvalOf(view.action_plan!, "segunda").group_key;
    expect(done.confirmation_batch!.executed).toEqual([approvalOf(view.action_plan!, "primeira").group_key]);
    expect(done.confirmation_batch!.not_executed).toEqual([{ group_key: second, code: "GROUP_CHANGED" }]);
    expect(action(done, "primeira").status).toBe("DONE");
    expect(action(done, "segunda")).toMatchObject({ status: "NEEDS_INPUT", assessment: { issue: "REVIEW_REQUIRED" } });
    // Outside any router trace too, the held group's derived value leaves with its basis (asked again, never re-proposed).
    const held = child(s, done, "segunda").scheduling!;
    expect(held.agent_basis).toBeUndefined(); expect(held.fields.professional_ref).toBeUndefined(); expect(held.proposal).toBeUndefined();
  });
  it("a plan without derived values reads nothing at the Confirmar", async () => {
    plan(true);
    (db.validation as { actions: AgentActionOutcome[] }).actions[1].basis = [];
    const reads = vi.fn(async () => 0);
    db.reader = { performers: async () => { await reads(); return []; }, bookable: async () => { await reads(); return false; }, activeCount: async () => reads() };
    const { s, sessionId, view } = await conversation();
    await s.confirmActionPlanGroup(actor, sessionId, approvalOf(view.action_plan!, "segunda"));
    expect(reads).not.toHaveBeenCalled();
    expect(db.writes.map(write => write.precondition)).toEqual([false, false]);
  });
});
