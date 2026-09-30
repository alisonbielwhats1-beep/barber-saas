import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** Fixer of the adversarial reviews A (references and reads) and B (recurrence guard, cross-phase) of Candidate 4, phase 3, through
 * the real plan path (decoder, ActionPlan, per-action adapters, journal drafts and proposals). Luna frames are recorded (no network,
 * no model); only tenant lookups and the domain snapshots are fixtures. Today is Monday 28/09/2026 (São Paulo): "amanhã" = 29/09,
 * "sexta" = 02/10. A brow/nail studio with a barber chair; diverse synthetic names; no gender is inferred from any name. */
type Row = { appointment_ref: string; customer_ref: string; customer_name: string; professional_ref: string; professional_name: string; service_ref: string;
  services: { serviceName: string }[]; start_local: string; end_local: string; start_at: string; status: string };
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[], moves: [] as { ref: string; date: string; time: string }[],
  proposed: 0, self: [] as { id: string; name: string }[], day: [] as string[] }));
const at = (local: string) => new Date(`${local}:00-03:00`).toISOString();
const plus1 = (start: string) => `${start.slice(0, 11)}${String(Number(start.slice(11, 13)) + 1).padStart(2, "0")}${start.slice(13)}`;
const appointment = (ref: string, customer: [string, string], start: string, services: [string, string][]): Row => ({ appointment_ref: ref, customer_ref: customer[0], customer_name: customer[1],
  professional_ref: "pro-iara", professional_name: "Iara Botelho", service_ref: services[0][0], services: services.map(([, serviceName]) => ({ serviceName })),
  start_local: start, end_local: plus1(start), start_at: at(start), status: "CONFIRMED" });
const APPOINTMENTS: Record<string, Row> = {
  "a-ravi": appointment("a-ravi", ["c-ravi", "Ravi Kapoor"], "2026-09-30T14:00", [["s-degrade", "Corte degradê"]]),
  "a-yumi": appointment("a-yumi", ["c-yumi", "Yumi Oda"], "2026-09-29T09:00", [["s-sobr", "Design de sobrancelha"]]),
  "a-zuri": appointment("a-zuri", ["c-zuri", "Zuri Mensah"], "2026-09-29T11:00", [["s-pemao", "Pé e mão"]]),
  "a-noah": appointment("a-noah", ["c-noah", "Noah Lins"], "2026-09-29T16:00", [["s-degrade", "Corte degradê"]]),
  "a-aurora": appointment("a-aurora", ["c-aurora", "Aurora Pires"], "2026-09-29T16:00", [["s-sobr", "Design de sobrancelha"]]),
  "a-bene": appointment("a-bene", ["c-bene", "Benedita Sá"], "2026-09-30T11:00", [["s-sobr", "Design de sobrancelha"], ["s-henna", "Henna"]]),
  "a-otavio": appointment("a-otavio", ["c-otavio", "Otávio Brum"], "2026-09-29T10:00", [["s-degrade", "Corte degradê"]]),
};
const SERVICES: Record<string, string> = { "s-degrade": "Corte degradê", "s-sobr": "Design de sobrancelha", "s-henna": "Henna", "s-pemao": "Pé e mão", "s-mensal": "Manutenção mensal" };
const CUSTOMERS: Record<string, { id: string; name: string }> = { ravi: { id: "c-ravi", name: "Ravi Kapoor" }, yumi: { id: "c-yumi", name: "Yumi Oda" }, zuri: { id: "c-zuri", name: "Zuri Mensah" },
  bene: { id: "c-bene", name: "Benedita Sá" }, kai: { id: "c-kai", name: "Kaique Rocha" }, otavio: { id: "c-otavio", name: "Otávio Brum" }, mai: { id: "c-mai", name: "Maitê Duarte" } };
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  listSchedulingServices: async (_tx: unknown, _actor: unknown, name: string) => Object.entries(SERVICES).filter(([, label]) => fold(label).includes(fold(name).split(" ")[0])).map(([id, label]) => ({ id, name: label })),
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, filter: { query?: string; service_ref?: string }) => {
    const { isFirstPersonReference } = await import("../secretary-first-person");
    if (isFirstPersonReference(filter.query)) return db.self;
    const all = [{ id: "pro-iara", name: "Iara Botelho" }, { id: "pro-caua", name: "Cauã Moreira" }];
    return filter.query ? all.filter(row => fold(row.name).startsWith(fold(filter.query!).split(" ")[0])) : all;
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
vi.mock("../entity-suggestions", async importOriginal => ({ ...await importOriginal<object>(), salonDirectoryNames: async (_tx: unknown, _actor: unknown, kind: string) => kind === "service" ? Object.values(SERVICES) : ["Iara Botelho", "Cauã Moreira"] }));
vi.mock("../scheduling-actions", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingSnapshot: async (_tx: unknown, _actor: unknown, f: Record<string, unknown>) => {
    const list = Array.isArray(f.service_list_ref) ? f.service_list_ref as string[] : undefined, first = (f.service_ref as string | undefined) ?? list?.[0] ?? "";
    return { customer_ref: f.customer_ref, customer_name: f.customer_name, service_ref: first, service_revision: "1", service_name: SERVICES[first], professional_ref: f.professional_ref, professional_name: "Iara Botelho",
      date: f.date, startLocal: `${f.date}T${f.time}`, endLocal: plus1(`${f.date}T${f.time}`), timezone: "America/Sao_Paulo", priceCents: 8000, priceType: "FIXED", durationMin: 60, quote: "q",
      ...(list && list.length > 1 ? { services: list.map(id => ({ service_ref: id, service_revision: "1", service_name: SERVICES[id], priceCents: 4000, priceType: "FIXED", durationMin: 30 })) } : {}) };
  },
  proposeAppointmentCreate: async (_tx: unknown, _actor: unknown, input: { draft_ref: string; draft_revision: number }) => {
    db.proposed++;
    return { proposal_ref: crypto.randomUUID(), draft_ref: input.draft_ref, draft_revision: input.draft_revision, payload_hash: "h".repeat(64), preview: "NOVO AGENDAMENTO", expires_at: new Date(Date.now() + 600_000).toISOString() };
  },
  confirmAppointmentCreate: async () => { throw Error("NEVER_CONFIRMED_IN_THIS_TEST"); } }));
vi.mock("../scheduling-mutations", async importOriginal => {
  const original = await importOriginal<typeof import("../scheduling-mutations")>();
  return { ...original, authorizeSchedulingOperation: async () => "OWNER",
    locateSchedulingAppointments: async (_tx: unknown, _actor: unknown, f: { customer_ref?: string }) => Object.values(APPOINTMENTS).filter(row => row.customer_ref === f.customer_ref),
    inspectSchedulingMove: async (_tx: unknown, _actor: unknown, ref: string, date: string, time: string) => { db.moves.push({ ref, date, time }); return { result: {}, alternatives: [] }; },
    schedulingAppointmentServices: async (_tx: unknown, _actor: unknown, ref: string) => { const row = APPOINTMENTS[ref];
      return { professional_ref: row.professional_ref, professional_name: row.professional_name, customer_name: row.customer_name, services: row.services.map((s, index) => ({ id: index ? "s-henna" : row.service_ref, name: s.serviceName })) }; },
    schedulingActionSnapshot: async (_tx: unknown, _actor: unknown, operation: string, f: Record<string, string>) => {
      const base = { timezone: "America/Sao_Paulo", resource_ids: [], waiting_hash: "", affected: [], priceCents: 8000 };
      if (operation === "schedule.block") return original.actionSnapshot.parse({ ...base, kind: operation, professional_ref: f.professional_ref, professional_name: "Iara Botelho",
        startLocal: `${f.date}T${f.time}`, endLocal: `${f.end_date ?? f.date}T${f.end_time}`, services: [], requires_acceptance: false, waiting_count: 0 });
      const row = APPOINTMENTS[f.appointment_ref], change = operation === "appointment.change", target = change ? `${f.date ?? row.start_local.slice(0, 10)}T${f.time ?? row.start_local.slice(11, 16)}` : row.start_local;
      return original.actionSnapshot.parse({ ...base, kind: operation, appointment_ref: row.appointment_ref, revision: 1, customer_ref: row.customer_ref, customer_name: row.customer_name,
        professional_ref: f.target_professional_ref ?? row.professional_ref, professional_name: row.professional_name, before_start: row.start_local, before_end: row.end_local, before_timezone: "America/Sao_Paulo",
        startLocal: target, endLocal: plus1(target),
        services: row.services.map((s, index) => ({ id: index ? "s-henna" : row.service_ref, name: s.serviceName, durationMin: 60, priceCents: 8000, priceType: "FIXED", priceNote: null, processingMin: 0, finishingMin: 0 })),
        requires_acceptance: false, waiting_count: 0 });
    } };
});
import { SalonSecretary, type SecretaryView } from "../salon-secretary";
import { ScriptedServicesModel, call, appendScriptedResponses } from "../../test/scripted-services-model";
import { startBatch } from "../secretary-batch";
import { validateSelectionV2 } from "@everflair/salon-secretary";

const actor = { salonId: "synthetic-brow-studio", userId: "synthetic-owner" };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-28T15:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  vi.stubEnv("SALON_SECRETARY_SAME_AS", "true"); vi.stubEnv("SALON_SECRETARY_REFERENCES_V2", "true");
  Object.assign(db, { rows: [], moves: [], proposed: 0, self: [], day: ["a-yumi", "a-otavio", "a-zuri", "a-noah"] });
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
  const say = (message: string, next?: unknown, tool = "select_capabilities") => { if (next) appendScriptedResponses(model, [call(tool, next)]); return secretary.send(actor, { sessionId: session.sessionId, message }); };
  return { secretary, sessionId: session.sessionId, say };
}
const action = (view: SecretaryView, key: string) => view.action_plan!.actions.find(item => item.key === key)!;
const state = (view: SecretaryView, key: string) => view.operations!.find(item => item.action_keys?.includes(key))!.state.scheduling!;
const group = (view: SecretaryView, key: string) => view.action_plan!.confirmation_groups.find(item => item.action_keys.includes(key))!;
const codes = () => db.rows.filter(row => row.entityType === "SECRETARY_ROUTER").flatMap(row => (row.metadata as { outcome?: { divergence: { failed_codes: string[] } } }).outcome?.divergence.failed_codes ?? []);

describe("A1 D-SELF: a term of comparison after 'no mesmo horário' is someone else's clock", () => {
  const change = (literal: string, text: string) => op("ravi", "appointment.change", { customer_name: "Ravi", source_scope: text, weekday: pair(5, "sexta"), same_as: [ref("time", "ravi", literal)] });
  it.each([
    ["passa o Ravi pra sexta no mesmo horário que a Yumi", "no mesmo horário"],
    ["passa o Ravi pra sexta no horário igual ao da Yumi", "no horário igual"],
    ["passa o Ravi pra sexta no mesmo horário, o da Yumi", "no mesmo horário"],
  ])("%j: the time is asked; Ravi's own 14h is never proposed", async (text, literal) => {
    const { say } = await conversation(turn("NEW", [change(literal, text)]));
    const view = await say(text);
    expect(state(view, "ravi").fields.time).toBeUndefined();
    expect(state(view, "ravi").proposal).toBeUndefined();
    expect(codes()).toContain("SAME_AS_LITERAL_UNPROVEN");
  });
  it("control: 'pra sexta no mesmo horário' alone keeps Ravi's own 14h (ORIGIN_KEPT)", async () => {
    const text = "passa o Ravi pra sexta no mesmo horário";
    const { say } = await conversation(turn("NEW", [change("no mesmo horário", text)]));
    const view = await say(text);
    expect(state(view, "ravi").fields).toMatchObject({ date: "2026-10-02", time: "14:00" });
    expect(codes()).toEqual(expect.arrayContaining(["SAME_AS_SELF_ORIGIN", "ORIGIN_KEPT"]));
  });
});

describe("A2 D2: an ordinal the owner narrowed (a daypart) is never ranked over the whole read", () => {
  it.each(["a primeira cliente da tarde dela", "o último cliente dela de manhã"])("%j: nothing is moved; never a pick of the other half of the day", async literal => {
    const text = `vê a agenda da Iara amanhã e passa ${literal} pra sexta no mesmo horário`;
    const list = op("agenda", "appointment.list", { professional_name: "Iara", source_scope: "vê a agenda da Iara amanhã", day_offset: pair(1, "amanhã") });
    const move = op("passa", "appointment.change", { source_scope: `passa ${literal} pra sexta no mesmo horário`, weekday: pair(5, "sexta"),
      same_as: [ref("customer", "agenda", literal), ref("time", "passa", "no mesmo horário")] });
    const { say } = await conversation(turn("NEW", [list, move]));
    const view = await say(text);
    expect(state(view, "passa").fields.appointment_ref).toBeUndefined();
    expect(state(view, "passa").proposal).toBeUndefined();
    expect(db.moves).toEqual([]);
  });
  it("control: 'o último cliente dela' of the same read still names the last row (Noah, 16h)", async () => {
    const text = "vê a agenda da Iara amanhã e passa o último cliente dela pra sexta no mesmo horário";
    const list = op("agenda", "appointment.list", { professional_name: "Iara", source_scope: "vê a agenda da Iara amanhã", day_offset: pair(1, "amanhã") });
    const move = op("passa", "appointment.change", { source_scope: "passa o último cliente dela pra sexta no mesmo horário", weekday: pair(5, "sexta"),
      same_as: [ref("customer", "agenda", "o último cliente dela"), ref("time", "passa", "no mesmo horário")] });
    const { say } = await conversation(turn("NEW", [list, move]));
    const view = await say(text);
    expect(state(view, "passa").fields.appointment_ref).toBe("a-noah");
  });
});

describe("A3/A4 D4: a clause (or its unclaimed tail) that states its own day or professional never takes the sibling's", () => {
  const first = () => op("kai", "appointment.create", { customer_name: "Kaique", service_name: "degradê", professional_name: "Iara", source_scope: "marca o Kaique amanhã às 10h pra degradê com a Iara",
    day_offset: pair(1, "amanhã"), time: pair("10:00", "às 10h") });
  it.each([["no dia seguinte"], ["noutro dia"], ["na véspera"]])("own day %j: the date is asked, never 29/09", async own => {
    const scope = `a Maitê ${own} às 11h pra degradê com a Iara`, text = `marca o Kaique amanhã às 10h pra degradê com a Iara e ${scope}`;
    const mai = op("mai", "appointment.create", { customer_name: "Maitê", service_name: "degradê", professional_name: "Iara", source_scope: scope, time: pair("11:00", "às 11h"), same_as: [ref("date", "kai", "amanhã")] });
    const { say } = await conversation(turn("NEW", [first(), mai]));
    const view = await say(text);
    expect(state(view, "mai").fields.date).not.toBe("2026-09-29");
    expect(codes()).not.toContain("SAME_AS_DISTRIBUTIVE");
  });
  it("own professional 'com o Cauã' (Luna left it null): never Iara", async () => {
    const text = "marca o Kaique amanhã às 10h pra degradê com a Iara e a Maitê amanhã às 11h pra degradê com o Cauã";
    const mai = op("mai", "appointment.create", { customer_name: "Maitê", service_name: "degradê", source_scope: "a Maitê amanhã às 11h pra degradê com o Cauã", day_offset: pair(1, "amanhã"), time: pair("11:00", "às 11h"),
      same_as: [ref("professional", "kai", "com a Iara")] });
    const { say } = await conversation(turn("NEW", [first(), mai]));
    const view = await say(text);
    expect(state(view, "mai").fields.professional_ref).not.toBe("pro-iara");
    expect(codes()).not.toContain("SAME_AS_DISTRIBUTIVE");
  });
  it("control: a shared suffix ', as duas com a Iara' is still copied (SAME_AS_DISTRIBUTIVE)", async () => {
    const text = "marca o Kaique amanhã às 10h pra degradê e a Maitê amanhã às 11h pra degradê, os dois com a Iara";
    const kai = op("kai", "appointment.create", { customer_name: "Kaique", service_name: "degradê", professional_name: "Iara", source_scope: "marca o Kaique amanhã às 10h pra degradê",
      day_offset: pair(1, "amanhã"), time: pair("10:00", "às 10h") });
    const mai = op("mai", "appointment.create", { customer_name: "Maitê", service_name: "degradê", source_scope: "a Maitê amanhã às 11h pra degradê", day_offset: pair(1, "amanhã"), time: pair("11:00", "às 11h"),
      same_as: [ref("professional", "kai", "com a Iara")] });
    const { say } = await conversation(turn("NEW", [kai, mai]));
    const view = await say(text);
    expect(state(view, "mai").fields.professional_ref).toBe("pro-iara");
    expect(codes()).toContain("SAME_AS_DISTRIBUTIVE");
  });
});

describe("A5 follow path: a set of values known only after the first preparation gets its card, never an endless wait", () => {
  const cancelAndCreate = () => {
    const text = "cancela a Benedita e marca a Maitê sexta às 10h com a Iara pro mesmo serviço";
    const cancel = op("cancela", "appointment.cancel", { customer_name: "Benedita", source_scope: "cancela a Benedita" });
    const create = op("marca", "appointment.create", { customer_name: "Maitê", professional_name: "Iara", source_scope: "marca a Maitê sexta às 10h com a Iara pro mesmo serviço",
      weekday: pair(5, "sexta"), time: pair("10:00", "às 10h"), same_as: [ref("service", "cancela", "pro mesmo serviço")] });
    return { text, frame: turn("NEW", [cancel, create]) };
  };
  it("D3: the cancellation asked its reason; its appointment has two services: the create shows a service card", async () => {
    const { text, frame } = cancelAndCreate();
    const { say } = await conversation(frame);
    const first = await say(text);
    expect(state(first, "marca").references?.waiting).toContain("service");
    const view = await say("porque ela viajou", turn("PATCH", [{ item_key: "cancela", choice: null, fields: { reason: "porque ela viajou" } }]));
    expect(action(view, "cancela").status).toBe("READY_FOR_CONFIRMATION");
    expect(state(view, "marca").references?.waiting ?? []).not.toContain("service");
    expect(state(view, "marca").candidates).toMatchObject({ kind: "service_ref", items: [{ id: "s-sobr" }, { id: "s-henna" }] });
    expect(state(view, "marca").proposal).toBeUndefined();
    expect(codes()).toContain("SAME_AS_SERVICE_CARD");
  });
  it("D3 + MULTI_SERVICE (review B): the same flow copies BOTH services as the create's list, never one card pick", async () => {
    vi.stubEnv("SALON_SECRETARY_MULTI_SERVICE", "true");
    const { text, frame } = cancelAndCreate();
    const { say } = await conversation(frame);
    await say(text);
    const view = await say("porque ela viajou", turn("PATCH", [{ item_key: "cancela", choice: null, fields: { reason: "porque ela viajou" } }]));
    expect(state(view, "marca").fields).toMatchObject({ service_names: ["Design de sobrancelha", "Henna"], service_list_ref: ["s-sobr", "s-henna"] });
    expect(state(view, "marca").fields.service_ref).toBeUndefined();
    expect(state(view, "marca").candidates).toBeUndefined();
    expect(codes()).toContain("SAME_AS_SEEDED_LIST");
  });
  it("D2: the read was deferred for its day; 'o último' ties at 16h: the change shows the card of the tied rows", async () => {
    db.day = ["a-yumi", "a-zuri", "a-noah", "a-aurora"];
    const text = "vê a agenda da Iara e passa o último cliente dela pra sexta no mesmo horário";
    const list = op("agenda", "appointment.list", { professional_name: "Iara", source_scope: "vê a agenda da Iara" });
    const move = op("passa", "appointment.change", { source_scope: "passa o último cliente dela pra sexta no mesmo horário", weekday: pair(5, "sexta"),
      same_as: [ref("customer", "agenda", "o último cliente dela"), ref("time", "passa", "no mesmo horário")] });
    const { say } = await conversation(turn("NEW", [list, move]));
    await say(text);
    const view = await say("amanhã", turn("PATCH", [{ item_key: "agenda", choice: null, fields: { day_offset: pair(1, "amanhã") } }]));
    expect(state(view, "passa").candidates).toMatchObject({ kind: "appointment_ref", items: [{ id: "a-noah" }, { id: "a-aurora" }] });
    expect(codes()).toContain("SAME_AS_READ_CARD");
    expect(codes()).not.toContain("SAME_AS_GONE");
  });
});

describe("A6 E2: the owner's first person as the NEW professional of a change", () => {
  beforeEach(() => vi.stubEnv("SALON_SECRETARY_ALTER_APPOINTMENT", "true"));
  const frame = (text: string) => turn("NEW", [op("ravi", "appointment.change", { customer_name: "Ravi", source_scope: text, target_professional_name: "mim", service_changes: null })]);
  it("registered: resolved to the owner's own registration, named as registered, no 'você quis dizer' card", async () => {
    db.self = [{ id: "pro-caua", name: "Cauã Moreira" }];
    const text = "passa o Ravi pra mim";
    const { say } = await conversation(frame(text));
    const view = await say(text);
    expect(state(view, "ravi").fields.target_professional_ref).toBe("pro-caua");
    expect(state(view, "ravi").resolved_names?.["pro-caua"]).toBe("Cauã Moreira");
    expect(state(view, "ravi").candidates?.source).toBeUndefined();
    expect(codes()).not.toContain("ALTER_TARGET_CONFIRM");
  });
  it("not registered: said plainly, with the team as options, nothing preselected", async () => {
    const text = "passa o Ravi pra mim";
    const { say } = await conversation(frame(text));
    const view = await say(text);
    expect(state(view, "ravi").fields.target_professional_ref).toBeUndefined();
    expect(state(view, "ravi").candidates).toMatchObject({ kind: "target_professional_ref", items: [{ id: "pro-iara" }, { id: "pro-caua" }] });
    expect(state(view, "ravi").message).toContain("Não encontrei seu cadastro como profissional neste salão.");
    expect(codes()).toContain("SELF_NOT_PROFESSIONAL");
  });
});

describe("review B, recurrence guard across phases (SALON_SECRETARY_RECURRENCE_GUARD)", () => {
  beforeEach(() => vi.stubEnv("SALON_SECRETARY_RECURRENCE_GUARD", "true"));
  const series = () => op("kai", "appointment.create", { customer_name: "Kaique", service_name: "degradê", professional_name: "Iara", source_scope: "marca o Kaique toda sexta às 9h pra degradê com a Iara",
    weekday: pair(5, "sexta"), time: pair("09:00", "às 9h") });
  it("B3: a day copied from a create that states 'toda sexta' carries the recurrence: the linked create asks too, never a silent single", async () => {
    const text = "marca o Kaique toda sexta às 9h pra degradê com a Iara e a Maitê às 10h pra degradê com a Iara";
    const mai = op("mai", "appointment.create", { customer_name: "Maitê", service_name: "degradê", professional_name: "Iara", source_scope: "a Maitê às 10h pra degradê com a Iara",
      time: pair("10:00", "às 10h"), same_as: [ref("date", "kai", "sexta")] });
    const { say, secretary, sessionId } = await conversation(turn("NEW", [series(), mai]));
    const view = await say(text);
    expect(state(view, "mai").fields.date).toBe("2026-10-02");
    expect(state(view, "mai").recurrence).toEqual({ expression: "toda sexta", status: "ASKED" });
    expect(state(view, "mai").proposal).toBeUndefined();
    // The owner's yes for Kaique never answers for Maitê.
    const clicked = await secretary.selectAutomatic(actor, sessionId, view.operations!.find(item => item.action_keys?.includes("kai"))!.operation_ref, "recurrence-first-only");
    expect(state(clicked, "mai").recurrence?.status).toBe("ASKED");
    expect(group(clicked, "mai").status).not.toBe("READY_FOR_CONFIRMATION");
  });
  it("B3 with REFERENCES_V2 off: the V1 'no mesmo dia' link carries it too", async () => {
    vi.stubEnv("SALON_SECRETARY_REFERENCES_V2", "false");
    const text = "marca o Kaique toda sexta às 9h pra degradê com a Iara e a Maitê no mesmo dia às 10h pra degradê com a Iara";
    const mai = op("mai", "appointment.create", { customer_name: "Maitê", service_name: "degradê", professional_name: "Iara", source_scope: "a Maitê no mesmo dia às 10h pra degradê com a Iara",
      time: pair("10:00", "às 10h"), same_as: [ref("date", "kai", "no mesmo dia")] });
    const { say } = await conversation(turn("NEW", [series(), mai]));
    const view = await say(text);
    expect(state(view, "mai").recurrence?.status).toBe("ASKED");
    expect(state(view, "mai").proposal).toBeUndefined();
  });
  it("B3 control: guard off, nothing is copied (historical behaviour)", async () => {
    vi.stubEnv("SALON_SECRETARY_RECURRENCE_GUARD", "false");
    const text = "marca o Kaique toda sexta às 9h pra degradê com a Iara e a Maitê às 10h pra degradê com a Iara";
    const mai = op("mai", "appointment.create", { customer_name: "Maitê", service_name: "degradê", professional_name: "Iara", source_scope: "a Maitê às 10h pra degradê com a Iara",
      time: pair("10:00", "às 10h"), same_as: [ref("date", "kai", "sexta")] });
    const { say } = await conversation(turn("NEW", [series(), mai]));
    const view = await say(text);
    expect(state(view, "mai").recurrence).toBeUndefined();
  });
  it("B6: a move to 'toda quinta' names the one appointment it would move and asks; nothing is proposed", async () => {
    const text = "passa o Ravi pra toda quinta às 15h";
    const { say } = await conversation(turn("NEW", [op("ravi", "appointment.change", { customer_name: "Ravi", source_scope: text, weekday: pair(4, "quinta"), time: pair("15:00", "às 15h") })]));
    const view = await say(text);
    expect(state(view, "ravi").proposal).toBeUndefined();
    expect(state(view, "ravi").candidates).toMatchObject({ kind: "recurrence_ref", items: [{ id: "recurrence-first-only" }] });
    expect(state(view, "ravi").message).toBe("Ainda não remarco séries pelo chat (“toda quinta”). Remarco só o de qua, 30/09 às 14h para qui, 01/10 às 15h? Nada foi preparado para as outras datas.");
    expect(action(view, "ravi").status).not.toBe("READY_FOR_CONFIRMATION");
  });
  it("B6: a cancellation of 'toda terça' names the one appointment and asks; the click alone goes on to the proposal", async () => {
    const text = "desmarca o Otávio de toda terça porque ele mudou de cidade";
    const { say, secretary, sessionId } = await conversation(turn("NEW", [op("oto", "appointment.cancel", { customer_name: "Otávio", source_scope: text, weekday: pair(2, "terça"), reason: "porque ele mudou de cidade" })]));
    const view = await say(text);
    expect(state(view, "oto").proposal).toBeUndefined();
    expect(state(view, "oto").message).toBe("Ainda não cancelo séries pelo chat (“toda terça”). Cancelo só o de ter, 29/09 às 10h? Nada foi preparado para as outras datas.");
    const clicked = await secretary.selectAutomatic(actor, sessionId, view.operations!.find(item => item.action_keys?.includes("oto"))!.operation_ref, "recurrence-first-only");
    expect(state(clicked, "oto").proposal).toBeDefined();
    expect(action(clicked, "oto").status).toBe("READY_FOR_CONFIRMATION");
  });
  it("B8: a typed yes that states the recurrence again is not a yes (OPTION_RECURRENCE_RESTATED); nothing is proposed", async () => {
    const text = "marca o Kaique toda sexta às 9h pra degradê com a Iara";
    const { say } = await conversation(turn("NEW", [series()]));
    await say(text);
    const view = await say("pode ser, mas lembra que é toda sexta", turn("PATCH", [{ item_key: "kai", choice: { option_id: "opt_1", literal: "pode ser" }, fields: {} }]), "upsert_action_draft");
    expect(state(view, "kai").recurrence?.status).toBe("ASKED");
    expect(state(view, "kai").proposal).toBeUndefined();
    expect(codes()).toContain("OPTION_RECURRENCE_RESTATED");
    // Control: the plain typed yes is still verified and applied.
    const yes = await say("pode ser", turn("PATCH", [{ item_key: "kai", choice: { option_id: "opt_1", literal: "pode ser" }, fields: {} }]), "upsert_action_draft");
    expect(state(yes, "kai").recurrence?.status).toBe("FIRST_ONLY");
  });
  it("B9: the recurrence notice is said once when another action's card question already says it", async () => {
    const text = "marca o Kaique toda sexta às 9h pra degradê com a Iara e a Maitê às 10h pra degradê com a Iara toda sexta";
    const mai = op("mai", "appointment.create", { customer_name: "Maitê", service_name: "degradê", professional_name: "Iara", source_scope: "a Maitê às 10h pra degradê com a Iara toda sexta",
      time: pair("10:00", "às 10h") });
    const { say } = await conversation(turn("NEW", [series(), mai]));
    const view = await say(text);
    expect(view.message!.split("Ainda não marco horários recorrentes pelo chat (“toda sexta”).").length - 1).toBe(1);
  });
  it("B5: an atomic cancel→create whose service is 'Manutenção mensal' is prepared (the adjective is the service's name)", async () => {
    const message = "cancela o Otávio de terça 10h porque ele mudou de cidade e coloca o Kaique no lugar dele pra manutenção mensal";
    const selection = validateSelectionV2({ skills: ["scheduling"], independent: false, operations: [
      { item_key: "a", operation: "appointment.cancel", depends_on: [], released_slot_of: null, source_scope: "cancela o Otávio de terça 10h porque ele mudou de cidade", customer_name: "Otávio",
        weekday: 2, time: "10:00", reason: "ele mudou de cidade", target_name: null, name: null, priceCents: null, durationMin: null, phone: null, email: null, requested_fields: [], clear_fields: [] },
      { item_key: "b", operation: "appointment.create", depends_on: ["a"], released_slot_of: "a", source_scope: "coloca o Kaique no lugar dele pra manutenção mensal", customer_name: "Kaique", service_name: "manutenção mensal",
        target_name: null, name: null, priceCents: null, durationMin: null, phone: null, email: null, requested_fields: [], clear_fields: [] }] } as never);
    // The pair goes on to its ordinary preparation (the day's agenda is not a fixture here): never refused for a recurrence.
    const outcome = await startBatch(actor, selection as never, message).then(() => "PREPARED", (error: Error) => error.message);
    expect(outcome).not.toBe("UNSUPPORTED_DEPENDENCY_ADAPTER");
    // A series said for the created one still prepares nothing in the pair (no card there).
    const series = message.replace("pra manutenção mensal", "toda terça pra manutenção mensal");
    const repeated = validateSelectionV2({ ...(selection as object), operations: (selection as { operations: Record<string, unknown>[] }).operations.map(item => item.item_key === "b" ? { ...item, source_scope: "coloca o Kaique no lugar dele toda terça pra manutenção mensal" } : item) } as never);
    await expect(startBatch(actor, repeated as never, series)).rejects.toThrow("UNSUPPORTED_DEPENDENCY_ADAPTER");
    vi.stubEnv("SALON_SECRETARY_RECURRENCE_GUARD", "false");
    expect(await startBatch(actor, repeated as never, series).then(() => "PREPARED", (error: Error) => error.message)).not.toBe("UNSUPPORTED_DEPENDENCY_ADAPTER");
  });
});
