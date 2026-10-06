import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** FX6 (review, owner rule 9, safety; flag SALON_SECRETARY_MULTI_SERVICE with SALON_SECRETARY_REFERENCES_V2): a create in the slot a move
 * frees books ONE service (never a list). Through the real scheduling adapter (grounding, prepare, availability over a fake tenant
 * transaction, create snapshot): the one combo the search finds for the owner's words whose parts are also registered apart is a card of
 * that combo with the reason, never a pick; a combo's registered name Luna wrote for the owner's words is read back as those words (same
 * card); the combo alone registered is used; the owner's click books it. A studio "Lótus Azul" and a barbearia as the other tenant.
 * No DB, no network, no model; nothing is confirmed. Same harness as secretary-multi-service-adapter.test.ts. */
type Service = { id: string; name: string; salonId: string; durationMin: number; priceCents: number; active: boolean };
type Pro = { id: string; name: string; salonId: string; services: string[]; active: boolean };
/** The master's weekly query (05/10 merge): one row per requested weekday. */
const weekdaysOf = (where: { weekday?: number | { in: number[] } }) => typeof where.weekday === "number" ? [where.weekday] : where.weekday?.in ?? [0, 1, 2, 3, 4, 5, 6];
const db = vi.hoisted(() => ({ tx: undefined as unknown, rows: [] as Record<string, unknown>[], pros: [] as Pro[], services: [] as Service[],
  customers: [] as { id: string; name: string; salonId: string }[], created: [] as Record<string, unknown>[] }));
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: unknown) => unknown) => fn(db.tx) }));
vi.mock("../customer-catalog", async original => ({ ...await original<object>(), assertCustomerAccess: async () => undefined,
  getCustomer: async (_tx: unknown, actor: { salonId: string }, id: string) => { const row = db.customers.find(item => item.id === id && item.salonId === actor.salonId); if (!row) throw Error("CUSTOMER_NOT_FOUND"); return { id, name: row.name }; },
  searchSalonCustomer: async (_tx: unknown, actor: { salonId: string }, query: string) => db.customers.filter(row => row.salonId === actor.salonId && fold(row.name).includes(fold(query.trim()))).map(({ id, name }) => ({ id, name, phone: null })) }));
vi.mock("../scheduling-catalog", async original => ({ ...await original<object>(), schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined,
  listUpcomingCustomerAppointments: async () => [],
  listSchedulingServices: async (_tx: unknown, actor: { salonId: string }, query: string) => db.services.filter(row => row.salonId === actor.salonId && row.active && fold(row.name).includes(fold(query.trim())))
    .map(({ id, name, durationMin, priceCents }) => ({ id, name, durationMin, priceCents, priceType: "FIXED" })),
  listSchedulingProfessionals: async (_tx: unknown, actor: { salonId: string }, input: { service_ref?: string; service_refs?: string[]; query?: string }) => db.pros.filter(row => row.salonId === actor.salonId && row.active &&
    (!input.service_ref || row.services.includes(input.service_ref)) && (input.service_refs ?? []).every(id => row.services.includes(id)) && (!input.query || fold(row.name).includes(fold(input.query))))
    .map(({ id, name }) => ({ id, name })),
}));
vi.mock("../appointment-service", async original => ({ ...await original<object>(),
  createAppointment: async (_tx: unknown, input: Record<string, unknown>) => { db.created.push(structuredClone(input)); return { appointment: { id: `ag-${db.created.length}`, clientId: input.clientId } }; },
}));
import { applySchedulingInterpretation, schedulingState, selectScheduling, type SchedulingState } from "../secretary-scheduling";
import { isSingleComboQuestion } from "../secretary-multi-service";

const lotus = { salonId: "studio-lotus-azul", userId: "dona-lotus" }, trilho = { salonId: "barbearia-trilho", userId: "recepcao-trilho" };
type Actor = typeof lotus;
const service = (id: string, name: string, durationMin: number, priceCents: number, salonId = lotus.salonId): Service => ({ id, name, salonId, durationMin, priceCents, active: true });
const noWrite = () => { expect(db.rows.filter(row => row.action === "CONFIRMED")).toEqual([]); expect(db.created).toEqual([]); };
/** The state a create in a released slot starts from (salon-secretary's releasedOrigin: the move's ORIGIN, seeded, and the released id). */
const released = (actor: Actor = lotus): SchedulingState => ({ ...schedulingState(), operation: "appointment.create",
  fields: { date: "2026-09-30", time: "10:00", professional_ref: actor === lotus ? "p-odete" : "p-wagner", professional_name: actor === lotus ? "Odete Lins" : "Wagner Sampaio" },
  references: { seeded: { date: "2026-09-30", time: "10:00", professional: actor === lotus ? "p-odete" : "p-wagner" }, released: "a-moved" } });
const fill = (c: SchedulingState, service_name: string, message = "e na vaga que abrir encaixa a Oksana pra hidratação e escova", actor: Actor = lotus) =>
  applySchedulingInterpretation(actor, c, { operation: "appointment.create", customer_name: "Oksana", service_name } as never, message, { askUnprovenService: true });
const performs = (pro: Pro, where: { services?: { some: { serviceId: string } }; AND?: { services: { some: { serviceId: string } } }[] }) =>
  (!where.services || pro.services.includes(where.services.some.serviceId)) && (where.AND ?? []).every(clause => pro.services.includes(clause.services.some.serviceId));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-29T15:00:00Z")); // Tuesday, 12h in São Paulo
  for (const name of ["MULTI_SERVICE", "TEMPORAL_COMPONENTS", "REFERENCES_V2", "SAME_AS"]) vi.stubEnv(`SALON_SECRETARY_${name}`, "true");
  db.rows = []; db.created = [];
  db.services = [service("l-hid", "Hidratação", 40, 5000), service("l-esc", "Escova", 40, 4000), service("l-combo", "Combo hidratação e escova", 80, 8000), service("l-corte", "Corte crespo", 60, 9000),
    service("t-hid", "Hidratação", 40, 5000, trilho.salonId), service("t-esc", "Escova", 40, 4000, trilho.salonId)];
  db.pros = [{ id: "p-odete", name: "Odete Lins", salonId: lotus.salonId, services: ["l-hid", "l-esc", "l-combo", "l-corte"], active: true },
    { id: "p-wagner", name: "Wagner Sampaio", salonId: trilho.salonId, services: ["t-hid", "t-esc"], active: true }];
  db.customers = [{ id: "c-oksana", name: "Oksana Petrenko", salonId: lotus.salonId }, { id: "c-oksana-t", name: "Oksana Petrenko", salonId: trilho.salonId }];
  const find = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  const proRow = (p: Pro) => ({ id: p.id, user: { name: p.name } });
  db.tx = { $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async (strings: readonly string[], ...values: unknown[]) => strings.join("?").includes("xmin") ? [{ revision: `rev-${values[0]}` }] : [{ locked: 1 }]),
    membership: { findFirstOrThrow: async () => ({ role: "RECEPTIONIST" }) },
    salon: { findUnique: async () => ({ timezone: "America/Sao_Paulo", minBookingLeadMinutes: 0, maxBookingLeadDays: 365, bufferMinutes: 0 }), findUniqueOrThrow: async () => ({ timezone: "America/Sao_Paulo" }) },
    servicePricingRule: { findFirst: async () => null },
    workingHours: { findMany: async ({ where }: { where: { salonId: string; professionalId: { in: string[] }; weekday?: number | { in: number[] } } }) => weekdaysOf(where).flatMap(weekday =>
      where.professionalId.in.filter(id => db.pros.some(p => p.id === id && p.salonId === where.salonId)).map(professionalId => ({ weekday, professionalId, startMinutes: 540, endMinutes: 1140 }))) },
    professionalOpening: { findMany: async () => [] }, salonClosure: { findMany: async () => [] }, timeOff: { findMany: async () => [] },
    resourceBooking: { findMany: async () => [] }, waitlistOffer: { findMany: async () => [] }, physicalResource: { findFirst: async () => null },
    appointment: { findMany: async () => [] },
    professional: {
      findFirst: async ({ where }: { where: { id: string; salonId: string } & Parameters<typeof performs>[1] }) => { const p = db.pros.find(row => row.id === where.id && row.salonId === where.salonId && row.active && performs(row, where)); return p ? proRow(p) : null; },
      findMany: async ({ where }: { where: { salonId: string } }) => db.pros.filter(row => row.salonId === where.salonId && row.active).map(proRow) },
    service: {
      findFirst: async ({ where }: { where: { id: string; salonId: string } }) => db.services.find(row => row.id === where.id && row.salonId === where.salonId && row.active) ?? null,
      findFirstOrThrow: async ({ where }: { where: { id: string; salonId: string } }) => { const s = db.services.find(row => row.id === where.id && row.salonId === where.salonId && row.active); if (!s) throw Error("NOT_FOUND"); return { physicalResourceId: null }; },
      findMany: async ({ where }: { where: { salonId: string; id?: { in: string[] } } }) => db.services.filter(row => row.salonId === where.salonId && row.active && (!where.id || where.id.in.includes(row.id)))
        .map(s => ({ ...s, priceType: "FIXED", priceNote: null, physicalResourceId: null, professionals: db.pros.filter(p => p.active && p.salonId === s.salonId && p.services.includes(s.id)).map(p => ({ professional: proRow(p) })) })) },
    auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { db.rows.push(structuredClone(data)); return data; }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => find(where)), findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => find(where)[0] ?? null) } } as unknown as Tx;
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("rule 9 in a released slot: one service, never a combo picked by the words' form", () => {
  it("the owner's 'hidratação e escova' with the parts registered apart: a card of the combo with the reason, no proposal, no list", async () => {
    const c = released();
    await fill(c, "hidratação e escova");
    expect(c.proposal).toBeUndefined(); expect(c.fields).not.toHaveProperty("service_names"); expect(c.fields.service_ref).toBeUndefined();
    expect(c.candidates).toEqual({ kind: "service_ref", items: [{ id: "l-combo", name: "Combo hidratação e escova" }] });
    expect(isSingleComboQuestion(c.message)).toBe(true); expect(c.message).toContain("esses serviços também existem separados"); noWrite();
  });
  it("the owner's click on the combo: the proposal books the combo in the released slot (origin day, clock and professional kept)", async () => {
    const c = released();
    await fill(c, "hidratação e escova");
    await selectScheduling(lotus, c, "l-combo", { clicked: true });
    expect(c.candidates).toBeUndefined();
    expect(c.proposal!.snapshot).toMatchObject({ service_ref: "l-combo", professional_ref: "p-odete", startLocal: "2026-09-30T10:00" }); noWrite();
  });
  it("the combo's registered name Luna wrote for the owner's words (C7 proof) is read back as those words: the same card, never the combo by its name", async () => {
    vi.stubEnv("SALON_SECRETARY_NAME_SUGGESTIONS", "true");
    const c = released();
    await fill(c, "Combo hidratação e escova");
    expect(c.proposal).toBeUndefined(); expect(c.candidates).toEqual({ kind: "service_ref", items: [{ id: "l-combo", name: "Combo hidratação e escova" }] });
    expect(isSingleComboQuestion(c.message)).toBe(true); noWrite();
  });
  it("the owner naming the combo itself ('o combo'), and rule 9 case 1 (only the combo registered): the combo is used, no question", async () => {
    vi.stubEnv("SALON_SECRETARY_NAME_SUGGESTIONS", "true");
    const named = released();
    await fill(named, "Combo hidratação e escova", "e na vaga que abrir encaixa a Oksana pro combo");
    expect(named.candidates).toBeUndefined(); expect(named.proposal!.snapshot).toMatchObject({ service_ref: "l-combo" });
    for (const id of ["l-hid", "l-esc"]) db.services.find(s => s.id === id)!.active = false;
    const only = released();
    await fill(only, "hidratação e escova");
    expect(only.candidates).toBeUndefined(); expect(only.proposal!.snapshot).toMatchObject({ service_ref: "l-combo" }); noWrite();
  });
  it("adversarial: a single service in the released slot is unchanged; another salon's combo never joins this salon's words", async () => {
    const one = released();
    await fill(one, "corte crespo", "e na vaga que abrir encaixa a Oksana pra corte crespo");
    expect(one.candidates).toBeUndefined(); expect(one.proposal!.snapshot).toMatchObject({ service_ref: "l-corte" });
    const other = released(trilho);
    await fill(other, "hidratação e escova", undefined, trilho);
    expect(JSON.stringify(other)).not.toContain("l-combo"); expect(isSingleComboQuestion(other.message)).toBe(false); noWrite();
  });
  it("flag off: the historical single match (unchanged)", async () => {
    vi.stubEnv("SALON_SECRETARY_MULTI_SERVICE", "false");
    const c = released();
    await fill(c, "hidratação e escova");
    expect(c.candidates).toBeUndefined(); expect(c.proposal!.snapshot).toMatchObject({ service_ref: "l-combo" }); noWrite();
  });
});
