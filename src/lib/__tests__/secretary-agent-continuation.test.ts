import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** C5 agent Phase 2 (flag SALON_SECRETARY_AGENT; S1b rerun, part B): a message on an OPEN plan the agent built goes through the agent with the
 * plan's state (keys, states, what is missing, accepted values as refs of the message; customers masked as decision 22). Its answer to a field,
 * its correction of a ready action and its new request become patches of the open actions (on their own children) and additions to the plan;
 * its dismissal is scoped by the owner's own words, never less than said (V11): a dismissal that names nothing gives up every open action, one
 * that names an action gives up that one when the model agrees, anything unclear asks with nothing confirmable. The same scope guards the C4's
 * DISCARD on an agent plan (fallback path). Clicks are unchanged; flag off, the C4 rule stays exactly as it was. The loop runs over the offline
 * fake model; the validator's verdict and the tenant's rows are fixtures; the domain confirm only records what it would write. Synthetic salon
 * and diverse names; owner messages are short synthetic fragments; no gender is inferred from a name. */
type Seen = { purpose: string; context: boolean; used: number | undefined };
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[], writes: [] as string[], validation: undefined as unknown, seen: [] as Seen[] }));
const plusHour = (local: string) => `${local.slice(0, 11)}${String(Number(local.slice(11, 13)) + 1).padStart(2, "0")}${local.slice(13)}`;
const SERVICES: Record<string, string> = { "srv-luzes": "Luzes californianas" };
const TEAM = [{ id: "pro-farah", name: "Farah Nakashima" }, { id: "pro-teodoro", name: "Teodoro Aguiar" }];
const CUSTOMERS: Record<string, string> = { "cli-marisol": "Marisol Ikeda", "cli-dagoberto": "Dagoberto Nunes" };
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
  confirmAppointmentCreate: async (_tx: unknown, _actor: unknown, input: { proposal_ref: string; draft_revision: number }) => {
    db.writes.push(input.proposal_ref);
    return { proposal_ref: input.proposal_ref, draft_ref: "synthetic-draft", draft_revision: input.draft_revision, outcome: "CONFIRMED", appointment_ref: crypto.randomUUID() };
  } }));
vi.mock("../scheduling-mutations", async importOriginal => ({ ...await importOriginal<object>(), authorizeSchedulingOperation: async () => "OWNER", locateSchedulingAppointments: async () => [] }));
// Each model call's usage STARTED event records whether it ran inside the agent's message context and how many of its calls were taken by then.
vi.mock("../salon-secretary-usage", async importOriginal => ({ ...await importOriginal<object>(),
  usageRecorder: () => async (event: { status: string; purpose: string }) => {
    if (event.status !== "STARTED") return;
    const { agentMessage } = await import("../../../packages/salon-secretary/src/agent-context"), context = agentMessage();
    db.seen.push({ purpose: event.purpose, context: !!context, used: context?.calls.used() });
  } }));
// The message's lookups: a directory and nothing to read (the fixture plans need no lookup round).
vi.mock("../secretary-agent-lookups", async importOriginal => ({ ...await importOriginal<object>(),
  createAgentLookupExecutor: () => ({ directory: async () => ({ ok: true, directory: { today: { date: "2031-06-10", weekday: "terça-feira", timezone: "America/Sao_Paulo" }, professionals: [], services: [] } }),
    round: async (calls: readonly unknown[]) => calls.map(() => "{}") }) }));
// The validator's verdict is a fixture (the validator itself, contract A7: secretary-agent-validator.test.ts); no derived basis.
vi.mock("../secretary-agent-validator", async importOriginal => ({ ...await importOriginal<object>(), validateAgentPlanInTenant: async () => db.validation,
  agentFactReader: async () => ({ performers: async () => [], bookable: async () => true, activeCount: async () => 0 }) }));
import { SalonSecretary, type SecretaryView } from "../salon-secretary";
import { AGENT_DISMISSAL_ASK_NOTICE, AGENT_PATCH_DONE_NOTICE, AGENT_UNCLEAR_DISMISSAL_NOTICE, agentAppendSkeleton, agentContinuationEligible, agentDismissalActions,
  agentDismissalClause, agentDismissalScope, agentLooseNegator, agentOpenExecutor, agentOpenPlanFacts, agentOpenPlanState, agentOpenScope, agentOpenState,
  agentOpenStateRefused, agentQuoteSpans, agentHalfDayPending, type AgentDismissalAction, type AgentOpenSource } from "../secretary-agent-apply";
import { createAgentFakeModel, fakePlanCall, fakeReasoning, talkPlan } from "../../test/secretary-agent-fake-model";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import type { AgentActionOutcome } from "../secretary-agent-validator";
import type { SchedulingFields } from "../scheduling-contract";
import { AGENT_DEPENDENCY_FLAGS, AGENT_LIMITS, AGENT_NAME_MASK, AGENT_UNSAID_CUSTOMER, createAgentBinding, withAgentMessage, type AgentLookupExecutor } from "../../../packages/salon-secretary/src/agent-context";
import { AGENT_PLAN_LABEL } from "../../../packages/salon-secretary/src/agent-prompt";
import type { ActionPlan, Model, ModelRequest } from "@everflair/salon-secretary";

const actor = { salonId: "synthetic-continuation-studio", userId: "synthetic-continuation-owner" };
const DAY = "2031-06-12";
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2031-06-10T12:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  vi.stubEnv("SALON_SECRETARY_AGENT", "true");
  for (const flag of AGENT_DEPENDENCY_FLAGS) vi.stubEnv(flag, "true");
  Object.assign(db, { rows: [], writes: [], validation: undefined, seen: [] });
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(row); return row; }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null),
  } } as unknown as Tx;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const outcome = (key: string, fields: SchedulingFields, extra: Partial<AgentActionOutcome> = {}): AgentActionOutcome => ({
  key, operation: "appointment.create", status: "READY", fields, cleared: [], card: null, question: null, asked: null, ambiguities: [], origin: null, derived: null, recurrence: null,
  dependsOn: [], releasedSlotOf: null, basis: [], premises: [], note: [], notice: null, codes: [], names: {}, ...extra });
/** One booking the validator accepted; `time` absent: the day is said and the clock is still asked (an open question). */
const booking = (key: string, customer: string, time: string | undefined, extra: Partial<AgentActionOutcome> = {}) =>
  outcome(key, { customer_ref: customer, service_ref: "srv-luzes", professional_ref: "pro-farah", date: DAY, ...time ? { time } : {} }, { names: { [customer]: CUSTOMERS[customer] }, ...extra });
const planOf = (...actions: AgentActionOutcome[]) => ({ ok: true, result: "PLANO", notices: [], question: null, reply: null, codes: [], actions });
const NOTHING = planOf();
/** The model's plan (any valid propor_plano: the validator's verdict above is what the backend uses). */
const acao = (chave: string, inicio: string, extra: Record<string, unknown> = {}) => ({ chave, operacao: "appointment.create", citacao_acao: "trecho sintético", atendimento: null,
  cliente: null, profissional: null, novo_profissional: null, servicos: null, inicio, fim: null, dia: null, motivo: null, recorrencia: null, depende_de: [], ocupa_horario_de: null,
  bases: [{ campo: "inicio", tipo: "DITO", ref: null, citacao: "trecho" }], premissas: [], ...extra });
const lunaPlan = (actions: Record<string, unknown>[], descartar: unknown = null) => ({ resultado: "PLANO", resposta: null, acoes_fora: 0, pergunta: null, acoes: actions, descartar });
const agentModel = (tag: string, plan: unknown) => createAgentFakeModel([{ output: [fakeReasoning(`rs_${tag}`), fakePlanCall(plan, `call_${tag}`)] }]);
const dismissal = (alcance: "PLANO" | "ACOES", chaves: string[], citacao: string) => lunaPlan([], { alcance, chaves, citacao });
/** A Secretária whose model factory hands out these models in order (one per message path that asks for one). */
function secretary(models: Model[]) {
  const queue = [...models];
  return new SalonSecretary(async () => { const next = queue.shift(); if (!next) throw Error("NO_RECORDED_MODEL"); return next; }, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
}
type Stored = { turns: number; actionPlan?: ActionPlan; agentPlan?: string };
const stored = (s: SalonSecretary, sessionId: string) => (s as unknown as { sessions: Map<string, Stored> }).sessions.get(sessionId)!;
const approvalOf = (p: ActionPlan, key: string) => { const group = p.confirmation_groups.find(item => item.action_keys.includes(key))!;
  return { plan_ref: p.plan_ref, revision: p.revision, group_key: group.key, fingerprint: group.fingerprint }; };
const statuses = (view: SecretaryView) => view.action_plan!.actions.map(action => [action.key, action.status]);
const draftOf = (view: SecretaryView, key: string) => view.operations!.find(op => op.action_keys?.includes(key))!.state.scheduling!.draft!;
const routerAgents = () => db.rows.filter(row => row.entityType === "SECRETARY_ROUTER").map(row => (row.metadata as { outcome?: { agent?: Record<string, unknown> } | null }).outcome?.agent);
const nothingConfirmable = (view: SecretaryView) => view.action_plan!.confirmation_groups.every(group => group.status !== "READY_FOR_CONFIRMATION");
/** The plan's state the model read in a request (the system part after its label). */
function planState(request: ModelRequest): { acoes: Record<string, unknown>[]; clientes?: { ref: string; nome: string }[] } {
  const parts = (request.input as unknown as { content: { text: string }[] }[])[0].content, part = parts.find(item => item.text.startsWith(`${AGENT_PLAN_LABEL} `))!;
  return JSON.parse(part.text.slice(AGENT_PLAN_LABEL.length + 1));
}
/** An open agent plan: Marisol's booking ready to confirm, Dagoberto's waiting for its clock. `next`: the models of the following messages. */
async function openPlan(next: Model[]) {
  const first = agentModel("a", lunaPlan([acao("primeira", `${DAY}T10:00`), acao("segunda", `${DAY}T15:00`)])), s = secretary([first, ...next]);
  const { sessionId } = await s.start(actor, "auto");
  db.validation = planOf(booking("primeira", "cli-marisol", "10:00"), booking("segunda", "cli-dagoberto", undefined));
  const view = await s.send(actor, { sessionId, message: "pedido sintético inicial" });
  expect(first.mismatches).toEqual([]); expect(view.agent_plan).toBe(true);
  expect(statuses(view)).toEqual([["primeira", "READY_FOR_CONFIRMATION"], ["segunda", "NEEDS_INPUT"]]);
  return { s, sessionId, view, session: () => stored(s, sessionId) };
}

describe("Phase 2 routing and patches: the agent continues its own open plan", () => {
  it("an answer to the open question is that action's patch: prepared on its own child (same draft, next revision), the plan kept, the turn counted once", async () => {
    const second = agentModel("b", lunaPlan([acao("segunda", `${DAY}T15:00`)]));
    const { s, sessionId, view, session } = await openPlan([second]);
    const before = draftOf(view, "segunda"), turns = session().turns, seen = db.seen.length;
    db.validation = planOf(booking("segunda", "cli-dagoberto", "15:00", { patch: true }));
    const next = await s.send(actor, { sessionId, message: "Dagoberto às 15h" });
    expect(second.requests).toHaveLength(1); expect(second.mismatches).toEqual([]);
    // The state the model read: both actions, their states and what is missing; customers masked (only the words written in this message).
    const state = planState(second.requests[0]);
    expect(state.acoes.map(action => [action.chave, action.estado])).toEqual([["primeira", "PRONTA"], ["segunda", "FALTA"]]);
    expect(state.acoes[1].falta).toContain("inicio");
    expect(state.clientes).toEqual([{ ref: "c1", nome: AGENT_UNSAID_CUSTOMER }, { ref: "c2", nome: `Dagoberto ${AGENT_NAME_MASK}` }]);
    for (const hidden of ["Marisol", "Ikeda", "Nunes", "9000", "NOVO AGENDAMENTO"]) expect(JSON.stringify(state)).not.toContain(hidden);
    expect(next.action_plan!.plan_ref).toBe(view.action_plan!.plan_ref);
    expect(statuses(next)).toEqual([["primeira", "READY_FOR_CONFIRMATION"], ["segunda", "READY_FOR_CONFIRMATION"]]);
    const after = draftOf(next, "segunda");
    expect(after.draft_ref).toBe(before.draft_ref); expect(after.draft_revision).toBeGreaterThan(before.draft_revision);
    expect(after.fields.time).toBe("15:00");
    expect(session().turns).toBe(turns + 1);
    expect(db.seen.slice(seen).map(event => [event.purpose.startsWith("AGENT"), event.context, event.used])).toEqual([[true, true, 1]]);
    expect(routerAgents().at(-1)).toMatchObject({ path: "AGENT", fallback_code: null, rounds: 1 });
  });

  it("a correction of a ready action replaces its proposal; the approval of the old proposal never confirms", async () => {
    const second = agentModel("b", lunaPlan([acao("primeira", `${DAY}T11:00`)]));
    const { s, sessionId, view } = await openPlan([second]);
    const old = approvalOf(view.action_plan!, "primeira");
    db.validation = planOf(booking("primeira", "cli-marisol", "11:00", { patch: true }));
    const next = await s.send(actor, { sessionId, message: "Marisol às 11h" });
    expect(statuses(next)).toEqual([["primeira", "READY_FOR_CONFIRMATION"], ["segunda", "NEEDS_INPUT"]]);
    expect(draftOf(next, "primeira").fields.time).toBe("11:00");
    await expect(s.confirmActionPlanGroup(actor, sessionId, old)).rejects.toThrow();
    expect(db.writes).toEqual([]);
    const done = await s.confirmActionPlanGroup(actor, sessionId, approvalOf(next.action_plan!, "primeira"));
    expect(statuses(done)[0]).toEqual(["primeira", "DONE"]); expect(db.writes).toHaveLength(1);
  });

  it("a new request on the open plan joins it (never replaces it): a new key with its own child, the open actions untouched", async () => {
    const second = agentModel("b", lunaPlan([acao("terceira", `${DAY}T17:00`)]));
    const { s, sessionId, view } = await openPlan([second]);
    db.validation = planOf(booking("terceira", "cli-dagoberto", "17:00"));
    const next = await s.send(actor, { sessionId, message: "Dagoberto também às 17h" });
    expect(next.action_plan!.plan_ref).toBe(view.action_plan!.plan_ref);
    expect(statuses(next)).toEqual([["primeira", "READY_FOR_CONFIRMATION"], ["segunda", "NEEDS_INPUT"], ["terceira", "READY_FOR_CONFIRMATION"]]);
    expect(next.suspended_plans ?? []).toEqual([]);
    expect(draftOf(next, "primeira").draft_ref).toBe(draftOf(view, "primeira").draft_ref);
    expect(new Set(next.operations!.map(op => op.operation_ref)).size).toBe(3);
  });

  it("a change of an action already confirmed never runs again: the write count stays and the reply says so", async () => {
    const second = agentModel("b", lunaPlan([acao("primeira", `${DAY}T12:00`)]));
    const { s, sessionId, view } = await openPlan([second]);
    const done = await s.confirmActionPlanGroup(actor, sessionId, approvalOf(view.action_plan!, "primeira"));
    expect(statuses(done)).toEqual([["primeira", "DONE"], ["segunda", "NEEDS_INPUT"]]); expect(db.writes).toHaveLength(1);
    db.validation = planOf(booking("primeira", "cli-marisol", "12:00", { patch: true }));
    const next = await s.send(actor, { sessionId, message: "Marisol às 12h" });
    expect(second.requests).toHaveLength(1);
    expect(statuses(next)).toEqual([["primeira", "DONE"], ["segunda", "NEEDS_INPUT"]]);
    expect(next.message).toContain(AGENT_PATCH_DONE_NOTICE);
    expect(db.writes).toHaveLength(1);
  });

  it("an open action waiting on the C4's half-day question keeps the message with the C4 (its typed answer is the C4's): the agent never reads it", async () => {
    const c4 = new ScriptedServicesModel([call("upsert_action_draft", { turn: { mode: "CONVERSATION", response: "Resposta sintética da C4." } })]);
    const { s, sessionId, view } = await openPlan([c4]);
    type Held = { actionUnits?: { keys: string[]; child?: string }[]; scheduling?: Record<string, unknown> };
    const sessions = (s as unknown as { sessions: Map<string, Held> }).sessions, unit = sessions.get(sessionId)!.actionUnits!.find(item => item.keys.includes("segunda"))!;
    sessions.get(unit.child!)!.scheduling!.pending_temporal_ambiguities = [{ field: "time", kind: "CLOCK_DAYPART", expression: "às 4", candidates: ["04:00", "16:00"] }];
    const seen = db.seen.length;
    const next = await s.send(actor, { sessionId, message: "de tarde" });
    expect(db.seen.slice(seen).every(event => !event.purpose.startsWith("AGENT"))).toBe(true);
    expect(next.action_plan!.plan_ref).toBe(view.action_plan!.plan_ref);
    expect(db.writes).toEqual([]);
  });

  it("what this path cannot apply goes whole to the C4 continuation, before anything changes (a booking in the slot of a create)", async () => {
    const second = agentModel("b", lunaPlan([acao("no_lugar", `${DAY}T10:00`, { depende_de: ["primeira"], ocupa_horario_de: "primeira" })]));
    const c4 = new ScriptedServicesModel([call("upsert_action_draft", { turn: { mode: "CONVERSATION", response: "Resposta sintética da C4." } })]);
    const { s, sessionId, view } = await openPlan([second, c4]);
    db.validation = planOf(booking("no_lugar", "cli-dagoberto", "10:00", { dependsOn: ["primeira"], releasedSlotOf: "primeira" }));
    const next = await s.send(actor, { sessionId, message: "Dagoberto no lugar dela" });
    expect(second.requests).toHaveLength(1); expect(c4.requests).toHaveLength(1);
    expect(next.action_plan!.actions.map(action => action.key)).toEqual(["primeira", "segunda"]);
    expect(draftOf(next, "primeira").draft_ref).toBe(draftOf(view, "primeira").draft_ref);
    expect(routerAgents().at(-1)).toMatchObject({ path: "C4_FALLBACK", fallback_code: "AGENT_RELEASED_UNSUPPORTED" });
  });
});

describe("Phase 2 dismissal: never less than the owner said (V11)", () => {
  it("V11, structural: one ready action and one waiting; a dismissal that names nothing gives up EVERY open action, whatever keys the model chose", async () => {
    const second = agentModel("b", dismissal("ACOES", ["segunda"], "desisti disso"));
    const { s, sessionId, view } = await openPlan([second]);
    db.validation = NOTHING;
    const next = await s.send(actor, { sessionId, message: "desisti disso" });
    expect(second.mismatches).toEqual([]);
    expect(next.action_plan).toBeUndefined();
    expect(next.retired_plan!.actions.map(action => [action.key, action.status])).toEqual([["primeira", "DISCARDED"], ["segunda", "DISCARDED"]]);
    await expect(s.confirmActionPlanGroup(actor, sessionId, approvalOf(view.action_plan!, "primeira"))).rejects.toThrow();
    expect(db.writes).toEqual([]);
  });

  it("a dismissal naming one action gives up exactly that one when the model agrees; the other stays confirmable", async () => {
    const second = agentModel("b", dismissal("ACOES", ["segunda"], "tira a Dagoberto"));
    const { s, sessionId } = await openPlan([second]);
    db.validation = NOTHING;
    const next = await s.send(actor, { sessionId, message: "tira a Dagoberto" });
    expect(statuses(next)).toEqual([["primeira", "READY_FOR_CONFIRMATION"], ["segunda", "DISCARDED"]]);
    const done = await s.confirmActionPlanGroup(actor, sessionId, approvalOf(next.action_plan!, "primeira"));
    expect(statuses(done)).toEqual([["primeira", "DONE"], ["segunda", "DISCARDED"]]); expect(db.writes).toHaveLength(1);
  });

  it("adversarial: a keep/exception word, or keys that differ from the owner's words, asks; nothing is given up and nothing stays confirmable", async () => {
    const cases: [string, unknown][] = [["larga tudo menos a Marisol", dismissal("PLANO", [], "larga tudo menos a Marisol")],
      ["tira a Dagoberto", dismissal("ACOES", ["primeira"], "tira a Dagoberto")], ["larga a primeira", dismissal("ACOES", ["primeira"], "larga a primeira")]];
    for (const [message, plan] of cases) {
      const second = agentModel("b", plan);
      const { s, sessionId, view } = await openPlan([second]);
      db.validation = NOTHING;
      const next = await s.send(actor, { sessionId, message });
      expect(statuses(next), message).toEqual([["primeira", "NEEDS_INPUT"], ["segunda", "NEEDS_INPUT"]]);
      expect(next.action_plan!.actions[0].assessment.issue, message).toBe("REVIEW_REQUIRED");
      expect(nothingConfirmable(next), message).toBe(true);
      expect(next.message, message).toContain(AGENT_DISMISSAL_ASK_NOTICE);
      await expect(s.confirmActionPlanGroup(actor, sessionId, approvalOf(view.action_plan!, "primeira"))).rejects.toThrow();
    }
    expect(db.writes).toEqual([]);
  });

  it("adversarial (V11): an elliptical dismissal ('… e da X') whose keys leave the ready action out asks; it never stays confirmable", async () => {
    const second = agentModel("b", dismissal("ACOES", ["segunda"], "desisto da Dagoberto"));
    const { s, sessionId, view } = await openPlan([second]);
    db.validation = NOTHING;
    const next = await s.send(actor, { sessionId, message: "desisto da Dagoberto e da Marisol" });
    expect(second.mismatches).toEqual([]);
    expect(statuses(next)).toEqual([["primeira", "NEEDS_INPUT"], ["segunda", "NEEDS_INPUT"]]);
    expect(next.action_plan!.actions[0].assessment.issue).toBe("REVIEW_REQUIRED");
    expect(nothingConfirmable(next)).toBe(true);
    expect(next.message).toContain(AGENT_DISMISSAL_ASK_NOTICE);
    await expect(s.confirmActionPlanGroup(actor, sessionId, approvalOf(view.action_plan!, "primeira"))).rejects.toThrow();
    expect(db.writes).toEqual([]);
  });

  it("V11 on the C4 path: the agent fails, the C4 reads the dismissal as the waiting action only; the guard gives up every open action", async () => {
    const failing = createAgentFakeModel([{ output: [], fail: "TRANSPORT" }]);
    const c4 = new ScriptedServicesModel([call("upsert_action_draft", { turn: { mode: "DISCARD", item_keys: ["segunda"] } })]);
    const { s, sessionId } = await openPlan([failing, c4]);
    const next = await s.send(actor, { sessionId, message: "desisti disso" });
    expect(failing.requests).toHaveLength(1); expect(c4.requests).toHaveLength(1);
    expect(next.action_plan).toBeUndefined();
    expect(next.retired_plan!.actions.map(action => [action.key, action.status])).toEqual([["primeira", "DISCARDED"], ["segunda", "DISCARDED"]]);
    expect(routerAgents().at(-1)).toMatchObject({ path: "C4_FALLBACK", fallback_code: "AGENT_TRANSPORT" });
    expect(db.writes).toEqual([]);
  });

  it("a bare refusal read as neither a dismissal nor a change holds the ready proposal for review (nothing confirmable)", async () => {
    const second = agentModel("b", talkPlan("Certo."));
    const { s, sessionId, view } = await openPlan([second]);
    db.validation = { ok: true, result: "CONVERSA", actions: [], notices: [], question: null, reply: "Certo.", codes: [] };
    const next = await s.send(actor, { sessionId, message: "Não." });
    expect(next.action_plan!.actions[0]).toMatchObject({ key: "primeira", status: "NEEDS_INPUT", assessment: { issue: "REVIEW_REQUIRED" } });
    expect(nothingConfirmable(next)).toBe(true);
    expect(next.message).toContain(AGENT_UNCLEAR_DISMISSAL_NOTICE);
    await expect(s.confirmActionPlanGroup(actor, sessionId, approvalOf(view.action_plan!, "primeira"))).rejects.toThrow();
    expect(db.writes).toEqual([]);
  });

  it("the per-action Descartar (a click) is unchanged: exactly that action, no model call", async () => {
    const { s, sessionId, view } = await openPlan([]);
    const seen = db.seen.length;
    const after = await s.discardAction(actor, sessionId, { plan_ref: view.action_plan!.plan_ref, action_key: "segunda" });
    expect(statuses(after)).toEqual([["primeira", "READY_FOR_CONFIRMATION"], ["segunda", "DISCARDED"]]);
    expect(db.seen.length).toBe(seen);
  });

  it("flag off: the same C4 dismissal on a stored agent plan keeps the C4's own rule (exactly its keys), with no message context", async () => {
    const c4 = new ScriptedServicesModel([call("upsert_action_draft", { turn: { mode: "DISCARD", item_keys: ["segunda"] } })]);
    const { s, sessionId } = await openPlan([c4]);
    vi.stubEnv("SALON_SECRETARY_AGENT", "false");
    const seen = db.seen.length;
    const next = await s.send(actor, { sessionId, message: "desisti disso" });
    expect(c4.requests).toHaveLength(1);
    expect(statuses(next)).toEqual([["primeira", "READY_FOR_CONFIRMATION"], ["segunda", "DISCARDED"]]);
    expect(db.seen.slice(seen).every(event => !event.context && !event.purpose.startsWith("AGENT"))).toBe(true);
  });
});

describe("Phase 2 units: eligibility, the plan's state, the dismissal scope and the additions", () => {
  const source = (key: string, extra: Partial<AgentOpenSource> = {}): AgentOpenSource => ({ key, operation: "appointment.create", status: "READY_FOR_CONFIRMATION", missing: [],
    dependsOn: [], fields: { customer_ref: "cli-yasmin", service_ref: "srv-pe", professional_ref: "pro-oto", date: DAY, time: "09:00" },
    names: { "cli-yasmin": "Yasmin Okonkwo", "srv-pe": "Reflexologia podal", "pro-oto": "Otávio Brandt" }, basis: [], ...extra });
  it("eligibility: an open plan the agent built, no card answer nor pending discard, no confirmed release, no open suspended plan, under the turn limit", () => {
    const open = { plan_ref: "plano-x", actions: [{ status: "DONE", operation: "appointment.create" }, { status: "NEEDS_INPUT", operation: "appointment.create" }] };
    const base = { multiActionV2: true, turns: 3, actionPlan: open, agentPlan: "plano-x" };
    expect(agentContinuationEligible(base)).toBe(true);
    expect(agentContinuationEligible({ ...base, agentPlan: "outro" })).toBe(false);
    expect(agentContinuationEligible({ ...base, agentPlan: undefined })).toBe(false);
    expect(agentContinuationEligible(base, "operation-ref")).toBe(false);
    expect(agentContinuationEligible({ ...base, pendingDiscard: { plan_ref: "plano-x", keys: [], question: "?" } })).toBe(false);
    expect(agentContinuationEligible({ ...base, actionPlan: { ...open, actions: [{ status: "DONE", operation: "appointment.cancel" }, { status: "NEEDS_INPUT" }] } })).toBe(false);
    expect(agentContinuationEligible({ ...base, actionPlan: { ...open, actions: [{ status: "DONE" }, { status: "DISCARDED" }] } })).toBe(false);
    expect(agentContinuationEligible({ ...base, suspendedPlans: [{ actionPlan: { actions: [{ status: "READY" }] } }] })).toBe(false);
    expect(agentContinuationEligible({ ...base, turns: 20 })).toBe(false);
    expect(agentContinuationEligible({ ...base, multiActionV2: false })).toBe(false);
  });
  it("a plan whose open action waits on the C4's half-day question stays with the C4; a closed action's question never counts", () => {
    const count = (held: Record<string, number>) => (key: string) => held[key];
    expect(agentHalfDayPending([{ key: "a", status: "NEEDS_INPUT" }, { key: "b", status: "READY_FOR_CONFIRMATION" }], count({ a: 1 }))).toBe(true);
    expect(agentHalfDayPending([{ key: "a", status: "DONE" }, { key: "b", status: "DISCARDED" }], count({ a: 1, b: 2 }))).toBe(false);
    expect(agentHalfDayPending([{ key: "a", status: "NEEDS_INPUT" }], count({}))).toBe(false);
  });
  it("the state: refs of this message only, masked customers, no reason, price, phone or backend text; discarded actions left out", () => {
    const binding = createAgentBinding();
    binding.bind("p", "pro-oto", { name: "Otávio Brandt" }); binding.bind("s", "srv-pe", { name: "Reflexologia podal", durationMin: 50 });
    const sources = [source("pe_yasmin"), source("cancela", { operation: "appointment.cancel", status: "NEEDS_INPUT", missing: ["reason"], origin: `${DAY}T14:00`,
      fields: { customer_ref: "cli-wendel", date: DAY, time: "14:00", reason: "motivo particular sigiloso" }, names: { "cli-wendel": "Wendel Okafor" } }),
      source("velha", { status: "DISCARDED" })];
    const text = agentOpenPlanState(sources, binding, ["Yasmin pode vir"])!;
    const state = JSON.parse(text) as { acoes: Record<string, unknown>[]; clientes: { ref: string; nome: string }[] };
    expect(state.acoes.map(action => action.chave)).toEqual(["pe_yasmin", "cancela"]);
    expect(state.acoes[0]).toEqual({ chave: "pe_yasmin", operacao: "appointment.create", estado: "PRONTA", valores: { cliente: "c1", profissional: "p1", servicos: ["s1"], inicio: `${DAY}T09:00` } });
    expect(state.acoes[1]).toEqual({ chave: "cancela", operacao: "appointment.cancel", estado: "FALTA", falta: ["motivo"], valores: { cliente: "c2", origem: `${DAY}T14:00` } });
    expect(state.clientes).toEqual([{ ref: "c1", nome: `Yasmin ${AGENT_NAME_MASK}` }, { ref: "c2", nome: AGENT_UNSAID_CUSTOMER }]);
    for (const hidden of ["Okonkwo", "Wendel", "Okafor", "sigiloso", "cli-", "pro-", "srv-"]) expect(text).not.toContain(hidden);
    expect(agentOpenState({ status: "NEEDS_INPUT", issue: "REVIEW_REQUIRED" })).toBe("REVISAR");
    expect(agentOpenState({ status: "FAILED_SAFE" })).toBe("REVISAR");
    expect(agentOpenState({ status: "DONE" })).toBe("FEITA");
  });
  it("the state never goes over 3 KB: past it there is no state (the message stays with the C4)", () => {
    const many = Array.from({ length: 40 }, (_, index) => source(`acao_${index}`, { dependsOn: ["pe_yasmin"], origin: `${DAY}T09:00` }));
    expect(agentOpenPlanState(many, createAgentBinding(), [])).toBeNull();
    expect(Buffer.byteLength(agentOpenPlanState(many.slice(0, 2), createAgentBinding(), [])!)).toBeLessThanOrEqual(AGENT_LIMITS.planStateBytes);
  });
  it("the scope, the facts and the executor: keys of the open plan, done ones apart; a state that cannot be rendered refuses the directory before any call", async () => {
    const sources = [source("feito", { status: "DONE" }), source("aberto", { status: "NEEDS_INPUT" }), source("fora", { status: "DISCARDED" })];
    const scope = agentOpenScope(sources, ["qualquer coisa"]);
    expect([scope.keys, scope.done]).toEqual([["feito", "aberto"], ["feito"]]);
    expect(agentOpenPlanFacts(sources).actions.map(action => [action.key, action.status, action.customer])).toEqual([["feito", "DONE", "cli-yasmin"], ["aberto", "OPEN", "cli-yasmin"]]);
    const base: AgentLookupExecutor = { directory: async () => ({ ok: true, directory: { today: { date: DAY, weekday: "quinta-feira", timezone: "America/Sao_Paulo" }, professionals: [], services: [] } }),
      round: async calls => calls.map(() => "{}") };
    const executor = agentOpenExecutor(base);
    const refused = await withAgentMessage({ owner: ["x"], executor, open: { keys: ["aberto"], render: () => null } }, async context =>
      [await executor.directory(context), agentOpenStateRefused(context)] as const);
    expect(refused).toEqual([{ ok: false, code: "AGENT_UNAVAILABLE" }, true]);
    const rendered = await withAgentMessage({ owner: ["x"], executor, open: { keys: ["aberto"], render: () => '{"acoes":[{"chave":"aberto"}]}' } }, async context =>
      [await executor.directory(context), agentOpenStateRefused(context)] as const);
    expect(rendered[0]).toMatchObject({ ok: true, directory: { plan: '{"acoes":[{"chave":"aberto"}]}' } }); expect(rendered[1]).toBe(false);
    // Without an open plan the executor is the app's own (no state, no refusal).
    expect(await withAgentMessage({ owner: ["x"], executor }, async context => executor.directory(context))).toMatchObject({ ok: true });
  });
  describe("agentDismissalScope (pure, synthetic actions)", () => {
    const actions: AgentDismissalAction[] = [
      { key: "pe_yasmin", names: ["Yasmin Okonkwo", "Reflexologia podal", "Otávio Brandt"], dates: [DAY], clocks: ["09:00"] },
      { key: "tranca", names: ["Otávio Brandt"], dates: [DAY], clocks: ["15:00", "16:00"] }];
    /** `others`: the quotes of the plan's other requests in the same message (their parts are theirs, never the dismissal's). */
    const scope = (message: string, keys: string[] | null, quote?: string, others: string[] = []) => agentDismissalScope({ message, clause: agentDismissalClause(message, quote), keys, actions,
      timezone: "America/Sao_Paulo", now: new Date("2031-06-10T12:00:00Z"), known: ["Otávio Brandt", "Reflexologia podal", "Massagem relaxante", `Zuleide ${AGENT_NAME_MASK}`],
      covered: agentQuoteSpans(message, others) });
    it("nothing named: every open action, whatever keys came", () => {
      expect(scope("desisti disso", ["tranca"])).toEqual({ kind: "ALL" });
      expect(scope("larga mão", null)).toEqual({ kind: "ALL" });
      expect(scope("Não, desisti disso", null, "desisti disso")).toEqual({ kind: "ALL" });
    });
    it("named exactly as the keys: those; a day, clock or day part names actions too", () => {
      expect(scope("tira a Yasmin", ["pe_yasmin"])).toEqual({ kind: "KEYS", keys: ["pe_yasmin"] });
      expect(scope("tira o das 15h", ["tranca"])).toEqual({ kind: "KEYS", keys: ["tranca"] });
      expect(scope("tira o da tarde", ["tranca"])).toEqual({ kind: "KEYS", keys: ["tranca"] });
      expect(scope("tira o Otávio", null)).toEqual({ kind: "ALL" });
    });
    it("adversarial: exception, denial outside the clause, divergence, unmatched name or clock, ordinal: ask", () => {
      expect(scope("larga tudo menos a Yasmin", null)).toMatchObject({ kind: "ASK", code: "AGENT_DISMISSAL_EXCEPTION" });
      expect(scope("larga tudo, a Yasmin não", null, "larga tudo")).toMatchObject({ kind: "ASK", code: "AGENT_DISMISSAL_EXCEPTION" });
      expect(scope("larga tudo, mas não o de quinta", null, "larga tudo")).toMatchObject({ kind: "ASK", code: "AGENT_DISMISSAL_EXCEPTION" });
      expect(scope("tira a Yasmin", ["tranca"])).toMatchObject({ kind: "ASK", code: "AGENT_DISMISSAL_DIVERGENT" });
      expect(scope("tira a Yasmin", null)).toMatchObject({ kind: "ASK", code: "AGENT_DISMISSAL_DIVERGENT" });
      expect(scope("tira a massagem", ["pe_yasmin"])).toMatchObject({ kind: "ASK", code: "AGENT_DISMISSAL_UNMATCHED" });
      expect(scope("tira a Zuleide", ["pe_yasmin"])).toMatchObject({ kind: "ASK", code: "AGENT_DISMISSAL_UNMATCHED" });
      expect(scope("tira o das 11h", ["tranca"])).toMatchObject({ kind: "ASK", code: "AGENT_DISMISSAL_UNMATCHED" });
      expect(scope("tira a primeira", ["pe_yasmin"])).toMatchObject({ kind: "ASK", code: "AGENT_DISMISSAL_ORDINAL" });
      expect(scope("tira a Yasmin", ["pe_yasmin", "sumida"])).toMatchObject({ kind: "ASK", code: "AGENT_DISMISSAL_DIVERGENT" });
      // Without the salon's zone a day or clock cannot be read: ask.
      expect(agentDismissalScope({ message: "tira o das 15h", keys: ["tranca"], actions, now: new Date() })).toMatchObject({ kind: "ASK", code: "AGENT_DISMISSAL_UNMATCHED" });
    });
    it("another action of the same message stays outside the dismissal's clause", () => {
      expect(scope("tira a Yasmin e bloqueia a manhã do Otávio", ["pe_yasmin"], "tira a Yasmin", ["bloqueia a manhã do Otávio"])).toEqual({ kind: "KEYS", keys: ["pe_yasmin"] });
    });
    it("adversarial (V11): an open action named beside the dismissal, outside its clause and outside every other request, asks; never left confirmable", () => {
      // Elliptical coordination after the clause ("e o das 15h"), after a comma, or with a name: the keys leave that action out.
      expect(scope("tira a Yasmin e o das 15h", ["pe_yasmin"], "tira a Yasmin")).toMatchObject({ kind: "ASK", code: "AGENT_DISMISSAL_DIVERGENT" });
      expect(scope("tira a Yasmin, o das 16h também", ["pe_yasmin"], "tira a Yasmin")).toMatchObject({ kind: "ASK", code: "AGENT_DISMISSAL_DIVERGENT" });
      expect(scope("tira o das 15h e a Yasmin", ["tranca"], "tira o das 15h")).toMatchObject({ kind: "ASK", code: "AGENT_DISMISSAL_DIVERGENT" });
      // The same part, when no other request of the plan quotes it, is the dismissal's to read.
      expect(scope("tira a Yasmin e bloqueia a manhã do Otávio", ["pe_yasmin"], "tira a Yasmin")).toMatchObject({ kind: "ASK", code: "AGENT_DISMISSAL_DIVERGENT" });
      // Only what the keys leave out asks: the dismissed action named again outside the clause, or the whole plan given up, stays as it was.
      expect(scope("tira a Yasmin. A Yasmin desmarcou", ["pe_yasmin"], "tira a Yasmin")).toEqual({ kind: "KEYS", keys: ["pe_yasmin"] });
      expect(scope("esquece, o das 15h também", null, "esquece")).toEqual({ kind: "ALL" });
      expect(agentQuoteSpans("tira a Yasmin. tira a Yasmin", ["tira a Yasmin"])).toEqual([]);
    });
    it("the open actions as a dismissal names them: never a done one", () => {
      const named = agentDismissalActions([source("feito", { status: "DONE" }), source("aberto", { status: "NEEDS_INPUT", origin: `${DAY}T08:30` })]);
      expect(named).toEqual([{ key: "aberto", names: ["Yasmin Okonkwo", "Otávio Brandt", "Reflexologia podal"], dates: [DAY], clocks: ["09:00", "08:30"] }]);
    });
  });
  it("a bare refusal: a negator alone before punctuation, after interjections only", () => {
    for (const text of ["Não.", "não, deixa", "ah não!", "Opa, não"]) expect(agentLooseNegator(text), text).toBe(true);
    for (const text of ["a Yasmin não.", "não quero mais", "não pras 10, pras 11", "pode marcar"]) expect(agentLooseNegator(text), text).toBe(false);
  });
  it("additions: edges to open actions stay outside the selection; a discarded key is renamed; a dropped action takes its dependents along", () => {
    const added = (key: string, extra: Partial<AgentActionOutcome> = {}) => outcome(key, { customer_ref: "cli-yasmin", date: DAY, time: "18:00" }, extra);
    const skeleton = agentAppendSkeleton([added("depois", { dependsOn: ["aberto"] }), added("velha"), added("junto", { dependsOn: ["velha"] })], new Set(["aberto"]), new Set(["velha"]));
    expect(skeleton.selection!.operations.map(op => [op.item_key, op.depends_on])).toEqual([["depois", []], ["velha_2", []], ["junto", ["velha_2"]]]);
    expect([...skeleton.external]).toEqual([["depois", { dependsOn: ["aberto"], releasedSlotOf: null }], ["velha_2", { dependsOn: [], releasedSlotOf: null }],
      ["junto", { dependsOn: [], releasedSlotOf: null }]]);
    const dropped = agentAppendSkeleton([added("cai", { status: "DROP" }), added("segue_cai", { dependsOn: ["cai"] }), added("sem_ninguem", { dependsOn: ["sumida"] })], new Set(), new Set());
    expect(dropped.selection).toBeUndefined(); expect(dropped.dropped.sort()).toEqual(["cai", "segue_cai", "sem_ninguem"]);
  });
});
