import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import type { ClockComponent, DayComponent } from "../../../packages/salon-secretary/src/temporal-components";

/** P2b (flag SALON_SECRETARY_MULTI_SERVICE) through the real scheduling adapter, draft journal, availability (the real
 * getSchedulingAvailability, loadVisitDay and findVisitPlan over a fake tenant transaction), create snapshot, preview and
 * confirmation executor (the real createVisit; only the domain's createAppointment is a recording fake). A barbearia
 * ("pezinho"), an esmalteria and a studio de cílios/estética. No DB, no network, no model; the only confirmations are the
 * explicit confirmAppointmentCreate calls. */
type Service = { id: string; name: string; salonId: string; durationMin: number; priceCents: number; active: boolean };
type Pro = { id: string; name: string; salonId: string; services: string[]; active: boolean };
type Appt = { id: string; salonId: string; professionalId: string; start: string; end: string; status: string };
const db = vi.hoisted(() => ({ tx: undefined as unknown, rows: [] as Record<string, unknown>[], pros: [] as Pro[], services: [] as Service[], appointments: [] as Appt[],
  customers: [] as { id: string; name: string; salonId: string }[], role: "RECEPTIONIST", created: [] as Record<string, unknown>[] }));
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const utc = (local: string) => new Date(Date.parse(`${local}:00Z`) + 3 * 3600_000);
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
import { confirmAppointmentCreate } from "../scheduling-actions";
import { withTenant } from "../prisma-tenant";
import { SEPARATE_SERVICES_REF, nobodyPerformsAll, notPerformingAll, severalProfessionalsQuestion, unansweredServiceCard } from "../secretary-multi-service";
import { collectedActionFields } from "../secretary-action-plan";
import { presentationHints } from "../secretary-presentation";
import { clarificationContext } from "../secretary-clarification";

const navalha = { salonId: "barbearia-navalha", userId: "recepcao-navalha" }, lotus = { salonId: "esmalteria-lotus", userId: "dona-lotus" }, olhar = { salonId: "studio-olhar", userId: "dona-olhar" };
type Actor = typeof navalha;
const day = (value: Partial<DayComponent> & Pick<DayComponent, "kind">): DayComponent => ({ offset: null, weekday: null, week: null, day: null, month: null, year: null, days: null, ...value });
const TOMORROW = day({ kind: "RELATIVE_DAY", offset: 1 });
const clock = (hour: number, minute = 0): ClockComponent => ({ hour, minute, daypart: "UNSPECIFIED" });
const at10 = [{ field: "date", text: "amanhã", component: TOMORROW }, { field: "time", text: "às 10", component: clock(10) }];
const fresh = (operation = "appointment.create"): SchedulingState => ({ ...schedulingState(), operation: operation as SchedulingState["operation"] });
const turn = (state: SchedulingState, fields: Record<string, unknown>, message: string, actor: Actor = navalha, operation = state.operation ?? "appointment.create") =>
  applySchedulingInterpretation(actor, state, { operation, ...fields } as never, message, { askUnprovenService: true });
const text = (value: string) => value.replace(/[  ]/g, " ");
const confirm = (state: SchedulingState, actor: Actor = navalha) => withTenant(actor, tx => confirmAppointmentCreate(tx as Tx, actor, { proposal_ref: state.proposal!.proposal_ref, draft_revision: state.proposal!.draft_revision }));
const service = (id: string, name: string, durationMin: number, priceCents: number, salonId = navalha.salonId): Service => ({ id, name, salonId, durationMin, priceCents, active: true });
const noWrite = () => { expect(db.rows.filter(row => row.action === "CONFIRMED")).toEqual([]); expect(db.created).toEqual([]); };
/** Where-clause matcher for the professional eligibility query (one service, or every service of a list). */
const performs = (pro: Pro, where: { services?: { some: { serviceId: string } }; AND?: { services: { some: { serviceId: string } } }[] }) =>
  (!where.services || pro.services.includes(where.services.some.serviceId)) && (where.AND ?? []).every(clause => pro.services.includes(clause.services.some.serviceId));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-29T15:00:00Z")); // Tuesday, 12h in São Paulo; tomorrow is Wednesday 30/09
  vi.stubEnv("SALON_SECRETARY_MULTI_SERVICE", "true"); vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", "true");
  db.rows = []; db.created = []; db.role = "RECEPTIONIST"; db.appointments = [];
  db.services = [service("s-corte", "Corte", 30, 4500), service("s-barba", "Barba", 20, 3000), service("s-pezinho", "Pezinho", 15, 1200), service("s-sobrancelha", "Sobrancelha", 15, 1500),
    service("s-pe", "Pé", 40, 3500, lotus.salonId), service("s-mao", "Mão", 30, 3000, lotus.salonId), service("s-gel", "Esmaltação em gel", 60, 8000, lotus.salonId),
    service("s-henna", "Design com henna", 40, 6000, olhar.salonId), service("s-buco", "Buço", 10, 1500, olhar.salonId), service("s-cilios", "Extensão de cílios", 120, 20000, olhar.salonId)];
  db.pros = [{ id: "p-caio", name: "Caio Brito", salonId: navalha.salonId, services: ["s-corte", "s-barba", "s-pezinho"], active: true },
    { id: "p-lia", name: "Lia Moraes", salonId: navalha.salonId, services: ["s-corte", "s-pezinho", "s-sobrancelha"], active: true },
    { id: "p-teo", name: "Téo Nakamura", salonId: navalha.salonId, services: ["s-barba"], active: true },
    { id: "p-jade", name: "Jade Moura", salonId: lotus.salonId, services: ["s-pe", "s-mao", "s-gel"], active: true },
    { id: "p-bia", name: "Bia Castro", salonId: lotus.salonId, services: ["s-mao"], active: true },
    { id: "p-nina", name: "Nina Prado", salonId: olhar.salonId, services: ["s-henna", "s-buco", "s-cilios"], active: true }];
  db.customers = [{ id: "c-kevin", name: "Kevin Sato", salonId: navalha.salonId }, { id: "c-duda", name: "Duda Ramos", salonId: navalha.salonId },
    { id: "c-hiroshi", name: "Hiroshi Tanaka", salonId: navalha.salonId }, { id: "c-maria", name: "Maria Eduarda Lopes", salonId: navalha.salonId },
    { id: "c-yasmin", name: "Yasmin Alves", salonId: lotus.salonId }, { id: "c-luz", name: "Luz Andrade", salonId: olhar.salonId }];
  const find = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  const proRow = (p: Pro) => ({ id: p.id, user: { name: p.name } });
  db.tx = { $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async (strings: readonly string[], ...values: unknown[]) => strings.join("?").includes("xmin") ? [{ revision: `rev-${values[0]}` }] : [{ locked: 1 }]),
    membership: { findFirstOrThrow: async () => ({ role: db.role }) },
    salon: { findUnique: async () => ({ timezone: "America/Sao_Paulo", minBookingLeadMinutes: 0, maxBookingLeadDays: 365, bufferMinutes: 0 }), findUniqueOrThrow: async () => ({ timezone: "America/Sao_Paulo" }) },
    servicePricingRule: { findFirst: async () => null },
    workingHours: { findMany: async ({ where }: { where: { salonId: string; professionalId: { in: string[] } } }) =>
      where.professionalId.in.filter(id => db.pros.some(p => p.id === id && p.salonId === where.salonId)).map(professionalId => ({ professionalId, startMinutes: 540, endMinutes: 1140 })) },
    professionalOpening: { findMany: async () => [] }, salonClosure: { findMany: async () => [] }, timeOff: { findMany: async () => [] },
    resourceBooking: { findMany: async () => [] }, waitlistOffer: { findMany: async () => [] },
    physicalResource: { findFirst: async () => null },
    appointment: { findMany: async ({ where }: { where: { salonId: string; professionalId: { in: string[] }; startAt: { lt: Date }; endAt: { gt: Date } } }) =>
      db.appointments.filter(a => a.salonId === where.salonId && where.professionalId.in.includes(a.professionalId) && ["PENDING", "CONFIRMED"].includes(a.status) &&
        utc(a.start) < where.startAt.lt && utc(a.end) > where.endAt.gt).map(a => ({ professionalId: a.professionalId, startAt: utc(a.start), endAt: utc(a.end) })) },
    professional: {
      findFirst: async ({ where }: { where: { id: string; salonId: string; active?: boolean } & Parameters<typeof performs>[1] }) => { const p = db.pros.find(row => row.id === where.id && row.salonId === where.salonId && row.active && performs(row, where)); return p ? proRow(p) : null; },
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

describe("C02: one appointment with several services and one professional", () => {
  it("'corte e barba': both services, summed duration and price in the proposal; one Confirmar creates ONE appointment (idempotent)", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Kevin", service_names: ["corte", "barba"], professional_name: "Caio", temporal_evidence: at10 }, "Marca corte e barba pro Kevin amanhã às 10 com o Caio");
    expect(c.proposal).toBeDefined(); noWrite();
    expect(c.proposal!.snapshot).toMatchObject({ customer_ref: "c-kevin", professional_ref: "p-caio", startLocal: "2026-09-30T10:00", endLocal: "2026-09-30T10:50", durationMin: 50, priceCents: 7500,
      service_ref: "s-corte", services: [{ service_ref: "s-corte", durationMin: 30, priceCents: 4500 }, { service_ref: "s-barba", durationMin: 20, priceCents: 3000 }] });
    expect(text(c.message)).toContain("NOVO AGENDAMENTO\nCliente: Kevin Sato\nServiços: Corte (30 min, R$ 45,00) + Barba (20 min, R$ 30,00)\nProfissional: Caio Brito\nQuando: qua, 30/09 às 10h–10h50\nDuração total: 50 min\nPreço total: R$ 75,00");
    expect(c.fields).toMatchObject({ service_names: ["corte", "barba"], service_list_ref: ["s-corte", "s-barba"] }); expect(c.fields).not.toHaveProperty("service_name");
    await turn(c, {}, "sim"); expect(c.proposal).toBeDefined(); noWrite(); // a typed "sim" never confirms
    const receipt = await confirm(c);
    expect(receipt).toMatchObject({ appointment_ref: "ag-1", duplicate: false });
    expect(db.created).toEqual([expect.objectContaining({ professionalId: "p-caio", serviceIds: ["s-corte", "s-barba"], startLocal: "2026-09-30T10:00", clientId: "c-kevin" })]);
    expect(await confirm(c)).toMatchObject({ appointment_ref: "ag-1", duplicate: true }); expect(db.created).toHaveLength(1);
  });
  it("'pé e mão' in an esmalteria without a combo, and 'design com henna e buço' in a studio", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Yasmin", service_names: ["pé", "mão"], professional_name: "Jade", temporal_evidence: at10 }, "Coloca pé e mão pra Yasmin amanhã às 10 com a Jade", lotus);
    expect(c.proposal!.snapshot).toMatchObject({ professional_ref: "p-jade", endLocal: "2026-09-30T11:10", durationMin: 70, priceCents: 6500, services: [{ service_ref: "s-pe" }, { service_ref: "s-mao" }] });
    const d = fresh();
    await turn(d, { customer_name: "Luz", service_names: ["design com henna", "buço"], temporal_evidence: at10 }, "Agenda design com henna e buço pra Luz amanhã às 10", olhar);
    // The only professional who performs both is assigned (auto-assign only of a single eligible professional).
    expect(d.proposal!.snapshot).toMatchObject({ professional_ref: "p-nina", durationMin: 50, priceCents: 7500 });
    expect(text(d.message)).toContain("Serviços: Design com henna (40 min, R$ 60,00) + Buço (10 min, R$ 15,00)");
    noWrite();
  });
  it("C30: availability for the summed duration (read-only, nothing written)", async () => {
    db.appointments = [{ id: "a-1", salonId: lotus.salonId, professionalId: "p-jade", start: "2026-09-30T10:00", end: "2026-09-30T11:00", status: "CONFIRMED" }];
    const c = fresh("availability.get");
    await turn(c, { service_names: ["pé", "mão"], professional_name: "Jade", temporal_evidence: [at10[0]] }, "Tem horário amanhã pra pé e mão com a Jade?", lotus);
    // 70 min: 9h would run into the 10h booking; the list starts after it.
    expect(c.message).toBe("Horários livres de Jade para Pé + Mão em qua, 30/09: 11h, 11h15, 11h30, 11h45, 12h. A consulta não reserva o horário.");
    expect(c.proposal).toBeUndefined(); noWrite();
  });
  it("a slot that fits one service but not the summed duration is unavailable, with alternatives for the whole visit", async () => {
    db.appointments = [{ id: "a-1", salonId: navalha.salonId, professionalId: "p-caio", start: "2026-09-30T10:30", end: "2026-09-30T11:00", status: "CONFIRMED" }];
    const single = fresh();
    await turn(single, { customer_name: "Kevin", service_name: "corte", professional_name: "Caio", temporal_evidence: at10 }, "Marca corte pro Kevin amanhã às 10 com o Caio");
    expect(single.proposal).toBeDefined();
    const c = fresh();
    await turn(c, { customer_name: "Kevin", service_names: ["corte", "barba"], professional_name: "Caio", temporal_evidence: at10 }, "Marca corte e barba pro Kevin amanhã às 10 com o Caio");
    expect(c.proposal).toBeUndefined(); expect(c.waiting_for).toBe("time");
    expect(c.message).toBe("Esse horário está indisponível. Tenho 11h, 11h15, 11h30, 11h45, 12h. Qual horário você prefere?"); noWrite();
  });
  it("the schedule changes between the proposal and Confirmar: nothing is written", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Kevin", service_names: ["corte", "barba"], professional_name: "Caio", temporal_evidence: at10 }, "Marca corte e barba pro Kevin amanhã às 10 com o Caio");
    db.appointments = [{ id: "a-2", salonId: navalha.salonId, professionalId: "p-caio", start: "2026-09-30T10:40", end: "2026-09-30T11:00", status: "CONFIRMED" }];
    await expect(confirm(c)).rejects.toThrow(/SLOT_CONFLICT|SCHEDULE_CHANGED/); noWrite();
  });
  it("one service in the list is the single-service path; repeated words are one service", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Duda", service_names: ["barba", "Barba"], professional_name: "Téo", temporal_evidence: at10 }, "Marca barba pro Duda amanhã às 10 com o Téo");
    expect(c.fields).toMatchObject({ service_name: "barba", service_ref: "s-barba" }); expect(c.fields).not.toHaveProperty("service_names");
    expect(c.proposal!.snapshot!.services).toBeUndefined(); expect(text(c.message)).toContain("Serviço: Barba\n"); noWrite();
  });
});

describe("the professional attends every service (one professional; different professionals are out of scope)", () => {
  it("a named professional who does not perform all of them: said, who does is offered (never picked); the click is checked", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Kevin", service_names: ["corte", "barba"], professional_name: "Lia", temporal_evidence: at10 }, "Marca corte e barba pro Kevin amanhã às 10 com a Lia");
    expect(c.proposal).toBeUndefined(); expect(c.message).toBe(notPerformingAll);
    expect(c.candidates).toEqual({ kind: "professional_ref", items: [{ id: "p-caio", name: "Caio Brito" }] });
    await expect(selectScheduling(navalha, c, "p-lia")).rejects.toThrow("SELECTION_INVALID");
    await selectScheduling(navalha, c, "p-caio", { clicked: true });
    expect(c.proposal!.snapshot).toMatchObject({ professional_ref: "p-caio", services: [{ service_ref: "s-corte" }, { service_ref: "s-barba" }] }); noWrite();
  });
  it("nobody performs all of them: an explicit unsupported message, nothing proposed, never split", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Duda", service_names: ["barba", "sobrancelha"], temporal_evidence: at10 }, "Marca barba e sobrancelha pro Duda amanhã às 10");
    expect(c.proposal).toBeUndefined(); expect(c.message).toBe(nobodyPerformsAll); noWrite();
  });
  it("'corte com o Caio e sobrancelha com a Lia': two professionals named for one visit are asked, never reduced to one silently", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Hiroshi", service_names: ["corte", "sobrancelha"], professional_name: "Caio", temporal_evidence: at10 }, "Marca corte com o Caio e sobrancelha com a Lia pro Hiroshi amanhã às 10");
    expect(c.proposal).toBeUndefined(); expect(c.message).toBe(severalProfessionalsQuestion); expect(c.waiting_for).toBe("professional_name");
    expect(c.fields).not.toHaveProperty("professional_name"); expect(c.fields).not.toHaveProperty("professional_ref"); noWrite();
    await turn(c, { professional_name: "Lia" }, "Pode ser tudo com a Lia");
    expect(c.proposal!.snapshot).toMatchObject({ professional_ref: "p-lia", services: [{ service_ref: "s-corte" }, { service_ref: "s-sobrancelha" }], durationMin: 45 }); noWrite();
  });
  it("one professional named in parts ('a Ana Paula') is one professional", async () => {
    db.pros.push({ id: "p-anapaula", name: "Ana Paula Reis", salonId: navalha.salonId, services: ["s-corte", "s-barba"], active: true },
      { id: "p-analuiza", name: "Ana Luiza Prado", salonId: navalha.salonId, services: ["s-corte"], active: true });
    const c = fresh();
    await turn(c, { customer_name: "Kevin", service_names: ["corte", "barba"], professional_name: "Ana Paula", temporal_evidence: at10 }, "Marca corte e barba pro Kevin amanhã às 10 com a Ana Paula");
    expect(c.proposal!.snapshot).toMatchObject({ professional_ref: "p-anapaula" }); noWrite();
  });
});

describe("catalog combos and homonyms: asked, never picked, never booked beside their parts", () => {
  beforeEach(() => { db.services.push(service("s-combo", "Corte e barba", 45, 6500)); db.pros[0].services.push("s-combo"); });
  it("the combo and the separate services both exist: a card; 'separados' books both services, the combo books the one service", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Kevin", service_names: ["corte", "barba"], professional_name: "Caio", temporal_evidence: at10 }, "Marca corte e barba pro Kevin amanhã às 10 com o Caio");
    expect(c.proposal).toBeUndefined(); noWrite();
    expect(c.message).toBe("No catálogo, “Corte e barba” já junta corte e barba. Marco esse serviço ou os serviços separados? Selecione uma opção real.");
    expect(c.candidates).toEqual({ kind: "service_combo_ref", items: [{ id: "s-combo", name: "Corte e barba" }, { id: SEPARATE_SERVICES_REF, name: "Separados: corte + barba" }] });
    const apart = fresh();
    await turn(apart, { customer_name: "Kevin", service_names: ["corte", "barba"], professional_name: "Caio", temporal_evidence: at10 }, "Marca corte e barba pro Kevin amanhã às 10 com o Caio");
    await selectScheduling(navalha, apart, SEPARATE_SERVICES_REF, { clicked: true });
    expect(apart.proposal!.snapshot).toMatchObject({ services: [{ service_ref: "s-corte" }, { service_ref: "s-barba" }], durationMin: 50 });
    await selectScheduling(navalha, c, "s-combo", { clicked: true });
    expect(c.proposal!.snapshot).toMatchObject({ service_ref: "s-combo", durationMin: 45, priceCents: 6500 }); expect(c.proposal!.snapshot!.services).toBeUndefined();
    expect(text(c.message)).toContain("Serviço: Corte e barba\n"); expect(c.fields).toMatchObject({ service_name: "Corte e barba", service_ref: "s-combo" });
    noWrite();
  });
  // C4 owner rule 9 (contract migration, backup .demo/agenda-core/contract-migration/secretary-multi-service-adapter.test.before-c4-rule9.ts):
  // before, a single service_name for the combo resolved as that one service even with the services apart registered (a pick).
  it("a single service_name for the combo, with the services apart registered too, is asked like the list (never picked)", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Kevin", service_name: "corte e barba", professional_name: "Caio", temporal_evidence: at10 }, "Marca corte e barba pro Kevin amanhã às 10 com o Caio");
    expect(c.proposal).toBeUndefined(); expect(c.candidates?.kind).toBe("service_combo_ref"); noWrite();
  });
  it("only the combo exists for one of the said services: the combo IS the request (never combo + part)", async () => {
    db.services = db.services.filter(row => row.id !== "s-corte");
    const c = fresh();
    await turn(c, { customer_name: "Kevin", service_names: ["corte", "barba"], professional_name: "Caio", temporal_evidence: at10 }, "Marca corte e barba pro Kevin amanhã às 10 com o Caio");
    expect(c.proposal!.snapshot).toMatchObject({ service_ref: "s-combo", durationMin: 45 }); expect(c.proposal!.snapshot!.services).toBeUndefined(); noWrite();
  });
  it("a combo card is never answered by words both options share; the owner's click decides", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Kevin", service_names: ["corte", "barba"], professional_name: "Caio", temporal_evidence: at10 }, "Marca corte e barba pro Kevin amanhã às 10 com o Caio");
    await turn(c, { service_name: "Corte e barba" }, "corte e barba");
    expect(c.proposal).toBeUndefined(); expect(c.candidates?.kind).toBe("service_combo_ref");
    expect(c.message.startsWith(`${unansweredServiceCard}\nNo catálogo`)).toBe(true); expect(c.fields.service_names).toEqual(["corte", "barba"]); noWrite();
  });
});

describe("each service resolved like a single one", () => {
  beforeEach(() => { db.services.push(service("s-corte-inf", "Corte infantil", 25, 3500)); db.pros[0].services.push("s-corte-inf"); });
  it("a homonym is a card for that service only; the other services are kept; a wrong option is refused", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Kevin", service_names: ["corte", "barba"], professional_name: "Caio", temporal_evidence: at10 }, "Marca corte e barba pro Kevin amanhã às 10 com o Caio");
    expect(c.message).toBe("Qual serviço você quis dizer com “corte”? Selecione uma opção real.");
    expect(c.candidates).toEqual({ kind: "service_list_ref", items: [{ id: "s-corte", name: "Corte" }, { id: "s-corte-inf", name: "Corte infantil" }] });
    await expect(selectScheduling(navalha, c, "s-barba")).rejects.toThrow("SELECTION_INVALID");
    await selectScheduling(navalha, c, "s-corte-inf", { clicked: true });
    expect(c.proposal!.snapshot).toMatchObject({ services: [{ service_ref: "s-corte-inf" }, { service_ref: "s-barba" }], durationMin: 45 }); noWrite();
  });
  it("the owner's words single out an option Luna restates: a pick; words every option shares: asked again, the list kept", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Kevin", service_names: ["corte", "barba"], professional_name: "Caio", temporal_evidence: at10 }, "Marca corte e barba pro Kevin amanhã às 10 com o Caio");
    const again = fresh();
    await turn(again, { customer_name: "Kevin", service_names: ["corte", "barba"], professional_name: "Caio", temporal_evidence: at10 }, "Marca corte e barba pro Kevin amanhã às 10 com o Caio");
    await turn(again, { service_name: "Corte" }, "o corte");
    expect(again.proposal).toBeUndefined(); expect(again.message).toBe(`${unansweredServiceCard}\nQual serviço você quis dizer com “corte”? Selecione uma opção real.`);
    expect(again.fields.service_names).toEqual(["corte", "barba"]);
    await turn(c, { service_name: "Corte infantil" }, "é o infantil");
    expect(c.proposal!.snapshot).toMatchObject({ services: [{ service_ref: "s-corte-inf" }, { service_ref: "s-barba" }] }); noWrite();
  });
  it("two words resolved to the same catalog service are refused (never the same service twice in one appointment)", async () => {
    db.services.push(service("s-corte-m", "Corte masculino", 30, 5000)); db.pros[0].services.push("s-corte-m");
    const c = fresh();
    await turn(c, { customer_name: "Kevin", service_names: ["corte masculino", "corte"], professional_name: "Caio", temporal_evidence: at10 }, "Marca corte masculino e corte pro Kevin amanhã às 10 com o Caio");
    expect(c.candidates?.kind).toBe("service_list_ref");
    await selectScheduling(navalha, c, "s-corte-m", { clicked: true });
    expect(c.proposal).toBeUndefined(); expect(c.message).toBe("Corte masculino apareceu mais de uma vez no mesmo atendimento. Quais serviços devo marcar?");
    expect(c.fields).not.toHaveProperty("service_names"); noWrite();
  });
  it("an unknown service (or another salon's) is said, nothing proposed; with suggestions on, similar names are offered", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Kevin", service_names: ["barba", "esmaltação em gel"], professional_name: "Caio", temporal_evidence: at10 }, "Marca barba e esmaltação em gel pro Kevin amanhã às 10 com o Caio");
    expect(c.proposal).toBeUndefined(); expect(c.message).toBe("Não encontrei o serviço “esmaltação em gel” neste salão. Quais serviços devo marcar?");
    vi.stubEnv("SALON_SECRETARY_NAME_SUGGESTIONS", "true");
    const d = fresh();
    await turn(d, { customer_name: "Kevin", service_names: ["barba", "pezinhu"], professional_name: "Caio", temporal_evidence: at10 }, "Marca barba e pezinhu pro Kevin amanhã às 10 com o Caio");
    expect(d.proposal).toBeUndefined(); expect(d.candidates).toMatchObject({ kind: "service_list_ref", source: "suggest", items: [{ id: "s-pezinho", name: "Pezinho" }] });
    await selectScheduling(navalha, d, "s-pezinho", { clicked: true });
    expect(d.proposal!.snapshot).toMatchObject({ services: [{ service_ref: "s-barba" }, { service_ref: "s-pezinho" }] }); noWrite();
  });
});

describe("adversarial: words the owner did not affirm are never booked", () => {
  it("a negated service ('barba não') is never booked: asked, and no service of the list is kept", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Duda", service_names: ["corte", "barba"], professional_name: "Caio", temporal_evidence: at10 }, "Marca corte pro Duda amanhã às 10 com o Caio, barba não");
    expect(c.proposal).toBeUndefined(); expect(c.message).toBe("Na sua mensagem “barba” aparece com negação, então não marquei nenhum serviço. Quais serviços devo marcar?");
    expect(c.fields).not.toHaveProperty("service_names"); expect(c.fields).not.toHaveProperty("service_name"); noWrite();
  });
  it("a service the message does not prove, and a service_name contradicting the list, are asked (nothing kept, nothing proposed)", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Duda", service_names: ["corte", "barba", "pezinho"], professional_name: "Caio", temporal_evidence: at10 }, "Marca corte e barba pro Duda amanhã às 10 com o Caio");
    expect(c.proposal).toBeUndefined(); expect(c.message).toBe("Não consegui confirmar “pezinho” na sua mensagem, então não marquei nenhum serviço. Quais serviços devo marcar?");
    const d = fresh();
    await turn(d, { customer_name: "Duda", service_name: "sobrancelha", service_names: ["corte", "barba"], professional_name: "Caio", temporal_evidence: at10 }, "Marca corte e barba e sobrancelha pro Duda amanhã às 10 com o Caio");
    expect(d.proposal).toBeUndefined(); expect(d.message).toBe("Recebi indicações diferentes para os serviços e não escolhi nenhuma. Quais serviços devo marcar?");
    expect(d.fields).not.toHaveProperty("service_names"); expect(d.fields).not.toHaveProperty("service_name"); noWrite();
  });
  it("outside a plan turn an unproven list refuses the patch, like a single unproven service", async () => {
    const c = fresh();
    await expect(applySchedulingInterpretation(navalha, c, { operation: "appointment.create", customer_name: "Duda", service_names: ["corte", "pezinho"] } as never, "Marca corte pro Duda"))
      .rejects.toThrow("ENTITY_MENTION_CONFLICT");
    noWrite();
  });
  it("a service list is never read on another operation", async () => {
    await expect(turn(fresh("appointment.change"), { customer_name: "Kevin", service_names: ["corte", "barba"] }, "Remarca corte e barba do Kevin")).rejects.toThrow("CAPABILITY_FIELD_MISMATCH");
    noWrite();
  });
});

describe("single <-> list across turns", () => {
  // Review A (P2 fixer, contract migration): one service beside a held list that the owner's words name is asked (restating, narrowing
  // or adding?) and nothing is kept; the next answer starts clean. Before: it replaced the list silently.
  it("'e barba também' keeps the accepted service (no new proof, same resolution); 'só a barba' in the owner's words is asked, then applied", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Maria Eduarda", service_name: "corte", professional_name: "Caio", temporal_evidence: at10 }, "Marca um corte pra Maria Eduarda amanhã às 10 com o Caio");
    expect(c.proposal!.snapshot).toMatchObject({ service_ref: "s-corte", durationMin: 30 });
    await turn(c, { service_names: ["corte", "barba"] }, "e barba também");
    expect(c.proposal!.snapshot).toMatchObject({ professional_ref: "p-caio", services: [{ service_ref: "s-corte" }, { service_ref: "s-barba" }], endLocal: "2026-09-30T10:50" });
    expect(c.fields).not.toHaveProperty("service_name");
    // A restatement of one service the owner did not write changes nothing (never a silent drop of the other).
    await turn(c, { service_name: "corte" }, "pode confirmar a hora");
    expect(c.proposal!.snapshot!.services).toHaveLength(2);
    await turn(c, { service_name: "barba" }, "na verdade só a barba");
    expect(c.proposal).toBeUndefined(); expect(c.fields).not.toHaveProperty("service_names"); expect(c.waiting_for).toBe("service_names");
    expect(c.message).toBe("O pedido tinha “corte” e “barba” e agora recebi só “barba”; não marquei nenhum serviço. Quais serviços devo marcar?");
    await turn(c, { service_name: "barba" }, "só a barba");
    expect(c.proposal!.snapshot).toMatchObject({ service_ref: "s-barba", durationMin: 20 }); expect(c.proposal!.snapshot!.services).toBeUndefined();
    expect(c.fields).not.toHaveProperty("service_names"); expect(c.fields).not.toHaveProperty("service_list_ref"); noWrite();
  });
});

describe("flag off: never read, never executed", () => {
  it("a list in an interpretation is a capability mismatch; a proposal made while on never executes after the flag is off", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Kevin", service_names: ["corte", "barba"], professional_name: "Caio", temporal_evidence: at10 }, "Marca corte e barba pro Kevin amanhã às 10 com o Caio");
    expect(c.proposal).toBeDefined();
    vi.stubEnv("SALON_SECRETARY_MULTI_SERVICE", "false");
    await expect(confirm(c)).rejects.toThrow("MULTI_SERVICE_DISABLED"); noWrite();
    await expect(turn(fresh(), { customer_name: "Kevin", service_names: ["corte", "barba"] }, "Marca corte e barba pro Kevin")).rejects.toThrow("CAPABILITY_FIELD_MISMATCH");
    // Preparing the kept draft again drops the list: the service is asked (nothing proposed).
    await turn(c, { temporal_evidence: [{ field: "time", text: "às 11", component: clock(11) }] }, "às 11");
    expect(c.proposal).toBeUndefined(); expect(c.fields).not.toHaveProperty("service_names"); expect(c.draft!.missing_fields).toContain("service_ref"); noWrite();
  });
});

describe("candidate profile (every candidate flag on)", () => {
  beforeEach(() => {
    for (const flag of ["TEMPORAL_POLARITY", "SAME_AS", "STRUCTURED_CONTEXT", "NAME_SUGGESTIONS", "CUSTOMER_OVERLAP_GUARD", "PERSISTED_STATE", "DATE_RULES_V2", "DAYPART_RULES_V2", "DAYPART_BY_HOURS", "ALTER_APPOINTMENT"])
      vi.stubEnv(`SALON_SECRETARY_${flag}`, "true");
  });
  it("the same proposal and one appointment; the domain review (overlap flag) inspects every service", async () => {
    vi.stubEnv("SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED", "true");
    const inspect = vi.spyOn(await import("../appointment-service"), "inspectAppointmentAvailability").mockImplementation(async (_tx, input) => {
      const startAt = utc(input.startLocal), minutes = input.serviceIds.reduce((sum, id) => sum + db.services.find(row => row.id === id)!.durationMin, 0);
      return { violation: null, startAt, endAt: new Date(startAt.getTime() + minutes * 60_000), timezone: "America/Sao_Paulo", conflicts: [], services: [] } as never;
    });
    const c = fresh();
    await turn(c, { customer_name: "Kevin", service_names: ["corte", "barba"], professional_name: "Caio", temporal_evidence: at10 }, "Marca corte e barba pro Kevin amanhã às 10 com o Caio");
    expect(inspect).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ professionalId: "p-caio", serviceIds: ["s-corte", "s-barba"], startLocal: "2026-09-30T10:00" }));
    expect(c.draft!.review).toMatchObject({ status: "AVAILABLE", durationMin: 50 });
    expect(c.proposal!.snapshot).toMatchObject({ durationMin: 50, priceCents: 7500 });
    await confirm(c); expect(db.created).toEqual([expect.objectContaining({ serviceIds: ["s-corte", "s-barba"] })]);
  });
});

describe("plan projection: the owner's words only; refs never leave the backend", () => {
  const action = (operation: string, missing: string[]) => ({ key: "a", operation, skill: "scheduling", mutation: operation === "appointment.create", missing_fields: missing, depends_on: [], fields: {},
    assessment: { status: "NEEDS_INPUT", missing_fields: missing, preview: "" } }) as never;
  it("the plan holds the list (never its refs, never a neutral slot when there is none); a list card is asked with the adapter's own question", async () => {
    db.services.push(service("s-corte-inf", "Corte infantil", 25, 3500));
    const c = fresh();
    await turn(c, { customer_name: "Kevin", service_names: ["corte", "barba"], professional_name: "Caio", temporal_evidence: at10 }, "Marca corte e barba pro Kevin amanhã às 10 com o Caio");
    const fields = collectedActionFields({ scheduling: c, message: c.message } as never, action("appointment.create", c.draft!.missing_fields)) as Record<string, unknown>;
    expect(fields.service_names).toEqual(["corte", "barba"]); expect(fields).not.toHaveProperty("service_name"); expect(JSON.stringify(fields)).not.toContain("s-corte");
    const single = fresh();
    await turn(single, { customer_name: "Kevin", service_name: "barba", professional_name: "Caio", temporal_evidence: at10 }, "Marca barba pro Kevin amanhã às 10 com o Caio");
    expect(collectedActionFields({ scheduling: single, message: single.message } as never, action("appointment.create", []))).not.toHaveProperty("service_names");
    const hints = presentationHints({ actions: [action("appointment.create", c.draft!.missing_fields)] } as never, [{ keys: ["a"], kind: "single", child: "x" }], [{ operation_ref: "x", state: { scheduling: c, message: c.message } as never }]);
    expect(hints.a).toMatchObject({ question: "Qual serviço você quis dizer com “corte”? Selecione uma opção real.", selection: { field: "service_list_ref", labels: ["Corte", "Corte infantil"] } });
    const context = clarificationContext({ ...c, waiting_for: c.candidates!.kind, selection: { field: c.candidates!.kind, labels: c.candidates!.items.map(item => item.name) }, missing_fields: c.draft!.missing_fields });
    expect(context.clarification).toMatchObject({ response_fields: ["service_names"], requested_field: "service_list_ref" });
    expect(context.fields).not.toHaveProperty("service_list_ref"); expect(JSON.stringify(context)).not.toContain("s-corte"); noWrite();
  });
  it("the two-professional question reaches the plan as the adapter's own wording", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Hiroshi", service_names: ["corte", "sobrancelha"], professional_name: "Caio", temporal_evidence: at10 }, "Marca corte com o Caio e sobrancelha com a Lia pro Hiroshi amanhã às 10");
    const hints = presentationHints({ actions: [action("appointment.create", c.draft!.missing_fields)] } as never, [{ keys: ["a"], kind: "single", child: "x" }], [{ operation_ref: "x", state: { scheduling: c, message: c.message } as never }]);
    expect(hints.a.question).toBe(severalProfessionalsQuestion); noWrite();
  });
});

import { splitChoiceDelta, nameEchoAgrees } from "../secretary-options";
import { SalonSecretary } from "../salon-secretary";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
/** Adversarial review A of P2b, fixed (phase 2 fixer). Nothing is written in any case: proposals still wait for Confirmar. */
describe("review A: an answer to a service card of the list never collapses the list", () => {
  beforeEach(() => { db.services.push(service("s-corte-inf", "Corte infantil", 25, 3500)); db.pros[0].services.push("s-corte-inf"); });
  const cardForCorte = async () => {
    const c = fresh();
    await turn(c, { customer_name: "Kevin", service_names: ["corte", "barba"], professional_name: "Caio", temporal_evidence: at10 }, "Marca corte e barba pro Kevin amanhã às 10 com o Caio");
    expect(c.candidates?.kind).toBe("service_list_ref"); return c;
  };
  it("choice path: service_names / service_name restating the pick are its echo (compared, never applied as a new list)", async () => {
    const c = await cardForCorte(), option = { option_id: "opt_2", label: "Corte infantil", ref: "s-corte-inf", field: "service_list_ref" };
    const split = splitChoiceDelta({ operation: "appointment.create", item_key: "a", service_names: ["corte infantil"], service_name: "Corte infantil" }, option, "appointment.create");
    expect(split.echo).toEqual({ service_names: ["corte infantil"], service_name: "Corte infantil" }); expect(split.rest).toMatchObject({ service_names: null, service_name: null });
    expect(nameEchoAgrees("service_names", ["corte infantil", "barba"], option, c.fields as never)).toBe(true);
    expect(nameEchoAgrees("service_name", "Corte infantil", option, c.fields as never)).toBe(true);
    expect(nameEchoAgrees("service_names", ["sobrancelha"], option, c.fields as never)).toBe(false); noWrite();
  });
  it("E2E (SalonSecretary, scripted Luna): the verified choice with its response field keeps both services; control without it", async () => {
    vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", "false");
    const pair = (value: unknown, literal: string) => ({ value, literal });
    for (const fields of [{ service_names: ["corte infantil"] }, { service_name: "Corte infantil" }, {}]) {
      db.rows = [];
      const model = new ScriptedServicesModel([call("select_capabilities", { turn: { mode: "NEW", operations: [{ item_key: "a", operation: "appointment.create", customer_name: "Kevin",
        service_names: ["corte", "barba"], professional_name: "Caio", day_offset: pair(1, "amanhã"), time: pair("10:00", "às 10") }] } }),
        call("upsert_action_draft", { turn: { mode: "PATCH", operations: [{ item_key: "a", choice: { option_id: "opt_2", literal: "corte infantil" }, fields }] } })]);
      const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
      const session = await secretary.start(navalha, "auto");
      await secretary.send(navalha, { sessionId: session.sessionId, message: "Marca corte e barba pro Kevin amanhã às 10 com o Caio" });
      const second = await secretary.send(navalha, { sessionId: session.sessionId, message: "corte infantil" });
      expect(text(second.message ?? "")).toContain("Corte infantil (25 min, R$ 35,00) + Barba");
    }
    noWrite();
  });
  it("after the pick, a restatement of it without the owner's words keeps the list; one service the owner names beside the list is asked", async () => {
    const c = await cardForCorte();
    await selectScheduling(navalha, c, "s-corte-inf", { clicked: true });
    await turn(c, { service_name: "Corte infantil" }, "pode ser");
    expect(c.proposal!.snapshot).toMatchObject({ services: [{ service_ref: "s-corte-inf" }, { service_ref: "s-barba" }] });
    await turn(c, { service_name: "sobrancelha" }, "e sobrancelha");
    expect(c.proposal).toBeUndefined(); expect(c.fields).not.toHaveProperty("service_names");
    expect(c.message).toBe("O pedido tinha “corte” e “barba” e agora recebi só “sobrancelha”; não marquei nenhum serviço. Quais serviços devo marcar?"); noWrite();
  });
});
describe("review A: combos and exclusions", () => {
  it("a combo that also holds a service the owner never said is never booked by itself: a card (click or its name); the click books it", async () => {
    db.services.find(s => s.id === "s-barba")!.active = false;
    db.services.push(service("s-trio", "Corte + Barba + Sobrancelha", 60, 8000)); db.pros[0].services.push("s-trio");
    const c = fresh();
    await turn(c, { customer_name: "Kevin", service_names: ["corte", "barba"], professional_name: "Caio", temporal_evidence: at10 }, "Marca corte e barba pro Kevin amanhã às 10 com o Caio");
    expect(c.proposal).toBeUndefined();
    expect(c.candidates).toEqual({ kind: "service_combo_ref", items: [{ id: "s-trio", name: "Corte + Barba + Sobrancelha" }] });
    expect(c.message).toBe("No catálogo, “Corte + Barba + Sobrancelha” já junta corte e barba. “barba” não existe separado, e “Corte + Barba + Sobrancelha” inclui também Sobrancelha. Marco esse serviço? Selecione uma opção real.");
    await selectScheduling(navalha, c, "s-trio", { clicked: true });
    expect(c.proposal!.snapshot).toMatchObject({ service_ref: "s-trio", durationMin: 60 }); noWrite();
  });
  it("'sem barba' in a list: the excluded service is never booked (asked, like 'barba não')", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Kevin", service_names: ["corte", "pezinho", "barba"], professional_name: "Caio", temporal_evidence: at10 }, "Marca corte e pezinho pro Kevin amanhã às 10 com o Caio, sem barba");
    expect(c.proposal).toBeUndefined(); expect(c.message).toBe("Na sua mensagem “barba” aparece com negação, então não marquei nenhum serviço. Quais serviços devo marcar?");
    expect(c.fields).not.toHaveProperty("service_names"); noWrite();
  });
  it("a combo beside one of its own parts is refused after the cards, never booked", async () => {
    db.services.push(service("s-cb", "Corte e barba", 45, 6500)); db.pros[0].services.push("s-cb");
    const c = fresh();
    await turn(c, { customer_name: "Kevin", service_names: ["corte e barba", "barba"], professional_name: "Caio", temporal_evidence: at10 }, "Marca corte e barba pro Kevin amanhã às 10 com o Caio e capricha na barba");
    if (c.candidates?.kind === "service_list_ref") await selectScheduling(navalha, c, "s-barba", { clicked: true });
    expect(c.proposal).toBeUndefined(); expect(c.fields).not.toHaveProperty("service_names");
    expect(c.message).toBe("Corte e barba já inclui Barba; o mesmo serviço não entra duas vezes no atendimento. Quais serviços devo marcar?"); noWrite();
  });
  it("control: parts that are words of one service are not a combo ('Corte infantil' beside 'Barba' is booked)", async () => {
    db.services.push(service("s-corte-inf", "Corte infantil", 25, 3500)); db.pros[0].services.push("s-corte-inf");
    const c = fresh();
    await turn(c, { customer_name: "Kevin", service_names: ["corte infantil", "barba"], professional_name: "Caio", temporal_evidence: at10 }, "Marca corte infantil e barba pro Kevin amanhã às 10 com o Caio");
    expect(c.proposal!.snapshot).toMatchObject({ services: [{ service_ref: "s-corte-inf" }, { service_ref: "s-barba" }] }); noWrite();
  });
});

describe("C4 owner rule 9: the catalog decides a combo, whatever form Luna chose for the owner's words", () => {
  // A spa (combo named with "com"), a barbearia (three-service combo named with "+") and a studio de coloração (combo with "e").
  const bambu = { salonId: "spa-bambu", userId: "dona-bambu" }, trilho = { salonId: "barbearia-trilho", userId: "recepcao-trilho" }, prisma = { salonId: "studio-prisma", userId: "dona-prisma" };
  beforeEach(() => {
    db.services.push(service("b-massagem", "Massagem relaxante", 60, 12000, bambu.salonId), service("b-esfoliacao", "Esfoliação corporal", 40, 9000, bambu.salonId),
      service("b-combo", "Massagem com esfoliação", 90, 18000, bambu.salonId), service("b-drenagem", "Drenagem", 50, 10000, bambu.salonId),
      service("t-corte", "Corte social", 30, 4000, trilho.salonId), service("t-barba", "Barba", 20, 3000, trilho.salonId), service("t-sobrancelha", "Sobrancelha", 15, 1500, trilho.salonId),
      service("t-trio", "Corte + Barba + Sobrancelha", 60, 7500, trilho.salonId),
      service("x-coloracao", "Coloração", 90, 15000, prisma.salonId), service("x-matizacao", "Matização", 40, 7000, prisma.salonId), service("x-combo", "Coloração e matização", 120, 20000, prisma.salonId),
      service("x-tesoura", "Corte na tesoura", 45, 6000, prisma.salonId), service("x-navalha", "Sobrancelha na navalha", 15, 2000, prisma.salonId));
    db.pros.push({ id: "p-soraia", name: "Soraia Pinheiro", salonId: bambu.salonId, services: ["b-massagem", "b-esfoliacao", "b-combo", "b-drenagem"], active: true },
      { id: "p-wagner", name: "Wagner Sampaio", salonId: trilho.salonId, services: ["t-corte", "t-barba", "t-sobrancelha", "t-trio"], active: true },
      { id: "p-ines", name: "Inês Vasconcelos", salonId: prisma.salonId, services: ["x-coloracao", "x-matizacao", "x-combo", "x-tesoura", "x-navalha"], active: true });
    db.customers.push({ id: "c-taina", name: "Tainá Couto", salonId: bambu.salonId }, { id: "c-enzo", name: "Enzo Takeda", salonId: trilho.salonId }, { id: "c-odete", name: "Odete Figueiredo", salonId: prisma.salonId });
  });
  const spa = (c: SchedulingState, fields: Record<string, unknown>) =>
    turn(c, { customer_name: "Tainá", professional_name: "Soraia", temporal_evidence: at10, ...fields }, "Marca massagem e esfoliação pra Tainá amanhã às 10 com a Soraia", bambu, c.operation);
  it("combo only: one service_name joining what the combo joins ('e' said, 'com' registered) is that combo, with no question", async () => {
    db.services.find(s => s.id === "b-esfoliacao")!.active = false;
    const c = fresh();
    await spa(c, { service_name: "massagem e esfoliação" });
    expect(c.candidates).toBeUndefined(); expect(c.fields).not.toHaveProperty("service_names");
    expect(c.proposal!.snapshot).toMatchObject({ service_ref: "b-combo", durationMin: 90, priceCents: 18000 }); expect(c.proposal!.snapshot!.services).toBeUndefined();
    expect(text(c.message)).toContain("Serviço: Massagem com esfoliação\n"); noWrite();
  });
  it("combo and services apart: one service_name, a one-item list and a two-item list all get the same card (never picked); each choice books what was chosen", async () => {
    const single = fresh(), one = fresh(), listed = fresh();
    await spa(single, { service_name: "massagem e esfoliação" });
    await spa(one, { service_names: ["massagem e esfoliação"] });
    await spa(listed, { service_names: ["massagem", "esfoliação"] });
    for (const c of [single, one, listed]) {
      expect(c.proposal).toBeUndefined();
      expect(c.candidates).toEqual({ kind: "service_combo_ref", items: [{ id: "b-combo", name: "Massagem com esfoliação" }, { id: SEPARATE_SERVICES_REF, name: "Separados: massagem + esfoliação" }] });
      expect(c.message).toBe("No catálogo, “Massagem com esfoliação” já junta massagem e esfoliação. Marco esse serviço ou os serviços separados? Selecione uma opção real.");
    }
    await selectScheduling(bambu, single, SEPARATE_SERVICES_REF, { clicked: true });
    expect(single.proposal!.snapshot).toMatchObject({ services: [{ service_ref: "b-massagem" }, { service_ref: "b-esfoliacao" }], durationMin: 100 });
    await selectScheduling(bambu, one, "b-combo", { clicked: true });
    expect(one.proposal!.snapshot).toMatchObject({ service_ref: "b-combo", durationMin: 90 }); expect(one.proposal!.snapshot!.services).toBeUndefined();
    noWrite();
  });
  it("an availability read asks the same question: never a silent read of the combo or of the parts", async () => {
    const c = fresh("availability.get");
    await turn(c, { service_name: "massagem e esfoliação", professional_name: "Soraia", temporal_evidence: [at10[0]] }, "Tem horário amanhã pra massagem e esfoliação com a Soraia?", bambu, "availability.get");
    expect(c.candidates?.kind).toBe("service_combo_ref"); expect(c.message).not.toContain("Horários livres"); noWrite();
  });
  it("a three-service combo named with '+' (the owner's commas and 'e'): asked while every part exists apart; the combo alone once a part does not", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Enzo", service_name: "corte, barba e sobrancelha", professional_name: "Wagner", temporal_evidence: at10 }, "Põe o Enzo amanhã às 10 com o Wagner pra corte, barba e sobrancelha", trilho);
    expect(c.proposal).toBeUndefined();
    expect(c.candidates).toEqual({ kind: "service_combo_ref", items: [{ id: "t-trio", name: "Corte + Barba + Sobrancelha" }, { id: SEPARATE_SERVICES_REF, name: "Separados: corte + barba + sobrancelha" }] });
    db.services.find(s => s.id === "t-sobrancelha")!.active = false;
    const d = fresh();
    await turn(d, { customer_name: "Enzo", service_name: "corte, barba e sobrancelha", professional_name: "Wagner", temporal_evidence: at10 }, "Põe o Enzo amanhã às 10 com o Wagner pra corte, barba e sobrancelha", trilho);
    expect(d.candidates).toBeUndefined(); expect(d.proposal!.snapshot).toMatchObject({ service_ref: "t-trio", durationMin: 60 }); noWrite();
  });
  it("accents: the owner's unaccented 'coloracao e matizacao' is asked between the combo (named with 'e') and the services apart", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Odete", service_name: "coloracao e matizacao", professional_name: "Inês", temporal_evidence: [{ field: "date", text: "amanha", component: TOMORROW }, { field: "time", text: "as 10", component: clock(10) }] },
      "marca a odete amanha as 10 coloracao e matizacao com a ines", prisma);
    expect(c.proposal).toBeUndefined();
    expect(c.candidates).toEqual({ kind: "service_combo_ref", items: [{ id: "x-combo", name: "Coloração e matização" }, { id: SEPARATE_SERVICES_REF, name: "Separados: coloracao + matizacao" }] }); noWrite();
  });
  it("no catalog service joins every part ('corte com navalha'): the single-service path, never two services booked by the backend's split", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Odete", service_name: "corte com navalha", professional_name: "Inês", temporal_evidence: at10 }, "Marca a Odete amanhã às 10 corte com navalha com a Inês", prisma);
    expect(c.proposal).toBeUndefined(); expect(c.fields).not.toHaveProperty("service_names"); expect(c.candidates?.kind).not.toBe("service_combo_ref");
    expect(c.message).toContain("Não encontrei esse serviço neste salão."); noWrite();
  });
  it("tenant isolation: another salon's combo never joins this salon's words", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Kevin", service_name: "corte, barba e sobrancelha", professional_name: "Caio", temporal_evidence: at10 }, "Marca corte, barba e sobrancelha pro Kevin amanhã às 10 com o Caio");
    expect(c.fields).not.toHaveProperty("service_names"); expect(c.candidates?.kind).not.toBe("service_combo_ref");
    expect(JSON.stringify(c)).not.toContain("t-trio"); noWrite();
  });
  it("the combo chosen, restated later in the owner's own words, is kept (never asked again); a card open is answered, never re-read as a list", async () => {
    const c = fresh();
    await spa(c, { service_name: "massagem e esfoliação" });
    await selectScheduling(bambu, c, "b-combo", { clicked: true });
    await turn(c, { service_name: "massagem e esfoliação", temporal_evidence: [{ field: "time", text: "às 11", component: clock(11) }] }, "a massagem e esfoliação da Tainá fica às 11 então", bambu);
    expect(c.candidates).toBeUndefined(); expect(c.proposal!.snapshot).toMatchObject({ service_ref: "b-combo", startLocal: "2026-09-30T11:00" });
    const d = fresh();
    await spa(d, { service_name: "massagem" });
    expect(d.candidates?.kind).toBe("service_ref");
    await turn(d, { service_name: "Massagem com esfoliação" }, "massagem com esfoliação", bambu);
    expect(d.candidates?.kind).not.toBe("service_combo_ref"); expect(d.proposal!.snapshot).toMatchObject({ service_ref: "b-combo" }); noWrite();
  });
  it("words the message does not hold are never split (a model's rewording keeps today's path)", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Tainá", service_name: "massagem e esfoliação", professional_name: "Soraia", temporal_evidence: at10 }, "Marca o pacote pra Tainá amanhã às 10 com a Soraia", bambu);
    expect(c.fields).not.toHaveProperty("service_names"); expect(c.candidates?.kind).not.toBe("service_combo_ref"); noWrite();
  });
  it("the combo's registered name Luna wrote for the owner's words (C7 directory proof): read by the owner's words for each part; the owner naming the combo itself keeps it", async () => {
    vi.stubEnv("SALON_SECRETARY_NAME_SUGGESTIONS", "true");
    db.services.find(s => s.id === "b-combo")!.name = "Kit massagem com esfoliação";
    const c = fresh();
    await spa(c, { service_name: "Kit massagem com esfoliação" });
    expect(c.proposal).toBeUndefined();
    expect(c.candidates).toEqual({ kind: "service_combo_ref", items: [{ id: "b-combo", name: "Kit massagem com esfoliação" }, { id: SEPARATE_SERVICES_REF, name: "Separados: massagem + esfoliacao" }] });
    const d = fresh();
    await turn(d, { customer_name: "Tainá", service_name: "Kit massagem com esfoliação", professional_name: "Soraia", temporal_evidence: at10 }, "Marca o kit pra Tainá amanhã às 10 com a Soraia", bambu);
    expect(d.candidates).toBeUndefined(); expect(d.proposal!.snapshot).toMatchObject({ service_ref: "b-combo" }); noWrite();
  });
  it("flag off: the single form is today's path (no list, no combo card)", async () => {
    vi.stubEnv("SALON_SECRETARY_MULTI_SERVICE", "false");
    const c = fresh();
    await spa(c, { service_name: "massagem e esfoliação" });
    expect(c.fields).not.toHaveProperty("service_names"); expect(c.candidates?.kind).not.toBe("service_combo_ref"); noWrite();
  });
});
