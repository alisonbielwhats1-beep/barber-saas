import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** C4 R-B (flag SALON_SECRETARY_REFERENCES_V2 with SALON_SECRETARY_SAME_AS): a same_as literal that states THIS action's own value
 * ("e o Hiroshi tb depois de amanhã às 11", "e o Hiroshi no mesmo dia às 11h, também pra barba") through the real plan path
 * (decoder, ActionPlan, per-action adapters, journal drafts and proposals). Same fixtures as secretary-references-v2-runtime.test.ts:
 * frames are recorded (no network, no model); only tenant lookups and the domain confirm are fixtures. Today is Monday 28/09/2026
 * (São Paulo): "depois de amanhã" = 30/09, "sexta" = 02/10. Diverse synthetic names; no gender is inferred from any name. */
type Row = { appointment_ref: string; customer_ref: string; customer_name: string; professional_ref: string; professional_name: string; service_ref: string;
  services: { serviceName: string }[]; start_local: string; end_local: string; start_at: string; status: string };
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[], moves: [] as { ref: string; date: string; time: string; released?: string }[],
  confirmed: [] as string[], snapshots: [] as { released?: string }[], proposed: [] as { released?: string }[], acceptance: false, waiting: 0, self: [] as { id: string; name: string }[],
  day: [] as string[] }));
const at = (local: string) => new Date(`${local}:00-03:00`).toISOString();
const appointment = (ref: string, customer: [string, string], start: string, services: [string, string][], status = "CONFIRMED"): Row => ({ appointment_ref: ref, customer_ref: customer[0], customer_name: customer[1],
  professional_ref: "pro-nara", professional_name: "Nara Quintela", service_ref: services[0][0], services: services.map(([, serviceName]) => ({ serviceName })),
  start_local: start, end_local: `${start.slice(0, 11)}${String(Number(start.slice(11, 13)) + 1).padStart(2, "0")}${start.slice(13)}`, start_at: at(start), status });
const APPOINTMENTS: Record<string, Row> = {
  "a-teo": appointment("a-teo", ["c-teo", "Téo Nakamura"], "2026-09-30T14:00", [["s-corte", "Corte masculino"]]),
  "a-jade": appointment("a-jade", ["c-jade", "Jade Moura"], "2026-09-29T09:00", [["s-gel", "Esmaltação em gel"]]),
  "a-kevin": appointment("a-kevin", ["c-kevin", "Kevin Sato"], "2026-09-29T11:00", [["s-corte", "Corte masculino"]]),
  "a-luz": appointment("a-luz", ["c-luz", "Luz Andrade"], "2026-09-29T16:00", [["s-gel", "Esmaltação em gel"]]),
  "a-yasmin": appointment("a-yasmin", ["c-yasmin", "Yasmin Alves"], "2026-09-29T16:00", [["s-corte", "Corte masculino"]]),
  "a-duda": appointment("a-duda", ["c-duda", "Duda Ramos"], "2026-09-30T10:00", [["s-gel", "Esmaltação em gel"]]),
  "a-ceu": appointment("a-ceu", ["c-ceu", "Céu Martins"], "2026-09-30T11:00", [["s-corte", "Corte masculino"], ["s-barba", "Barba"]]),
};
const SERVICES: Record<string, string> = { "s-corte": "Corte masculino", "s-gel": "Esmaltação em gel", "s-barba": "Barba", "s-escova": "Escova" };
const CUSTOMERS: Record<string, { id: string; name: string }> = { lia: { id: "c-lia", name: "Lia Moraes" }, teo: { id: "c-teo", name: "Téo Nakamura" }, jade: { id: "c-jade", name: "Jade Moura" },
  duda: { id: "c-duda", name: "Duda Ramos" }, ceu: { id: "c-ceu", name: "Céu Martins" }, hiroshi: { id: "c-hiroshi", name: "Hiroshi Tanaka" } };
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  listSchedulingServices: async (_tx: unknown, _actor: unknown, name: string) => Object.entries(SERVICES).filter(([, label]) => fold(label).startsWith(fold(name).split(" ")[0])).map(([id, label]) => ({ id, name: label })),
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, filter: { query?: string; service_ref?: string }) => {
    const { isFirstPersonReference } = await import("../secretary-first-person");
    if (isFirstPersonReference(filter.query)) return db.self;
    const all = [{ id: "pro-nara", name: "Nara Quintela" }, { id: "pro-jonas", name: "Jonas Ferraz" }];
    // Only Jonas does Escova (a scope without a name is filtered by the service).
    const rows = filter.query ? all.filter(row => fold(row.name).startsWith(fold(filter.query!).split(" ")[0])) : all;
    return filter.service_ref === "s-escova" ? rows.filter(row => row.id === "pro-jonas") : rows;
  },
  schedulingSelfProfessional: async () => db.self[0],
  getSchedulingAvailability: async (_tx: unknown, _actor: unknown, input: { date: string; time: string }) => ({ plan: { startLocal: `${input.date}T${input.time}` }, alternatives: [], timezone: "America/Sao_Paulo" }),
  listSchedulingAppointments: async (_tx: unknown, _actor: unknown, input: { date: string; professional_ref?: string }) =>
    db.day.map(ref => APPOINTMENTS[ref]).filter(row => row.start_local.startsWith(input.date) && (!input.professional_ref || row.professional_ref === input.professional_ref)),
  getSchedulingAppointment: async (_tx: unknown, _actor: unknown, ref: string) => { const row = APPOINTMENTS[ref]; if (!row) throw Error("APPOINTMENT_NOT_FOUND"); return row; } }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, name: string) => Object.entries(CUSTOMERS).filter(([key]) => fold(name).startsWith(key)).map(([, row]) => row),
  getCustomer: async (_tx: unknown, _actor: unknown, ref: string) => { const row = Object.values(CUSTOMERS).find(item => item.id === ref); if (!row) throw Error("CUSTOMER_NOT_FOUND"); return row; } }));
vi.mock("../scheduling-entity-mentions", async importOriginal => ({ ...await importOriginal<object>(), validateSchedulingEntityMentions: async () => undefined }));
vi.mock("../scheduling-actions", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingSnapshot: async (_tx: unknown, _actor: unknown, f: Record<string, string>, _now?: Date, projection?: { releasedAppointmentId: string }) => {
    db.snapshots.push({ ...(projection ? { released: projection.releasedAppointmentId } : {}) });
    return { customer_ref: f.customer_ref, customer_name: f.customer_name, service_ref: f.service_ref, service_revision: "1", service_name: SERVICES[f.service_ref] ?? f.service_name, professional_ref: f.professional_ref,
      professional_name: "Nara Quintela", date: f.date, startLocal: `${f.date}T${f.time}`, endLocal: `${f.date}T${String(Number(f.time.slice(0, 2)) + 1).padStart(2, "0")}${f.time.slice(2)}`,
      timezone: "America/Sao_Paulo", priceCents: 8000, priceType: "FIXED", durationMin: 60, quote: "q" };
  },
  proposeAppointmentCreate: async (_tx: unknown, _actor: unknown, input: { draft_ref: string; draft_revision: number }, projection?: { releasedAppointmentId: string }) => {
    db.proposed.push({ ...(projection ? { released: projection.releasedAppointmentId } : {}) });
    return { proposal_ref: crypto.randomUUID(), draft_ref: input.draft_ref, draft_revision: input.draft_revision, payload_hash: "h".repeat(64), preview: "NOVO AGENDAMENTO", expires_at: new Date(Date.now() + 600_000).toISOString() };
  },
  confirmAppointmentCreate: async (_tx: unknown, _actor: unknown, input: { proposal_ref: string; draft_revision: number }) => {
    db.confirmed.push(input.proposal_ref);
    // The receipt of a mutation carries its proposal's action snapshot (what the move left behind).
    const proposal = db.rows.find(row => row.action === "PROPOSAL" && (row.metadata as { proposal_ref?: string }).proposal_ref === input.proposal_ref)?.metadata as { action_snapshot?: unknown } | undefined;
    return { proposal_ref: input.proposal_ref, draft_ref: "synthetic-draft", draft_revision: input.draft_revision, outcome: "RESCHEDULED", appointment_ref: "synthetic-appointment",
      ...(proposal?.action_snapshot ? { action_snapshot: proposal.action_snapshot } : {}) };
  } }));
vi.mock("../scheduling-mutations", async importOriginal => {
  const original = await importOriginal<typeof import("../scheduling-mutations")>();
  return { ...original, authorizeSchedulingOperation: async () => "OWNER",
    locateSchedulingAppointments: async (_tx: unknown, _actor: unknown, f: { customer_ref?: string }) => Object.values(APPOINTMENTS).filter(row => row.customer_ref === f.customer_ref && row.status === "CONFIRMED"),
    inspectSchedulingMove: async (_tx: unknown, _actor: unknown, ref: string, date: string, time: string, _excluded?: unknown, released?: string) => {
      db.moves.push({ ref, date, time, ...(released ? { released } : {}) }); return { result: {}, alternatives: [] };
    },
    schedulingActionSnapshot: async (_tx: unknown, _actor: unknown, operation: string, f: Record<string, string>) => {
      const base = { timezone: "America/Sao_Paulo", resource_ids: [], waiting_hash: "", affected: [], priceCents: 8000 };
      if (operation === "schedule.block") return original.actionSnapshot.parse({ ...base, kind: operation, professional_ref: f.professional_ref, professional_name: "Nara Quintela",
        startLocal: `${f.date}T${f.time}`, endLocal: `${f.end_date ?? f.date}T${f.end_time}`, services: [], requires_acceptance: false, waiting_count: 0 });
      const row = APPOINTMENTS[f.appointment_ref], change = operation === "appointment.change";
      return original.actionSnapshot.parse({ ...base, kind: operation, appointment_ref: row.appointment_ref, revision: 1, customer_ref: row.customer_ref, customer_name: row.customer_name,
        professional_ref: row.professional_ref, professional_name: row.professional_name, before_start: row.start_local, before_end: row.end_local, before_timezone: "America/Sao_Paulo",
        startLocal: change ? `${f.date}T${f.time}` : row.start_local, endLocal: change ? `${f.date}T${String(Number(f.time.slice(0, 2)) + 1).padStart(2, "0")}${f.time.slice(2)}` : row.end_local,
        services: row.services.map((s, index) => ({ id: index ? "s-barba" : row.service_ref, name: s.serviceName, durationMin: 60, priceCents: 8000, priceType: "FIXED", priceNote: null, processingMin: 0, finishingMin: 0 })),
        requires_acceptance: change && db.acceptance, waiting_count: change ? db.waiting : 0 });
    } };
});
import { SalonSecretary, type SecretaryView } from "../salon-secretary";
import { ScriptedServicesModel, call, appendScriptedResponses } from "../../test/scripted-services-model";

const actor = { salonId: "synthetic-studio", userId: "synthetic-owner" };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-28T15:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  vi.stubEnv("SALON_SECRETARY_SAME_AS", "true"); vi.stubEnv("SALON_SECRETARY_REFERENCES_V2", "true");
  Object.assign(db, { rows: [], moves: [], confirmed: [], snapshots: [], proposed: [], acceptance: false, waiting: 0, self: [], day: ["a-jade", "a-kevin", "a-luz"] });
  APPOINTMENTS["a-jade"].status = "CONFIRMED"; APPOINTMENTS["a-jade"].start_at = at(APPOINTMENTS["a-jade"].start_local);
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
const ref = (field: string, item_key: string, literal: string) => ({ field, item_key, literal });
const turn = (mode: string, operations: unknown[]) => ({ turn: { mode, operations } });
async function conversation(first: unknown) {
  const model = new ScriptedServicesModel([call("select_capabilities", first)]);
  const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const session = await secretary.start(actor, "auto");
  const say = (message: string, next?: [string, unknown]) => { if (next) appendScriptedResponses(model, [call(next[0], next[1])]); return secretary.send(actor, { sessionId: session.sessionId, message }); };
  return { model, secretary, sessionId: session.sessionId, say };
}
const read = (view: SecretaryView) => ({
  action: (key: string) => view.action_plan!.actions.find(item => item.key === key)!,
  child: (key: string) => view.operations!.find(item => item.action_keys?.includes(key))!.state,
  group: (key: string) => view.action_plan!.confirmation_groups.find(group => group.action_keys.includes(key))!,
});
const codes = () => db.rows.filter(row => row.entityType === "SECRETARY_ROUTER").flatMap(row => (row.metadata as { outcome?: { divergence: { failed_codes: string[] } } }).outcome?.divergence.failed_codes ?? []);
const approvals = (view: SecretaryView) => view.action_plan!.confirmation_groups.filter(group => group.status === "READY_FOR_CONFIRMATION")
  .map(group => ({ plan_ref: view.action_plan!.plan_ref, revision: view.action_plan!.revision, group_key: group.key, fingerprint: group.fingerprint }));

const clock = (hour: number, literal: string, daypart = "UNSPECIFIED", minute = 0) => ({ value: { hour, minute, daypart }, literal });
const relative = (offset: number, literal: string) => ({ value: { kind: "RELATIVE_DAY", offset, weekday: null, week: null, day: null, month: null, year: null, days: null }, literal });
const components = (date: unknown = null, time: unknown = null) => ({ date, source_date: null, end_date: null, time, source_time: null, end_time: null });
const sameAs = (view: SecretaryView, key: string) => (view.action_plan!.actions.find(item => item.key === key) as unknown as { same_as?: { field: string }[] }).same_as ?? [];

describe("C4 R-B: a day literal that states this action's own day (components)", () => {
  beforeEach(() => { vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", "true"); });
  const text = "marca a Lia depois de amanhã de manhã às 9 pra corte e o Hiroshi tb depois de amanhã às 11 pra escova";
  const lia = () => op("lia", "appointment.create", { customer_name: "Lia", service_name: "corte", professional_name: "Nara", source_scope: "marca a Lia depois de amanhã de manhã às 9 pra corte",
    components: components(relative(2, "depois de amanhã"), clock(9, "de manhã às 9", "MANHA")) });
  const hiroshi = (scope: string, fields: Record<string, unknown> = {}) => op("hiroshi", "appointment.create", { customer_name: "Hiroshi", service_name: "escova", source_scope: scope,
    components: components(null, clock(11, "às 11")), same_as: [ref("date", "lia", "depois de amanhã"), ref("time", "lia", "depois de amanhã")], ...fields });
  it("the literal in Hiroshi's own clause is Hiroshi's own day (30/09), never copied from Lia; the time stays his own 11h; proposed", async () => {
    const { say } = await conversation(turn("NEW", [lia(), hiroshi("e o Hiroshi tb depois de amanhã às 11 pra escova")]));
    const view = await say(text), r = read(view);
    expect(r.child("hiroshi").scheduling!.fields).toMatchObject({ date: "2026-09-30", time: "11:00", service_ref: "s-escova" });
    expect(r.action("hiroshi").status).toBe("READY_FOR_CONFIRMATION");
    expect(sameAs(view, "hiroshi")).toEqual([]); // no link kept: the day is his own and never follows Lia's later corrections
    expect(codes()).toEqual(expect.arrayContaining(["SAME_AS_OWN_LITERAL", "SAME_AS_LITERAL_UNPROVEN"]));
  });
  it("a time literal that states only a day grounds nothing for time: the day is his own, the time is asked", async () => {
    const own = "marca a Lia depois de amanhã de manhã às 9 pra corte e o Hiroshi tb depois de amanhã pra escova";
    const { say } = await conversation(turn("NEW", [lia(), hiroshi("e o Hiroshi tb depois de amanhã pra escova", { components: components() })]));
    const view = await say(own), r = read(view);
    expect(r.child("hiroshi").scheduling!.fields.date).toBe("2026-09-30");
    expect(r.child("hiroshi").scheduling!.fields.time).toBeUndefined();
    expect(r.action("hiroshi").missing_fields).toContain("time");
    expect(r.child("hiroshi").scheduling!.proposal).toBeUndefined();
  });
  it("adversarial: a negated own literal is never a value: the day is asked (never 30/09)", async () => {
    const negated = "marca a Lia depois de amanhã de manhã às 9 pra corte e o Hiroshi às 11 pra escova, não depois de amanhã";
    const { say } = await conversation(turn("NEW", [lia(), hiroshi("e o Hiroshi às 11 pra escova, não depois de amanhã")]));
    const view = await say(negated), r = read(view);
    expect(r.child("hiroshi").scheduling!.fields.date).toBeUndefined();
    expect(r.action("hiroshi").missing_fields).toContain("date");
    expect(r.child("hiroshi").scheduling!.proposal).toBeUndefined();
    expect(codes()).not.toContain("SAME_AS_OWN_LITERAL");
  });
  it("review adversarial: an exclusion day literal ('tirando sexta') is never Hiroshi's day: the day is asked, nothing proposed", async () => {
    for (const tail of ["tirando sexta", "fora sexta", "em vez de sexta"]) {
      Object.assign(db, { rows: [] });
      const said = `marca a Lia depois de amanhã de manhã às 9 pra corte e o Hiroshi às 11 pra escova, ${tail}`;
      const { say } = await conversation(turn("NEW", [lia(), hiroshi(`e o Hiroshi às 11 pra escova, ${tail}`, { same_as: [ref("date", "lia", tail)] })]));
      const r = read(await say(said));
      expect(r.child("hiroshi").scheduling!.fields.date, tail).toBeUndefined();
      expect(r.action("hiroshi").missing_fields, tail).toContain("date");
      expect(r.child("hiroshi").scheduling!.proposal, tail).toBeUndefined();
      expect(codes(), tail).toContain("SAME_AS_LITERAL_UNPROVEN"); expect(codes(), tail).not.toContain("SAME_AS_OWN_LITERAL");
    }
  });
  it("review adversarial: an offset from Lia ('duas horas mais tarde') is never an absolute clock: his own day, the time asked", async () => {
    const said = "marca a Lia depois de amanhã de manhã às 9 pra corte e o Hiroshi tb depois de amanhã, duas horas mais tarde, pra escova";
    const { say } = await conversation(turn("NEW", [lia(), hiroshi("e o Hiroshi tb depois de amanhã, duas horas mais tarde, pra escova",
      { components: components(), same_as: [ref("date", "lia", "depois de amanhã"), ref("time", "lia", "duas horas mais tarde")] })]));
    const view = await say(said), r = read(view);
    expect(r.child("hiroshi").scheduling!.fields.date).toBe("2026-09-30");
    expect(r.child("hiroshi").scheduling!.fields.time).toBeUndefined();
    expect(r.action("hiroshi").missing_fields).toContain("time");
    expect(r.child("hiroshi").scheduling!.proposal).toBeUndefined();
  });
  it("flag off (V2): the historical refusal, the day is asked", async () => {
    vi.stubEnv("SALON_SECRETARY_REFERENCES_V2", "false");
    const { say } = await conversation(turn("NEW", [lia(), hiroshi("e o Hiroshi tb depois de amanhã às 11 pra escova")]));
    const r = read(await say(text));
    expect(r.child("hiroshi").scheduling!.fields.date).toBeUndefined();
    expect(r.action("hiroshi").missing_fields).toContain("date");
    expect(codes()).toContain("SAME_AS_LITERAL_UNPROVEN");
    expect(codes()).not.toContain("SAME_AS_OWN_LITERAL");
  });
});

describe("C4 R-B: a service literal that states this action's own service", () => {
  beforeEach(() => { (db.tx as unknown as { service: unknown }).service = { findMany: vi.fn(async () => Object.values(SERVICES).map(name => ({ name }))) }; });
  const text = (tail: string) => `marca o Téo pra corte na sexta às 10h e o Hiroshi no mesmo dia às 11h, ${tail}`;
  const teo = () => op("teo", "appointment.create", { customer_name: "Téo", service_name: "corte", professional_name: "Nara", source_scope: "marca o Téo pra corte na sexta às 10h",
    weekday: pair(5, "sexta"), time: pair("10:00", "às 10h") });
  const hiroshi = (tail: string, literal: string, fields: Record<string, unknown> = {}) => op("hiroshi", "appointment.create", { customer_name: "Hiroshi", professional_name: "Nara",
    source_scope: `e o Hiroshi no mesmo dia às 11h, ${tail}`, time: pair("11:00", "às 11h"), same_as: [ref("date", "teo", "no mesmo dia"), ref("service", "teo", literal)], ...fields });
  it("the literal 'também pra barba' is Hiroshi's own service (Barba, never Téo's corte); the day still follows Téo", async () => {
    const { say } = await conversation(turn("NEW", [teo(), hiroshi("também pra barba", "também pra barba")]));
    const view = await say(text("também pra barba")), r = read(view);
    expect(r.child("hiroshi").scheduling!.fields).toMatchObject({ service_ref: "s-barba", date: "2026-10-02", time: "11:00" });
    expect(r.action("hiroshi").status).toBe("READY_FOR_CONFIRMATION");
    expect(sameAs(view, "hiroshi").map(item => item.field)).toEqual(["date"]);
    expect(codes()).toEqual(expect.arrayContaining(["SAME_AS_OWN_LITERAL", "SAME_AS_SEEDED"]));
  });
  it("adversarial: a literal naming two services is no single value: the service is asked, nothing proposed", async () => {
    const { say } = await conversation(turn("NEW", [teo(), hiroshi("também pra corte masculino e barba", "também pra corte masculino e barba")]));
    const r = read(await say(text("também pra corte masculino e barba")));
    expect(r.child("hiroshi").scheduling!.fields.service_ref).toBeUndefined();
    expect(r.child("hiroshi").scheduling!.proposal).toBeUndefined();
    expect(codes()).toContain("SAME_AS_LITERAL_UNPROVEN");
    expect(codes()).not.toContain("SAME_AS_OWN_LITERAL");
  });
  it("adversarial: a negated service literal is never a value", async () => {
    const { say } = await conversation(turn("NEW", [teo(), hiroshi("mas não pra barba", "não pra barba")]));
    const r = read(await say(text("mas não pra barba")));
    expect(r.child("hiroshi").scheduling!.fields.service_ref).toBeUndefined();
    expect(r.child("hiroshi").scheduling!.proposal).toBeUndefined();
    expect(codes()).not.toContain("SAME_AS_OWN_LITERAL");
  });
  it("review adversarial: an exclusion or substitution head beside the service ('fora a barba', 'em vez de barba') is never the service: asked", async () => {
    for (const tail of ["fora a barba", "tirando a barba", "nada de barba", "em vez de barba"]) {
      Object.assign(db, { rows: [] });
      const { say } = await conversation(turn("NEW", [teo(), hiroshi(tail, tail)]));
      const r = read(await say(text(tail)));
      expect(r.child("hiroshi").scheduling!.fields.service_ref, tail).toBeUndefined();
      expect(r.child("hiroshi").scheduling!.proposal, tail).toBeUndefined();
      expect(r.action("hiroshi").status, tail).not.toBe("READY_FOR_CONFIRMATION");
      expect(codes(), tail).toContain("SAME_AS_LITERAL_UNPROVEN"); expect(codes(), tail).not.toContain("SAME_AS_OWN_LITERAL");
    }
  });
  it("adversarial: Luna's own service stands (never replaced by the literal's)", async () => {
    const { say } = await conversation(turn("NEW", [teo(), hiroshi("também pra barba, quer dizer escova", "também pra barba", { service_name: "escova" })]));
    const r = read(await say(text("também pra barba, quer dizer escova")));
    expect(r.child("hiroshi").scheduling!.fields.service_ref).toBe("s-escova");
    expect(codes()).not.toContain("SAME_AS_OWN_LITERAL");
  });
});
void approvals;

