import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** C5 (flag SALON_SECRETARY_COMBO_GUARD; owner rules 9 and 11 of 29-30/09) through the real alteration adapter, draft journal and change
 * snapshot, with the fake tenant transaction of secretary-fx6-alter-combo.test.ts: a combo added to an appointment that holds one of its
 * parts replaces that part (never "Corte + Corte e barba"); with the combo and the part apart both registered the owner chooses on a
 * card; a combo part neither held nor said is used only after the owner click; a list never holds a combo beside its own part. A
 * barbearia and a salão; diverse synthetic names (no gender inferred from a name). No DB, no network, no model; no confirmation. */
type Service = { id: string; name: string; salonId: string; durationMin: number; priceCents: number; active: boolean };
type Pro = { id: string; name: string; salonId: string; services: string[]; active: boolean };
type Booked = { id: string; name: string; durationMin: number; priceCents: number };
type Appt = { id: string; salonId: string; customer_ref: string; professional_ref: string; services: Booked[]; start_local: string; status: string; version: number };
const db = vi.hoisted(() => ({ tx: undefined as unknown, rows: [] as Record<string, unknown>[], pros: [] as Pro[], services: [] as Service[], appointments: [] as Appt[],
  customers: [] as { id: string; name: string; salonId: string }[], accounts: [] as string[], role: "RECEPTIONIST", executed: [] as Record<string, unknown>[], locked: [] as unknown[] }));
const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const utc = (local: string) => new Date(Date.parse(`${local}:00Z`) + 3 * 3600_000);
const local = (at: Date) => new Date(at.getTime() - 3 * 3600_000).toISOString().slice(0, 16);
const minutes = (services: readonly { durationMin: number }[]) => services.reduce((sum, s) => sum + s.durationMin, 0);
const end = (a: Appt) => local(new Date(utc(a.start_local).getTime() + minutes(a.services) * 60_000));
const snapshot = (s: Booked) => ({ id: s.id, name: s.name, durationMin: s.durationMin, priceCents: s.priceCents, priceType: "FIXED", priceNote: null, processingMin: 0, finishingMin: 0 });
const domainError = (code: string) => Object.assign(new Error(code), { code, name: "AppointmentError" });
const dto = (a: Appt) => ({ appointment_ref: a.id, customer_ref: a.customer_ref, customer_name: db.customers.find(row => row.id === a.customer_ref)!.name,
  professional_ref: a.professional_ref, professional_name: db.pros.find(row => row.id === a.professional_ref)!.name, service_ref: a.services[0].id,
  services: a.services.map(s => ({ serviceName: s.name, durationMin: s.durationMin, priceCents: s.priceCents, priceType: "FIXED" })),
  start_at: utc(a.start_local).toISOString(), end_at: utc(end(a)).toISOString(), start_local: a.start_local, end_local: end(a), status: a.status, revision: a.version, timezone: "America/Sao_Paulo",
  priceCents: a.services.reduce((sum, s) => sum + s.priceCents, 0) });
/** The domain's availability: salon hours 09–19, one attendance at a time per professional (the appointment itself excluded). */
function inspect(salonId: string, professionalId: string, services: readonly Booked[], startLocal: string, exclude?: string) {
  const startAt = utc(startLocal), endAt = new Date(startAt.getTime() + minutes(services) * 60_000), clock = startLocal.slice(11), last = local(endAt).slice(11);
  const busy = db.appointments.some(a => a.salonId === salonId && a.id !== exclude && a.professional_ref === professionalId && ["PENDING", "CONFIRMED"].includes(a.status) &&
    utc(a.start_local) < endAt && utc(end(a)) > startAt);
  const violation = clock < "09:00" || last > "19:00" || local(endAt).slice(0, 10) !== startLocal.slice(0, 10) ? "OUTSIDE_WORKING_HOURS" : busy ? "SLOT_TAKEN" : null;
  return { violation, startAt, endAt, timezone: "America/Sao_Paulo", services: services.map(snapshot), conflicts: [] };
}
vi.mock("../prisma-tenant", () => ({ withTenant: (_actor: unknown, fn: (tx: unknown) => unknown) => fn(db.tx) }));
vi.mock("../customer-catalog", async original => ({ ...await original<object>(), assertCustomerAccess: async () => undefined, getCustomer: async () => undefined,
  searchSalonCustomer: async (_tx: unknown, actor: { salonId: string }, query: string) => db.customers.filter(row => row.salonId === actor.salonId && fold(row.name).includes(fold(query.trim()))).map(({ id, name }) => ({ id, name, phone: null })) }));
vi.mock("../scheduling-catalog", async original => ({ ...await original<object>(), schedulingTimezone: async () => "America/Sao_Paulo", assertSchedulingAccess: async () => undefined,
  listSchedulingServices: async (_tx: unknown, actor: { salonId: string }, query: string) => db.services.filter(row => row.salonId === actor.salonId && row.active && fold(row.name).includes(fold(query.trim())))
    .map(({ id, name, durationMin, priceCents }) => ({ id, name, durationMin, priceCents, priceType: "FIXED" })),
  listSchedulingProfessionals: async (_tx: unknown, actor: { salonId: string }, input: { service_ref?: string; service_refs?: string[]; query?: string }) => db.pros.filter(row => row.salonId === actor.salonId && row.active &&
    (!input.service_ref || row.services.includes(input.service_ref)) && (input.service_refs ?? []).every(id => row.services.includes(id)) && (!input.query || fold(row.name).includes(fold(input.query))))
    .map(({ id, name }) => ({ id, name })),
  getSchedulingAppointment: async (_tx: unknown, actor: { salonId: string }, ref: string) => { const a = db.appointments.find(row => row.id === ref && row.salonId === actor.salonId); if (!a) throw Error("APPOINTMENT_NOT_FOUND"); return dto(a); },
  listUpcomingCustomerAppointments: async (_tx: unknown, actor: { salonId: string }, customer: string, options: { overlapping?: { start: Date; end: Date } } = {}) => db.appointments.filter(a => a.salonId === actor.salonId &&
    a.customer_ref === customer && ["PENDING", "CONFIRMED"].includes(a.status) && (!options.overlapping || utc(a.start_local) < options.overlapping.end && utc(end(a)) > options.overlapping.start)).map(dto),
  listSchedulingAppointments: async (_tx: unknown, actor: { salonId: string }, input: { date: string; customer_ref?: string }) => db.appointments.filter(a => a.salonId === actor.salonId &&
    a.start_local.startsWith(input.date) && (!input.customer_ref || a.customer_ref === input.customer_ref)).map(dto),
}));
vi.mock("../appointment-service", async original => ({ ...await original<object>(),
  lockAppointmentOperationalScope: async (_tx: unknown, input: unknown) => { db.locked.push(input); },
  inspectAppointmentAvailability: async (_tx: unknown, input: { salonId: string; professionalId: string; serviceIds: string[]; startLocal: string; excludeAppointmentId?: string }) => {
    const services = input.serviceIds.map(id => db.services.find(row => row.id === id && row.salonId === input.salonId && row.active));
    if (services.some(s => !s)) throw domainError("SERVICE_INVALID");
    const pro = db.pros.find(row => row.id === input.professionalId && row.salonId === input.salonId && row.active);
    if (!pro || !input.serviceIds.every(id => pro.services.includes(id))) throw domainError("PRO_SERVICE_MISMATCH");
    return inspect(input.salonId, input.professionalId, services as Booked[], input.startLocal, input.excludeAppointmentId);
  },
  inspectAppointmentAvailabilityWithServiceSnapshots: async (_tx: unknown, input: { salonId: string; professionalId: string; currentProfessionalId: string; serviceSnapshots: Booked[]; startLocal: string; excludeAppointmentId?: string }) => {
    const pro = db.pros.find(row => row.id === input.professionalId && row.salonId === input.salonId && row.active);
    if (!pro || input.professionalId !== input.currentProfessionalId && !input.serviceSnapshots.every(s => pro.services.includes(s.id))) throw domainError("PRO_SERVICE_MISMATCH");
    return inspect(input.salonId, input.professionalId, input.serviceSnapshots, input.startLocal, input.excludeAppointmentId);
  },
}));
vi.mock("../reschedule-proposals", async original => ({ ...await original<object>(),
  requestStaffReschedule: async (_tx: unknown, input: { salonId: string; appointmentId: string; professionalId: string; serviceIds: string[]; startLocal: string; expectedVersion?: number; idempotencyKey: string }) => {
    const a = db.appointments.find(row => row.id === input.appointmentId && row.salonId === input.salonId)!;
    if (input.expectedVersion !== a.version) throw domainError("VERSION_CONFLICT");
    db.executed.push(structuredClone(input));
    const same = a.professional_ref === input.professionalId && a.start_local === input.startLocal && JSON.stringify(a.services.map(s => s.id)) === JSON.stringify(input.serviceIds);
    const services = JSON.stringify(a.services.map(s => s.id)) === JSON.stringify(input.serviceIds) ? a.services : input.serviceIds.map(id => db.services.find(row => row.id === id)!);
    Object.assign(a, { professional_ref: input.professionalId, start_local: input.startLocal, services, version: a.version + 1 });
    return db.accounts.includes(a.customer_ref) && !same ? { requiresAcceptance: true, proposalId: "rp-1" } : { requiresAcceptance: false };
  },
}));
import { applySchedulingInterpretation, schedulingState, selectScheduling, type SchedulingState } from "../secretary-scheduling";

const pezinho = { salonId: "barbearia-pezinho", userId: "recepcao-pezinho" }, lotus = { salonId: "esmalteria-lotus", userId: "dona-lotus" };
type Actor = typeof pezinho;
const fresh = (): SchedulingState => ({ ...schedulingState(), operation: "appointment.change" });
const turn = (state: SchedulingState, fields: Record<string, unknown>, message: string, actor: Actor = pezinho, operation = "appointment.change") =>
  applySchedulingInterpretation(actor, state, { operation, ...fields } as never, message);
const service = (id: string, name: string, durationMin: number, priceCents: number, salonId = pezinho.salonId, active = true): Service => ({ id, name, salonId, durationMin, priceCents, active });
const booked = (id: string, priceCents: number) => { const s = db.services.find(row => row.id === id)!; return { id, name: s.name, durationMin: s.durationMin, priceCents }; };
const appt = (id: string, customer_ref: string, professional_ref: string, start_local: string, services: Booked[], version = 3): Appt =>
  ({ id, salonId: pezinho.salonId, customer_ref, professional_ref, services, start_local, status: "CONFIRMED", version });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-29T15:00:00Z")); // Tuesday, 12h in São Paulo
  vi.stubEnv("SALON_SECRETARY_ALTER_APPOINTMENT", "true"); vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", "true");
  db.rows = []; db.executed = []; db.locked = []; db.accounts = ["c-otavio"]; db.role = "RECEPTIONIST";
  db.services = [service("s-corte", "Corte", 30, 4500), service("s-corte-inf", "Corte infantil", 25, 3500), service("s-barba", "Barba", 20, 3000),
    service("s-pezinho", "Pezinho", 15, 1200), service("s-sobrancelha", "Sobrancelha", 15, 1500), service("s-esmalte", "Esmaltação em gel", 60, 8000, lotus.salonId)];
  db.pros = [{ id: "p-jonas", name: "Jonas Ferraz", salonId: pezinho.salonId, services: ["s-corte", "s-corte-inf", "s-barba", "s-pezinho"], active: true },
    { id: "p-yasmin", name: "Yasmin Toledo", salonId: pezinho.salonId, services: ["s-corte", "s-pezinho", "s-sobrancelha"], active: true },
    { id: "p-caua", name: "Cauã Ribeiro", salonId: pezinho.salonId, services: ["s-barba"], active: true },
    { id: "p-anapaula", name: "Ana Paula Dias", salonId: pezinho.salonId, services: ["s-corte"], active: true },
    { id: "p-anabia", name: "Ana Beatriz Luz", salonId: pezinho.salonId, services: ["s-corte"], active: true },
    { id: "p-rita", name: "Rita Gomes", salonId: pezinho.salonId, services: ["s-corte"], active: false },
    { id: "p-marina", name: "Marina Duarte", salonId: lotus.salonId, services: ["s-esmalte"], active: true }];
  db.customers = [{ id: "c-luana", name: "Luana Prado", salonId: pezinho.salonId }, { id: "c-otavio", name: "Otávio Mendes", salonId: pezinho.salonId },
    { id: "c-bruna", name: "Bruna Siqueira", salonId: pezinho.salonId }, { id: "c-kauan", name: "Kauan Reis", salonId: pezinho.salonId }, { id: "c-luana-l", name: "Luana Prado", salonId: lotus.salonId }];
  // The booked price of a Corte was R$ 40 (the catalog says R$ 45 now): kept unless the services change.
  db.appointments = [appt("a-luana", "c-luana", "p-jonas", "2026-10-01T14:00", [booked("s-corte", 4000)]),
    appt("a-otavio", "c-otavio", "p-jonas", "2026-10-01T16:00", [booked("s-corte", 4000), booked("s-barba", 3000)], 5)];
  const find = (where: Record<string, unknown>) => db.rows.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
  const appointmentRow = (where: { id: string; salonId: string }) => {
    const a = db.appointments.find(row => row.id === where.id && row.salonId === where.salonId);
    return a ? { professionalId: a.professional_ref, dependentId: null, products: [], client: { name: db.customers.find(c => c.id === a.customer_ref)!.name },
      professional: { user: { name: db.pros.find(p => p.id === a.professional_ref)!.name } }, service: { ...snapshot(a.services[0]) },
      serviceItems: a.services.map(s => ({ serviceId: s.id, serviceName: s.name, durationMin: s.durationMin, priceCents: s.priceCents, priceType: "FIXED", priceNote: null, processingMin: 0, finishingMin: 0 })) } : null;
  };
  db.tx = { $executeRaw: vi.fn(async () => 0), $queryRaw: vi.fn(async (_strings: unknown, ...values: unknown[]) => [{ has_account: db.accounts.includes(values[0] as string) }]),
    membership: { findFirstOrThrow: async () => ({ role: db.role }) },
    salon: { findUniqueOrThrow: async () => ({ timezone: "America/Sao_Paulo" }) },
    resourceBooking: { findMany: async () => [] }, waitlistEntry: { findMany: async () => [] },
    professional: { findFirst: async ({ where }: { where: { id: string; salonId: string; active?: boolean } }) => { const p = db.pros.find(row => row.id === where.id && row.salonId === where.salonId && (where.active === undefined || row.active === where.active)); return p ? { id: p.id, user: { name: p.name } } : null; },
      findMany: async ({ where }: { where: { salonId: string } }) => db.pros.filter(row => row.salonId === where.salonId && row.active).map(p => ({ id: p.id, user: { name: p.name } })) },
    service: { findFirst: async ({ where }: { where: { id: string; salonId: string } }) => db.services.find(row => row.id === where.id && row.salonId === where.salonId && row.active) ?? null,
      findMany: async ({ where }: { where: { salonId: string; id?: { in: string[] } } }) => db.services.filter(row => row.salonId === where.salonId && row.active && (!where.id || where.id.in.includes(row.id))).map(s => ({ id: s.id, name: s.name })) },
    appointment: {
      findMany: async ({ where }: { where: { salonId: string; clientId?: string; professionalId?: string; status: { in: string[] }; startAt: { gt: Date } } }) =>
        db.appointments.filter(a => a.salonId === where.salonId && (!where.clientId || a.customer_ref === where.clientId) && (!where.professionalId || a.professional_ref === where.professionalId) &&
          where.status.in.includes(a.status) && utc(a.start_local) > where.startAt.gt).map(a => ({ id: a.id })),
      findFirst: async ({ where }: { where: { id: string; salonId: string } }) => appointmentRow(where),
      findFirstOrThrow: async ({ where }: { where: { id: string; salonId: string } }) => { const row = appointmentRow(where); if (!row) throw Error("NOT_FOUND"); return row; } },
    auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { db.rows.push(structuredClone(data)); return data; }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => find(where)), findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => find(where)[0] ?? null) } } as unknown as Tx;
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const unconfirmed = () => expect(db.rows.filter(row => row.action === "CONFIRMED")).toEqual([]);
const noWrite = () => { unconfirmed(); expect(db.executed).toEqual([]); };
describe("C5 combo guard (owner rules 9 and 11): a combo added to an appointment", () => {
  const norte = { salonId: "barbearia-navalha-norte", userId: "dono-navalha" };
  const at = (id: string, customer_ref: string, start_local: string, services: string[]): Appt => ({ id, salonId: norte.salonId, customer_ref, professional_ref: "p-icaro", start_local, status: "CONFIRMED", version: 2,
    services: services.map(sid => { const s = db.services.find(row => row.id === sid)!; return { id: sid, name: s.name, durationMin: s.durationMin, priceCents: s.priceCents }; }) });
  beforeEach(() => {
    vi.stubEnv("SALON_SECRETARY_MULTI_SERVICE", "true"); vi.stubEnv("SALON_SECRETARY_COMBO_GUARD", "true");
    db.services.push(service("n-corte", "Corte", 30, 4500, norte.salonId), service("n-barba", "Barba", 30, 3500, norte.salonId), service("n-combo", "Corte e barba", 60, 7000, norte.salonId),
      service("n-pezinho", "Pezinho", 15, 1500, norte.salonId), service("n-hid", "Hidratação capilar", 40, 5000, norte.salonId), service("n-degrade", "Corte degradê", 40, 5500, norte.salonId));
    db.pros.push({ id: "p-icaro", name: "Ícaro Bastos", salonId: norte.salonId, services: ["n-corte", "n-barba", "n-combo", "n-pezinho", "n-hid", "n-degrade"], active: true },
      { id: "p-noe", name: "Noé Carvalho", salonId: norte.salonId, services: ["n-corte", "n-pezinho"], active: true });
    db.customers.push({ id: "c-wendel", name: "Wendel Sá", salonId: norte.salonId }, { id: "c-teodoro", name: "Teodoro Brandão", salonId: norte.salonId },
      { id: "c-livia", name: "Lívia Arantes", salonId: norte.salonId }, { id: "c-heitor", name: "Heitor Paiva", salonId: norte.salonId },
      { id: "c-duda", name: "Duda Moraes", salonId: norte.salonId }, { id: "c-joaquim", name: "Joaquim Leal", salonId: norte.salonId });
    db.appointments.push(at("a-wendel", "c-wendel", "2026-10-02T10:00", ["n-corte"]), at("a-teodoro", "c-teodoro", "2026-10-02T11:30", ["n-corte"]),
      at("a-livia", "c-livia", "2026-10-03T15:00", ["n-hid"]), at("a-heitor", "c-heitor", "2026-10-02T13:00", ["n-corte", "n-pezinho"]),
      at("a-duda", "c-duda", "2026-10-02T16:30", ["n-combo"]), at("a-joaquim", "c-joaquim", "2026-10-02T09:00", ["n-degrade"]));
  });
  const onlyCombo = () => { db.services = db.services.filter(row => row.id !== "n-barba"); };
  const include = (c: SchedulingState, who: string, message: string) => turn(c, { customer_name: who, service_changes: [{ mode: "INCLUDE", service_name: "barba" }] }, message, norte);
  const services = (c: SchedulingState) => c.proposal!.action_snapshot!.services!.map(s => s.id);

  it("combo and the part apart both registered: a card that says which is which; the combo replaces the Corte (10h–11h, R$ 70)", async () => {
    const c = fresh();
    await include(c, "Wendel", "adiciona barba no horário do wendel");
    expect(c.proposal).toBeUndefined();
    expect(c.candidates).toEqual({ kind: "service_changes_ref", items: [{ id: "n-barba", name: "Barba" }, { id: "n-combo", name: "Corte e barba" }] });
    expect(c.message).toContain("“Corte e barba” junta Corte e barba, e “Barba” também existe separado. Selecione “Corte e barba” para trocar Corte por ele");
    await selectScheduling(norte, c, "n-combo");
    expect(services(c)).toEqual(["n-combo"]);
    expect(c.proposal!.action_snapshot).toMatchObject({ startLocal: "2026-10-02T10:00", endLocal: "2026-10-02T11:00", priceCents: 7000 });
    expect(c.proposal!.preview).not.toContain("Corte e Corte e barba"); noWrite();
  });
  it("the part apart chosen: Corte + Barba in the same appointment (never a combo beside its part)", async () => {
    const c = fresh();
    await include(c, "Wendel", "adiciona barba no horário do wendel");
    await selectScheduling(norte, c, "n-barba");
    expect(services(c)).toEqual(["n-corte", "n-barba"]); noWrite();
  });
  it("only the combo registered (no Barba apart): used directly, replacing the Corte, without a question", async () => {
    onlyCombo();
    const c = fresh();
    await include(c, "Wendel", "adiciona barba no horário do wendel");
    expect(c.candidates).toBeUndefined();
    expect(services(c)).toEqual(["n-combo"]);
    expect(c.proposal!.action_snapshot).toMatchObject({ endLocal: "2026-10-02T11:00", priceCents: 7000 }); noWrite();
  });
  it("the replaced part keeps the other services and their order (Corte + Pezinho → Corte e barba + Pezinho)", async () => {
    onlyCombo();
    const c = fresh();
    await include(c, "Heitor", "coloca barba no heitor");
    expect(services(c)).toEqual(["n-combo", "n-pezinho"]); noWrite();
  });
  it("adversarial: a combo part neither held nor said (Hidratação + 'barba' → 'Corte e barba' holds a Corte) is asked, used only after the click", async () => {
    onlyCombo();
    const c = fresh();
    await include(c, "Lívia", "põe barba na lívia");
    expect(c.proposal).toBeUndefined();
    expect(c.candidates).toEqual({ kind: "service_changes_ref", items: [{ id: "n-combo", name: "Corte e barba" }] });
    expect(c.message).toContain("“Corte e barba” inclui também Corte, que o agendamento de Lívia Arantes não tem e que você não citou. Nada foi alterado.");
    await selectScheduling(norte, c, "n-combo");
    expect(services(c)).toEqual(["n-hid", "n-combo"]); noWrite();
  });
  it("adversarial: a similar but different part (Corte degradê) is never replaced silently nor kept beside the combo", async () => {
    onlyCombo();
    const c = fresh();
    await include(c, "Joaquim", "adiciona barba no joaquim");
    expect(c.proposal).toBeUndefined(); expect(c.candidates?.items).toEqual([{ id: "n-combo", name: "Corte e barba" }]);
    await selectScheduling(norte, c, "n-combo");
    expect(c.proposal).toBeUndefined();
    expect(c.message).toContain("“Corte e barba” já inclui Corte degradê; o mesmo serviço não entra duas vezes no agendamento de Joaquim Leal. Nada foi alterado."); noWrite();
  });
  it("invariant: the part added beside a combo the appointment already holds is refused (asked), never proposed", async () => {
    const c = fresh();
    await include(c, "Duda", "adiciona barba na duda");
    expect(c.candidates?.items.map(item => item.id)).toEqual(["n-barba", "n-combo"]);
    await selectScheduling(norte, c, "n-barba");
    expect(c.proposal).toBeUndefined(); expect(c.message).toContain("“Corte e barba” já inclui Barba"); noWrite();
  });
  it("flag off: the historical behaviour stays byte-identical (the combo is added beside the Corte)", async () => {
    vi.stubEnv("SALON_SECRETARY_COMBO_GUARD", "false");
    onlyCombo();
    const c = fresh();
    await include(c, "Wendel", "adiciona barba no horário do wendel");
    expect(services(c)).toEqual(["n-corte", "n-combo"]); noWrite();
    const d = fresh();
    db.services.push(service("n-barba", "Barba", 30, 3500, norte.salonId));
    await include(d, "Wendel", "adiciona barba no horário do wendel");
    expect(d.message).toBe("Qual serviço você quis dizer com “barba”? Selecione uma opção real."); noWrite();
  });
});
