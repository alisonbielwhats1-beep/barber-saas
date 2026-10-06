import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** P3a (flag SALON_SECRETARY_REFERENCES_V2 with SALON_SECRETARY_SAME_AS) through the real plan path: decoder, ActionPlan, the
 * per-action adapters, journal drafts and proposals, the group executor. Luna frames are recorded (no network, no model); only
 * tenant lookups and the domain confirm are fixtures. Today is Monday 28/09/2026 (São Paulo): "amanhã" = 29/09, "sexta" = 02/10.
 * A nail/hair studio with diverse synthetic names; no gender is inferred from any name (the owner's own pronouns only). */
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

describe("D4 distributive: a day said once for a create and a block", () => {
  const text = "marca a Lia amanhã às 10h pra corte com a Nara e fecha a agenda da Nara das 14 às 15";
  const lia = () => op("lia", "appointment.create", { customer_name: "Lia", service_name: "corte", professional_name: "Nara", source_scope: "marca a Lia amanhã às 10h pra corte com a Nara",
    day_offset: pair(1, "amanhã"), time: pair("10:00", "às 10h") });
  const block = (fields: Record<string, unknown> = {}) => op("fecha", "schedule.block", { professional_name: "Nara", source_scope: "fecha a agenda da Nara das 14 às 15",
    time: pair("14:00", "das 14"), end_time: pair("15:00", "às 15"), same_as: [ref("date", "lia", "amanhã")], ...fields });
  it("the block lands on the create's ACCEPTED day (SAME_AS_DISTRIBUTIVE), one group", async () => {
    const { say } = await conversation(turn("NEW", [lia(), block()]));
    const view = await say(text), r = read(view);
    expect(r.child("fecha").scheduling!.fields).toMatchObject({ date: "2026-09-29", time: "14:00", end_time: "15:00" });
    expect(r.action("fecha").status).toBe("READY_FOR_CONFIRMATION");
    expect(r.group("fecha").action_keys.sort()).toEqual(["fecha", "lia"]);
    expect(codes()).toEqual(expect.arrayContaining(["SAME_AS_DISTRIBUTIVE", "SAME_AS_SEEDED"]));
  });
  it("a correction of the create's day re-derives the block (no model value copied)", async () => {
    const { say } = await conversation(turn("NEW", [lia(), block()]));
    await say(text);
    const view = await say("A Lia é na sexta.", ["select_capabilities", turn("PATCH", [{ item_key: "lia", choice: null, fields: { weekday: pair(5, "sexta") } }])]), r = read(view);
    expect(r.child("lia").scheduling!.fields.date).toBe("2026-10-02");
    expect(r.child("fecha").scheduling!.fields.date).toBe("2026-10-02");
    expect(codes()).toContain("SAME_AS_REDERIVED");
  });
  it("adversarial: a block with its own day never takes the sibling's (the own proven day stands)", async () => {
    const own = "marca a Lia amanhã às 10h pra corte com a Nara e fecha a agenda da Nara sexta das 14 às 15";
    const { say } = await conversation(turn("NEW", [lia(), block({ source_scope: "fecha a agenda da Nara sexta das 14 às 15", weekday: pair(5, "sexta") })]));
    const r = read(await say(own));
    expect(r.child("fecha").scheduling!.fields.date).toBe("2026-10-02");
    expect(codes()).toContain("SAME_AS_LITERAL_UNPROVEN");
    expect(codes()).not.toContain("SAME_AS_DISTRIBUTIVE");
  });
  it("adversarial: a negated clause is never linked (asked, never amanhã)", async () => {
    const negated = "marca a Lia amanhã às 10h pra corte com a Nara e não fecha a agenda da Nara das 14 às 15 amanhã";
    const { say } = await conversation(turn("NEW", [lia(), block({ source_scope: "não fecha a agenda da Nara das 14 às 15 amanhã" })]));
    const r = read(await say(negated));
    expect(r.child("fecha").scheduling!.fields.date).toBeUndefined();
    expect(r.child("fecha").scheduling!.proposal).toBeUndefined();
  });
  it("a shared professional who does not perform this action's service is asked, never reassigned", async () => {
    const both = "marca a Lia amanhã às 10h pra corte com a Nara e o Téo às 11h pra escova";
    const first = op("lia", "appointment.create", { customer_name: "Lia", service_name: "corte", professional_name: "Nara", source_scope: "marca a Lia amanhã às 10h pra corte com a Nara", day_offset: pair(1, "amanhã"), time: pair("10:00", "às 10h") });
    const second = op("teo", "appointment.create", { customer_name: "Téo", service_name: "escova", source_scope: "o Téo às 11h pra escova", time: pair("11:00", "às 11h"),
      same_as: [ref("date", "lia", "amanhã"), ref("professional", "lia", "com a Nara")] });
    const { say } = await conversation(turn("NEW", [first, second]));
    const view = await say(both), r = read(view);
    expect(r.child("teo").scheduling!.fields).toMatchObject({ date: "2026-09-29", time: "11:00" });
    expect(r.child("teo").scheduling!.fields.professional_ref).toBeUndefined();
    expect(r.child("teo").scheduling!.candidates).toMatchObject({ kind: "professional_ref", items: [{ id: "pro-jonas" }] });
    expect(r.child("teo").scheduling!.proposal).toBeUndefined();
    expect(view.message).toContain("não está elegível");
    expect(codes()).toContain("SAME_AS_DISTRIBUTIVE");
  });
  it("flag off (V2): the historical proof (no anaphora marker) leaves the block's day asked", async () => {
    vi.stubEnv("SALON_SECRETARY_REFERENCES_V2", "false");
    const { say } = await conversation(turn("NEW", [lia(), block()]));
    const r = read(await say(text));
    expect(r.child("fecha").scheduling!.fields.date).toBeUndefined();
    expect(r.action("fecha").missing_fields).toContain("date");
    expect(codes()).toContain("SAME_AS_LITERAL_UNPROVEN");
  });
});

describe("D-SELF-ORIGIN: 'pra sexta no mesmo horário' keeps the move's own origin clock", () => {
  const change = (literal: string, scope: string, fields: Record<string, unknown> = {}) => op("teo", "appointment.change", { customer_name: "Téo", source_scope: scope,
    weekday: pair(5, "sexta"), same_as: [ref("time", "teo", literal)], ...fields });
  it("the located appointment's 14h is seeded on Friday (ORIGIN_KEPT); availability checked normally", async () => {
    const text = "passa o Téo pra sexta no mesmo horário";
    const { say } = await conversation(turn("NEW", [change("no mesmo horário", text)]));
    const r = read(await say(text));
    expect(r.child("teo").scheduling!.fields).toMatchObject({ appointment_ref: "a-teo", date: "2026-10-02", time: "14:00" });
    expect(r.action("teo").status).toBe("READY_FOR_CONFIRMATION");
    expect(db.moves).toContainEqual({ ref: "a-teo", date: "2026-10-02", time: "14:00" });
    expect(codes()).toEqual(expect.arrayContaining(["SAME_AS_SELF_ORIGIN", "ORIGIN_KEPT"]));
  });
  it("genitive guard: 'no mesmo horário da Jade' is never Téo's own 14h (the time is asked)", async () => {
    const text = "passa o Téo pra sexta no mesmo horário da Jade";
    const { say } = await conversation(turn("NEW", [change("no mesmo horário", text)]));
    const r = read(await say(text));
    expect(r.child("teo").scheduling!.fields.time).toBeUndefined();
    expect(r.action("teo").missing_fields).toContain("time");
    expect(db.moves.filter(move => move.time === "14:00")).toEqual([]);
  });
  it("GF14 kept: a new day without the same-time literal asks the time", async () => {
    const text = "passa o Téo pra sexta";
    const { say } = await conversation(turn("NEW", [op("teo", "appointment.change", { customer_name: "Téo", source_scope: text, weekday: pair(5, "sexta") })]));
    const r = read(await say(text));
    expect(r.child("teo").scheduling!.fields.time).toBeUndefined();
    expect(r.action("teo").missing_fields).toContain("time");
  });
  it("Luna's own 10h beside the self reference (origin 14h): conflict, none chosen, asked", async () => {
    const text = "passa o Téo pra sexta às 10h no mesmo horário";
    const { say } = await conversation(turn("NEW", [change("no mesmo horário", text, { time: pair("10:00", "às 10h") })]));
    const view = await say(text), r = read(view);
    expect(r.child("teo").scheduling!.fields.time).toBeUndefined();
    expect(r.child("teo").scheduling!.proposal).toBeUndefined();
    expect(view.message).toContain("Recebi indicações diferentes para o horário e não escolhi nenhuma.");
    expect(codes()).toContain("SAME_AS_CONFLICT");
  });
});

describe("D2: 'o último cliente dela' is ONE row of the read, ranked over the whole read", () => {
  const text = "vê a agenda da Nara amanhã e passa o último cliente dela pra sexta no mesmo horário";
  const list = () => op("agenda", "appointment.list", { professional_name: "Nara", source_scope: "vê a agenda da Nara amanhã", day_offset: pair(1, "amanhã") });
  const move = (literal = "o último cliente dela") => op("passa", "appointment.change", { source_scope: "passa o último cliente dela pra sexta no mesmo horário", weekday: pair(5, "sexta"),
    same_as: [ref("customer", "agenda", literal), ref("time", "passa", "no mesmo horário")] });
  it("the third row (16h) moves to Friday at its own 16h; the read is prepared first", async () => {
    const { say } = await conversation(turn("NEW", [list(), move()]));
    const view = await say(text), r = read(view);
    expect(view.action_plan!.execution_order).toEqual(["agenda", "passa"]);
    expect(r.child("passa").scheduling!.fields).toMatchObject({ appointment_ref: "a-luz", customer_ref: "c-luz", date: "2026-10-02", time: "16:00" });
    expect(r.action("passa").status).toBe("READY_FOR_CONFIRMATION");
    expect(db.moves).toContainEqual({ ref: "a-luz", date: "2026-10-02", time: "16:00" });
  });
  it("two appointments tie at the last time: a card of both, never a pick", async () => {
    db.day = ["a-jade", "a-kevin", "a-luz", "a-yasmin"];
    const { say } = await conversation(turn("NEW", [list(), move()]));
    const r = read(await say(text));
    expect(r.child("passa").scheduling!.fields.appointment_ref).toBeUndefined();
    expect(r.child("passa").scheduling!.candidates).toMatchObject({ kind: "appointment_ref", items: [{ id: "a-luz" }, { id: "a-yasmin" }] });
    expect(db.moves).toEqual([]);
    expect(codes()).toContain("SAME_AS_READ_CARD");
  });
  it("Luna's own customer name that is not the named row: conflict, asked, nothing moved", async () => {
    const { say } = await conversation(turn("NEW", [list(), { ...move(), customer_name: "Kevin" }]));
    const view = await say(text), r = read(view);
    expect(r.child("passa").scheduling!.fields.appointment_ref).toBeUndefined();
    expect(view.message).toContain("Recebi indicações diferentes para o cliente e não escolhi nenhuma.");
    expect(db.moves).toEqual([]);
  });
  it("'o primeiro' when the first appointment already started: refused, never the second customer", async () => {
    APPOINTMENTS["a-jade"].status = "IN_PROGRESS"; APPOINTMENTS["a-jade"].start_at = "2026-09-28T12:00:00.000Z";
    const first = "vê a agenda da Nara amanhã e passa o primeiro cliente dela pra sexta no mesmo horário";
    const { say } = await conversation(turn("NEW", [list(), { ...move("o primeiro cliente dela"), source_scope: "passa o primeiro cliente dela pra sexta no mesmo horário" }]));
    const view = await say(first), r = read(view);
    expect(r.child("passa").scheduling!.fields.appointment_ref).toBeUndefined();
    expect(view.message).toContain("já começou ou foi encerrado");
    expect(db.moves).toEqual([]);
    expect(codes()).toContain("SAME_AS_READ_REFUSED");
  });
});

describe("D3: 'pro mesmo serviço' copies the ACCEPTED service of the cancelled appointment", () => {
  const cancel = (who: string, customer: string) => op("cancela", "appointment.cancel", { customer_name: customer, source_scope: `cancela a ${who} porque ela viajou`, reason: "porque ela viajou" });
  const create = (scope: string, fields: Record<string, unknown> = {}) => op("marca", "appointment.create", { customer_name: "Hiroshi", professional_name: "Nara", source_scope: scope, weekday: pair(5, "sexta"), time: pair("10:00", "às 10h"),
    same_as: [ref("service", "cancela", "pro mesmo serviço")], ...fields });
  it("one service: seeded; the create is proposed with it", async () => {
    const text = "cancela a Duda porque ela viajou e marca o Hiroshi sexta às 10h pro mesmo serviço";
    const { say } = await conversation(turn("NEW", [cancel("Duda", "Duda"), create("marca o Hiroshi sexta às 10h pro mesmo serviço")]));
    const r = read(await say(text));
    expect(r.child("marca").scheduling!.fields).toMatchObject({ service_ref: "s-gel", date: "2026-10-02", time: "10:00" });
    expect(r.action("marca").status).toBe("READY_FOR_CONFIRMATION");
    expect(codes()).toContain("SAME_AS_SEEDED");
  });
  it("two services: a card of those services, never a pick", async () => {
    const text = "cancela a Céu porque ela viajou e marca o Hiroshi sexta às 10h pro mesmo serviço";
    const { say } = await conversation(turn("NEW", [cancel("Céu", "Céu"), create("marca o Hiroshi sexta às 10h pro mesmo serviço")]));
    const r = read(await say(text));
    expect(r.child("marca").scheduling!.fields.service_ref).toBeUndefined();
    expect(r.child("marca").scheduling!.candidates).toMatchObject({ kind: "service_ref", items: [{ id: "s-corte" }, { id: "s-barba" }] });
    expect(r.child("marca").scheduling!.proposal).toBeUndefined();
    expect(codes()).toContain("SAME_AS_SERVICE_CARD");
  });
  it("Luna names another service beside the link: conflict, asked, nothing proposed", async () => {
    const text = "cancela a Duda porque ela viajou e marca o Hiroshi sexta às 10h pro mesmo serviço, escova";
    const { say } = await conversation(turn("NEW", [cancel("Duda", "Duda"), create("marca o Hiroshi sexta às 10h pro mesmo serviço, escova", { service_name: "escova" })]));
    const view = await say(text), r = read(view);
    expect(r.child("marca").scheduling!.fields.service_ref).toBeUndefined();
    expect(r.child("marca").scheduling!.proposal).toBeUndefined();
    expect(view.message).toContain("Recebi indicações diferentes para o serviço e não escolhi nenhuma.");
    expect(codes()).toContain("SAME_AS_CONFLICT");
  });
  it("a negated link is never honored: 'não pro mesmo serviço, pra escova' is escova", async () => {
    const text = "cancela a Duda porque ela viajou e marca o Hiroshi sexta às 10h, não pro mesmo serviço, pra escova";
    const { say } = await conversation(turn("NEW", [cancel("Duda", "Duda"), create("marca o Hiroshi sexta às 10h, não pro mesmo serviço, pra escova", { service_name: "escova" })]));
    const r = read(await say(text));
    expect(r.child("marca").scheduling!.fields.service_ref).toBe("s-escova");
    expect(codes()).toContain("SAME_AS_LITERAL_UNPROVEN");
  });
});

describe("D1: a new appointment in the slot a reschedule frees takes the move's ORIGIN", () => {
  const text = "passa o Téo pra sexta às 10h e coloca a Jade no horário que ele deixou pra corte";
  const move = () => op("troca", "appointment.change", { customer_name: "Téo", source_scope: "passa o Téo pra sexta às 10h", weekday: pair(5, "sexta"), time: pair("10:00", "às 10h") });
  const fill = (fields: Record<string, unknown> = {}) => op("vaga", "appointment.create", { customer_name: "Jade", service_name: "corte", source_scope: "coloca a Jade no horário que ele deixou pra corte",
    depends_on: ["troca"], released_slot_of: "troca", destination_mode: "SAME_RELEASED_SLOT", ...fields });
  it("the create is seeded with the origin (30/09 14h, same professional) and checked with that appointment projected out", async () => {
    const { say } = await conversation(turn("NEW", [move(), fill()]));
    const view = await say(text), r = read(view);
    expect(r.child("vaga").scheduling!.fields).toMatchObject({ date: "2026-09-30", time: "14:00", professional_ref: "pro-nara", customer_ref: "c-jade", service_ref: "s-corte" });
    expect(r.child("vaga").scheduling!.references).toMatchObject({ released: "a-teo" });
    expect(db.snapshots).toContainEqual({ released: "a-teo" });
    expect(db.proposed).toContainEqual({ released: "a-teo" });
    expect(r.action("vaga")).toMatchObject({ status: "READY_FOR_CONFIRMATION", depends_on: ["troca"], released_slot_of: "troca" });
    expect(r.group("vaga").action_keys.sort()).toEqual(["troca", "vaga"]);
    expect(codes()).toContain("RELEASED_ORIGIN_SEEDED");
  });
  it("one confirmation runs the move first, then the create (sequential)", async () => {
    const { say, secretary, sessionId } = await conversation(turn("NEW", [move(), fill()]));
    const ready = await say(text), r = read(ready);
    const order = [r.child("troca").scheduling!.proposal!.proposal_ref, r.child("vaga").scheduling!.proposal!.proposal_ref];
    await secretary.confirmReadyGroups(actor, sessionId, approvals(ready));
    expect(db.confirmed).toEqual(order);
  });
  it("Luna copying a day/clock into the create never stands: the released origin owns them", async () => {
    const { say } = await conversation(turn("NEW", [move(), fill({ day_offset: pair(1, "amanhã"), time: pair("10:00", "às 10h") })]));
    const r = read(await say(text));
    expect(r.child("vaga").scheduling!.fields).toMatchObject({ date: "2026-09-30", time: "14:00" });
  });
  it("the move needs the customer's acceptance: the create is refused up front, nothing proposed for it", async () => {
    db.acceptance = true;
    const { say } = await conversation(turn("NEW", [move(), fill()]));
    const view = await say(text), r = read(view);
    expect(r.child("vaga").scheduling!.proposal).toBeUndefined();
    expect(r.child("vaga").scheduling!.fields.time).toBeUndefined();
    expect(view.message).toContain("só fica livre depois que o cliente aceitar a remarcação");
    expect(codes()).toContain("RELEASED_ORIGIN_ACCEPTANCE");
  });
  it("C21: the appointment has a waiting list: the owner is told the slot goes to it and asked (no silent promotion, no proposal)", async () => {
    db.waiting = 2;
    const { say } = await conversation(turn("NEW", [move(), fill()]));
    const view = await say(text), r = read(view);
    expect(r.child("vaga").scheduling!.proposal).toBeUndefined();
    expect(view.message).toContain("vai automaticamente para a lista de espera (2 pessoa(s))");
    expect(codes()).toContain("RELEASED_ORIGIN_WAITLIST");
  });
  it("the move lands on the created slot (same day, same professional): asked, never two colliding proposals", async () => {
    const overlap = "passa o Téo pras 14h30 do mesmo dia e coloca a Jade no horário que ele deixou pra corte";
    const { say } = await conversation(turn("NEW", [op("troca", "appointment.change", { customer_name: "Téo", source_scope: "passa o Téo pras 14h30 do mesmo dia", time: pair("14:30", "pras 14h30") }),
      fill({ source_scope: "coloca a Jade no horário que ele deixou pra corte" })]));
    const view = await say(overlap), r = read(view);
    expect(r.child("vaga").scheduling!.proposal).toBeUndefined();
    expect(view.message).toContain("ficaria sobreposto à remarcação que o libera");
    expect(codes()).toContain("RELEASED_ORIGIN_OVERLAP");
  });
  it("the origin's professional does not do the new service: asked (never moved to another professional)", async () => {
    const escova = "passa o Téo pra sexta às 10h e coloca a Jade no horário que ele deixou pra escova";
    const { say } = await conversation(turn("NEW", [move(), fill({ service_name: "escova", source_scope: "coloca a Jade no horário que ele deixou pra escova" })]));
    const view = await say(escova), r = read(view);
    expect(r.child("vaga").scheduling!.fields.professional_ref).toBeUndefined();
    expect(r.child("vaga").scheduling!.proposal).toBeUndefined();
    expect(view.message).toContain("não está elegível");
    expect(r.child("vaga").scheduling!.candidates).toMatchObject({ kind: "professional_ref", items: [{ id: "pro-jonas" }] });
  });
  it("ADD, a pending move of the active plan: the added create is seeded from its origin, after it in the same group", async () => {
    const first = "passa o Téo pra sexta às 10h e vê a agenda da Nara amanhã";
    const { say } = await conversation(turn("NEW", [move(), op("agenda", "appointment.list", { professional_name: "Nara", source_scope: "vê a agenda da Nara amanhã", day_offset: pair(1, "amanhã") })]));
    await say(first);
    const add = fill({ source_scope: "coloca a Jade no horário que ele deixou pra corte" });
    const view = await say("coloca a Jade no horário que ele deixou pra corte", ["upsert_action_draft", turn("ADD", [add])]), r = read(view);
    expect(r.action("vaga")).toMatchObject({ depends_on: ["troca"], released_slot_of: "troca", status: "READY_FOR_CONFIRMATION" });
    expect(r.child("vaga").scheduling!.fields).toMatchObject({ date: "2026-09-30", time: "14:00", professional_ref: "pro-nara" });
    expect(r.group("vaga").action_keys).toEqual(expect.arrayContaining(["troca", "vaga"]));
    expect(db.proposed).toContainEqual({ released: "a-teo" });
  });
  it("ADD, a move already confirmed: the create takes the receipt's origin, with no projection (the slot is really free now)", async () => {
    const { say, secretary, sessionId } = await conversation(turn("NEW", [move()]));
    const ready = await say("passa o Téo pra sexta às 10h");
    await secretary.confirmReadyGroups(actor, sessionId, approvals(ready));
    db.proposed = []; db.snapshots = [];
    const add = fill({ source_scope: "coloca a Jade no horário que ele deixou pra corte" });
    const view = await say("coloca a Jade no horário que ele deixou pra corte", ["select_capabilities", turn("ADD", [add])]), r = read(view);
    expect(r.child("vaga").scheduling!.fields).toMatchObject({ date: "2026-09-30", time: "14:00", professional_ref: "pro-nara" });
    expect(r.child("vaga").scheduling!.references?.released).toBeUndefined();
    expect(db.proposed).toEqual([{}]);
    expect(codes()).toContain("RELEASED_ORIGIN_DONE");
  });
  it("flag off: the historical refusal of the whole turn (INVALID_DEPENDENCY_GRAPH), nothing prepared", async () => {
    vi.stubEnv("SALON_SECRETARY_REFERENCES_V2", "false");
    const { say } = await conversation(turn("NEW", [move(), fill()]));
    await expect(say(text)).rejects.toThrow("INVALID_DEPENDENCY_GRAPH");
    expect(db.moves).toEqual([]);
  });
});

describe("E2: 'minha agenda' is the owner's own registration, named as registered", () => {
  const text = "fecha a minha agenda amanhã das 14 às 15";
  const block = () => op("fecha", "schedule.block", { professional_name: "minha", source_scope: text, day_offset: pair(1, "amanhã"), time: pair("14:00", "das 14"), end_time: pair("15:00", "às 15") });
  it("registered here: the block is proposed for that professional; the reply never says 'minha'", async () => {
    db.self = [{ id: "pro-nara", name: "Nara Quintela" }];
    const { say } = await conversation(turn("NEW", [block()]));
    const view = await say(text), r = read(view);
    expect(r.child("fecha").scheduling!.fields.professional_ref).toBe("pro-nara");
    expect(r.action("fecha").status).toBe("READY_FOR_CONFIRMATION");
  });
  it("not registered here: said plainly, with the salon's professionals to choose from (no pick)", async () => {
    const { say } = await conversation(turn("NEW", [block()]));
    const view = await say(text), r = read(view);
    expect(r.child("fecha").scheduling!.fields.professional_ref).toBeUndefined();
    expect(view.message).toContain("Não encontrei seu cadastro como profissional neste salão.");
    expect(r.child("fecha").scheduling!.candidates).toMatchObject({ kind: "professional_ref", items: [{ id: "pro-nara" }, { id: "pro-jonas" }] });
    expect(codes()).toContain("SELF_NOT_PROFESSIONAL");
  });
  it("a block without any professional: a card of the team, the owner first and marked, never preselected", async () => {
    db.self = [{ id: "pro-jonas", name: "Jonas Ferraz" }];
    const { say } = await conversation(turn("NEW", [op("fecha", "schedule.block", { source_scope: "fecha a agenda amanhã das 14 às 15", day_offset: pair(1, "amanhã"), time: pair("14:00", "das 14"), end_time: pair("15:00", "às 15") })]));
    const r = read(await say("fecha a agenda amanhã das 14 às 15"));
    expect(r.child("fecha").scheduling!.fields.professional_ref).toBeUndefined();
    expect(r.child("fecha").scheduling!.candidates).toMatchObject({ kind: "professional_ref", items: [{ id: "pro-jonas", name: "Jonas Ferraz · você" }, { id: "pro-nara" }] });
  });
});
