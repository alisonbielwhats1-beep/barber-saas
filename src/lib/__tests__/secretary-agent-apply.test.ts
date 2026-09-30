import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** C5 agent, WP5 (docs/c5-spike/11-especificacao-agente.md §6.2, §8.1 "Aplicação" and "Continuação C4"): the validated plan goes through the C4's
 * own plan, adapters and prepare(). For the same resolved values the agent's preparation gives the same draft snapshot and proposal as the C4 path
 * with the owner's names; the validator's cards and questions replace the proposal (the draft is still written); half-day readings are asked;
 * a locate that picks another appointment than the validated one fails closed; derived values (V13) are recomputed from the referenced action's
 * prepared slot; and a continuation that changes what a derived value stood on drops it (asked again), while the owner's own value replaces it.
 * Tenant lookups are fixtures (secretary-c5-stale-proposal-guard.test.ts style); the journal is the real one over an in-memory audit log.
 * Synthetic salon, diverse names; no gender is inferred from any name. */
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[], located: [] as Record<string, unknown>[] }));
const plusHour = (local: string) => `${local.slice(0, 11)}${String(Number(local.slice(11, 13)) + 1).padStart(2, "0")}${local.slice(13)}`;
const SERVICES: Record<string, string> = { "srv-pedi": "Pedicure spa", "srv-refle": "Reflexologia" };
const TEAM = [{ id: "pro-otavio", name: "Otávio Brandt" }, { id: "pro-petra", name: "Petra Lindqvist" }];
const CUSTOMERS: Record<string, { id: string; name: string }> = { ilka: { id: "cli-ilka", name: "Ilka Moraes" }, wendel: { id: "cli-wendel", name: "Wendel Okafor" } };
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const teamName = (ref: unknown) => TEAM.find(row => row.id === ref)?.name ?? "Otávio Brandt";
const customerName = (ref: unknown) => Object.values(CUSTOMERS).find(row => row.id === ref)?.name ?? "sem cadastro";
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  listSchedulingServices: async (_tx: unknown, _actor: unknown, name: string) => Object.entries(SERVICES).filter(([, label]) => fold(label).startsWith(fold(name).split(" ")[0])).map(([id, label]) => ({ id, name: label })),
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, filter: { query?: string }) =>
    TEAM.filter(row => !filter.query || fold(row.name).startsWith(fold(filter.query).split(" ")[0])).map(row => ({ ...row })),
  schedulingSelfProfessional: async () => undefined,
  getSchedulingAvailability: async (_tx: unknown, _actor: unknown, input: { date: string; time: string }) => ({ plan: { startLocal: `${input.date}T${input.time}` }, alternatives: [], timezone: "America/Sao_Paulo" }),
  listSchedulingAppointments: async () => [], listUpcomingCustomerAppointments: async () => [],
  getSchedulingAppointment: async () => { throw Error("APPOINTMENT_NOT_FOUND"); } }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, name: string) => Object.entries(CUSTOMERS).filter(([key]) => fold(name).startsWith(key)).map(([, row]) => row),
  getCustomer: async (_tx: unknown, _actor: unknown, ref: string) => { const row = Object.values(CUSTOMERS).find(item => item.id === ref); if (!row) throw Error("CUSTOMER_NOT_FOUND"); return row; } }));
vi.mock("../scheduling-entity-mentions", async importOriginal => ({ ...await importOriginal<object>(), validateSchedulingEntityMentions: async () => undefined }));
vi.mock("../scheduling-actions", async importOriginal => ({ ...await importOriginal<object>(),
  // The registered names, as the real snapshot reads them from the tenant (never the words that led to the refs).
  schedulingSnapshot: async (_tx: unknown, _actor: unknown, f: Record<string, unknown>) => {
    const time = f.time as string, date = f.date as string;
    return { customer_ref: f.customer_ref, customer_name: customerName(f.customer_ref), service_ref: f.service_ref, service_revision: "1", service_name: SERVICES[f.service_ref as string], professional_ref: f.professional_ref,
      professional_name: teamName(f.professional_ref), date, startLocal: `${date}T${time}`, endLocal: plusHour(`${date}T${time}`), timezone: "America/Sao_Paulo", priceCents: 9000, priceType: "FIXED", durationMin: 60, quote: "q" };
  },
  proposeAppointmentCreate: async (_tx: unknown, _actor: unknown, input: { draft_ref: string; draft_revision: number }) =>
    ({ proposal_ref: crypto.randomUUID(), draft_ref: input.draft_ref, draft_revision: input.draft_revision, payload_hash: "h".repeat(64), preview: "NOVO AGENDAMENTO", expires_at: new Date(Date.now() + 600_000).toISOString() }),
  proposeSchedulingAction: async (_tx: unknown, _actor: unknown, input: { draft_ref: string; draft_revision: number }) =>
    ({ proposal_ref: crypto.randomUUID(), draft_ref: input.draft_ref, draft_revision: input.draft_revision, payload_hash: "h".repeat(64), preview: "CANCELAMENTO", expires_at: new Date(Date.now() + 600_000).toISOString() }) }));
vi.mock("../scheduling-mutations", async importOriginal => {
  const original = await importOriginal<typeof import("../scheduling-mutations")>();
  return { ...original, authorizeSchedulingOperation: async () => "OWNER", locateSchedulingAppointments: async () => db.located.map(row => ({ ...row })),
    inspectSchedulingMove: async () => ({ result: {}, alternatives: [] }),
    schedulingActionSnapshot: async (_tx: unknown, _actor: unknown, operation: string, f: Record<string, string>) => original.actionSnapshot.parse({ timezone: "America/Sao_Paulo", resource_ids: [],
      waiting_hash: "", affected: [], priceCents: 9000, kind: operation, professional_ref: "pro-otavio", professional_name: "Otávio Brandt", startLocal: `${f.date}T09:00`,
      endLocal: `${f.date}T10:00`, services: [], requires_acceptance: false, waiting_count: 0, customer_name: customerName(f.customer_ref) }) };
});
import { schedulingState, prepareResolvedScheduling, reseedScheduling, applySchedulingInterpretation, type SchedulingState } from "../secretary-scheduling";
import { AGENT_DEPENDENT_NOTICE, AGENT_NOTE_LABEL, AGENT_PROFESSIONAL_CARD, agentDeferredRead, agentPreparedSlot, agentSkeleton, agentTurnNotice, prepareAgentScheduling } from "../secretary-agent-apply";
import { actionUnits } from "../secretary-action-plan";
import type { AgentActionOutcome, AgentValidation } from "../secretary-agent-validator";
import type { SchedulingFields } from "../scheduling-contract";
import type { AgentPlanOperation } from "../../../packages/salon-secretary/src/agent-plan";
import { createActionPlan, type SchedulingInterpretation } from "@everflair/salon-secretary";

const actor = { salonId: "synthetic-foot-studio", userId: "synthetic-foot-owner" };
const DAY = "2031-06-12", OTHER_DAY = "2031-06-13";
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2031-06-10T12:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  Object.assign(db, { rows: [], located: [] });
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(row); return row; }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null),
  } } as unknown as Tx;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const outcome = (key: string, operation: AgentPlanOperation, fields: SchedulingFields, extra: Partial<AgentActionOutcome> = {}): AgentActionOutcome => ({
  key, operation, status: "READY", fields, cleared: [], card: null, question: null, asked: null, ambiguities: [], origin: null, derived: null, recurrence: null,
  dependsOn: [], releasedSlotOf: null, basis: [], premises: [], note: [], notice: null, codes: [], names: {}, ...extra });
const validation = (actions: AgentActionOutcome[], notices: string[] = []): Extract<AgentValidation, { ok: true }> =>
  ({ ok: true, result: "PLANO", actions, notices, question: null, reply: null, codes: [] });
const booking = (time = "10:00"): SchedulingFields => ({ customer_ref: "cli-ilka", service_ref: "srv-pedi", professional_ref: "pro-otavio", date: DAY, time });
const NAMES = { "cli-ilka": "Ilka Moraes", "srv-pedi": "Pedicure spa", "pro-otavio": "Otávio Brandt" };
const fresh = (): SchedulingState => schedulingState();

describe("the plan skeleton", () => {
  it("keeps ids, operations and edges only; a dropped action leaves with the actions that stand on it", () => {
    const plan = agentSkeleton(validation([outcome("unhas", "appointment.create", booking()), outcome("fora", "appointment.cancel", {}, { status: "DROP", notice: "aviso sintético" }),
      outcome("depois", "appointment.create", booking("12:00"), { dependsOn: ["fora"], releasedSlotOf: "fora" })], ["aviso sintético"]));
    expect([...plan.outcomes.keys()]).toEqual(["unhas"]);
    expect(plan.dropped.sort()).toEqual(["depois", "fora"]);
    expect(plan.notices).toEqual(["aviso sintético", AGENT_DEPENDENT_NOTICE]);
    expect(plan.selection!.operations).toHaveLength(1);
    expect(plan.selection!.operations[0]).toMatchObject({ operation: "appointment.create", item_key: "unhas", depends_on: [] });
    // Nothing of the values reaches the selection (they reach prepare() through the outcome).
    expect(JSON.stringify(plan.selection)).not.toContain("cli-ilka");
    const actionPlan = createActionPlan(plan.selection);
    expect(actionUnits(actionPlan).map(unit => unit.kind)).toEqual(["single"]);
  });
  it("a cancellation with the create in its slot is the C4's atomic pair; a reschedule and the create in its origin are two units", () => {
    vi.stubEnv("SALON_SECRETARY_REFERENCES_V2", "true");
    const pair = agentSkeleton(validation([outcome("sai", "appointment.cancel", { customer_ref: "cli-ilka", date: DAY }),
      outcome("entra", "appointment.create", { customer_ref: "cli-wendel", service_ref: "srv-refle" }, { dependsOn: ["sai"], releasedSlotOf: "sai" })]));
    expect(actionUnits(createActionPlan(pair.selection)).map(unit => [unit.kind, unit.keys])).toEqual([["scheduling-batch", ["sai", "entra"]]]);
    const move = agentSkeleton(validation([outcome("muda", "appointment.change", { customer_ref: "cli-ilka", date: OTHER_DAY, time: "15:00" }),
      outcome("ocupa", "appointment.create", { customer_ref: "cli-wendel", service_ref: "srv-refle" }, { dependsOn: ["muda"], releasedSlotOf: "muda" })]));
    expect(actionUnits(createActionPlan(move.selection)).map(unit => unit.kind)).toEqual(["single", "single"]);
  });
  it("no action left: no selection, only the notices", () => {
    const plan = agentSkeleton(validation([outcome("fora", "appointment.cancel", {}, { status: "DROP" })], ["aviso sintético"]));
    expect(plan.selection).toBeUndefined();
    expect(plan.notices).toEqual(["aviso sintético"]);
  });
});

describe("one action through the C4's prepare()", () => {
  it("the same resolved booking gives the same draft snapshot and a proposal, as the C4 path with the owner's names", async () => {
    const c4 = fresh(); c4.operation = "appointment.create";
    await reseedScheduling(actor, c4, { customer_name: "Ilka", service_name: "pedicure", professional_name: "Otávio", date: DAY, time: "10:00" }, {});
    const agent = fresh();
    await prepareResolvedScheduling(actor, agent, "appointment.create", booking(), { names: NAMES });
    expect(c4.proposal).toBeDefined(); expect(agent.proposal).toBeDefined();
    expect(agent.draft!.snapshot).toEqual(c4.draft!.snapshot);
    for (const key of ["customer_ref", "service_ref", "professional_ref", "date", "time"] as const) expect(agent.fields[key]).toBe(c4.fields[key]);
    expect(agent.resolved_names).toMatchObject(NAMES);
  });
  it("never takes an appointment ref from the plan: the C4 locate decides", async () => {
    const agent = fresh();
    await prepareResolvedScheduling(actor, agent, "appointment.create", { ...booking(), appointment_ref: "apt-da-luna" });
    expect(agent.fields.appointment_ref).toBeUndefined();
  });
  it("a professional left unsaid: the card of the validator's rows replaces prepare()'s list; nothing is proposed", async () => {
    const c = fresh();
    await prepareResolvedScheduling(actor, c, "appointment.create", { customer_ref: "cli-ilka", service_ref: "srv-pedi", date: DAY, time: "10:00" },
      { card: { kind: "professional_ref", items: [{ id: "pro-petra", name: "Petra Lindqvist" }], question: AGENT_PROFESSIONAL_CARD } });
    expect(c.proposal).toBeUndefined(); expect(c.draft).toBeDefined();
    expect(c.candidates).toEqual({ kind: "professional_ref", items: [{ id: "pro-petra", name: "Petra Lindqvist" }] });
    expect(c.waiting_for).toBe("professional_ref"); expect(c.message).toBe(AGENT_PROFESSIONAL_CARD);
    expect(c.fields.professional_ref).toBeUndefined();
  });
  it("a question of the validator holds the proposal; the draft is complete and nothing is proposed", async () => {
    const c = fresh();
    await prepareResolvedScheduling(actor, c, "appointment.create", booking(), { question: "Pergunta sintética de retorno?" });
    expect(c.proposal).toBeUndefined(); expect(c.proposal_deferred).toBeUndefined();
    expect(c.message).toBe("Pergunta sintética de retorno?");
    expect(c.draft?.snapshot).toBeDefined();
  });
  it("an open half-day reading is asked: its role stays empty", async () => {
    const c = fresh();
    await prepareResolvedScheduling(actor, c, "appointment.create", booking("16:00"),
      { ambiguities: [{ field: "time", kind: "CLOCK_DAYPART", expression: "às quatro", candidates: ["04:00", "16:00"] }] });
    expect(c.fields.time).toBeUndefined(); expect(c.waiting_for).toBe("time"); expect(c.proposal).toBeUndefined();
    expect(c.pending_temporal_ambiguities?.map(item => item.field)).toEqual(["time"]);
  });
  it("the locate picks another appointment than the validated one: fails closed, nothing proposed", async () => {
    db.located = [{ appointment_ref: "apt-outro", customer_ref: "cli-ilka", customer_name: "Ilka Moraes", start_local: `${DAY}T09:00`, professional_name: "Otávio Brandt", professional_ref: "pro-otavio" }];
    const c = fresh();
    await expect(prepareResolvedScheduling(actor, c, "appointment.cancel", { customer_ref: "cli-ilka", date: DAY }, { expected: "apt-validado" })).rejects.toThrow("AGENT_APPT_LOCATE");
    expect(c.proposal).toBeUndefined();
  });
  it("the locate picks the validated appointment: the cancellation goes on as in the C4", async () => {
    db.located = [{ appointment_ref: "apt-validado", customer_ref: "cli-ilka", customer_name: "Ilka Moraes", start_local: `${DAY}T09:00`, professional_name: "Otávio Brandt", professional_ref: "pro-otavio" }];
    const c = fresh();
    await prepareResolvedScheduling(actor, c, "appointment.cancel", { customer_ref: "cli-ilka", date: DAY, reason: "imprevisto sintético" }, { expected: "apt-validado" });
    expect(c.fields.appointment_ref).toBe("apt-validado");
  });
});

describe("values derived from another action (V13)", () => {
  const first = async () => { const c = fresh(); await prepareResolvedScheduling(actor, c, "appointment.create", booking("10:00"), { names: NAMES }); return c; };
  it("right after the other action's accepted proposal: the backend's value, with its premise", async () => {
    const before = await first(), after = fresh();
    const done = await prepareAgentScheduling(actor, after, outcome("seguinte", "appointment.create", { customer_ref: "cli-wendel", service_ref: "srv-refle", professional_ref: "pro-otavio" }, {
      dependsOn: ["antes"], derived: { type: "SEQUENCIA", keys: ["antes"], inicio: `${DAY}T11:00`, fim: null, offset: 0, direction: "AFTER", professional: null } }),
      key => key === "antes" ? agentPreparedSlot(before) : undefined);
    expect(after.fields.date).toBe(DAY); expect(after.fields.time).toBe("11:00"); expect(after.proposal).toBeDefined();
    expect(done.premises.some(line => line.startsWith("Logo depois de "))).toBe(true);
    expect(after.agent_basis?.map(item => item.type)).toEqual(["SEQUENCIA"]);
  });
  it("the model's value disagrees with the backend's: the time is asked, never taken", async () => {
    const before = await first(), after = fresh();
    const done = await prepareAgentScheduling(actor, after, outcome("seguinte", "appointment.create", { customer_ref: "cli-wendel", service_ref: "srv-refle", professional_ref: "pro-otavio" }, {
      dependsOn: ["antes"], derived: { type: "SEQUENCIA", keys: ["antes"], inicio: `${DAY}T11:15`, fim: null, offset: 0, direction: "AFTER", professional: null } }),
      key => key === "antes" ? agentPreparedSlot(before) : undefined);
    expect(done.codes).toEqual(["AGENT_SEQUENCE_MISMATCH"]);
    expect(after.fields.time).toBeUndefined(); expect(after.proposal).toBeUndefined();
  });
  it("the other action has no proposal yet: the values are asked (never guessed)", async () => {
    const after = fresh();
    const done = await prepareAgentScheduling(actor, after, outcome("seguinte", "appointment.create", { customer_ref: "cli-wendel", service_ref: "srv-refle", professional_ref: "pro-otavio" }, {
      dependsOn: ["antes"], derived: { type: "SEQUENCIA", keys: ["antes"], inicio: `${DAY}T11:00`, fim: null, offset: 0, direction: "AFTER", professional: null } }), () => undefined);
    expect(done.codes).toEqual(["AGENT_DERIVED_WAIT"]); expect(after.proposal).toBeUndefined(); expect(after.fields.date).toBeUndefined();
  });
});

describe("the C4 continuation over a derived value (§6.2 hook)", () => {
  it("another day for an action timed after an anchor: the derived time leaves with its basis and is asked", async () => {
    const c = fresh();
    await prepareResolvedScheduling(actor, c, "appointment.create", booking("11:30"), { names: NAMES, basis: [{ type: "ANCORA", field: "inicio",
      anchor: { kind: "f", start: `${DAY}T11:00`, end: `${DAY}T11:30` }, professionalId: "pro-otavio", date: DAY, ordinal: null, offset: 0, direction: "AFTER", value: `${DAY}T11:30` }] });
    expect(c.proposal).toBeDefined();
    const codes = await applySchedulingInterpretation(actor, c, { operation: "appointment.create", date: OTHER_DAY } as SchedulingInterpretation);
    expect(codes).toContain("AGENT_BASIS_PATCHED");
    expect(c.agent_basis).toBeUndefined(); expect(c.agent_forgotten).toBeUndefined();
    expect(c.fields.date).toBe(OTHER_DAY); expect(c.fields.time).toBeUndefined(); expect(c.draft!.fields.time).toBeUndefined();
    expect(c.proposal).toBeUndefined(); expect(c.waiting_for).toBe("time");
  });
  it("the owner names another professional over a delegated one: the owner's value replaces it and the basis leaves", async () => {
    const c = fresh();
    await prepareResolvedScheduling(actor, c, "appointment.create", booking(), { basis: [{ type: "DELEGADO", field: "profissional", chosen: "pro-otavio", set: ["pro-otavio", "pro-petra"],
      counts: { "pro-otavio": 1, "pro-petra": 3 }, start: `${DAY}T10:00`, services: ["srv-pedi"] }] });
    expect(c.proposal).toBeDefined(); expect(c.agent_basis).toHaveLength(1);
    const codes = await applySchedulingInterpretation(actor, c, { operation: "appointment.create", professional_name: "Petra" } as SchedulingInterpretation);
    expect(codes).toContain("AGENT_BASIS_OWNER");
    expect(c.agent_basis).toBeUndefined(); expect(c.fields.professional_ref).toBe("pro-petra"); expect(c.proposal).toBeDefined();
  });
  it("a change that does not touch what the value stood on keeps it", async () => {
    const c = fresh();
    await prepareResolvedScheduling(actor, c, "appointment.create", booking(), { basis: [{ type: "DELEGADO", field: "profissional", chosen: "pro-otavio", set: ["pro-otavio"],
      counts: {}, start: `${DAY}T10:00`, services: ["srv-pedi"] }] });
    await applySchedulingInterpretation(actor, c, { operation: "appointment.create", customer_name: "Wendel" } as SchedulingInterpretation);
    expect(c.agent_basis).toHaveLength(1); expect(c.fields.professional_ref).toBe("pro-otavio"); expect(c.fields.customer_ref).toBe("cli-wendel");
  });
});

describe("what the owner reads (§5.5) and the deferred read", () => {
  it("the notices, then each action's backend premises, then Luna's checked notes under their label", () => {
    const plan = agentSkeleton(validation([outcome("unhas", "appointment.create", booking(), { premises: ["Premissa do backend."], note: ["nota conferida"] })], ["aviso sintético"]));
    expect(agentTurnNotice(plan, new Map([["unhas", { premises: ["Premissa do backend.", "Outra premissa."], codes: [] }]])))
      .toBe(`aviso sintético\nPremissa do backend.\nOutra premissa.\n${AGENT_NOTE_LABEL}: nota conferida`);
    expect(agentTurnNotice(agentSkeleton(validation([outcome("unhas", "appointment.create", booking())])), new Map())).toBeUndefined();
  });
  it("a read after a write of the plan keeps its resolved fields for the confirmation and says so now", () => {
    const c = fresh();
    agentDeferredRead(c, outcome("ver", "appointment.list", { professional_ref: "pro-otavio", date: DAY, appointment_ref: "apt-qualquer" }, { names: { "pro-otavio": "Otávio Brandt" } }), "Prévia sintética.");
    expect(c.operation).toBe("appointment.list"); expect(c.message).toBe("Prévia sintética.");
    expect(c.fields).toEqual({ professional_ref: "pro-otavio", professional_name: "Otávio Brandt", date: DAY });
    expect(c.proposal).toBeUndefined();
  });
});
