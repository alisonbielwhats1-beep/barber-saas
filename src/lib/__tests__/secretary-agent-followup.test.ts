import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** S1 fix B2 (flag SALON_SECRETARY_AGENT; docs/c5-spike/11-especificacao-agente.md Phase 1, "no active plan" = no open action): a new request on a
 * CLOSED plan (every action DONE or DISCARDED) goes through the agent first. Its plan replaces the closed one as the C4's new request does (retired
 * when it can be, else suspended; no receipts carried over); a reply keeps it; a failure, or a customer pronoun with no referent in the message,
 * goes to the C4 continuation within the same calls and deadline, the turn counted once; an open plan, the flag off or a preparation that throws
 * leave everything as before. The loop runs over the offline fake model; the validator's verdict and the tenant's rows are fixtures; the domain
 * confirm only records what it would write. Synthetic salon and diverse names; no gender is inferred from a name. */
type Seen = { purpose: string; context: boolean; used: number | undefined };
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[], writes: [] as string[], validation: undefined as unknown,
  executors: 0, seen: [] as Seen[], failSkillLoad: false }));
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
// The message's lookups: a directory and nothing to read (the fixture plans need no lookup round); each message's executor is counted.
vi.mock("../secretary-agent-lookups", async importOriginal => ({ ...await importOriginal<object>(),
  createAgentLookupExecutor: () => { db.executors++;
    return { directory: async () => ({ ok: true, directory: { today: { date: "2031-06-10", weekday: "terça-feira", timezone: "America/Sao_Paulo" }, professionals: [], services: [] } }),
      round: async (calls: readonly unknown[]) => calls.map(() => "{}") }; } }));
// The validator's verdict is a fixture (the validator itself: secretary-agent-validator.test.ts); no derived basis, so nothing is read at the Confirmar.
vi.mock("../secretary-agent-validator", async importOriginal => ({ ...await importOriginal<object>(), validateAgentPlanInTenant: async () => db.validation,
  agentFactReader: async () => ({ performers: async () => [], bookable: async () => true, activeCount: async () => 0 }) }));
import { SalonSecretary } from "../salon-secretary";
import { AGENT_FOLLOW_UP_LIMITS, agentFollowUpEligible, agentPlanOpen, agentPlanReleased, agentPronounTopic } from "../secretary-agent-apply";
import { createAgentFakeModel, fakePlanCall, fakeReasoning, talkPlan, type AgentFakeModel } from "../../test/secretary-agent-fake-model";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import type { AgentActionOutcome, AgentValidation } from "../secretary-agent-validator";
import type { SchedulingFields } from "../scheduling-contract";
import { AGENT_DEPENDENCY_FLAGS } from "../../../packages/salon-secretary/src/agent-context";
import type { ActionPlan, Model } from "@everflair/salon-secretary";
import { RouterTrace, type AgentTurnOutcome, type TurnOutcome } from "../secretary-router";

const actor = { salonId: "synthetic-followup-studio", userId: "synthetic-followup-owner" };
const DAY = "2031-06-12";
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2031-06-10T12:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  vi.stubEnv("SALON_SECRETARY_AGENT", "true");
  for (const flag of AGENT_DEPENDENCY_FLAGS) vi.stubEnv(flag, "true");
  Object.assign(db, { rows: [], writes: [], validation: undefined, executors: 0, seen: [], failSkillLoad: false });
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (db.failSkillLoad && data.entityType === "SECRETARY_SKILL_LOAD") throw Error("SYNTHETIC_DATABASE_DOWN");
      const row = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(row); return row;
    }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null),
  } } as unknown as Tx;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const outcome = (key: string, fields: SchedulingFields, extra: Partial<AgentActionOutcome> = {}): AgentActionOutcome => ({
  key, operation: "appointment.create", status: "READY", fields, cleared: [], card: null, question: null, asked: null, ambiguities: [], origin: null, derived: null, recurrence: null,
  dependsOn: [], releasedSlotOf: null, basis: [], premises: [], note: [], notice: null, codes: [], names: {}, ...extra });
/** One booking the validator accepted (customer, service, professional, day and time proven). */
const booking = (key: string, customer: string, time: string, extra: Partial<AgentActionOutcome> = {}) =>
  outcome(key, { customer_ref: customer, service_ref: "srv-luzes", professional_ref: "pro-farah", date: DAY, time }, { names: { [customer]: CUSTOMERS[customer] }, ...extra });
const planOf = (...actions: AgentActionOutcome[]) => ({ ok: true, result: "PLANO", notices: [], question: null, reply: null, codes: [], actions });
/** The model's plan (any valid propor_plano: the validator's verdict above is what the backend uses). */
const acao = (chave: string, inicio: string) => ({ chave, operacao: "appointment.create", citacao_acao: "trecho sintético", atendimento: null, cliente: null, profissional: null,
  novo_profissional: null, servicos: null, inicio, fim: null, dia: null, motivo: null, recorrencia: null, depende_de: [], ocupa_horario_de: null,
  bases: [{ campo: "inicio", tipo: "DITO", ref: null, citacao: "trecho" }], premissas: [] });
const lunaPlan = (...actions: [string, string][]) => ({ resultado: "PLANO", resposta: null, acoes_fora: 0, pergunta: null, acoes: actions.map(([key, time]) => acao(key, `${DAY}T${time}`)) });
const agentModel = (tag: string, ...actions: [string, string][]) => createAgentFakeModel([{ output: [fakeReasoning(`rs_${tag}`), fakePlanCall(lunaPlan(...actions), `call_${tag}`)] }]);
const c4Conversation = () => new ScriptedServicesModel([call("select_capabilities", { turn: { mode: "CONVERSATION", response: "Resposta sintética da C4." } })]);
/** A Secretária whose model factory hands out these models in order (one per message path that asks for one). */
function secretary(models: Model[]) {
  const queue = [...models];
  return new SalonSecretary(async () => { const next = queue.shift(); if (!next) throw Error("NO_RECORDED_MODEL"); return next; }, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
}
type Stored = { turns: number; actionPlan?: ActionPlan; suspendedPlans?: { actionPlan?: ActionPlan; groupReceipts?: Set<string> }[]; groupReceipts?: Set<string>; agentPlan?: string };
const stored = (s: SalonSecretary, sessionId: string) => (s as unknown as { sessions: Map<string, Stored> }).sessions.get(sessionId)!;
const approvalOf = (p: ActionPlan, key: string) => { const group = p.confirmation_groups.find(item => item.action_keys.includes(key))!;
  return { plan_ref: p.plan_ref, revision: p.revision, group_key: group.key, fingerprint: group.fingerprint }; };
const routerAgents = () => db.rows.filter(row => row.entityType === "SECRETARY_ROUTER").map(row => (row.metadata as { outcome?: { agent?: Record<string, unknown> } | null }).outcome?.agent);
/** The agent's one booking, confirmed: a closed plan (its only action DONE). `next`: the models of the following messages. */
async function closedPlan(next: Model[]) {
  const first = agentModel("a", ["primeira", "10:00"]), s = secretary([first, ...next]);
  const { sessionId } = await s.start(actor, "auto");
  db.validation = planOf(booking("primeira", "cli-marisol", "10:00"));
  const view = await s.send(actor, { sessionId, message: "pedido sintético inicial" });
  expect(first.mismatches).toEqual([]); expect(view.agent_plan).toBe(true);
  const closed = await s.confirmActionPlanGroup(actor, sessionId, approvalOf(view.action_plan!, "primeira"));
  expect(closed.action_plan!.actions.map(action => action.status)).toEqual(["DONE"]);
  return { s, sessionId, closed, session: () => stored(s, sessionId) };
}
const noAgentCall = (seen: Seen[]) => seen.every(event => !event.purpose.startsWith("AGENT"));

describe("B2 eligibility (pure): a closed plan, nothing open anywhere, within the C4's own limits", () => {
  const closed = { actions: [{ status: "DONE" }, { status: "DISCARDED" }] }, open = { actions: [{ status: "DONE" }, { status: "READY_FOR_CONFIRMATION" }] };
  const base = { multiActionV2: true, turns: 3, actionPlan: closed };
  it("only a closed active plan, no card answer, no pending discard, no open suspended plan, room for one more suspended plan and turn", () => {
    expect(agentFollowUpEligible(base)).toBe(true);
    expect(agentFollowUpEligible(base, "operation-ref")).toBe(false);
    expect(agentFollowUpEligible({ ...base, actionPlan: open })).toBe(false);
    expect(agentFollowUpEligible({ ...base, actionPlan: undefined })).toBe(false);
    expect(agentFollowUpEligible({ ...base, multiActionV2: false })).toBe(false);
    expect(agentFollowUpEligible({ ...base, pendingDiscard: { plan_ref: "p", keys: ["a"], question: "?" } })).toBe(false);
    expect(agentFollowUpEligible({ ...base, suspendedPlans: [{ actionPlan: open }] })).toBe(false);
    expect(agentFollowUpEligible({ ...base, suspendedPlans: [{ actionPlan: closed }] })).toBe(true);
    expect(agentFollowUpEligible({ ...base, suspendedPlans: Array.from({ length: AGENT_FOLLOW_UP_LIMITS.suspendedPlans }, () => ({ actionPlan: closed })) })).toBe(false);
    expect(agentFollowUpEligible({ ...base, turns: AGENT_FOLLOW_UP_LIMITS.turns - 1 })).toBe(true);
    expect(agentFollowUpEligible({ ...base, turns: AGENT_FOLLOW_UP_LIMITS.turns })).toBe(false);
    expect([agentPlanOpen(closed), agentPlanOpen(open), agentPlanOpen(undefined)]).toEqual([false, true, false]);
  });
  it("a closed plan with a confirmed cancel or reschedule stays the C4's: its continuation may fill what that receipt freed", () => {
    const closedWith = (status: string, operation: string) => ({ actions: [{ status: "DONE", operation: "appointment.create" }, { status, operation }] });
    expect(agentFollowUpEligible({ ...base, actionPlan: closedWith("DONE", "appointment.cancel") })).toBe(false);
    expect(agentFollowUpEligible({ ...base, actionPlan: closedWith("DONE", "appointment.change") })).toBe(false);
    // A discarded cancel or reschedule freed nothing; other confirmed operations leave nothing the agent cannot read.
    expect(agentFollowUpEligible({ ...base, actionPlan: closedWith("DISCARDED", "appointment.cancel") })).toBe(true);
    expect(agentFollowUpEligible({ ...base, actionPlan: closedWith("DISCARDED", "appointment.change") })).toBe(true);
    expect(agentFollowUpEligible({ ...base, actionPlan: closedWith("DONE", "appointment.create") })).toBe(true);
    expect(agentFollowUpEligible({ ...base, actionPlan: closedWith("DONE", "schedule.block") })).toBe(true);
    // Only the active plan's receipts count (a suspended plan is never continued by an addition).
    expect(agentFollowUpEligible({ ...base, suspendedPlans: [{ actionPlan: closedWith("DONE", "appointment.cancel") }] })).toBe(true);
    expect([agentPlanReleased(closedWith("DONE", "appointment.cancel")), agentPlanReleased(closedWith("DISCARDED", "appointment.cancel")), agentPlanReleased(undefined)]).toEqual([true, false, false]);
  });
  it("the pronoun rule reads only the validator's code", () => {
    const validation = (codes: string[]) => ({ ok: true, actions: [{ codes }] }) as unknown as AgentValidation;
    expect(agentPronounTopic(validation(["AGENT_PRONOUN_TOPIC"]))).toBe(true);
    expect(agentPronounTopic(validation(["AGENT_NAME_MISMATCH"]))).toBe(false);
    expect(agentPronounTopic({ ok: false, code: "AGENT_SCHEMA", reasons: [] })).toBe(false);
  });
});

describe("B2 on a closed plan: the agent takes the new request", () => {
  it("its plan replaces the closed one (suspended with its receipts; the new plan starts without them), the turn counted once", async () => {
    const second = agentModel("b", ["segunda", "15:00"]);
    const { s, sessionId, closed, session } = await closedPlan([second]);
    const turns = session().turns, seen = db.seen.length;
    db.validation = planOf(booking("segunda", "cli-dagoberto", "15:00"));
    const view = await s.send(actor, { sessionId, message: "outro pedido sintético" });
    expect(second.requests).toHaveLength(1); expect(second.mismatches).toEqual([]);
    expect(view.action_plan!.plan_ref).not.toBe(closed.action_plan!.plan_ref);
    expect(view.agent_plan).toBe(true);
    expect(view.action_plan!.actions.map(action => [action.key, action.status])).toEqual([["segunda", "READY_FOR_CONFIRMATION"]]);
    expect(view.suspended_plans).toEqual([{ plan_ref: closed.action_plan!.plan_ref, label: "appointment.create" }]);
    expect(session().turns).toBe(turns + 1);
    expect(session().groupReceipts).toBeUndefined();
    expect(session().suspendedPlans![0].groupReceipts?.size).toBe(1);
    expect(db.seen.slice(seen).map(event => [event.context, event.used])).toEqual([[true, 1]]);
    expect(routerAgents().at(-1)).toMatchObject({ path: "AGENT", fallback_code: null, rounds: 1, follow_up: true });
    // Only the follow-up message carries the mark (the closed plan's own message never did).
    expect(routerAgents().filter(agent => agent?.follow_up === true)).toHaveLength(1);
    // The new plan confirms on its own approval; nothing of the closed one runs again.
    const done = await s.confirmActionPlanGroup(actor, sessionId, approvalOf(view.action_plan!, "segunda"));
    expect(done.action_plan!.actions.map(action => action.status)).toEqual(["DONE"]);
    expect(db.writes).toHaveLength(2);
  });

  it("a closed plan with a discarded action is retired, never suspended", async () => {
    const first = agentModel("a", ["primeira", "10:00"], ["segunda", "14:00"]), second = agentModel("b", ["terceira", "16:00"]), s = secretary([first, second]);
    const { sessionId } = await s.start(actor, "auto");
    db.validation = planOf(booking("primeira", "cli-marisol", "10:00"), booking("segunda", "cli-dagoberto", "14:00"));
    const view = await s.send(actor, { sessionId, message: "pedido sintético duplo" });
    expect(view.action_plan!.confirmation_groups).toHaveLength(2);
    const discarded = await s.discardAction(actor, sessionId, { plan_ref: view.action_plan!.plan_ref, action_key: "segunda" });
    const closed = await s.confirmActionPlanGroup(actor, sessionId, approvalOf(discarded.action_plan!, "primeira"));
    expect(closed.action_plan!.actions.map(action => action.status)).toEqual(["DONE", "DISCARDED"]);
    db.validation = planOf(booking("terceira", "cli-marisol", "16:00"));
    const next = await s.send(actor, { sessionId, message: "mais um pedido sintético" });
    expect(second.requests).toHaveLength(1);
    expect(next.action_plan!.actions.map(action => action.key)).toEqual(["terceira"]);
    expect(next.suspended_plans ?? []).toEqual([]);
    expect(stored(s, sessionId).suspendedPlans ?? []).toEqual([]);
  });

  it("a conversation keeps the closed plan, with the reply and 'nothing changed' as this message's answer", async () => {
    const second = createAgentFakeModel([{ output: [fakeReasoning("rs_b"), fakePlanCall(talkPlan("Resposta sintética da conversa."), "call_b")] }]);
    const { s, sessionId, closed, session } = await closedPlan([second]);
    const turns = session().turns;
    db.validation = { ok: true, result: "CONVERSA", actions: [], notices: [], question: null, reply: "Resposta sintética da conversa.", codes: [] };
    const view = await s.send(actor, { sessionId, message: "conversa sintética" });
    expect(second.requests).toHaveLength(1);
    expect(view.action_plan!.plan_ref).toBe(closed.action_plan!.plan_ref);
    expect(view.capability_status).toBe("CONVERSATION");
    expect(view.message).toContain("Resposta sintética da conversa.");
    expect(view.suspended_plans ?? []).toEqual([]);
    expect(session().turns).toBe(turns + 1);
  });
});

describe("B2 fallbacks: the C4 continuation of the closed plan, same calls and deadline, the turn counted once", () => {
  it("an agent failure: the C4 answers with the message's second call", async () => {
    const second = agentModel("b", ["segunda", "15:00"]), c4 = c4Conversation();
    const { s, sessionId, closed, session } = await closedPlan([second, c4]);
    const turns = session().turns, seen = db.seen.length;
    db.validation = { ok: false, code: "AGENT_SCHEMA", reasons: ["SINTETICO"] };
    const view = await s.send(actor, { sessionId, message: "outro pedido sintético" });
    expect(second.requests).toHaveLength(1); expect(c4.requests).toHaveLength(1);
    expect(view.action_plan!.plan_ref).toBe(closed.action_plan!.plan_ref);
    expect(session().turns).toBe(turns + 1);
    expect(db.seen.slice(seen).filter(event => event.purpose === "INTERPRETATION")).toEqual([{ purpose: "INTERPRETATION", context: true, used: 2 }]);
    expect(routerAgents().at(-1)).toMatchObject({ path: "C4_FALLBACK", fallback_code: "AGENT_SCHEMA", follow_up: true });
  });

  it("a customer pronoun with no referent in this message: the C4, which still has the closed plan's context, answers", async () => {
    const second = agentModel("b", ["segunda", "15:00"]), c4 = c4Conversation();
    const { s, sessionId, closed, session } = await closedPlan([second, c4]);
    const turns = session().turns;
    db.validation = planOf(outcome("segunda", { service_ref: "srv-luzes", professional_ref: "pro-farah", date: DAY, time: "15:00" }, { status: "ASK", codes: ["AGENT_PRONOUN_TOPIC"] }));
    const view = await s.send(actor, { sessionId, message: "pedido sintético com pronome" });
    expect(c4.requests).toHaveLength(1);
    expect(view.action_plan!.plan_ref).toBe(closed.action_plan!.plan_ref);
    expect(session().turns).toBe(turns + 1);
    expect(routerAgents().at(-1)).toMatchObject({ path: "C4_FALLBACK", fallback_code: "AGENT_PRONOUN_TOPIC", follow_up: true });
  });

  it("a preparation that throws leaves the closed plan, its receipts and the suspended list exactly as they were", async () => {
    const second = agentModel("b", ["segunda", "15:00"]);
    const { s, sessionId, closed, session } = await closedPlan([second]);
    const receipts = session().groupReceipts, agentPlan = session().agentPlan;
    db.validation = planOf(booking("segunda", "cli-dagoberto", "15:00"));
    db.failSkillLoad = true;
    await expect(s.send(actor, { sessionId, message: "outro pedido sintético" })).rejects.toThrow();
    expect(second.requests).toHaveLength(1);
    expect(session().actionPlan!.plan_ref).toBe(closed.action_plan!.plan_ref);
    expect(session().actionPlan!.actions.map(action => action.status)).toEqual(["DONE"]);
    expect(session().groupReceipts).toBe(receipts); expect(session().agentPlan).toBe(agentPlan);
    expect(session().suspendedPlans).toBeUndefined();
    expect(db.writes).toHaveLength(1);
  });
});

describe("B2 leaves everything else as it was", () => {
  it("an open plan stays with the C4: no agent call, no agent telemetry for that message", async () => {
    const first = agentModel("a", ["primeira", "10:00"]), c4 = c4Conversation(), s = secretary([first, c4]);
    const { sessionId } = await s.start(actor, "auto");
    db.validation = planOf(booking("primeira", "cli-marisol", "10:00"));
    const view = await s.send(actor, { sessionId, message: "pedido sintético inicial" });
    expect(view.action_plan!.actions.map(action => action.status)).toEqual(["READY_FOR_CONFIRMATION"]);
    const seen = db.seen.length, rows = routerAgents().length;
    await s.send(actor, { sessionId, message: "ajuste sintético" }).catch(() => undefined);
    expect(first.requests).toHaveLength(1);
    expect(noAgentCall(db.seen.slice(seen))).toBe(true);
    expect(routerAgents().slice(rows).every(agent => agent === undefined)).toBe(true);
  });

  it("flag off on a closed plan: no message context, no executor, no agent call (the C4 path as before)", async () => {
    const second: AgentFakeModel = agentModel("b", ["segunda", "15:00"]), c4 = c4Conversation();
    const { s, sessionId } = await closedPlan([c4]);
    vi.stubEnv("SALON_SECRETARY_AGENT", "false");
    const seen = db.seen.length, executors = db.executors;
    await s.send(actor, { sessionId, message: "outro pedido sintético" }).catch(() => undefined);
    expect(second.requests).toHaveLength(0);
    expect(db.executors).toBe(executors);
    expect(db.seen.slice(seen).every(event => !event.context && !event.purpose.startsWith("AGENT"))).toBe(true);
  });
});

describe("S1 telemetry on the router row: the follow-up, the pre-load and the per-call efforts, codes and numbers only", () => {
  const plain = { kind: "CONVERSATION", groups_ready: 0, groups_total: 0, open_question_fields: [], question_fingerprints: [], repeated_question_count: 0,
    divergence: { luna_operations: 0, plan_actions: 0, dropped_fields: [], failed_codes: [] }, repairs: 0, error_code: null } as TurnOutcome;
  const agent = { path: "AGENT", rounds: 2, lookup_calls: 1, lookup_kinds: ["T1"], rows: 3, output_bytes: 10, truncated: false, fallback_code: null,
    validator: { accepted: 1, name_fallback: 0, carded: 0, asked: 0, dropped: 0, codes: [] }, question_field: null, premises_backend: 0, premise_note_dropped: 0, uncovered: 0,
    actions_left: 0, locate_disagree: 0, effort: "medium" } as AgentTurnOutcome;
  const row = (extra: Record<string, unknown>) => { const trace = new RouterTrace(); trace.outcome = { ...plain, agent: { ...agent, ...extra } as unknown as AgentTurnOutcome }; return trace.snapshot().outcome?.agent; };
  it("kept when they apply", () => {
    const preload = { items: 2, kinds: ["T2", "T1"], rows: 4, bytes: 900, ms: 12, skipped: 1 };
    expect(row({ follow_up: true, efforts: ["high", "medium"], preload })).toMatchObject({ follow_up: true, efforts: ["high", "medium"], preload });
  });
  it("absent when they do not apply; anything outside their closed values is dropped (adversarial)", () => {
    const none = row({});
    for (const key of ["follow_up", "efforts", "preload"]) expect(none).not.toHaveProperty(key);
    const bad = row({ follow_up: "sim", efforts: ["high", "Zenóbia Abayomi"], preload: { items: -1, kinds: ["T9", "Zenóbia Abayomi"], rows: 1.5, bytes: 10, ms: 3, skipped: 0, nome: "Zenóbia Abayomi" } });
    expect(bad).not.toHaveProperty("follow_up"); expect(bad).not.toHaveProperty("efforts");
    expect(bad!.preload).toEqual({ items: 0, kinds: [], rows: 0, bytes: 10, ms: 3, skipped: 0 });
    expect(JSON.stringify(bad)).not.toContain("Zenóbia");
  });
});
