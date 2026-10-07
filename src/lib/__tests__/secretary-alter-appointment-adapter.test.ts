import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";

/** P2a (flag SALON_SECRETARY_ALTER_APPOINTMENT) through the real scheduling adapter, draft journal, change snapshot, preview
 * and confirmation executor, with a fake tenant transaction: the domain's availability inspection and requestStaffReschedule
 * are fakes that follow the domain's rules (active, same salon, the professional performs every service; a busy professional
 * is SLOT_TAKEN). A barbershop ("pezinho"), and an esmalteria as the other tenant. No DB, no network, no model; the only
 * confirmations are the explicit confirmAppointmentCreate calls of the executor tests. */
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
import { confirmAppointmentCreate } from "../scheduling-actions";
import { withTenant } from "../prisma-tenant";
import { projectSchedulingOperation } from "../secretary-operation-projection";
import { validateSelectionV2, selectionTransportSchemaV2 } from "@everflair/salon-secretary";

const pezinho = { salonId: "barbearia-pezinho", userId: "recepcao-pezinho" }, lotus = { salonId: "esmalteria-lotus", userId: "dona-lotus" };
type Actor = typeof pezinho;
const fresh = (): SchedulingState => ({ ...schedulingState(), operation: "appointment.change" });
const turn = (state: SchedulingState, fields: Record<string, unknown>, message: string, actor: Actor = pezinho, operation = "appointment.change") =>
  applySchedulingInterpretation(actor, state, { operation, ...fields } as never, message);
const text = (value: string) => value.replace(/ /g, " ");
const confirm = (state: SchedulingState, actor: Actor = pezinho) => withTenant(actor, tx => confirmAppointmentCreate(tx as Tx, actor, { proposal_ref: state.proposal!.proposal_ref, draft_revision: state.proposal!.draft_revision }));
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

describe("E1: the NEW professional at the same slot", () => {
  it("'vai ser com a Yasmin em vez do Jonas, mesmo horário': TROCAR PROFISSIONAL, slot and booked price kept, then one confirmed execution (idempotent)", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Luana", professional_name: "Jonas", target_professional_name: "Yasmin" }, "Ixi, a Luana vai ser com a Yasmin em vez do Jonas, mesmo horário obg");
    expect(c.proposal).toBeDefined(); expect(c.fields).not.toHaveProperty("date"); expect(c.fields).not.toHaveProperty("time");
    const s = c.proposal!.action_snapshot!;
    expect(s).toMatchObject({ professional_ref: "p-yasmin", professional_name: "Yasmin Toledo", before_professional_ref: "p-jonas", startLocal: "2026-10-01T14:00", endLocal: "2026-10-01T14:30",
      priceCents: 4000, requires_acceptance: false, services: [expect.objectContaining({ id: "s-corte", priceCents: 4000 })] });
    expect(text(c.message)).toContain("TROCAR PROFISSIONAL\nLuana Prado\nANTES: Corte com Jonas Ferraz — qui, 01/10 às 14h–14h30\nDEPOIS: Corte com Yasmin Toledo — qui, 01/10 às 14h–14h30\nHorário mantido.\nPreço mantido: R$ 40,00");
    noWrite();
    const receipt = await confirm(c);
    expect(receipt).toMatchObject({ outcome: "RESCHEDULED", duplicate: false });
    expect(db.executed).toEqual([expect.objectContaining({ appointmentId: "a-luana", professionalId: "p-yasmin", serviceIds: ["s-corte"], startLocal: "2026-10-01T14:00", expectedVersion: 3, idempotencyKey: c.proposal!.proposal_ref })]);
    expect(db.locked).toEqual([expect.objectContaining({ appointmentId: "a-luana", targetProfessionalIds: ["p-yasmin"] })]);
    expect(await confirm(c)).toMatchObject({ duplicate: true }); expect(db.executed).toHaveLength(1);
  });
  it("a typed 'sim' never confirms; a flag switched off after the proposal never executes it", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Luana", target_professional_name: "Yasmin" }, "Passa a Luana pra Yasmin");
    await turn(c, {}, "sim");
    expect(c.proposal).toBeDefined(); noWrite();
    vi.stubEnv("SALON_SECRETARY_ALTER_APPOINTMENT", "false");
    await expect(confirm(c)).rejects.toThrow("ALTER_APPOINTMENT_DISABLED"); noWrite();
  });
  it("the target became busy between the proposal and Confirmar: nothing is written", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Luana", target_professional_name: "Yasmin" }, "Passa a Luana pra Yasmin, mesmo horário");
    expect(c.proposal).toBeDefined();
    db.appointments.push({ ...appt("a-bruna", "c-bruna", "p-yasmin", "2026-10-01T14:00", [booked("s-pezinho", 1200)]) });
    await expect(confirm(c)).rejects.toThrow(/SLOT_CONFLICT|SCHEDULE_CHANGED/); noWrite();
  });
  it("target + a new clock keeps the appointment's day; target + a new day asks the clock (GF14)", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Luana", target_professional_name: "Yasmin", temporal_evidence: [{ field: "time", text: "às 16h30", component: { hour: 16, minute: 30, daypart: "UNSPECIFIED" } }] },
      "Passa a Luana pra Yasmin às 16h30");
    expect(c.proposal!.action_snapshot).toMatchObject({ professional_ref: "p-yasmin", startLocal: "2026-10-01T16:30" });
    expect(text(c.message)).toContain("ALTERAR AGENDAMENTO"); expect(c.message).not.toContain("Horário mantido");
    const d = fresh();
    await turn(d, { customer_name: "Luana", target_professional_name: "Yasmin", temporal_evidence: [{ field: "date", text: "dia 2", component: { kind: "DAY_OF_MONTH", day: 2, month: null, weekday: null, week: null, offset: null, year: null, days: null } }] },
      "Passa a Luana pra Yasmin dia 2");
    expect(d.proposal).toBeUndefined(); expect(d.draft!.missing_fields).toContain("time"); noWrite();
  });
  it("an account customer's change of professional goes to their acceptance, and the preview says so", async () => {
    db.appointments.find(a => a.id === "a-otavio")!.services = [booked("s-corte", 4000)];
    const c = fresh();
    await turn(c, { customer_name: "Otávio", target_professional_name: "Yasmin" }, "O Otávio vai ser com a Yasmin");
    expect(c.proposal!.action_snapshot).toMatchObject({ requires_acceptance: true, startLocal: "2026-10-01T16:00" });
    expect(c.message).toContain("A alteração ficará aguardando o aceite do cliente.");
    expect(await confirm(c)).toMatchObject({ outcome: "PENDING_ACCEPTANCE", acceptance_ref: "rp-1" });
  });
});

describe("E1 adversarial: never a move to the wrong professional", () => {
  it("a target who does not perform the service: who does is offered (never picked); the click is checked again", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Luana", target_professional_name: "Cauã" }, "Passa a Luana pro Cauã");
    expect(c.proposal).toBeUndefined(); noWrite();
    expect(c.message).toBe("Cauã Ribeiro não faz Corte. Quem faz: Yasmin Toledo, Ana Paula Dias, Ana Beatriz Luz. Quem vai atender?");
    expect(c.candidates).toEqual({ kind: "target_professional_ref", items: [{ id: "p-yasmin", name: "Yasmin Toledo" }, { id: "p-anapaula", name: "Ana Paula Dias" }, { id: "p-anabia", name: "Ana Beatriz Luz" }] });
    await selectScheduling(pezinho, c, "p-anapaula", { clicked: true });
    expect(c.proposal!.action_snapshot).toMatchObject({ professional_ref: "p-anapaula", before_professional_ref: "p-jonas" });
  });
  it("homonyms are a card; a name of another salon, an inactive professional and a typo are not found", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Luana", target_professional_name: "Ana" }, "Passa a Luana pra Ana");
    expect(c.candidates).toMatchObject({ kind: "target_professional_ref", items: [{ id: "p-anapaula" }, { id: "p-anabia" }] }); expect(c.proposal).toBeUndefined();
    await expect(selectScheduling(pezinho, c, "p-yasmin")).rejects.toThrow("SELECTION_INVALID");
    for (const [name, message] of [["Marina", "Passa a Luana pra Marina"], ["Rita", "Passa a Luana pra Rita"]] as const) {
      const d = fresh();
      await turn(d, { customer_name: "Luana", target_professional_name: name }, message);
      expect(d.proposal).toBeUndefined(); expect(d.message).toContain("Não encontrei esse profissional neste salão."); expect(d.waiting_for).toBe("target_professional_name");
    }
    noWrite();
  });
  it("the professional already attending: said, nothing proposed", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Luana", target_professional_name: "Jonas" }, "A Luana continua com o Jonas");
    expect(c.proposal).toBeUndefined(); expect(c.message).toBe("O agendamento de Luana Prado já é Corte com Jonas Ferraz. Nada foi alterado."); noWrite();
  });
  it("a busy target: the unavailability with the target's own free times (never the old professional, never an encaixe)", async () => {
    db.appointments.push(appt("a-bruna", "c-bruna", "p-yasmin", "2026-10-01T14:00", [booked("s-pezinho", 1200)]));
    const c = fresh();
    await turn(c, { customer_name: "Luana", target_professional_name: "Yasmin" }, "Passa a Luana pra Yasmin, mesmo horário");
    expect(c.proposal).toBeUndefined(); expect(c.waiting_for).toBe("time");
    expect(c.message).toBe("Esse horário está indisponível: já existe outro atendimento. Com Corte com Yasmin Toledo, o atendimento iria até 14h30. O agendamento original continua como está. Tenho 14h15, 14h30, 14h45, 15h, 15h15. Qual horário você prefere?");
    expect(c.alternatives!.every(slot => slot.professional_ref === "p-yasmin")).toBe(true); noWrite();
  });
  it("'não vai ser com a Yasmin' never becomes a change to her; the accepted target is dropped and asked", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Luana", target_professional_name: "Yasmin" }, "Passa a Luana pra Yasmin");
    expect(c.proposal).toBeDefined();
    await turn(c, { target_professional_name: "Yasmin" }, "Não, a Luana não vai ser com a Yasmin");
    expect(c.proposal).toBeUndefined(); expect(c.fields).not.toHaveProperty("target_professional_name");
    expect(c.message).toBe("Não entendi com segurança para qual profissional passar o agendamento. Quem vai atender?"); noWrite();
  });
  it("a name the message does not contain is only confirmed by a click (C3), never proposed", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Luana", target_professional_name: "Yasmin" }, "Passa a Luana pra outra pessoa, mesmo horário");
    expect(c.proposal).toBeUndefined(); expect(c.candidates).toMatchObject({ kind: "target_professional_ref", source: "confirm", items: [{ id: "p-yasmin" }] });
    await selectScheduling(pezinho, c, "p-yasmin", { clicked: true });
    expect(c.unproven_names).toBeUndefined(); expect(c.proposal!.action_snapshot).toMatchObject({ professional_ref: "p-yasmin" });
  });
  it("a target on a create, or with the flag off, is refused before anything is prepared", async () => {
    await expect(turn({ ...schedulingState(), operation: "appointment.create" }, { customer_name: "Luana", target_professional_name: "Yasmin" }, "Marca a Luana com a Yasmin", pezinho, "appointment.create")).rejects.toThrow("CAPABILITY_FIELD_MISMATCH");
    vi.stubEnv("SALON_SECRETARY_ALTER_APPOINTMENT", "false");
    await expect(turn(fresh(), { customer_name: "Luana", target_professional_name: "Yasmin" }, "Passa a Luana pra Yasmin")).rejects.toThrow("CAPABILITY_FIELD_MISMATCH");
    expect(db.rows).toEqual([]); noWrite();
  });
  it("with the flag, a service locates an appointment holding it in any position (the dateless search as the dated one); flag off: the main service", async () => {
    const calls = vi.spyOn((db.tx as { appointment: { findMany: (...args: unknown[]) => unknown } }).appointment, "findMany");
    await turn(fresh(), { customer_name: "Otávio", service_name: "barba", target_professional_name: "Yasmin" }, "O Otávio da barba vai ser com a Yasmin");
    expect(calls.mock.calls.at(-1)![0]).toMatchObject({ where: { clientId: "c-otavio", OR: [{ serviceId: "s-barba" }, { serviceItems: { some: { serviceId: "s-barba" } } }] } });
    vi.stubEnv("SALON_SECRETARY_ALTER_APPOINTMENT", "false");
    await turn(fresh(), { customer_name: "Otávio", service_name: "barba", time: "17:00" }, "Passa o Otávio da barba pras 17h");
    const where = (calls.mock.calls.at(-1)![0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ serviceId: "s-barba" }); expect(where).not.toHaveProperty("OR"); noWrite();
  });
  it("tenant isolation: another salon's actor never finds this salon's appointment or professional", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Luana", target_professional_name: "Yasmin" }, "Passa a Luana pra Yasmin", lotus);
    expect(c.proposal).toBeUndefined(); expect(c.fields.appointment_ref).toBeUndefined(); noWrite();
  });
});

describe("services: replace, add, remove (backlog 0b)", () => {
  it("'troque o serviço da Luana para barba e pezinho': SET, catalog duration and price, slot kept; the executor sends the new list", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Luana", service_changes: [{ mode: "SET", service_name: "barba" }, { mode: "SET", service_name: "pezinho" }] }, "Troque o serviço da Luana para barba e pezinho");
    expect(c.proposal!.action_snapshot).toMatchObject({ professional_ref: "p-jonas", startLocal: "2026-10-01T14:00", endLocal: "2026-10-01T14:35", priceCents: 4200,
      services: [expect.objectContaining({ id: "s-barba" }), expect.objectContaining({ id: "s-pezinho" })], before_price_cents: 4000 });
    expect(text(c.message)).toContain("ALTERAR AGENDAMENTO\nLuana Prado\nANTES: Corte com Jonas Ferraz — qui, 01/10 às 14h–14h30\nDEPOIS: Barba e Pezinho com Jonas Ferraz — qui, 01/10 às 14h–14h35\nHorário mantido.\nDuração: 30 min → 35 min\nPreço: R$ 40,00 → R$ 42,00");
    noWrite();
    await confirm(c);
    expect(db.executed).toEqual([expect.objectContaining({ professionalId: "p-jonas", serviceIds: ["s-barba", "s-pezinho"], startLocal: "2026-10-01T14:00" })]);
  });
  it("owner 07/10: 'Altere o serviço da Luana.' with no service named asks which service (slot kept), never a new day and clock", async () => {
    const c = fresh();
    const codes = await turn(c, { customer_name: "Luana" }, "Altere o serviço da Luana.");
    expect(codes).toContain("ALTER_SERVICE_ASKED");
    expect(c.waiting_for).toBe("service_changes");
    expect(c.message).toBe("Qual serviço Luana vai fazer no lugar? Se for para acrescentar ou tirar um serviço, diga qual.");
    expect(c.message).not.toMatch(/dia|horário/); expect(c.proposal).toBeUndefined();
    await turn(c, { service_changes: [{ mode: "SET", service_name: "barba" }] }, "barba");
    expect(c.proposal!.action_snapshot).toMatchObject({ startLocal: "2026-10-01T14:00", services: [expect.objectContaining({ id: "s-barba" })] });
    // A plain move ("muda o horário") and a named service are untouched.
    for (const message of ["Muda o horário da Luana.", "Altera a Luana para sexta"]) expect(await turn(fresh(), { customer_name: "Luana" }, message)).not.toContain("ALTER_SERVICE_ASKED");
    noWrite();
  });
  it("'ela vai fazer barba também' adds to the same appointment (never a second one); 'tira a barba' removes; an account customer accepts it", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Luana", service_changes: [{ mode: "INCLUDE", service_name: "barba" }] }, "A Luana vai fazer barba também");
    expect(c.operation).toBe("appointment.change");
    expect(c.proposal!.action_snapshot).toMatchObject({ appointment_ref: "a-luana", services: [expect.objectContaining({ id: "s-corte", priceCents: 4500 }), expect.objectContaining({ id: "s-barba" })], endLocal: "2026-10-01T14:50" });
    const d = fresh();
    await turn(d, { customer_name: "Otávio", service_changes: [{ mode: "REMOVE", service_name: "barba" }] }, "Tira a barba do Otávio");
    expect(d.proposal!.action_snapshot).toMatchObject({ services: [expect.objectContaining({ id: "s-corte" })], endLocal: "2026-10-01T16:30", requires_acceptance: true });
    expect(text(d.message)).toContain("Duração: 50 min → 30 min\nPreço: R$ 70,00 → R$ 45,00\nA alteração ficará aguardando o aceite do cliente.");
    noWrite();
  });
  it("a longer duration that collides with the next client: the free times for the new duration, never an encaixe", async () => {
    db.appointments.push(appt("a-kauan", "c-kauan", "p-jonas", "2026-10-01T14:30", [booked("s-corte", 4000)]));
    const c = fresh();
    await turn(c, { customer_name: "Luana", service_changes: [{ mode: "INCLUDE", service_name: "barba" }] }, "A Luana vai fazer barba também");
    expect(c.proposal).toBeUndefined(); expect(c.waiting_for).toBe("time");
    expect(c.message).toMatch(/^Esse horário está indisponível: já existe outro atendimento\. Com Corte e Barba com Jonas Ferraz, o atendimento iria até 14h50\. O agendamento original continua como está\. Tenho /);
    // The owner picks a time: the day stays the appointment's, the new services stay.
    await turn(c, { temporal_evidence: [{ field: "time", text: "às 17h", component: { hour: 17, minute: 0, daypart: "UNSPECIFIED" } }] }, "às 17h");
    expect(c.proposal!.action_snapshot).toMatchObject({ startLocal: "2026-10-01T17:00", endLocal: "2026-10-01T17:50", services: [expect.objectContaining({ id: "s-corte" }), expect.objectContaining({ id: "s-barba" })] });
    noWrite();
  });
  it("refusals: the only service, a service the appointment does not have, one it already has — nothing is kept or proposed", async () => {
    const cases: [Record<string, unknown>, string, string][] = [
      [{ service_changes: [{ mode: "REMOVE", service_name: "barba" }] }, "Tira a barba da Bruna", "Não dá para deixar o agendamento de Bruna Siqueira sem serviço (Barba). Nada foi alterado; para desmarcar, peça o cancelamento."],
      [{ service_changes: [{ mode: "REMOVE", service_name: "barba" }] }, "Tira a barba da Luana", "O agendamento de Luana Prado não inclui Barba; tem Corte. Nada foi alterado."],
      [{ service_changes: [{ mode: "INCLUDE", service_name: "barba" }] }, "O Otávio vai fazer barba também", "O agendamento de Otávio Mendes já inclui Barba. Nada foi alterado."],
    ];
    db.appointments.push(appt("a-bruna", "c-bruna", "p-caua", "2026-10-01T10:00", [booked("s-barba", 3000)]));
    for (const [fields, message, said] of cases) {
      const c = fresh();
      await turn(c, { customer_name: ["Otávio", "Bruna", "Luana"].find(name => message.includes(name)), ...fields }, message);
      expect(c.proposal).toBeUndefined(); expect(c.message).toBe(`${said} Quais serviços devo trocar, acrescentar ou tirar?`);
      expect(c.fields).not.toHaveProperty("service_changes"); expect(c.waiting_for).toBe("service_changes");
    }
    noWrite();
  });
  it("homonyms ('Corte' vs 'Corte infantil') are a card; an unknown service is said; nothing is picked", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Luana", service_changes: [{ mode: "SET", service_name: "corte" }] }, "Muda o serviço da Luana pra corte");
    expect(c.proposal).toBeUndefined();
    expect(c.candidates).toEqual({ kind: "service_changes_ref", items: [{ id: "s-corte", name: "Corte" }, { id: "s-corte-inf", name: "Corte infantil" }] });
    expect(c.message).toBe("Qual serviço você quis dizer com “corte”? Selecione uma opção real.");
    await selectScheduling(pezinho, c, "s-corte-inf", { clicked: true });
    expect(c.proposal!.action_snapshot).toMatchObject({ services: [expect.objectContaining({ id: "s-corte-inf" })], endLocal: "2026-10-01T14:25", priceCents: 3500 });
    const d = fresh();
    await turn(d, { customer_name: "Luana", service_changes: [{ mode: "SET", service_name: "hidratação" }] }, "Troca o serviço da Luana pra hidratação");
    expect(d.proposal).toBeUndefined(); expect(d.message).toBe("Não encontrei o serviço “hidratação” neste salão. Qual serviço você quis dizer?"); noWrite();
  });
  it("a service the professional does not perform: who performs every service is offered; the choice keeps the new services", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Luana", service_changes: [{ mode: "SET", service_name: "sobrancelha" }] }, "Troca o serviço da Luana pra sobrancelha");
    expect(c.proposal).toBeUndefined();
    expect(c.message).toBe("Jonas Ferraz não faz Sobrancelha. Quem faz: Yasmin Toledo. Quem vai atender?");
    await selectScheduling(pezinho, c, "p-yasmin", { clicked: true });
    expect(c.proposal!.action_snapshot).toMatchObject({ professional_ref: "p-yasmin", before_professional_ref: "p-jonas", services: [expect.objectContaining({ id: "s-sobrancelha" })] });
    noWrite();
  });
  it("negation never becomes an action: 'não vai fazer pezinho' with a model that added it is asked; the rest of the turn is kept", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Luana", target_professional_name: "Yasmin", service_changes: [{ mode: "INCLUDE", service_name: "pezinho" }] }, "A Luana não vai fazer pezinho, só passa ela pra Yasmin");
    expect(c.proposal).toBeUndefined(); expect(c.fields).not.toHaveProperty("service_changes"); expect(c.fields.target_professional_name).toBe("Yasmin");
    expect(c.message).toBe("Não consegui confirmar na sua mensagem quais serviços mudam. Quais serviços devo trocar, acrescentar ou tirar?");
    // The owner confirms only the professional: the next turn prepares that alone, shown before Confirmar.
    await turn(c, {}, "só a profissional mesmo");
    expect(c.proposal!.action_snapshot).toMatchObject({ professional_ref: "p-yasmin", services: [expect.objectContaining({ id: "s-corte" })] }); noWrite();
  });
  it("a service name the message does not prove is not kept (asked)", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Luana", service_changes: [{ mode: "SET", service_name: "Barba" }] }, "Troca o serviço da Luana");
    expect(c.proposal).toBeUndefined(); expect(c.fields).not.toHaveProperty("service_changes"); expect(c.waiting_for).toBe("service_changes"); noWrite();
  });
  it("a validated V2 operation reaches the adapter through the projection with its delta intact", async () => {
    const selection = validateSelectionV2(selectionTransportSchemaV2.parse({ skills: ["scheduling"], independent: true, operations: [{ operation: "appointment.change", item_key: "a",
      customer_name: "Luana", service_changes: [{ mode: "INCLUDE", service_name: "pezinho" }], target_name: null, name: null, priceCents: null, durationMin: null, phone: null, email: null, requested_fields: [], clear_fields: [] }] }));
    const projected = projectSchedulingOperation(selection.operations[0]);
    expect(projected.fields).toEqual({ customer_name: "Luana", service_changes: [{ mode: "INCLUDE", service_name: "pezinho" }] });
    const c = fresh();
    await applySchedulingInterpretation(pezinho, c, { operation: projected.operation, ...projected.fields } as never, "A Luana vai fazer pezinho também");
    expect(c.proposal!.action_snapshot).toMatchObject({ services: [expect.objectContaining({ id: "s-corte" }), expect.objectContaining({ id: "s-pezinho" })] }); noWrite();
  });
});

import { splitChoiceDelta, nameEchoAgrees } from "../secretary-options";
import { SalonSecretary } from "../salon-secretary";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { unansweredServiceCard } from "../secretary-multi-service";
/** Adversarial review A of P2a, fixed (phase 2 fixer). Every case ends in a question or a proposal the owner still confirms. */
describe("review A: an answer to a service card never replaces the rest of the delta", () => {
  const swapToCorte = async () => {
    db.appointments.find(a => a.id === "a-luana")!.services = [booked("s-barba", 3000)];
    const c = fresh();
    await turn(c, { customer_name: "Luana", service_changes: [{ mode: "REMOVE", service_name: "barba" }, { mode: "INCLUDE", service_name: "corte" }] }, "Troca a barba da Luana por corte");
    expect(c.candidates).toEqual({ kind: "service_changes_ref", items: [{ id: "s-corte", name: "Corte" }, { id: "s-corte-inf", name: "Corte infantil" }] });
    return c;
  };
  it("choice path: the card's response field is an echo of the option (compared, never applied as a new delta)", async () => {
    const c = await swapToCorte(), option = { option_id: "opt_2", label: "Corte infantil", ref: "s-corte-inf", field: "service_changes_ref" };
    const split = splitChoiceDelta({ operation: "appointment.change", item_key: "a", service_changes: [{ mode: "INCLUDE", service_name: "corte infantil" }] }, option, "appointment.change");
    expect(split.echo).toEqual({ service_changes: [{ mode: "INCLUDE", service_name: "corte infantil" }] }); expect(split.rest.service_changes).toBeNull();
    expect(nameEchoAgrees("service_changes", [{ mode: "REMOVE", service_name: "barba" }, { mode: "INCLUDE", service_name: "Corte infantil" }], option, c.fields as never)).toBe(true);
    // A restatement that names something else, or the option with another mode, disagrees: the card is asked again.
    expect(nameEchoAgrees("service_changes", [{ mode: "INCLUDE", service_name: "pezinho" }], option, c.fields as never)).toBe(false);
    expect(nameEchoAgrees("service_changes", [{ mode: "REMOVE", service_name: "corte infantil" }], option, c.fields as never)).toBe(false);
    noWrite();
  });
  it("plain answer (no choice) restating only the answered item: a pick of the card, the swap kept", async () => {
    const c = await swapToCorte();
    await turn(c, { service_changes: [{ mode: "INCLUDE", service_name: "corte infantil" }] }, "corte infantil");
    expect(c.fields.service_changes).toEqual([{ mode: "REMOVE", service_name: "barba" }, { mode: "INCLUDE", service_name: "corte" }]);
    expect(c.proposal!.action_snapshot!.services.map(s => s.id)).toEqual(["s-corte-inf"]);
    expect(text(c.message)).toContain("DEPOIS: Corte infantil com Jonas Ferraz"); noWrite();
  });
  it("an answer every option shares, or a new service beside the card: asked again with the same card, the delta kept", async () => {
    const c = await swapToCorte();
    await turn(c, { service_changes: [{ mode: "INCLUDE", service_name: "Corte" }] }, "o corte");
    expect(c.proposal).toBeUndefined(); expect(c.candidates?.kind).toBe("service_changes_ref");
    expect(c.message).toBe(`${unansweredServiceCard}\nQual serviço você quis dizer com “corte”? Selecione uma opção real.`);
    await turn(c, { service_changes: [{ mode: "INCLUDE", service_name: "pezinho" }] }, "pezinho");
    expect(c.proposal).toBeUndefined(); expect(c.fields.service_changes).toHaveLength(2); expect(c.candidates?.kind).toBe("service_changes_ref"); noWrite();
  });
  it("a same-shape rewording of the carded change is the owner's correction (nothing accepted is dropped)", async () => {
    const c = await swapToCorte();
    await turn(c, { service_changes: [{ mode: "REMOVE", service_name: "barba" }, { mode: "INCLUDE", service_name: "pezinho" }] }, "Não, troca a barba por pezinho");
    expect(c.proposal!.action_snapshot!.services.map(s => s.id)).toEqual(["s-pezinho"]); noWrite();
  });
  it("E2E (SalonSecretary, scripted Luna): a choice with the response field restating the pick keeps the swap; control without it", async () => {
    vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", "false");
    for (const fields of [{ service_changes: [{ mode: "INCLUDE", service_name: "corte infantil" }] }, {}]) {
      db.rows = []; db.appointments.find(a => a.id === "a-luana")!.services = [booked("s-barba", 3000)];
      const model = new ScriptedServicesModel([call("select_capabilities", { turn: { mode: "NEW", operations: [{ item_key: "a", operation: "appointment.change", customer_name: "Luana",
        service_changes: [{ mode: "REMOVE", service_name: "barba" }, { mode: "INCLUDE", service_name: "corte" }] }] } }),
        call("upsert_action_draft", { turn: { mode: "PATCH", operations: [{ item_key: "a", choice: { option_id: "opt_2", literal: "corte infantil" }, fields }] } })]);
      const secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
      const session = await secretary.start(pezinho, "auto");
      await secretary.send(pezinho, { sessionId: session.sessionId, message: "Troca a barba da Luana por corte" });
      const second = await secretary.send(pezinho, { sessionId: session.sessionId, message: "corte infantil" });
      expect(text(second.message ?? "")).toContain("DEPOIS: Corte infantil com Jonas Ferraz"); expect(text(second.message ?? "")).not.toContain("Barba e Corte infantil");
    }
    noWrite();
  });
});
describe("review A: restatements after the card, and deltas that would drop an accepted change", () => {
  it("the chosen option's registered name re-echoed later keeps the resolved change (like the target)", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Luana", service_changes: [{ mode: "SET", service_name: "corte" }] }, "Muda o serviço da Luana pra corte");
    await selectScheduling(pezinho, c, "s-corte-inf", { clicked: true });
    await turn(c, { service_changes: [{ mode: "SET", service_name: "Corte infantil" }], temporal_evidence: [{ field: "time", text: "às 11h", component: { hour: 11, minute: 0, daypart: "UNSPECIFIED" } }] }, "Deixa às 11h");
    expect(c.fields.service_changes_ref).toEqual(["s-corte-inf"]);
    expect(c.proposal!.action_snapshot).toMatchObject({ startLocal: "2026-10-01T11:00", services: [expect.objectContaining({ id: "s-corte-inf" })] }); noWrite();
  });
  it("part of the delta restated without the owner's words changes nothing; with the owner's words it is asked (never a swap turned into an add)", async () => {
    const c = fresh();
    db.appointments.find(a => a.id === "a-luana")!.services = [booked("s-barba", 3000)];
    await turn(c, { customer_name: "Luana", service_changes: [{ mode: "REMOVE", service_name: "barba" }, { mode: "INCLUDE", service_name: "pezinho" }] }, "Troca a barba da Luana por pezinho");
    expect(c.proposal!.action_snapshot!.services.map(s => s.id)).toEqual(["s-pezinho"]);
    await turn(c, { service_changes: [{ mode: "INCLUDE", service_name: "pezinho" }], temporal_evidence: [{ field: "time", text: "às 11h", component: { hour: 11, minute: 0, daypart: "UNSPECIFIED" } }] }, "Deixa às 11h");
    expect(c.proposal!.action_snapshot).toMatchObject({ startLocal: "2026-10-01T11:00", services: [expect.objectContaining({ id: "s-pezinho" })] });
    await turn(c, { service_changes: [{ mode: "INCLUDE", service_name: "pezinho" }] }, "Então só o pezinho");
    expect(c.proposal).toBeUndefined(); expect(c.fields).not.toHaveProperty("service_changes"); expect(c.waiting_for).toBe("service_changes");
    expect(c.message).toBe("O pedido tinha: tirar barba e acrescentar pezinho. Agora recebi só: acrescentar pezinho. Não apliquei nenhuma troca de serviço. Quais serviços devo trocar, acrescentar ou tirar?");
    noWrite();
  });
  it("the same services in another order are the appointment's own list: nothing to change, nothing repriced or sent to acceptance", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Otávio", service_changes: [{ mode: "SET", service_name: "barba" }, { mode: "SET", service_name: "corte" }] }, "O Otávio vai fazer barba e corte");
    if (c.candidates?.kind === "service_changes_ref") await selectScheduling(pezinho, c, "s-corte", { clicked: true });
    expect(c.proposal).toBeUndefined(); expect(c.message).toBe("O agendamento de Otávio Mendes já é Corte e Barba com Jonas Ferraz. Nada foi alterado."); noWrite();
  });
});
describe("review A: negation by 'sem', substring names, the same customer's next appointment, swapped roles", () => {
  it("'sem barba': the excluded service is never included (asked, like 'barba não'); the target said with 'sem' is never who attends", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Luana", service_changes: [{ mode: "INCLUDE", service_name: "pezinho" }, { mode: "INCLUDE", service_name: "barba" }] }, "A Luana vai fazer pezinho também, sem barba");
    expect(c.proposal).toBeUndefined(); expect(c.fields).not.toHaveProperty("service_changes"); expect(c.waiting_for).toBe("service_changes");
    const d = fresh();
    await turn(d, { customer_name: "Luana", target_professional_name: "Yasmin" }, "Passa a Luana pra outra pessoa, sem a Yasmin");
    expect(d.proposal).toBeUndefined(); expect(d.fields).not.toHaveProperty("target_professional_name"); noWrite();
  });
  it("a name found only inside another professional's name is a confirmation card (click or the written name), never picked", async () => {
    db.pros.push({ id: "p-fabiana", name: "Fabiana Costa", salonId: pezinho.salonId, services: ["s-corte"], active: true });
    const c = fresh();
    await turn(c, { customer_name: "Luana", target_professional_name: "Bia" }, "Passa a Luana pra Bia");
    expect(c.proposal).toBeUndefined(); expect(c.candidates).toMatchObject({ kind: "target_professional_ref", source: "confirm", items: [{ id: "p-fabiana" }] });
    await selectScheduling(pezinho, c, "p-fabiana", { clicked: true });
    expect(c.proposal!.action_snapshot).toMatchObject({ professional_ref: "p-fabiana", before_professional_ref: "p-jonas" });
    const d = fresh();
    await turn(d, { customer_name: "Luana", target_professional_name: "Yasmin" }, "Passa a Luana pra Yasmin");
    expect(d.proposal!.action_snapshot).toMatchObject({ professional_ref: "p-yasmin" }); noWrite();
  });
  it("CUSTOMER_OVERLAP_GUARD: an extension over the same customer's next appointment is asked, never proposed; guard off: as before", async () => {
    db.appointments.push(appt("a-kauan1", "c-kauan", "p-jonas", "2026-10-01T10:00", [booked("s-corte", 4000)]), appt("a-kauan2", "c-kauan", "p-yasmin", "2026-10-01T10:30", [booked("s-sobrancelha", 1500)]));
    const ask = { customer_name: "Kauan", professional_name: "Jonas", service_changes: [{ mode: "INCLUDE", service_name: "barba" }] }, said = "O Kauan do Jonas vai fazer barba também";
    const off = fresh();
    await turn(off, ask, said);
    expect(off.proposal!.action_snapshot).toMatchObject({ appointment_ref: "a-kauan1", endLocal: "2026-10-01T10:50" });
    vi.stubEnv("SALON_SECRETARY_CUSTOMER_OVERLAP_GUARD", "true");
    const c = fresh();
    await turn(c, ask, said);
    expect(c.proposal).toBeUndefined(); expect(c.waiting_for).toBe("time");
    expect(text(c.message)).toBe("Kauan Reis já tem horário qui, 01/10 às 10h30, e com Corte e Barba o atendimento iria até 10h50, sobrepondo os dois. O agendamento original continua como está. Qual horário ou serviços você prefere?");
    noWrite();
  });
  it("a customer with appointments with both named professionals: a card of both readings, whichever way Luna put the roles; the pick orients who attends", async () => {
    db.appointments.push(appt("a-luana2", "c-luana", "p-yasmin", "2026-10-02T10:00", [booked("s-corte", 4000)]));
    for (const roles of [{ professional_name: "Yasmin", target_professional_name: "Jonas" }, { professional_name: "Jonas", target_professional_name: "Yasmin" }]) {
      const c = fresh();
      await turn(c, { customer_name: "Luana", ...roles }, "Passa a Luana do Jonas pra Yasmin");
      expect(c.proposal).toBeUndefined();
      expect(c.candidates).toMatchObject({ kind: "appointment_ref" }); expect(c.candidates!.items.map(item => item.id).sort()).toEqual(["a-luana", "a-luana2"]);
      expect(c.message).toContain("Qual deles muda de profissional?");
      await selectScheduling(pezinho, c, "a-luana", { clicked: true });
      expect(c.proposal!.action_snapshot).toMatchObject({ appointment_ref: "a-luana", professional_ref: "p-yasmin", before_professional_ref: "p-jonas" });
      const d = fresh();
      await turn(d, { customer_name: "Luana", ...roles }, "Passa a Luana do Jonas pra Yasmin");
      await selectScheduling(pezinho, d, "a-luana2", { clicked: true });
      expect(d.proposal!.action_snapshot).toMatchObject({ appointment_ref: "a-luana2", professional_ref: "p-jonas", before_professional_ref: "p-yasmin" });
    }
    noWrite();
  });
  it("swapped roles with an appointment only with the named professional: not found (never a move to the wrong professional)", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Luana", professional_name: "Yasmin", target_professional_name: "Jonas" }, "Passa a Luana do Jonas pra Yasmin");
    expect(c.proposal).toBeUndefined(); expect(c.message).toMatch(/^Não encontrei agendamento futuro/); noWrite();
  });
});
describe("review A (fixer refinements): exclusion agrees with a removal; a one-item delta replaced by another is asked", () => {
  it("'deixa a Luana sem barba' with REMOVE barba is the removal the owner asked (the privative agrees with it)", async () => {
    db.appointments.find(a => a.id === "a-luana")!.services = [booked("s-corte", 4000), booked("s-barba", 3000)];
    const c = fresh();
    await turn(c, { customer_name: "Luana", service_changes: [{ mode: "REMOVE", service_name: "barba" }] }, "Deixa a Luana sem barba");
    expect(c.proposal!.action_snapshot!.services.map(s => s.id)).toEqual(["s-corte"]); noWrite();
  });
  it("after 'barba também', a lone 'pezinho' (add or replace?) is asked; a two-item rewording that keeps one change in place is applied", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Luana", service_changes: [{ mode: "INCLUDE", service_name: "barba" }] }, "A Luana vai fazer barba também");
    expect(c.proposal).toBeDefined();
    await turn(c, { service_changes: [{ mode: "INCLUDE", service_name: "pezinho" }] }, "E pezinho");
    expect(c.proposal).toBeUndefined(); expect(c.fields).not.toHaveProperty("service_changes");
    expect(c.message).toBe("O pedido tinha: acrescentar barba. Agora recebi só: acrescentar pezinho. Não apliquei nenhuma troca de serviço. Quais serviços devo trocar, acrescentar ou tirar?");
    const d = fresh();
    db.appointments.find(a => a.id === "a-luana")!.services = [booked("s-barba", 3000)];
    await turn(d, { customer_name: "Luana", service_changes: [{ mode: "REMOVE", service_name: "barba" }, { mode: "INCLUDE", service_name: "pezinho" }] }, "Troca a barba da Luana por pezinho");
    await turn(d, { service_changes: [{ mode: "REMOVE", service_name: "barba" }, { mode: "INCLUDE", service_name: "sobrancelha" }] }, "Não, troca a barba por sobrancelha");
    expect(d.fields.service_changes).toEqual([{ mode: "REMOVE", service_name: "barba" }, { mode: "INCLUDE", service_name: "sobrancelha" }]);
    expect(d.proposal).toBeUndefined(); expect(d.message).toBe("Jonas Ferraz não faz Sobrancelha. Quem faz: Yasmin Toledo. Quem vai atender?"); noWrite();
  });
});

describe("C4 R-A: an alteration whose only destination is the appointment's own day keeps the slot (no clock asked)", () => {
  // "Corte" has a homonym here (Corte infantil): the swaps below use barba → pezinho, both unique in the catalog.
  const weekdayQuote = (text: string, weekday: number) => ({ field: "date", text, component: { kind: "WEEKDAY", weekday, week: "NEAREST", day: null, month: null, offset: null, year: null, days: null } });
  const swap = [{ mode: "REMOVE", service_name: "barba" }, { mode: "INCLUDE", service_name: "pezinho" }];
  it("'troca a barba do Otávio de quinta por pezinho' (his appointment is Thursday): ALTERAR at the same slot; the day is never kept", async () => {
    const c = fresh();
    const codes = await turn(c, { customer_name: "Otávio", service_changes: swap, temporal_evidence: [weekdayQuote("de quinta", 4)] }, "troca a barba do Otávio de quinta por pezinho");
    expect(codes).toContain("ALTER_SAME_DAY_KEPT");expect(c.proposal).toBeDefined();
    expect(c.fields).not.toHaveProperty("date");expect(c.fields).not.toHaveProperty("time");expect(c.draft!.fields).not.toHaveProperty("date");
    expect(c.proposal!.action_snapshot).toMatchObject({ appointment_ref: "a-otavio", startLocal: "2026-10-01T16:00",
      services: [expect.objectContaining({ id: "s-corte" }), expect.objectContaining({ id: "s-pezinho" })] });
    expect(text(c.message)).toContain("Horário mantido.");noWrite();
  });
  it("the day written in an earlier turn is never resurrected by the journal: the clicked Thursday keeps its slot; the Saturday one is a NEW day (clock asked)", async () => {
    db.appointments.push(appt("a-kauan-qui", "c-kauan", "p-jonas", "2026-10-01T10:00", [booked("s-barba", 3000)]), appt("a-kauan-sab", "c-kauan", "p-jonas", "2026-10-03T10:00", [booked("s-barba", 3000)]));
    const c = fresh();
    await turn(c, { customer_name: "Kauan", service_changes: swap, temporal_evidence: [weekdayQuote("de quinta", 4)] }, "troca a barba do Kauan de quinta por pezinho");
    expect(c.proposal).toBeUndefined();expect(c.candidates?.items.map(item => item.id)).toEqual(["a-kauan-qui", "a-kauan-sab"]);expect(c.draft!.fields).toMatchObject({ date: "2026-10-01" });
    await selectScheduling(pezinho, c, "a-kauan-qui", { clicked: true });
    expect(c.proposal!.action_snapshot).toMatchObject({ appointment_ref: "a-kauan-qui", startLocal: "2026-10-01T10:00", services: [expect.objectContaining({ id: "s-pezinho" })] });
    expect(c.fields).not.toHaveProperty("date");expect(c.draft!.fields).not.toHaveProperty("date");noWrite();
    const d = fresh();
    await turn(d, { customer_name: "Kauan", service_changes: swap, temporal_evidence: [weekdayQuote("de quinta", 4)] }, "troca a barba do Kauan de quinta por pezinho");
    await selectScheduling(pezinho, d, "a-kauan-sab", { clicked: true });
    expect(d.proposal).toBeUndefined();expect(d.fields).toMatchObject({ date: "2026-10-01" });expect(d.draft!.missing_fields).toContain("time");noWrite();
  });
  it("adversarial: another day, or a clock beside the same day, still moves (another day without a clock asks it: GF14)", async () => {
    const other = fresh();
    const codes = await turn(other, { customer_name: "Otávio", service_changes: swap, temporal_evidence: [weekdayQuote("na sexta", 5)] }, "troca a barba do Otávio por pezinho na sexta");
    expect(codes).not.toContain("ALTER_SAME_DAY_KEPT");expect(other.proposal).toBeUndefined();expect(other.fields).toMatchObject({ date: "2026-10-02" });expect(other.draft!.missing_fields).toContain("time");
    const clocked = fresh();
    await turn(clocked, { customer_name: "Otávio", service_changes: swap, temporal_evidence: [weekdayQuote("de quinta", 4), { field: "time", text: "às 11h", component: { hour: 11, minute: 0, daypart: "UNSPECIFIED" } }] },
      "troca a barba do Otávio de quinta às 11h por pezinho");
    expect(clocked.proposal!.action_snapshot).toMatchObject({ startLocal: "2026-10-01T11:00" });expect(clocked.message).not.toContain("Horário mantido");noWrite();
  });
  it("adversarial: a plain move to the appointment's own day (no alteration) is unchanged: the clock is asked (GF14)", async () => {
    const c = fresh();
    const codes = await turn(c, { customer_name: "Luana", temporal_evidence: [weekdayQuote("pra quinta", 4)] }, "passa a Luana pra quinta");
    expect(codes).not.toContain("ALTER_SAME_DAY_KEPT");expect(c.proposal).toBeUndefined();expect(c.fields).toMatchObject({ date: "2026-10-01" });expect(c.draft!.missing_fields).toContain("time");noWrite();
  });
  it("flag off (ALTER_APPOINTMENT): the alteration is refused before anything is prepared, as before", async () => {
    vi.stubEnv("SALON_SECRETARY_ALTER_APPOINTMENT", "false");
    const c = fresh();
    await expect(turn(c, { customer_name: "Otávio", service_changes: swap, temporal_evidence: [weekdayQuote("de quinta", 4)] }, "troca a barba do Otávio de quinta por pezinho")).rejects.toThrow();
    expect(c.proposal).toBeUndefined();noWrite();
  });
  // Review (today is Tuesday 29/09): "de terça" (the nearest Tuesday) and "terça que vem" both read 06/10, Bruna's appointment day.
  const tuesday = (field: string, text: string, week: string) => ({ field, text, component: { kind: "WEEKDAY", weekday: 2, week, day: null, month: null, offset: null, year: null, days: null } });
  it("review adversarial: a destination said by its own quote beside the origin's ('de terça pra terça que vem') is never dropped: the clock is asked", async () => {
    db.appointments.push(appt("a-bruna", "c-bruna", "p-jonas", "2026-10-06T10:00", [booked("s-barba", 3000)]));
    const c = fresh();
    const codes = await turn(c, { customer_name: "Bruna", service_changes: swap, temporal_evidence: [tuesday("source_date", "de terça", "NEAREST"), tuesday("date", "terça que vem", "AMBIGUOUS_NEXT")] },
      "passa a Bruna de terça pra terça que vem e troca a barba por pezinho");
    expect(codes).not.toContain("ALTER_SAME_DAY_KEPT");expect(c.proposal).toBeUndefined();
    expect(c.fields).toMatchObject({ appointment_ref: "a-bruna", source_date: "2026-10-06", date: "2026-10-06" });expect(c.draft!.fields).toMatchObject({ date: "2026-10-06" });
    expect(c.draft!.missing_fields).toContain("time");expect(c.message).not.toContain("Horário mantido");noWrite();
    // The same arguments without the alteration take the same historical path.
    const plain = fresh();
    await turn(plain, { customer_name: "Bruna", temporal_evidence: [tuesday("source_date", "de terça", "NEAREST"), tuesday("date", "terça que vem", "AMBIGUOUS_NEXT")] }, "passa a Bruna de terça pra terça que vem");
    expect(plain.proposal).toBeUndefined();expect(plain.draft!.missing_fields).toContain("time");noWrite();
  });
  it("review: the D03 shape (only the day that locates it, 'de terça') still keeps the slot", async () => {
    db.appointments.push(appt("a-bruna", "c-bruna", "p-jonas", "2026-10-06T10:00", [booked("s-barba", 3000)]));
    const c = fresh();
    const codes = await turn(c, { customer_name: "Bruna", service_changes: swap, temporal_evidence: [tuesday("date", "de terça", "NEAREST")] }, "troca a barba da Bruna de terça por pezinho");
    expect(codes).toContain("ALTER_SAME_DAY_KEPT");expect(c.proposal!.action_snapshot).toMatchObject({ appointment_ref: "a-bruna", startLocal: "2026-10-06T10:00" });
    expect(c.fields).not.toHaveProperty("date");expect(text(c.message)).toContain("Horário mantido.");noWrite();
  });
});

describe("C4 R-A round 2: the follow-up alteration of an appointment confirmed in the same conversation (flag SALON_SECRETARY_REFERENCES_V2)", () => {
  // Scripted Luna (recorded shape): the second turn adds the change to the active plan with an edge to the action already executed.
  const followUp = (depends_on: string[] | null) => new ScriptedServicesModel([
    call("select_capabilities", { turn: { mode: "NEW", operations: [{ item_key: "a", operation: "appointment.change", customer_name: "Luana", service_changes: [{ mode: "INCLUDE", service_name: "barba" }] }] } }),
    call("select_capabilities", { turn: { mode: "ADD", operations: [{ item_key: "b", operation: "appointment.change", depends_on, customer_name: "Luana", service_changes: [{ mode: "REMOVE", service_name: "barba" }] }] } })]);
  const confirmReady = async (secretary: SalonSecretary, sessionId: string, view: Awaited<ReturnType<SalonSecretary["send"]>>) => {
    const plan = view.action_plan!, group = plan.confirmation_groups.find(item => item.status === "READY_FOR_CONFIRMATION")!;
    return secretary.confirmActionPlanGroup(pezinho, sessionId, { plan_ref: plan.plan_ref, revision: plan.revision, group_key: group.key, fingerprint: group.fingerprint });
  };
  beforeEach(() => { vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", "false"); vi.stubEnv("SALON_SECRETARY_REFERENCES_V2", "true"); });
  it("'tira a barba da Luana, ela só vai fazer o corte' right after the confirmed 'barba também': ALTERAR the same appointment, one more confirmed execution", async () => {
    for (const depends_on of [["a"], null]) {
      db.rows = []; db.executed = []; const luana = db.appointments.find(a => a.id === "a-luana")!; luana.services = [booked("s-corte", 4000)]; luana.version = 3;
      const model = followUp(depends_on), secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
      const session = await secretary.start(pezinho, "auto");
      const first = await secretary.send(pezinho, { sessionId: session.sessionId, message: "A Luana vai fazer barba também" });
      const done = await confirmReady(secretary, session.sessionId, first);
      expect(done.action_plan!.actions.map(action => action.status)).toEqual(["DONE"]);
      expect(db.executed).toEqual([expect.objectContaining({ appointmentId: "a-luana", serviceIds: ["s-corte", "s-barba"] })]);
      const second = await secretary.send(pezinho, { sessionId: session.sessionId, message: "tira a barba da Luana, ela só vai fazer o corte" });
      expect(text(second.message), JSON.stringify(depends_on)).toContain("ANTES: Corte e Barba com Jonas Ferraz — qui, 01/10 às 14h–14h50\nDEPOIS: Corte com Jonas Ferraz — qui, 01/10 às 14h–14h30");
      expect(second.action_plan!.actions.map(action => [action.key, action.status])).toEqual([["a", "DONE"], ["b", "READY_FOR_CONFIRMATION"]]);
      expect(db.executed).toHaveLength(1);
      await confirmReady(secretary, session.sessionId, second);
      expect(db.executed).toEqual([expect.anything(), expect.objectContaining({ appointmentId: "a-luana", serviceIds: ["s-corte"], startLocal: "2026-10-01T14:00" })]);
    }
  });
  it("adversarial: flag off, the edge still refuses the turn and nothing is prepared or written beyond the first confirmation", async () => {
    vi.stubEnv("SALON_SECRETARY_REFERENCES_V2", "false");
    const model = followUp(["a"]), secretary = new SalonSecretary(async () => model, () => "gpt-6-luna", undefined, {}, { enabled: () => true });
    const session = await secretary.start(pezinho, "auto");
    await confirmReady(secretary, session.sessionId, await secretary.send(pezinho, { sessionId: session.sessionId, message: "A Luana vai fazer barba também" }));
    const second = await secretary.send(pezinho, { sessionId: session.sessionId, message: "tira a barba da Luana, ela só vai fazer o corte" });
    expect(second.message).not.toContain("ALTERAR AGENDAMENTO");
    expect(second.action_plan!.actions.map(action => action.status)).toEqual(["DONE"]);
    expect(db.executed).toHaveLength(1);
  });
});

describe("C4 owner rule 9 (flag SALON_SECRETARY_MULTI_SERVICE): a component taken out of a combo booking", () => {
  const norte = { salonId: "barbearia-norte", userId: "recepcao-norte" };
  const booking = (services: Booked[]): Appt => ({ id: "a-rafael", salonId: norte.salonId, customer_ref: "c-rafael", professional_ref: "p-heitor", services, start_local: "2026-10-02T17:00", status: "CONFIRMED", version: 2 });
  const says = (c: SchedulingState, changes: { mode: string; service_name: string }[], message: string) => turn(c, { customer_name: "Rafael", service_changes: changes }, message, norte);
  beforeEach(() => {
    vi.stubEnv("SALON_SECRETARY_MULTI_SERVICE", "true");
    db.services.push(service("n-navalhado", "Navalhado", 40, 5000, norte.salonId), service("n-barba", "Barba terapêutica", 30, 4000, norte.salonId),
      service("n-combo", "Navalhado com barba", 70, 8500, norte.salonId), service("n-hidra", "Hidratação capilar", 45, 7000, norte.salonId));
    db.pros.push({ id: "p-heitor", name: "Heitor Brandão", salonId: norte.salonId, services: ["n-navalhado", "n-barba", "n-combo", "n-hidra"], active: true });
    db.customers.push({ id: "c-rafael", name: "Rafael Okada", salonId: norte.salonId });
    db.appointments.push(booking([booked("n-combo", 8500)]));
  });
  it("REMOVE a component: the combo becomes the part left, registered apart, at the same slot with the same barber; one confirmed execution", async () => {
    const c = fresh();
    await says(c, [{ mode: "REMOVE", service_name: "navalhado" }], "o Rafael só vai fazer a barba, tira o navalhado dele");
    expect(c.candidates).toBeUndefined();
    expect(c.proposal!.action_snapshot).toMatchObject({ appointment_ref: "a-rafael", professional_ref: "p-heitor", startLocal: "2026-10-02T17:00", endLocal: "2026-10-02T17:30", services: [expect.objectContaining({ id: "n-barba" })] });
    expect(text(c.message)).toContain("ANTES: Navalhado com barba com Heitor Brandão — sex, 02/10 às 17h–18h10\nDEPOIS: Barba terapêutica com Heitor Brandão — sex, 02/10 às 17h–17h30\nHorário mantido.");
    noWrite();
    await confirm(c, norte);
    expect(db.executed).toEqual([expect.objectContaining({ appointmentId: "a-rafael", professionalId: "p-heitor", serviceIds: ["n-barba"], startLocal: "2026-10-02T17:00" })]);
  });
  it("SET the part kept ('só a barba'): the same proposal, never the combo it already is", async () => {
    const c = fresh();
    await says(c, [{ mode: "SET", service_name: "barba" }], "o Rafael vai fazer só a barba");
    expect(c.candidates).toBeUndefined(); expect(c.proposal!.action_snapshot).toMatchObject({ services: [expect.objectContaining({ id: "n-barba" })], startLocal: "2026-10-02T17:00" }); noWrite();
  });
  it("the part left registered twice apart: a card of those services (never a combo, never picked), kept across a restated delta; the click proposes", async () => {
    db.services.push(service("n-barba-exp", "Barba express", 20, 2500, norte.salonId)); db.pros.find(p => p.id === "p-heitor")!.services.push("n-barba-exp");
    const c = fresh();
    await says(c, [{ mode: "REMOVE", service_name: "navalhado" }], "tira o navalhado do Rafael");
    const card = { kind: "service_changes_ref", items: [{ id: "n-barba", name: "Barba terapêutica" }, { id: "n-barba-exp", name: "Barba express" }] };
    expect(c.proposal).toBeUndefined(); expect(c.candidates).toEqual(card);
    expect(c.message).toBe("Tirando Navalhado de “Navalhado com barba”, fica barba. Qual serviço? Selecione uma opção real.");
    await turn(c, { service_changes: [{ mode: "REMOVE", service_name: "navalhado" }] }, "isso, sem o navalhado", norte);
    expect(c.proposal).toBeUndefined(); expect(c.candidates).toEqual(card);
    await selectScheduling(norte, c, "n-barba-exp", { clicked: true });
    expect(c.proposal!.action_snapshot).toMatchObject({ services: [expect.objectContaining({ id: "n-barba-exp" })], endLocal: "2026-10-02T17:20" }); noWrite();
  });
  it("the part left not registered apart (here or only in another salon): explained and asked, nothing proposed or kept", async () => {
    db.services.find(s => s.id === "n-barba")!.active = false;
    const c = fresh();
    await says(c, [{ mode: "REMOVE", service_name: "navalhado" }], "tira o navalhado do Rafael");
    expect(c.proposal).toBeUndefined(); expect(c.fields).not.toHaveProperty("service_changes"); expect(c.waiting_for).toBe("service_changes");
    expect(c.message).toBe("Tirando Navalhado de “Navalhado com barba”, fica barba, que não está cadastrado como serviço separado neste salão. Nada foi alterado. Quais serviços devo trocar, acrescentar ou tirar?");
    expect(JSON.stringify(c)).not.toContain("s-barba");
    const d = fresh();
    await says(d, [{ mode: "SET", service_name: "barba" }], "o Rafael vai fazer só a barba");
    expect(d.proposal).toBeUndefined();
    expect(d.message).toBe("“Navalhado com barba” junta Navalhado e barba; barba não está cadastrado como serviço separado neste salão. Nada foi alterado. Quais serviços devo trocar, acrescentar ou tirar?"); noWrite();
  });
  it("words naming the whole combo, and a label word of its name, are not a component: today's path (asked, never proposed)", async () => {
    const c = fresh();
    await says(c, [{ mode: "REMOVE", service_name: "navalhado com barba" }], "tira o navalhado com barba do Rafael");
    expect(c.proposal).toBeUndefined(); expect(c.message).toContain("Não dá para deixar o agendamento de Rafael Okada sem serviço (Navalhado com barba).");
    db.services.find(s => s.id === "n-combo")!.name = "Kit navalhado e barba"; db.appointments[db.appointments.length - 1] = booking([booked("n-combo", 8500)]);
    const d = fresh();
    await says(d, [{ mode: "REMOVE", service_name: "kit" }], "tira o kit do Rafael");
    expect(d.proposal).toBeUndefined(); expect(d.message).toContain("sem serviço (Kit navalhado e barba)");
    // The label ("Kit") left unsaid names no service apart: removing the navalhado still leaves the barba.
    const e = fresh();
    await says(e, [{ mode: "REMOVE", service_name: "navalhado" }], "tira o navalhado do Rafael");
    expect(e.proposal!.action_snapshot).toMatchObject({ services: [expect.objectContaining({ id: "n-barba" })] }); noWrite();
  });
  it("a three-service combo ('+'): the two parts left are proposed apart; asked when another combo also joins them (never picked)", async () => {
    db.services.push(service("n-sobr", "Sobrancelha", 15, 2000, norte.salonId), service("n-trio", "Navalhado + Barba + Sobrancelha", 85, 10000, norte.salonId));
    db.pros.find(p => p.id === "p-heitor")!.services.push("n-sobr", "n-trio");
    db.appointments[db.appointments.length - 1] = booking([booked("n-trio", 10000)]);
    const c = fresh();
    await says(c, [{ mode: "REMOVE", service_name: "sobrancelha" }], "tira a sobrancelha do Rafael");
    expect(c.proposal).toBeUndefined(); expect(c.fields).not.toHaveProperty("service_changes");
    expect(c.message).toBe("Tirando Sobrancelha de “Navalhado + Barba + Sobrancelha”, ficam Navalhado e Barba, e o catálogo também tem “Navalhado com barba”. Nada foi alterado. Quais serviços devo deixar no agendamento?");
    db.services.find(s => s.id === "n-combo")!.active = false;
    const d = fresh();
    await says(d, [{ mode: "REMOVE", service_name: "sobrancelha" }], "tira a sobrancelha do Rafael");
    expect(d.proposal!.action_snapshot).toMatchObject({ services: [expect.objectContaining({ id: "n-navalhado" }), expect.objectContaining({ id: "n-barba" })], endLocal: "2026-10-02T18:10" }); noWrite();
  });
  it("ONE entry joining services a combo joins ('troca pra navalhado e barba'): a card of the combo while they exist apart (never picked); the combo alone when not", async () => {
    db.appointments[db.appointments.length - 1] = booking([booked("n-hidra", 7000)]);
    const c = fresh();
    await says(c, [{ mode: "SET", service_name: "navalhado e barba" }], "troca o serviço do Rafael pra navalhado e barba");
    expect(c.proposal).toBeUndefined(); expect(c.candidates).toEqual({ kind: "service_changes_ref", items: [{ id: "n-combo", name: "Navalhado com barba" }] });
    expect(c.message).toBe("No catálogo, “Navalhado com barba” já junta navalhado e barba, e esses serviços também existem separados. Selecione esse serviço ou diga quais serviços separados devo usar. Nada foi alterado.");
    await selectScheduling(norte, c, "n-combo", { clicked: true });
    expect(c.proposal!.action_snapshot).toMatchObject({ services: [expect.objectContaining({ id: "n-combo" })], endLocal: "2026-10-02T18:10" });
    db.services.find(s => s.id === "n-navalhado")!.active = false;
    const d = fresh();
    await says(d, [{ mode: "SET", service_name: "navalhado e barba" }], "troca o serviço do Rafael pra navalhado e barba");
    expect(d.candidates).toBeUndefined(); expect(d.proposal!.action_snapshot).toMatchObject({ services: [expect.objectContaining({ id: "n-combo" })] }); noWrite();
  });
  it("flag off: today's path (a card of every match, the combo included)", async () => {
    vi.stubEnv("SALON_SECRETARY_MULTI_SERVICE", "false");
    const c = fresh();
    await says(c, [{ mode: "REMOVE", service_name: "navalhado" }], "tira o navalhado do Rafael");
    expect(c.proposal).toBeUndefined();
    expect(c.candidates).toEqual({ kind: "service_changes_ref", items: [{ id: "n-navalhado", name: "Navalhado" }, { id: "n-combo", name: "Navalhado com barba" }] }); noWrite();
  });
});

describe("05/10 owner (flag SALON_SECRETARY_SERVICE_SWAP_V2): a service swap on the appointment's day, and the service said by its exact name", () => {
  const day1 = (field: string, text: string) => ({ field, text, component: { kind: "DAY_OF_MONTH", day: 1, weekday: null, week: null, month: null, offset: null, year: null, days: null } });
  beforeEach(() => {
    vi.stubEnv("SALON_SECRETARY_SERVICE_SWAP_V2", "true");
    // "pezinho" is now also inside a combo: only the exact name is the service said.
    db.services.push(service("s-combo-pezinho", "Barba + Pezinho", 40, 4500));
    db.pros.find(pro => pro.id === "p-jonas")!.services.push("s-combo-pezinho");
  });
  it("'troque o serviço do Otávio do dia 1 para pezinho': ALTERAR at the same slot, no clock and no service card", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Otávio", service_changes: [{ mode: "SET", service_name: "pezinho" }], temporal_evidence: [day1("date", "do dia 1")] }, "troque o serviço do Otávio do dia 1 para pezinho");
    expect(c.candidates).toBeUndefined();
    expect(c.proposal!.action_snapshot).toMatchObject({ appointment_ref: "a-otavio", startLocal: "2026-10-01T16:00", services: [expect.objectContaining({ id: "s-pezinho" })] });
    expect(text(c.message)).toContain("Horário mantido.");noWrite();
  });
  it("'troca a barba do Otávio do dia 1 por pezinho': a swap is never asked as 'join the combo or add apart'", async () => {
    const c = fresh();
    await turn(c, { customer_name: "Otávio", service_changes: [{ mode: "REMOVE", service_name: "barba" }, { mode: "INCLUDE", service_name: "pezinho" }], temporal_evidence: [day1("date", "do dia 1")] },
      "troca a barba do Otávio do dia 1 por pezinho");
    expect(c.candidates).toBeUndefined();
    expect(c.proposal!.action_snapshot).toMatchObject({ appointment_ref: "a-otavio", services: [expect.objectContaining({ id: "s-corte" }), expect.objectContaining({ id: "s-pezinho" })] });noWrite();
  });
  it("flag off: the owner's report of 05/10 (the day withdrawn as a divergence, both dates asked)", async () => {
    vi.stubEnv("SALON_SECRETARY_SERVICE_SWAP_V2", "false");
    const c = fresh();
    await turn(c, { customer_name: "Otávio", service_changes: [{ mode: "SET", service_name: "pezinho" }], temporal_evidence: [day1("date", "do dia 1")] }, "troque o serviço do Otávio do dia 1 para pezinho");
    expect(c.proposal).toBeUndefined();
    expect(c.message).toContain("Preciso confirmar data original e data de destino");noWrite();
  });
});
