import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** FX6 (review, owner rule 9; flags SALON_SECRETARY_ALTER_APPOINTMENT + SALON_SECRETARY_MULTI_SERVICE) through the real alteration adapter,
 * draft journal and change snapshot, with a fake tenant transaction (the same harness as secretary-alter-appointment-adapter.test.ts):
 * case 4 — the part left of a combo is a service holding every word of it as a WHOLE word ("pé" is never "Depilação perna inteira"):
 *          none registered is explained and asked, never a substring pick; case 3 — a combo's registered name Luna wrote for the owner's
 *          words is read back as those words (the combo and the services apart are a card); a label word ("Combo") is never an unsaid part.
 * An esmalteria "Lua" and a barbearia. No DB, no network, no model; no confirmation. */
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
import { applySchedulingInterpretation, schedulingState, type SchedulingState } from "../secretary-scheduling";

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
      findMany: async ({ where }: { where: { salonId: string } }) => db.services.filter(row => row.salonId === where.salonId && row.active).map(s => ({ name: s.name })) },
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

describe("rule 9 in a change: the part left of a combo, and the combo's name Luna wrote", () => {
  const lua = { salonId: "esmalteria-lua", userId: "recepcao-lua" };
  const booking = (services: Booked[]): Appt => ({ id: "a-irene", salonId: lua.salonId, customer_ref: "c-irene", professional_ref: "p-odete", services, start_local: "2026-10-02T15:00", status: "CONFIRMED", version: 2 });
  beforeEach(() => {
    vi.stubEnv("SALON_SECRETARY_MULTI_SERVICE", "true");
    // Combo "Pé e mão"; "Mão" registered apart; NO plain "Pé"; a service whose folded name holds "pe" only inside a word ("Depilação").
    db.services.push(service("l-combo", "Pé e mão", 90, 7000, lua.salonId), service("l-mao", "Mão", 40, 3500, lua.salonId), service("l-depil", "Depilação perna inteira", 50, 9000, lua.salonId),
      service("l-hid", "Hidratação", 40, 5000, lua.salonId), service("l-esc", "Escova", 40, 4000, lua.salonId), service("l-che", "Combo hidratação e escova", 80, 8000, lua.salonId));
    db.pros.push({ id: "p-odete", name: "Odete Lins", salonId: lua.salonId, services: ["l-combo", "l-mao", "l-depil", "l-hid", "l-esc", "l-che"], active: true });
    db.customers.push({ id: "c-irene", name: "Irene Vasconcelos", salonId: lua.salonId });
    db.appointments.push(booking([booked("l-combo", 7000)]));
  });
  const remove = (c: SchedulingState) => turn(c, { customer_name: "Irene", service_changes: [{ mode: "REMOVE", service_name: "mão" }] }, "a Irene não vai fazer a mão, tira a mão dela", lua);
  it("case 4: the part left ('Pé') is not registered apart: explained and asked; a service holding 'pe' only inside a word is never proposed", async () => {
    const c = fresh();
    await remove(c);
    expect(c.proposal).toBeUndefined(); expect(c.candidates).toBeUndefined();
    expect(c.message).toContain("fica Pé, que não está cadastrado como serviço separado neste salão. Nada foi alterado.");
    expect(JSON.stringify(c)).not.toContain("l-depil"); noWrite();
  });
  it("SET ('só o pé') is the same rule: explained and asked, never the substring match", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Irene", service_changes: [{ mode: "SET", service_name: "pé" }] }, "a Irene só vai fazer o pé", lua);
    expect(c.proposal).toBeUndefined(); expect(c.message).toContain("não está cadastrado como serviço separado"); expect(JSON.stringify(c)).not.toContain("l-depil"); noWrite();
  });
  it("control: 'Pé' registered apart is proposed (same slot and professional); two whole-word matches are a card, never a pick", async () => {
    db.services.push(service("l-pe", "Pé", 45, 3800, lua.salonId)); db.pros.find(p => p.id === "p-odete")!.services.push("l-pe");
    const c = fresh();
    await remove(c);
    expect(c.proposal!.action_snapshot!.services!.map(s => s.id)).toEqual(["l-pe"]); expect(c.proposal!.action_snapshot).toMatchObject({ startLocal: "2026-10-02T15:00" });
    db.services.push(service("l-pe-spa", "Pé spa", 60, 6000, lua.salonId)); db.pros.find(p => p.id === "p-odete")!.services.push("l-pe-spa");
    const d = fresh();
    await remove(d);
    expect(d.proposal).toBeUndefined(); expect(d.candidates).toEqual({ kind: "service_changes_ref", items: [{ id: "l-pe", name: "Pé" }, { id: "l-pe-spa", name: "Pé spa" }] }); noWrite();
  });
  it("adversarial: a plural or another word form is not the part ('Spa dos pés' is not 'Pé'): explained and asked", async () => {
    db.services.push(service("l-spa", "Spa dos pés", 60, 6000, lua.salonId)); db.pros.find(p => p.id === "p-odete")!.services.push("l-spa");
    const c = fresh();
    await remove(c);
    expect(c.proposal).toBeUndefined(); expect(c.message).toContain("não está cadastrado como serviço separado"); noWrite();
  });
  it("case 3: the combo's registered name Luna wrote for the owner's 'hidratação e escova' (C7 proof) is a card while the parts exist apart", async () => {
    vi.stubEnv("SALON_SECRETARY_NAME_SUGGESTIONS", "true");
    const c = fresh();
    await turn(c, { customer_name: "Irene", service_changes: [{ mode: "SET", service_name: "Combo hidratação e escova" }] }, "troca o serviço da Irene pra hidratação e escova", lua);
    expect(c.proposal).toBeUndefined(); expect(c.candidates).toEqual({ kind: "service_changes_ref", items: [{ id: "l-che", name: "Combo hidratação e escova" }] });
    expect(c.message).toContain("esses serviços também existem separados"); expect(c.message).not.toContain("inclui também"); noWrite();
  });
  it("the owner's own words: the same card, and the label word 'Combo' is never an unsaid part", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Irene", service_changes: [{ mode: "SET", service_name: "hidratação e escova" }] }, "troca o serviço da Irene pra hidratação e escova", lua);
    expect(c.candidates).toEqual({ kind: "service_changes_ref", items: [{ id: "l-che", name: "Combo hidratação e escova" }] });
    expect(c.message).not.toContain("inclui também"); noWrite();
  });
  it("the owner naming the combo itself ('pro combo'): Luna's registered name is kept and the combo is proposed", async () => {
    vi.stubEnv("SALON_SECRETARY_NAME_SUGGESTIONS", "true");
    const c = fresh();
    await turn(c, { customer_name: "Irene", service_changes: [{ mode: "SET", service_name: "Combo hidratação e escova" }] }, "troca o serviço da Irene pro combo", lua);
    expect(c.candidates).toBeUndefined(); expect(c.proposal!.action_snapshot!.services!.map(s => s.id)).toEqual(["l-che"]); noWrite();
  });
  it("flag off (MULTI_SERVICE): the historical card for 'mão', never a derived part", async () => {
    vi.stubEnv("SALON_SECRETARY_MULTI_SERVICE", "false");
    const c = fresh();
    await remove(c);
    expect(c.candidates).toEqual({ kind: "service_changes_ref", items: [{ id: "l-combo", name: "Pé e mão" }, { id: "l-mao", name: "Mão" }] }); noWrite();
  });
});
