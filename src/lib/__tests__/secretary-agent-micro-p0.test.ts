import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** Micro-candidate P0 (flag SALON_SECRETARY_AGENT_MICRO, default off; docs/SECRETARY_AGENT_EVAL_PROTOCOL.md Adendo 7): the three real safety causes
 * of the layer audit, structurally, on the agent arm (the agent's own apply and validator, and the C4 path the agent falls back to inside its
 * message context). (a) A released-slot/derived fill never overwrites a field the owner (or the model, from the owner's words) stated; (b) a
 * withdrawal and a correction in the same turn hold and ask, never leave the old value (or the withdrawn action) confirmable; (c) an answer only
 * changes the action that asked: a patch the plan aims at a READY action that did not ask is rejected. Each one has its adversarial twin (the
 * fill when nothing was stated, a withdrawal or a correction alone, the answer to the action that asked, a correction naming its action); with
 * the flag off, today's exact behaviour (byte-identical). Written BEFORE the fix (test-first). Recorded frames only (no network, no model, no
 * database): tenant lookups are fixtures and a confirmed create is only recorded (db.writes). Today is Monday 28/09/2026 (São Paulo): "quinta" =
 * 01/10, "sexta" = 02/10. A spa studio with invented names and services; no gender is ever read from a name. */
type Row = { appointment_ref: string; customer_ref: string; customer_name: string; professional_ref: string; professional_name: string; service_ref: string;
  services: { serviceName: string }[]; start_local: string; end_local: string; start_at: string; status: string };
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[], writes: [] as string[] }));
const plusHour = (local: string) => `${local.slice(0, 11)}${String(Number(local.slice(11, 13)) + 1).padStart(2, "0")}${local.slice(13)}`;
const at = (local: string) => new Date(`${local}:00-03:00`).toISOString();
const TEAM = [{ id: "pro-quirino", name: "Quirino Valadares" }, { id: "pro-sunamita", name: "Sunamita Prado" }];
const teamName = (ref: unknown) => TEAM.find(row => row.id === ref)?.name ?? "sem cadastro";
const SERVICES: Record<string, string> = { "s-relax": "Massagem relaxante", "s-banho": "Banho de lua" };
const CUSTOMERS: Record<string, { id: string; name: string }> = { leocadia: { id: "c-leocadia", name: "Leocádia Furtado" }, benedito: { id: "c-benedito", name: "Benedito Sales" },
  ondina: { id: "c-ondina", name: "Ondina Veloso" } };
/** Benedito's massage on Wednesday 30/09 at 14h with Quirino: the slot a move of this plan frees. */
const APPOINTMENTS: Record<string, Row> = { "a-benedito": { appointment_ref: "a-benedito", customer_ref: "c-benedito", customer_name: "Benedito Sales", professional_ref: "pro-quirino",
  professional_name: "Quirino Valadares", service_ref: "s-relax", services: [{ serviceName: "Massagem relaxante" }], start_local: "2026-09-30T14:00", end_local: "2026-09-30T15:00",
  start_at: at("2026-09-30T14:00"), status: "CONFIRMED" } };
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  listSchedulingServices: async (_tx: unknown, _actor: unknown, name: string) => Object.entries(SERVICES).filter(([, label]) => fold(label).startsWith(fold(name).split(" ")[0])).map(([id, label]) => ({ id, name: label })),
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, filter: { query?: string }) =>
    TEAM.filter(row => !filter.query || fold(row.name).startsWith(fold(filter.query).split(" ")[0])).map(row => ({ ...row })),
  schedulingSelfProfessional: async () => undefined,
  getSchedulingAvailability: async (_tx: unknown, _actor: unknown, input: { date: string; time: string }) => ({ plan: { startLocal: `${input.date}T${input.time}` }, alternatives: [], timezone: "America/Sao_Paulo" }),
  listSchedulingAppointments: async () => [], listUpcomingCustomerAppointments: async () => [],
  getSchedulingAppointment: async (_tx: unknown, _actor: unknown, ref: string) => { const row = APPOINTMENTS[ref]; if (!row) throw Error("APPOINTMENT_NOT_FOUND"); return row; } }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, name: string) => Object.entries(CUSTOMERS).filter(([key]) => fold(name).startsWith(key)).map(([, row]) => row),
  getCustomer: async (_tx: unknown, _actor: unknown, ref: string) => { const row = Object.values(CUSTOMERS).find(item => item.id === ref); if (!row) throw Error("CUSTOMER_NOT_FOUND"); return row; } }));
vi.mock("../scheduling-entity-mentions", async importOriginal => ({ ...await importOriginal<object>(), validateSchedulingEntityMentions: async () => undefined }));
vi.mock("../scheduling-actions", async importOriginal => ({ ...await importOriginal<object>(),
  // The registered names, as the real snapshot reads them from the tenant.
  schedulingSnapshot: async (_tx: unknown, _actor: unknown, f: Record<string, unknown>) => {
    const time = f.time as string, date = f.date as string;
    return { customer_ref: f.customer_ref, customer_name: Object.values(CUSTOMERS).find(row => row.id === f.customer_ref)?.name ?? f.customer_name, service_ref: f.service_ref, service_revision: "1",
      service_name: SERVICES[f.service_ref as string] ?? f.service_name, professional_ref: f.professional_ref, professional_name: teamName(f.professional_ref), date, startLocal: `${date}T${time}`,
      endLocal: plusHour(`${date}T${time}`), timezone: "America/Sao_Paulo", priceCents: 7000, priceType: "FIXED", durationMin: 60, quote: "q" };
  },
  proposeAppointmentCreate: async (_tx: unknown, _actor: unknown, input: { draft_ref: string; draft_revision: number }) =>
    ({ proposal_ref: crypto.randomUUID(), draft_ref: input.draft_ref, draft_revision: input.draft_revision, payload_hash: "h".repeat(64), preview: "NOVO AGENDAMENTO", expires_at: new Date(Date.now() + 600_000).toISOString() }),
  proposeSchedulingAction: async (_tx: unknown, _actor: unknown, input: { draft_ref: string; draft_revision: number }) =>
    ({ proposal_ref: crypto.randomUUID(), draft_ref: input.draft_ref, draft_revision: input.draft_revision, payload_hash: "h".repeat(64), preview: "REMARCAÇÃO", expires_at: new Date(Date.now() + 600_000).toISOString() }),
  // A confirmed create is only recorded (its proposal ref): the tests count what would have been written.
  confirmAppointmentCreate: async (_tx: unknown, _actor: unknown, input: { proposal_ref: string; draft_revision: number }) => {
    db.writes.push(input.proposal_ref);
    return { proposal_ref: input.proposal_ref, draft_ref: "synthetic-draft", draft_revision: input.draft_revision, outcome: "CONFIRMED", appointment_ref: crypto.randomUUID() };
  } }));
vi.mock("../scheduling-mutations", async importOriginal => {
  const original = await importOriginal<typeof import("../scheduling-mutations")>();
  return { ...original, authorizeSchedulingOperation: async () => "OWNER",
    locateSchedulingAppointments: async (_tx: unknown, _actor: unknown, f: { customer_ref?: string }) => Object.values(APPOINTMENTS).filter(row => row.customer_ref === f.customer_ref),
    inspectSchedulingMove: async () => ({ result: {}, alternatives: [] }),
    schedulingActionSnapshot: async (_tx: unknown, _actor: unknown, operation: string, f: Record<string, string>) => {
      const base = { timezone: "America/Sao_Paulo", resource_ids: [], waiting_hash: "", affected: [], priceCents: 7000 };
      if (operation === "schedule.block") return original.actionSnapshot.parse({ ...base, kind: operation, professional_ref: f.professional_ref, professional_name: teamName(f.professional_ref),
        startLocal: `${f.date}T${f.time}`, endLocal: `${f.end_date ?? f.date}T${f.end_time}`, services: [], requires_acceptance: false, waiting_count: 0 });
      const row = APPOINTMENTS[f.appointment_ref], change = operation === "appointment.change";
      return original.actionSnapshot.parse({ ...base, kind: operation, appointment_ref: row.appointment_ref, revision: 1, customer_ref: row.customer_ref, customer_name: row.customer_name,
        professional_ref: row.professional_ref, professional_name: row.professional_name, before_start: row.start_local, before_end: row.end_local, before_timezone: "America/Sao_Paulo",
        startLocal: change ? `${f.date}T${f.time}` : row.start_local, endLocal: change ? plusHour(`${f.date}T${f.time}`) : row.end_local,
        services: row.services.map(s => ({ id: row.service_ref, name: s.serviceName, durationMin: 60, priceCents: 7000, priceType: "FIXED", priceNote: null, processingMin: 0, finishingMin: 0 })),
        requires_acceptance: false, waiting_count: 0 });
    } };
});
// The agent's lookups are unavailable: a new message falls back to the C4 path INSIDE the agent's message context (the agent arm's fallback).
vi.mock("../secretary-agent-lookups", async importOriginal => ({ ...await importOriginal<object>(),
  createAgentLookupExecutor: () => ({ directory: async () => ({ ok: false, code: "AGENT_UNAVAILABLE" }), round: async (calls: readonly unknown[]) => calls.map(() => "{}") }) }));
import { SalonSecretary, type SecretaryView } from "../salon-secretary";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { AGENT_DEPENDENCY_FLAGS, createAgentBinding } from "../../../packages/salon-secretary/src/agent-context";
import type { AgentPlan } from "../../../packages/salon-secretary/src/agent-plan";
import { agentOpenPlanFacts, prepareAgentScheduling, withoutReleasedProfessional, type AgentMicroReferences, type AgentOpenSource } from "../secretary-agent-apply";
import { schedulingState } from "../secretary-scheduling";
import { validateAgentPlan, type AgentActionOutcome, type AgentFactReader } from "../secretary-agent-validator";
import type { SchedulingFields } from "../scheduling-contract";

const actor = { salonId: "synthetic-spa-studio", userId: "synthetic-spa-owner" };
const MICRO = "SALON_SECRETARY_AGENT_MICRO";
const micro = (on: boolean) => vi.stubEnv(MICRO, on ? "true" : undefined);
/** The agent arm's flags these paths read (the frozen candidate's subset). */
const ARM = ["SALON_SECRETARY_AGENT", "SALON_SECRETARY_SAME_AS", "SALON_SECRETARY_STALE_PROPOSAL_GUARD", "SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED", ...AGENT_DEPENDENCY_FLAGS];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-28T15:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  for (const flag of ARM) vi.stubEnv(flag, "true");
  vi.stubEnv(MICRO, undefined);
  Object.assign(db, { rows: [], writes: [] });
  const filtered = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  db.tx = { $executeRaw: vi.fn(async () => 0), auditLog: {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: crypto.randomUUID(), ...structuredClone(data) }; db.rows.push(row); return row; }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtered(where)[0] ?? null),
  } } as unknown as Tx;
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const pair = (value: unknown, literal: string) => ({ value, literal });
const op = (item_key: string, operation: string, fields: Record<string, unknown> = {}) => ({ operation, item_key, depends_on: null, released_slot_of: null, same_as: null, source_scope: null,
  customer_name: null, service_name: null, professional_name: null, date: null, day_offset: null, weekday: null, time: null, period: null, source_date: null, source_day_offset: null,
  source_weekday: null, source_time: null, end_time: null, end_date: null, reason: null, destination_mode: null, override_requested: null, override_reason: null, ...fields });
const turn = (value: unknown) => new ScriptedServicesModel([call("select_capabilities", { turn: value })]);
/** One recorded model per interpretation of the conversation, in order. */
async function conversation(models: ScriptedServicesModel[], message: string) {
  const queue = [...models];
  const s = new SalonSecretary(async () => { const next = queue.shift(); if (!next) throw Error("NO_RECORDED_MODEL"); return next; }, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const { sessionId } = await s.start(actor, "auto");
  return { s, sessionId, first: await s.send(actor, { sessionId, message }), say: (text: string) => s.send(actor, { sessionId, message: text }) };
}
const read = (view: SecretaryView) => ({
  action: (key: string) => view.action_plan!.actions.find(item => item.key === key)!,
  child: (key: string) => view.operations!.find(item => item.action_keys?.includes(key))!.state,
  ready: () => view.action_plan ? view.action_plan.confirmation_groups.filter(group => group.status === "READY_FOR_CONFIRMATION").flatMap(group => group.action_keys).sort() : [],
  status: (key: string) => view.action_plan?.actions.find(item => item.key === key)?.status ?? "RETIRED",
});
const approvals = (view: SecretaryView) => view.action_plan!.confirmation_groups.filter(group => group.status === "READY_FOR_CONFIRMATION")
  .map(group => ({ plan_ref: view.action_plan!.plan_ref, revision: view.action_plan!.revision, group_key: group.key, fingerprint: group.fingerprint }));
const routerAgents = () => db.rows.filter(row => row.entityType === "SECRETARY_ROUTER").map(row => (row.metadata as { outcome?: { agent?: Record<string, unknown> } | null }).outcome?.agent);

// ================================================================ P0a
describe("P0a (CE10 mechanism): a released-slot fill never overwrites a professional the owner stated", () => {
  /** The agent's validated create in the slot Benedito's move frees (LIBERADO_POR, derived from the move's prepared slot). */
  const released = (fields: SchedulingFields): AgentActionOutcome => ({ key: "vaga", operation: "appointment.create", status: "READY", fields, cleared: [], card: null, question: null,
    asked: null, ambiguities: [], origin: null, derived: { type: "LIBERADO_POR", keys: ["troca"], inicio: "2026-09-30T14:00", fim: null, offset: 0, direction: "AFTER", professional: null },
    recurrence: null, dependsOn: ["troca"], releasedSlotOf: "troca", basis: [], premises: [], note: [], notice: null, codes: [],
    names: { "c-leocadia": "Leocádia Furtado", "s-relax": "Massagem relaxante" } });
  const freed = () => ({ startLocal: "2026-09-30T14:00", endLocal: "2026-09-30T15:00", professional_ref: "pro-quirino", professional_name: "Quirino Valadares", customer_name: "Benedito Sales" });
  it("agent apply: the owner's professional (words for prepare()) is never replaced by the slot's; flag off: the slot's professional is proposed under the owner's words", async () => {
    const stated = () => released({ customer_ref: "c-leocadia", service_ref: "s-relax", professional_name: "Sunamita" });
    const today = schedulingState();
    await prepareAgentScheduling(actor, today, stated(), freed);
    expect(today.fields).toMatchObject({ professional_ref: "pro-quirino", professional_name: "Sunamita", date: "2026-09-30", time: "14:00" });
    expect(today.proposal).toBeDefined();
    micro(true);
    const c = schedulingState();
    await prepareAgentScheduling(actor, c, stated(), freed);
    expect(c.fields.professional_ref).not.toBe("pro-quirino");
    // Either the owner's professional is the one proposed, or nothing is proposed and the owner is asked.
    if (c.proposal) expect(c.fields.professional_ref).toBe("pro-sunamita");
  });
  it("adversarial twin (agent apply): the owner stated no professional: the slot still gives its day, clock and professional, with its premise", async () => {
    micro(true);
    const c = schedulingState();
    const done = await prepareAgentScheduling(actor, c, released({ customer_ref: "c-leocadia", service_ref: "s-relax" }), freed);
    expect(c.fields).toMatchObject({ professional_ref: "pro-quirino", date: "2026-09-30", time: "14:00", customer_ref: "c-leocadia", service_ref: "s-relax" });
    expect(c.proposal).toBeDefined();
    expect(done.premises).toContain("No horário que Benedito Sales libera.");
  });

  const MOVE = "passa o Benedito pra sexta às 10h";
  const move = () => op("troca", "appointment.change", { customer_name: "Benedito", source_scope: MOVE, weekday: pair(5, "sexta"), time: pair("10:00", "às 10h") });
  const fill = (scope: string, extra: Record<string, unknown> = {}) => op("vaga", "appointment.create", { customer_name: "Leocádia", service_name: "massagem relaxante", source_scope: scope,
    depends_on: ["troca"], released_slot_of: "troca", destination_mode: "SAME_RELEASED_SLOT", ...extra });
  it("C4 path the agent falls back to: the create in the freed slot keeps the professional the owner wrote; flag off: the slot's professional overwrites it", async () => {
    const scope = "a Leocádia entra na vaga dele com a Sunamita pra massagem relaxante", text = `${MOVE} e ${scope}`;
    const run = () => conversation([turn({ mode: "NEW", operations: [move(), fill(scope, { professional_name: "Sunamita" })] })], text);
    const today = read((await run()).first);
    expect(routerAgents().at(-1)).toMatchObject({ path: "C4_SKIPPED", fallback_code: "AGENT_UNAVAILABLE" });
    expect(today.child("vaga").scheduling!.fields).toMatchObject({ professional_ref: "pro-quirino", professional_name: "Quirino Valadares", date: "2026-09-30", time: "14:00" });
    expect(today.status("vaga")).toBe("READY_FOR_CONFIRMATION");
    micro(true);
    const r = read((await run()).first), fields = r.child("vaga").scheduling!.fields;
    expect(fields.professional_ref).not.toBe("pro-quirino");
    if (r.status("vaga") === "READY_FOR_CONFIRMATION" || r.child("vaga").scheduling!.proposal) expect(fields.professional_ref).toBe("pro-sunamita");
  });
  it("adversarial twin (C4 fallback): no professional said: the freed slot's professional, day and clock stand and the create is ready", async () => {
    micro(true);
    const scope = "a Leocádia entra na vaga dele pra massagem relaxante";
    const r = read((await conversation([turn({ mode: "NEW", operations: [move(), fill(scope)] })], `${MOVE} e ${scope}`)).first);
    expect(r.child("vaga").scheduling!.fields).toMatchObject({ professional_ref: "pro-quirino", date: "2026-09-30", time: "14:00", customer_ref: "c-leocadia", service_ref: "s-relax" });
    expect(r.status("vaga")).toBe("READY_FOR_CONFIRMATION");
  });
});

// ================================================================ P0b
describe("P0b (CE02 mechanism): a withdrawal and a correction in the same turn hold and ask", () => {
  /** Two ready bookings of the agent arm (the agent fell back; the plan is the C4's): Leocádia Thursday 14h, Ondina Thursday 16h. */
  const FIRST = "marca a Leocádia quinta às 14h pra massagem relaxante com o Quirino e a Ondina quinta às 16h pro banho de lua com a Sunamita";
  const ready = () => turn({ mode: "NEW", operations: [
    op("leo", "appointment.create", { customer_name: "Leocádia", service_name: "massagem relaxante", professional_name: "Quirino", weekday: pair(4, "quinta"), time: pair("14:00", "às 14h"),
      source_scope: "marca a Leocádia quinta às 14h pra massagem relaxante com o Quirino" }),
    op("ond", "appointment.create", { customer_name: "Ondina", service_name: "banho de lua", professional_name: "Sunamita", weekday: pair(4, "quinta"), time: pair("16:00", "às 16h"),
      source_scope: "a Ondina quinta às 16h pro banho de lua com a Sunamita" })] });
  const withdraw = () => turn({ mode: "DISCARD", item_keys: ["ond"] });
  const correct = () => turn({ mode: "PATCH", operations: [{ item_key: "leo", choice: null, fields: { operation: null, time: pair("15:00", "pras 15h") } }] });
  const BOTH = "tira a Ondina e passa a Leocádia pras 15h";
  const leoTime = (r: ReturnType<typeof read>) => r.child("leo").scheduling!.fields.time;
  it("the C4 reads only the withdrawal (DISCARD): the corrected booking never stays confirmable at its old time; flag off: it does and a confirmation writes it", async () => {
    const off = await conversation([ready(), withdraw()], FIRST);
    expect(read(off.first).ready()).toEqual(["leo", "ond"]);
    const view = await off.say(BOTH), today = read(view);
    expect(today.ready()).toEqual(["leo"]); expect(today.status("ond")).toBe("DISCARDED"); expect(leoTime(today)).toBe("14:00");
    await off.s.confirmReadyGroups(actor, off.sessionId, approvals(view));
    expect(db.writes).toHaveLength(1);
    db.writes = [];
    micro(true);
    const c = await conversation([ready(), withdraw()], FIRST);
    const held = await c.say(BOTH), r = read(held);
    expect(r.ready().includes("leo") && leoTime(r) === "14:00").toBe(false);
    expect(r.ready()).not.toContain("ond");
    expect(held.message).toContain("?");
    if (held.action_plan && approvals(held).length) await c.s.confirmReadyGroups(actor, c.sessionId, approvals(held));
    expect(db.writes.length === 0 || leoTime(read(held)) === "15:00").toBe(true);
  });
  it("the C4 reads only the correction (PATCH): the withdrawn booking never stays confirmable; flag off: it does", async () => {
    const off = await conversation([ready(), correct()], FIRST);
    const today = read(await off.say(BOTH));
    expect(today.ready()).toEqual(["leo", "ond"]); expect(leoTime(today)).toBe("15:00");
    micro(true);
    const c = await conversation([ready(), correct()], FIRST);
    const held = await c.say(BOTH), r = read(held);
    expect(r.ready()).not.toContain("ond");
    expect(held.message).toContain("?");
    if (r.ready().includes("leo")) expect(leoTime(r)).toBe("15:00");
  });
  it("adversarial twin: a withdrawal alone discards exactly that booking; the other stays ready as it was", async () => {
    micro(true);
    const c = await conversation([ready(), withdraw()], FIRST);
    const r = read(await c.say("tira a Ondina"));
    expect(r.status("ond")).toBe("DISCARDED"); expect(r.ready()).toEqual(["leo"]); expect(leoTime(r)).toBe("14:00");
  });
  it("adversarial twin: a correction alone applies; the other booking stays ready", async () => {
    micro(true);
    const c = await conversation([ready(), correct()], FIRST);
    const r = read(await c.say("passa a Leocádia pras 15h"));
    expect(r.ready()).toEqual(["leo", "ond"]); expect(leoTime(r)).toBe("15:00");
  });
});

// ================================================================ P0c
describe("P0c (CF09 mechanism): an answer only changes the action that asked", () => {
  const THU = "2026-10-01", NOW = new Date("2026-09-28T15:00:00Z");
  const svcs = [{ id: "s-relax", name: "Massagem relaxante", durationMin: 60 }, { id: "s-banho", name: "Banho de lua", durationMin: 60 }];
  const custs = Object.values(CUSTOMERS);
  /** The tenant as the validator reads it: everyone free 9h-19h on Thursday, nothing booked. */
  const reader: AgentFactReader = { timezone: "America/Sao_Paulo", now: NOW, appointment: async () => undefined, professionals: async () => TEAM.map(row => ({ ...row })),
    services: async () => svcs.map(row => ({ ...row })), customer: async id => custs.find(row => row.id === id),
    customerSet: async literal => { const words = fold(literal).split(/[^\p{L}]+/u).filter(Boolean), rows = custs.filter(row => fold(row.name).split(" ").some(token => words.includes(token)));
      return { rows, total: rows.length }; },
    selfProfessional: async () => undefined, performers: async () => TEAM.map(row => ({ ...row })), bookable: async () => true, activeCount: async () => 0,
    dayFacts: async (_date, ids) => ({ closures: [], now: -1, staff: ids.map(id => ({ id, work: [{ start: 540, end: 1140 }], off: [] })) }), dayAppointments: async () => [], locate: async () => [] };
  const binding = () => { const b = createAgentBinding();
    for (const row of TEAM) b.bind("p", row.id, { name: row.name });
    for (const row of svcs) b.bind("s", row.id, { name: row.name, durationMin: row.durationMin });
    for (const row of custs) b.bind("c", row.id, { shown: row.name });
    return b; };
  /** The open plan as the session holds it: Leocádia's booking READY at 14h; Ondina's waiting for its clock (the action that asked). */
  const leo: AgentOpenSource = { key: "leo", operation: "appointment.create", status: "READY_FOR_CONFIRMATION", missing: [], dependsOn: [], basis: [],
    fields: { customer_ref: "c-leocadia", service_ref: "s-relax", professional_ref: "pro-quirino", date: THU, time: "14:00" },
    names: { "c-leocadia": "Leocádia Furtado", "s-relax": "Massagem relaxante", "pro-quirino": "Quirino Valadares" } };
  const ond: AgentOpenSource = { key: "ond", operation: "appointment.create", status: "NEEDS_INPUT", missing: ["time"], dependsOn: [], basis: [],
    fields: { customer_ref: "c-ondina", service_ref: "s-banho", professional_ref: "pro-sunamita", date: THU },
    names: { "c-ondina": "Ondina Veloso", "s-banho": "Banho de lua", "pro-sunamita": "Sunamita Prado" } };
  type Action = AgentPlan["acoes"][number];
  const patch = (key: string, quote: string, clock: string): Action => ({ chave: key, operacao: "appointment.create", citacao_acao: quote, atendimento: null, cliente: null, profissional: null,
    novo_profissional: null, servicos: null, inicio: `${THU}T16:00`, fim: null, dia: null, motivo: null, recorrencia: null, depende_de: [], ocupa_horario_de: null,
    bases: [{ campo: "inicio", tipo: "DITO", ref: null, citacao: clock }], premissas: [] });
  async function validate(owner: string, action: Action, sources: AgentOpenSource[] = [leo, ond]) {
    const out = await validateAgentPlan({ resultado: "PLANO", resposta: null, acoes: [action], acoes_fora: 0, pergunta: null },
      { owner: [owner], binding: binding(), reader, open: agentOpenPlanFacts(sources) });
    if (!out.ok) throw Error(`REJECTED ${out.code}`);
    return out.actions[0];
  }
  it("a bare answer to the waiting booking that the plan applies to the READY one is rejected; flag off: the ready booking moves to 16h", async () => {
    const wrong = () => validate("Às 16h.", patch("leo", "Às 16h", "Às 16h"));
    expect(await wrong()).toMatchObject({ key: "leo", status: "READY", patch: true, codes: [], fields: { customer_ref: "c-leocadia", date: THU, time: "16:00" } });
    micro(true);
    const held = await wrong();
    expect(held.status === "READY" && held.fields.time === "16:00").toBe(false);
    expect(held.status).not.toBe("READY");
    // Nothing of the answer reaches the ready booking: its own validated values stay (or the action leaves), never the answer's clock.
    if (held.fields.time !== undefined) expect(held.fields.time).toBe("14:00");
  });
  it("adversarial twin: the same answer applied to the booking that asked still applies", async () => {
    micro(true);
    expect(await validate("Às 16h.", patch("ond", "Às 16h", "Às 16h"))).toMatchObject({ key: "ond", status: "READY", patch: true,
      fields: { customer_ref: "c-ondina", professional_ref: "pro-sunamita", service_ref: "s-banho", date: THU, time: "16:00" } });
  });
  it("adversarial twin: a correction that names the ready booking's customer still changes it while another booking waits", async () => {
    micro(true);
    expect(await validate("A Leocádia passa pras 16h.", patch("leo", "A Leocádia passa pras 16h", "pras 16h"))).toMatchObject({ key: "leo", status: "READY", patch: true,
      fields: { customer_ref: "c-leocadia", date: THU, time: "16:00" } });
  });
  it("adversarial twin: with nothing waiting, a bare correction of the one open booking still applies", async () => {
    micro(true);
    expect(await validate("Pras 16h.", patch("leo", "Pras 16h", "16h"), [leo])).toMatchObject({ key: "leo", status: "READY", patch: true, fields: { time: "16:00" } });
  });
  it("the flag: anything but the exact value 'true' keeps today's patch (fail-safe default)", async () => {
    for (const value of ["", "1", "TRUE", "yes"]) {
      vi.stubEnv(MICRO, value);
      expect(await validate("Às 16h.", patch("leo", "Às 16h", "Às 16h")), value).toMatchObject({ status: "READY", fields: { time: "16:00" } });
    }
  });
  // Settling review: the ready booking's professional or service words in an answer are values the waiting one may be asking for, never the
  // ready booking's identity.
  for (const answer of ["Às 16h com o Quirino.", "Às 16h, massagem."])
    it(`an answer that also holds the ready booking's professional or service words is still rejected on it (${answer.length} chars); flag off: it moves`, async () => {
      const quote = answer.slice(0, -1);
      expect(await validate(answer, patch("leo", quote, "Às 16h"))).toMatchObject({ key: "leo", status: "READY", fields: { time: "16:00" } });
      micro(true);
      const held = await validate(answer, patch("leo", quote, "Às 16h"));
      expect(held.status).not.toBe("READY");
      expect(held.codes).toContain("AGENT_PATCH_TARGET");
      if (held.fields.time !== undefined) expect(held.fields.time).toBe("14:00");
    });
  it("adversarial twin: a correction naming the ready booking's customer beside its professional still changes it", async () => {
    micro(true);
    expect(await validate("A Leocádia vai pras 16h com o Quirino.", patch("leo", "A Leocádia vai pras 16h com o Quirino", "pras 16h"))).toMatchObject({ key: "leo", status: "READY",
      fields: { customer_ref: "c-leocadia", time: "16:00" } });
  });
});

// ================================================================ settling review twins (P0a, P0b)
describe("P0 review twins", () => {
  const FIRST = "marca a Leocádia quinta às 14h pra massagem relaxante com o Quirino e a Ondina quinta às 16h pro banho de lua com a Sunamita";
  const ready = () => turn({ mode: "NEW", operations: [
    op("leo", "appointment.create", { customer_name: "Leocádia", service_name: "massagem relaxante", professional_name: "Quirino", weekday: pair(4, "quinta"), time: pair("14:00", "às 14h"),
      source_scope: "marca a Leocádia quinta às 14h pra massagem relaxante com o Quirino" }),
    op("ond", "appointment.create", { customer_name: "Ondina", service_name: "banho de lua", professional_name: "Sunamita", weekday: pair(4, "quinta"), time: pair("16:00", "às 16h"),
      source_scope: "a Ondina quinta às 16h pro banho de lua com a Sunamita" })] });
  const correct = () => turn({ mode: "PATCH", operations: [{ item_key: "leo", choice: null, fields: { operation: null, time: pair("15:00", "pras 15h") } }] });
  const leoTime = (r: ReturnType<typeof read>) => r.child("leo").scheduling!.fields.time;
  // P0b: the C4 reads only the correction; the withdrawn booking is named by its professional, its clock or an alterity word (no customer word).
  for (const [shape, text] of [["professional", "a da Sunamita pode cancelar e a Leocádia joga pras 15h"], ["clock", "a das 16h pode cancelar e a Leocádia joga pras 15h"],
    ["alterity", "a outra pode cancelar e a Leocádia joga pras 15h"]])
    it(`P0b, the withdrawn booking named by its ${shape}: held and asked, it never stays confirmable; flag off: it does`, async () => {
      const off = await conversation([ready(), correct()], FIRST);
      const today = read(await off.say(text));
      expect(today.ready()).toEqual(["leo", "ond"]);
      micro(true);
      const c = await conversation([ready(), correct()], FIRST);
      const held = await c.say(text), r = read(held);
      expect(r.ready()).not.toContain("ond");
      expect(held.message).toContain("?");
      if (r.ready().includes("leo")) expect(leoTime(r)).toBe("15:00");
    });
  it("P0b adversarial twin: a correction opened by a discourse word applies; the other booking stays ready", async () => {
    micro(true);
    const c = await conversation([ready(), correct()], FIRST);
    const r = read(await c.say("na real, a Leocádia joga pras 15h"));
    expect(r.ready()).toEqual(["leo", "ond"]); expect(leoTime(r)).toBe("15:00");
  });

  // P0a (agent apply): a stated value the derived fill would overwrite is asked, never replaced; a stated value equal to the slot's stands.
  const released = (fields: SchedulingFields): AgentActionOutcome => ({ key: "vaga", operation: "appointment.create", status: "READY", fields, cleared: [], card: null, question: null,
    asked: null, ambiguities: [], origin: null, derived: { type: "LIBERADO_POR", keys: ["troca"], inicio: "2026-09-30T14:00", fim: null, offset: 0, direction: "AFTER", professional: null },
    recurrence: null, dependsOn: ["troca"], releasedSlotOf: "troca", basis: [], premises: [], note: [], notice: null, codes: [],
    names: { "c-leocadia": "Leocádia Furtado", "s-relax": "Massagem relaxante", "pro-sunamita": "Sunamita Prado", "pro-quirino": "Quirino Valadares" } });
  const freed = () => ({ startLocal: "2026-09-30T14:00", endLocal: "2026-09-30T15:00", professional_ref: "pro-quirino", professional_name: "Quirino Valadares", customer_name: "Benedito Sales" });
  it("P0a apply: a stated professional ref that is not the slot's is asked (the mismatch code), never replaced; flag off: the slot's replaces it", async () => {
    const stated = () => released({ customer_ref: "c-leocadia", service_ref: "s-relax", professional_ref: "pro-sunamita" });
    const today = schedulingState();
    await prepareAgentScheduling(actor, today, stated(), freed);
    expect(today.fields.professional_ref).toBe("pro-quirino");
    micro(true);
    const c = schedulingState();
    const done = await prepareAgentScheduling(actor, c, stated(), freed);
    expect(done.codes).toContain("AGENT_RELEASE_MISMATCH");
    expect(c.fields.professional_ref).toBe("pro-sunamita");
    expect(c.proposal).toBeUndefined();
  });
  it("P0a apply adversarial twin: the stated professional is the slot's own: the slot's day and clock fill and the create is proposed", async () => {
    micro(true);
    const c = schedulingState();
    const done = await prepareAgentScheduling(actor, c, released({ customer_ref: "c-leocadia", service_ref: "s-relax", professional_ref: "pro-quirino" }), freed);
    expect(done.codes).toEqual([]);
    expect(c.fields).toMatchObject({ professional_ref: "pro-quirino", date: "2026-09-30", time: "14:00" });
    expect(c.proposal).toBeDefined();
  });

  // P0a (C4 fallback): the professional counts as the owner's only in the create's own clause and undenied.
  const MOVE = "passa o Benedito pra sexta às 10h";
  const move = () => op("troca", "appointment.change", { customer_name: "Benedito", source_scope: MOVE, weekday: pair(5, "sexta"), time: pair("10:00", "às 10h") });
  const fill = (scope: string, extra: Record<string, unknown> = {}) => op("vaga", "appointment.create", { customer_name: "Leocádia", service_name: "massagem relaxante", source_scope: scope,
    depends_on: ["troca"], released_slot_of: "troca", destination_mode: "SAME_RELEASED_SLOT", ...extra });
  for (const [shape, scope] of [["denied", "a Leocádia ocupa a vaga dele pra massagem relaxante, nunca com a Sunamita"], ["absent from its clause", "a Leocádia ocupa a vaga dele pra massagem relaxante"]])
    it(`P0a C4 fallback: a professional ${shape} is never kept over the freed slot's: the slot's professional stands as today`, async () => {
      micro(true);
      const text = shape === "denied" ? `${MOVE} e ${scope}` : `${MOVE}, a Sunamita fica de folga, e ${scope}`;
      const r = read((await conversation([turn({ mode: "NEW", operations: [move(), fill(scope, { professional_name: "Sunamita" })] })], text)).first);
      expect(r.child("vaga").scheduling!.fields).toMatchObject({ professional_ref: "pro-quirino", date: "2026-09-30", time: "14:00" });
    });
  it("P0a link marker: only a link the owner's professional kept is marked; it then neither seeds, waits on nor asks the slot's professional", () => {
    const waiting = withoutReleasedProfessional({ fields: {}, state: { waiting: ["date", "time", "professional"] as ("date" | "time" | "professional")[] }, code: "RELEASED_ORIGIN_WAITING" });
    expect(waiting.state).toEqual({ waiting: ["date", "time"], ownProfessional: true });
    const seeded = withoutReleasedProfessional({ fields: { date: "2026-09-30", time: "14:00", professional_ref: "pro-quirino", professional_name: "Quirino Valadares" },
      state: { seeded: { date: "2026-09-30", time: "14:00", professional: "pro-quirino" } }, code: "RELEASED_ORIGIN_SEEDED" });
    expect(seeded.fields).toEqual({ date: "2026-09-30", time: "14:00" });
    expect(seeded.state as AgentMicroReferences).toEqual({ seeded: { date: "2026-09-30", time: "14:00" }, ownProfessional: true });
  });
});
