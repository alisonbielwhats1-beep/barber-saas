import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** C4 R-B2 (flag SALON_SECRETARY_REFERENCES_V2 with SALON_SECRETARY_SAME_AS), owner rules 7 and 8 of 29/09 and the released slot of a
 * move, through the real plan path (decoder, ActionPlan, per-action adapters, journal drafts and proposals). Same fixture style as
 * secretary-c4-rb-references-runtime.test.ts: frames are recorded (no network, no model); only tenant lookups are fixtures. Today is
 * Monday 28/09/2026 (São Paulo): "quinta" = 01/10, "sexta" = 02/10, "sábado" = 03/10. Diverse synthetic names; no gender is inferred
 * from a name (only from the owner's own articles). */
type Row = { appointment_ref: string; customer_ref: string; customer_name: string; professional_ref: string; professional_name: string; service_ref: string;
  services: { serviceName: string }[]; start_local: string; end_local: string; start_at: string; status: string };
const db = vi.hoisted(() => ({ tx: undefined as unknown as Tx, rows: [] as Record<string, unknown>[], snapshots: [] as { released?: string; override?: unknown }[], day: [] as string[] }));
const at = (local: string) => new Date(`${local}:00-03:00`).toISOString();
const plusHour = (local: string) => `${local.slice(0, 11)}${String(Number(local.slice(11, 13)) + 1).padStart(2, "0")}${local.slice(13)}`;
const appointment = (ref: string, customer: [string, string], start: string, service: [string, string]): Row => ({ appointment_ref: ref, customer_ref: customer[0], customer_name: customer[1],
  professional_ref: "pro-hortensia", professional_name: "Hortênsia Lobo", service_ref: service[0], services: [{ serviceName: service[1] }], start_local: start, end_local: plusHour(start), start_at: at(start), status: "CONFIRMED" });
const APPOINTMENTS: Record<string, Row> = {
  "a-yolanda": appointment("a-yolanda", ["c-yolanda", "Yolanda Prates"], "2026-10-01T14:00", ["s-drenagem", "Drenagem linfática"]),
  "a-yolanda-sab": appointment("a-yolanda-sab", ["c-yolanda", "Yolanda Prates"], "2026-10-03T10:00", ["s-escova", "Escova modeladora"]),
  "a-ingrid-sab": appointment("a-ingrid-sab", ["c-ingrid", "Ingrid Solano"], "2026-10-03T11:00", ["s-escova", "Escova modeladora"]),
};
const SERVICES: Record<string, string> = { "s-drenagem": "Drenagem linfática", "s-escova": "Escova modeladora" };
const CUSTOMERS: Record<string, { id: string; name: string }> = { yolanda: { id: "c-yolanda", name: "Yolanda Prates" }, ingrid: { id: "c-ingrid", name: "Ingrid Solano" },
  tuane: { id: "c-tuane", name: "Tuane Brito" } };
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: Tx) => unknown) => fn(db.tx) }));
vi.mock("../scheduling-catalog", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined, secretaryDirectory: async () => undefined,
  listSchedulingServices: async (_tx: unknown, _actor: unknown, name: string) => Object.entries(SERVICES).filter(([, label]) => fold(label).startsWith(fold(name).split(" ")[0])).map(([id, label]) => ({ id, name: label })),
  listSchedulingProfessionals: async (_tx: unknown, _actor: unknown, filter: { query?: string }) => {
    const all = [{ id: "pro-hortensia", name: "Hortênsia Lobo" }, { id: "pro-caio", name: "Caio Ferraz" }];
    return filter.query ? all.filter(row => fold(row.name).startsWith(fold(filter.query!).split(" ")[0])) : all;
  },
  schedulingSelfProfessional: async () => undefined,
  getSchedulingAvailability: async (_tx: unknown, _actor: unknown, input: { date: string; time: string }) => ({ plan: { startLocal: `${input.date}T${input.time}` }, alternatives: [], timezone: "America/Sao_Paulo" }),
  listSchedulingAppointments: async (_tx: unknown, _actor: unknown, input: { date: string; professional_ref?: string }) =>
    db.day.map(ref => APPOINTMENTS[ref]).filter(row => row.start_local.startsWith(input.date) && (!input.professional_ref || row.professional_ref === input.professional_ref)),
  getSchedulingAppointment: async (_tx: unknown, _actor: unknown, ref: string) => { const row = APPOINTMENTS[ref]; if (!row) throw Error("APPOINTMENT_NOT_FOUND"); return row; } }));
vi.mock("../customer-catalog", async importOriginal => ({ ...await importOriginal<object>(), assertCustomerAccess: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, _actor: unknown, name: string) => Object.entries(CUSTOMERS).filter(([key]) => fold(name).startsWith(key)).map(([, row]) => row),
  getCustomer: async (_tx: unknown, _actor: unknown, ref: string) => { const row = Object.values(CUSTOMERS).find(item => item.id === ref); if (!row) throw Error("CUSTOMER_NOT_FOUND"); return row; } }));
vi.mock("../scheduling-entity-mentions", async importOriginal => ({ ...await importOriginal<object>(), validateSchedulingEntityMentions: async () => undefined }));
vi.mock("../scheduling-actions", async importOriginal => ({ ...await importOriginal<object>(),
  schedulingSnapshot: async (_tx: unknown, _actor: unknown, f: Record<string, unknown>, _now?: Date, projection?: { releasedAppointmentId: string }) => {
    db.snapshots.push({ ...(projection ? { released: projection.releasedAppointmentId } : {}), ...(f.override_requested !== undefined ? { override: f.override_requested } : {}) });
    const time = f.time as string, date = f.date as string;
    return { customer_ref: f.customer_ref, customer_name: f.customer_name, service_ref: f.service_ref, service_revision: "1", service_name: SERVICES[f.service_ref as string] ?? f.service_name, professional_ref: f.professional_ref,
      professional_name: "Hortênsia Lobo", date, startLocal: `${date}T${time}`, endLocal: plusHour(`${date}T${time}`), timezone: "America/Sao_Paulo", priceCents: 8000, priceType: "FIXED", durationMin: 60, quote: "q" };
  },
  proposeAppointmentCreate: async (_tx: unknown, _actor: unknown, input: { draft_ref: string; draft_revision: number }) =>
    ({ proposal_ref: crypto.randomUUID(), draft_ref: input.draft_ref, draft_revision: input.draft_revision, payload_hash: "h".repeat(64), preview: "NOVO AGENDAMENTO", expires_at: new Date(Date.now() + 600_000).toISOString() }) }));
vi.mock("../scheduling-mutations", async importOriginal => {
  const original = await importOriginal<typeof import("../scheduling-mutations")>();
  return { ...original, authorizeSchedulingOperation: async () => "OWNER",
    // The located appointment's own day: a move's origin (source_date), a cancellation's day.
    locateSchedulingAppointments: async (_tx: unknown, _actor: unknown, f: { customer_ref?: string; date?: string; source_date?: string }, operation?: string) => {
      const day = operation === "appointment.change" ? f.source_date : f.date;
      return Object.values(APPOINTMENTS).filter(row => row.customer_ref === f.customer_ref && row.status === "CONFIRMED" && (!day || row.start_local.startsWith(day)));
    },
    inspectSchedulingMove: async () => ({ result: {}, alternatives: [] }),
    schedulingActionSnapshot: async (_tx: unknown, _actor: unknown, operation: string, f: Record<string, string>) => {
      const base = { timezone: "America/Sao_Paulo", resource_ids: [], waiting_hash: "", affected: [], priceCents: 8000 };
      if (operation === "schedule.block") return original.actionSnapshot.parse({ ...base, kind: operation, professional_ref: f.professional_ref, professional_name: "Hortênsia Lobo",
        startLocal: `${f.date}T${f.time}`, endLocal: `${f.end_date ?? f.date}T${f.end_time}`, services: [], requires_acceptance: false, waiting_count: 0 });
      const row = APPOINTMENTS[f.appointment_ref], change = operation === "appointment.change";
      return original.actionSnapshot.parse({ ...base, kind: operation, appointment_ref: row.appointment_ref, revision: 1, customer_ref: row.customer_ref, customer_name: row.customer_name,
        professional_ref: row.professional_ref, professional_name: row.professional_name, before_start: row.start_local, before_end: row.end_local, before_timezone: "America/Sao_Paulo",
        startLocal: change ? `${f.date}T${f.time}` : row.start_local, endLocal: change ? plusHour(`${f.date}T${f.time}`) : row.end_local,
        services: row.services.map(s => ({ id: row.service_ref, name: s.serviceName, durationMin: 60, priceCents: 8000, priceType: "FIXED", priceNote: null, processingMin: 0, finishingMin: 0 })),
        requires_acceptance: false, waiting_count: 0 });
    } };
});
import { SalonSecretary, type SecretaryView } from "../salon-secretary";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";

const actor = { salonId: "synthetic-spa", userId: "synthetic-owner" };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-28T15:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NO_NETWORK"); }));
  vi.stubEnv("SALON_SECRETARY_SAME_AS", "true"); vi.stubEnv("SALON_SECRETARY_REFERENCES_V2", "true"); vi.stubEnv("SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED", "true");
  Object.assign(db, { rows: [], snapshots: [], day: [] });
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
const turn = (mode: string, operations: unknown[]) => ({ turn: { mode, operations } });
async function say(first: unknown, message: string) {
  const model = new ScriptedServicesModel([call("select_capabilities", first)]);
  const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
  const session = await secretary.start(actor, "auto");
  return secretary.send(actor, { sessionId: session.sessionId, message });
}
const read = (view: SecretaryView) => ({
  action: (key: string) => view.action_plan!.actions.find(item => item.key === key)!,
  child: (key: string) => view.operations!.find(item => item.action_keys?.includes(key))!.state,
});
const codes = () => db.rows.filter(row => row.entityType === "SECRETARY_ROUTER").flatMap(row => (row.metadata as { outcome?: { divergence: { failed_codes: string[] } } }).outcome?.divergence.failed_codes ?? []);

describe("rule 7 and the released slot: move a customer, fill her slot with another, then a bare pronoun", () => {
  const text = "muda a Yolanda de quinta pra sexta às 16h, na vaga encaixa a Ingrid pra drenagem e desmarca o sábado dela que ela vai viajar";
  const move = () => op("muda", "appointment.change", { customer_name: "Yolanda", source_scope: "muda a Yolanda de quinta pra sexta às 16h", source_weekday: pair(4, "quinta"),
    weekday: pair(5, "sexta"), time: pair("16:00", "às 16h") });
  const fill = (fields: Record<string, unknown> = {}) => op("vaga", "appointment.create", { customer_name: "Ingrid", service_name: "drenagem", source_scope: "na vaga encaixa a Ingrid pra drenagem",
    depends_on: ["muda"], released_slot_of: "muda", destination_mode: "SAME_RELEASED_SLOT", ...fields });
  const cancel = (customer: string | null) => op("sab", "appointment.cancel", { customer_name: customer, source_scope: "e desmarca o sábado dela que ela vai viajar", weekday: pair(6, "sábado"),
    reason: "ela vai viajar" });
  it("the pronoun is the moved customer: Luna's other pick is replaced and the moved customer's Saturday is the one proposed", async () => {
    const r = read(await say(turn("NEW", [move(), fill(), cancel("Ingrid")]), text));
    expect(r.child("sab").scheduling!.fields).toMatchObject({ customer_ref: "c-yolanda", appointment_ref: "a-yolanda-sab" });
    expect(r.action("sab").status).toBe("READY_FOR_CONFIRMATION");
    expect(codes()).toContain("PRONOUN_TOPIC");
  });
  it("Luna leaving the customer out gets the same, never a card of both Saturdays", async () => {
    const r = read(await say(turn("NEW", [move(), fill(), cancel(null)]), text));
    expect(r.child("sab").scheduling!.fields).toMatchObject({ customer_ref: "c-yolanda", appointment_ref: "a-yolanda-sab" });
    expect(r.child("sab").scheduling!.candidates).toBeUndefined();
  });
  it("an encaixe consent the owner did not write, in the slot the move frees, is dropped (never granted, never a failure)", async () => {
    const r = read(await say(turn("NEW", [move(), fill({ override_requested: true }), cancel("Ingrid")]), text));
    expect(r.action("vaga").status).toBe("READY_FOR_CONFIRMATION");
    expect(r.child("vaga").scheduling!.fields).toMatchObject({ date: "2026-10-01", time: "14:00", customer_ref: "c-ingrid" });
    expect(r.child("vaga").scheduling!.fields.override_requested).toBeUndefined();
    expect(db.snapshots.some(item => item.override === true)).toBe(false);
    expect(codes()).toEqual(expect.arrayContaining(["RELEASED_ORIGIN_SEEDED", "RELEASED_OVERRIDE_UNGROUNDED"]));
    expect(codes()).not.toContain("BACKEND_PREPARATION_FAILED");
  });
  it("adversarial: the owner's own consent is not dropped by this rule", async () => {
    const said = "muda a Yolanda de quinta pra sexta às 16h, na vaga pode encaixar a Ingrid pra drenagem e desmarca o sábado dela que ela vai viajar";
    await say(turn("NEW", [move(), fill({ override_requested: true, source_scope: "na vaga pode encaixar a Ingrid pra drenagem" }), cancel("Ingrid")]), said);
    expect(codes()).not.toContain("RELEASED_OVERRIDE_UNGROUNDED");
  });
  it("adversarial: without the move + released slot (two creates), the pronoun is asked: Luna's pick removed, no appointment chosen", async () => {
    const said = "marca a Yolanda sexta às 16h pra drenagem, marca a Ingrid sexta às 17h pra drenagem e desmarca o sábado dela";
    const a = op("a", "appointment.create", { customer_name: "Yolanda", service_name: "drenagem", professional_name: "Hortênsia", source_scope: "marca a Yolanda sexta às 16h pra drenagem",
      weekday: pair(5, "sexta"), time: pair("16:00", "às 16h") });
    const b = op("b", "appointment.create", { customer_name: "Ingrid", service_name: "drenagem", professional_name: "Hortênsia", source_scope: "marca a Ingrid sexta às 17h pra drenagem",
      weekday: pair(5, "sexta"), time: pair("17:00", "às 17h") });
    const c = op("c", "appointment.cancel", { customer_name: "Ingrid", source_scope: "e desmarca o sábado dela", weekday: pair(6, "sábado") });
    const r = read(await say(turn("NEW", [a, b, c]), said));
    expect(r.child("c").scheduling!.fields.customer_ref).toBeUndefined();
    expect(r.child("c").scheduling!.fields.appointment_ref).toBeUndefined();
    expect(r.action("c").status).not.toBe("READY_FOR_CONFIRMATION");
    expect(codes()).toContain("PRONOUN_AMBIGUOUS");
  });
  it("flag off: the historical path (Luna's pick stands, no rule-7 code)", async () => {
    vi.stubEnv("SALON_SECRETARY_REFERENCES_V2", "false");
    const said = "cancela a Yolanda de quinta que ela desmarcou, na vaga põe a Ingrid pra drenagem e desmarca o sábado dela";
    const c1 = op("qui", "appointment.cancel", { customer_name: "Yolanda", source_scope: "cancela a Yolanda de quinta que ela desmarcou", weekday: pair(4, "quinta"), reason: "ela desmarcou" });
    const c2 = op("sab", "appointment.cancel", { customer_name: "Ingrid", source_scope: "e desmarca o sábado dela", weekday: pair(6, "sábado") });
    const r = read(await say(turn("NEW", [c1, op("vaga", "appointment.create", { customer_name: "Ingrid", service_name: "drenagem", source_scope: "na vaga põe a Ingrid pra drenagem",
      depends_on: ["qui"], released_slot_of: "qui" }), c2]), said));
    expect(r.child("sab").scheduling!.fields.customer_ref).toBe("c-ingrid");
    expect(codes()).not.toContain("PRONOUN_TOPIC"); expect(codes()).not.toContain("PRONOUN_AMBIGUOUS");
  });
});

describe("rule 8: a block between the two appointments this request just defined", () => {
  const create = (key: string, customer: string, time: string, literal: string, scope: string, fields: Record<string, unknown> = {}) => op(key, "appointment.create",
    { customer_name: customer, service_name: "drenagem", professional_name: "Hortênsia", source_scope: scope, weekday: pair(4, "quinta"), time: pair(time, literal), ...fields });
  const block = (scope: string, fields: Record<string, unknown> = {}) => op("bloq", "schedule.block", { professional_name: "Hortênsia", source_scope: scope, weekday: pair(4, "quinta"),
    reason: "ela tem curso", ...fields });
  it("only the free interval (10h–11h), prepared after both appointments even when the plan orders the block before one of them", async () => {
    const text = "quinta: marca a Yolanda às 9 pra drenagem com a Hortênsia e a Tuane às 11 pra drenagem tb com ela, e bloqueia a Hortênsia entre uma e outra que ela tem curso";
    const a = create("a", "Yolanda", "09:00", "às 9", "quinta: marca a Yolanda às 9 pra drenagem com a Hortênsia", { weekday: pair(4, "quinta") });
    const b = create("b", "Tuane", "11:00", "às 11", "e a Tuane às 11 pra drenagem tb com ela", { professional_name: null, weekday: null, same_as: [{ field: "professional", item_key: "a", literal: "tb com ela" },
      { field: "date", item_key: "a", literal: "tb com ela" }] });
    const r = read(await say(turn("NEW", [a, b, block("e bloqueia a Hortênsia entre uma e outra que ela tem curso", { weekday: null })]), text));
    expect(r.child("bloq").scheduling!.fields).toMatchObject({ date: "2026-10-01", time: "10:00", end_time: "11:00", professional_ref: "pro-hortensia" });
    expect(r.action("bloq").status).toBe("READY_FOR_CONFIRMATION");
    expect(codes()).toContain("BETWEEN_BOOKINGS_SEEDED");
  });
  it("adversarial: appointments with no free interval between them: the block's times are asked, nothing proposed", async () => {
    const text = "quinta: marca a Yolanda às 9 pra drenagem com a Hortênsia e a Tuane às 10 pra drenagem com a Hortênsia, e bloqueia a Hortênsia entre uma e outra";
    const a = create("a", "Yolanda", "09:00", "às 9", "quinta: marca a Yolanda às 9 pra drenagem com a Hortênsia");
    const b = create("b", "Tuane", "10:00", "às 10", "e a Tuane às 10 pra drenagem com a Hortênsia");
    const r = read(await say(turn("NEW", [a, b, block("e bloqueia a Hortênsia entre uma e outra")]), text));
    expect(r.child("bloq").scheduling!.fields.time).toBeUndefined();
    expect(r.action("bloq").missing_fields).toEqual(expect.arrayContaining(["time"]));
    expect(codes()).not.toContain("BETWEEN_BOOKINGS_SEEDED");
  });
  it("adversarial: a block of another professional than the two appointments is never filled from them", async () => {
    const text = "quinta: marca a Yolanda às 9 pra drenagem com a Hortênsia e a Tuane às 11 pra drenagem com a Hortênsia, e bloqueia o Caio entre uma e outra";
    const a = create("a", "Yolanda", "09:00", "às 9", "quinta: marca a Yolanda às 9 pra drenagem com a Hortênsia");
    const b = create("b", "Tuane", "11:00", "às 11", "e a Tuane às 11 pra drenagem com a Hortênsia");
    const r = read(await say(turn("NEW", [a, b, block("e bloqueia o Caio entre uma e outra", { professional_name: "Caio" })]), text));
    expect(r.child("bloq").scheduling!.fields.time).toBeUndefined();
    expect(codes()).not.toContain("BETWEEN_BOOKINGS_SEEDED");
  });
  it("adversarial: a negated 'between' is never a block interval", async () => {
    const text = "quinta: marca a Yolanda às 9 pra drenagem com a Hortênsia e a Tuane às 11 pra drenagem com a Hortênsia, e bloqueia a Hortênsia mas não entre uma e outra";
    const a = create("a", "Yolanda", "09:00", "às 9", "quinta: marca a Yolanda às 9 pra drenagem com a Hortênsia");
    const b = create("b", "Tuane", "11:00", "às 11", "e a Tuane às 11 pra drenagem com a Hortênsia");
    const r = read(await say(turn("NEW", [a, b, block("e bloqueia a Hortênsia mas não entre uma e outra")]), text));
    expect(r.child("bloq").scheduling!.fields.time).toBeUndefined();
    expect(codes()).not.toContain("BETWEEN_BOOKINGS_SEEDED");
  });
  it("flag off: the historical question", async () => {
    vi.stubEnv("SALON_SECRETARY_REFERENCES_V2", "false");
    const text = "quinta: marca a Yolanda às 9 pra drenagem com a Hortênsia e a Tuane às 11 pra drenagem com a Hortênsia, e bloqueia a Hortênsia entre uma e outra";
    const a = create("a", "Yolanda", "09:00", "às 9", "quinta: marca a Yolanda às 9 pra drenagem com a Hortênsia");
    const b = create("b", "Tuane", "11:00", "às 11", "e a Tuane às 11 pra drenagem com a Hortênsia");
    const r = read(await say(turn("NEW", [a, b, block("e bloqueia a Hortênsia entre uma e outra")]), text));
    expect(r.child("bloq").scheduling!.fields.time).toBeUndefined();
    expect(codes()).not.toContain("BETWEEN_BOOKINGS_SEEDED");
  });
});
