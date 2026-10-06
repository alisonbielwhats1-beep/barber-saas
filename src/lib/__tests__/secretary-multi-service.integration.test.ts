import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi, describe } from "vitest";
import { assertMvpTestDatabase } from "../../../scripts/service-mvp-test-safety";
import { prisma } from "../prisma";
import { withTenant } from "../prisma-tenant";
import { applySchedulingInterpretation, schedulingState, selectScheduling, type SchedulingState } from "../secretary-scheduling";
import { confirmAppointmentCreate } from "../scheduling-actions";
import { SEPARATE_SERVICES_REF } from "../secretary-multi-service";
import { addCalendarDays, dateKeyInTimeZone, localDateTimeToUtc } from "../time";

/** P2b (flag SALON_SECRETARY_MULTI_SERVICE) on the local disposable PostgreSQL (coordinator only:
 * RUN_SERVICE_MVP_INTEGRATION=1, the MVP test database preflight). The real adapter, journal, availability (visit engine),
 * create snapshot and domain executor (createVisit → createAppointment): two and three services become ONE appointment with
 * the AppointmentService items in the order said and the summed duration and price; idempotency; a collision by the summed
 * duration; a catalog combo asked (combo or apart, never both); the professional who performs every service; tenant
 * isolation; availability is read-only. Synthetic barbearia "Navalha" and esmalteria "Lótus"; no network, no paid model. */
const suite = process.env.RUN_SERVICE_MVP_INTEGRATION === "1" ? describe : describe.skip;
const admin = new PrismaClient({ datasources: { db: { url: process.env.MVP_TEST_ADMIN_URL ?? process.env.DATABASE_URL } } });
const tz = "America/Sao_Paulo";
async function fixture(kind: "navalha" | "lotus" = "navalha") {
  const salonId = randomUUID();
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${salonId},true)`;
    const owner = await tx.user.create({ data: { name: "Dona Célia Sintética", email: `multi-owner-${salonId}@example.test`, passwordHash: "synthetic-no-login" } });
    await tx.salon.create({ data: { id: salonId, name: kind === "navalha" ? "Barbearia Navalha Sintética" : "Esmalteria Lótus Sintética", slug: `multi-${salonId}`, accessStatus: "APPROVED", plan: "PRO", timezone: tz } });
    await tx.membership.create({ data: { salonId, userId: owner.id, role: "OWNER" } });
    const service = (name: string, durationMin: number, priceCents: number) => tx.service.create({ data: { salonId, name, durationMin, priceCents } });
    const pro = async (name: string, services: { id: string }[]) => {
      const user = await tx.user.create({ data: { name, email: `multi-${name.split(" ")[0].toLowerCase()}-${salonId}@example.test`, passwordHash: "synthetic-no-login" } });
      const professional = await tx.professional.create({ data: { salonId, userId: user.id } });
      for (const s of services) await tx.professionalService.create({ data: { serviceId: s.id, professionalId: professional.id } });
      await tx.workingHours.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ salonId, professionalId: professional.id, weekday, startMinutes: 540, endMinutes: 1140 })) });
      return professional;
    };
    const corte = await service(kind === "navalha" ? "Corte" : "Pé", kind === "navalha" ? 30 : 40, kind === "navalha" ? 4500 : 3500);
    const barba = await service(kind === "navalha" ? "Barba" : "Mão", kind === "navalha" ? 20 : 30, 3000);
    const pezinho = await service(kind === "navalha" ? "Pezinho" : "Esmaltação em gel", kind === "navalha" ? 15 : 60, kind === "navalha" ? 1200 : 8000);
    const caio = await pro(kind === "navalha" ? "Caio Brito" : "Jade Moura", [corte, barba, pezinho]), lia = await pro(kind === "navalha" ? "Lia Moraes" : "Bia Castro", [corte]);
    const kevin = await tx.clientProfile.create({ data: { salonId, name: kind === "navalha" ? "Kevin Sato" : "Yasmin Alves" } });
    const duda = await tx.clientProfile.create({ data: { salonId, name: "Duda Ramos" } });
    return { actor: { salonId, userId: owner.id }, corte, barba, pezinho, caio, lia, kevin, duda, date: addCalendarDays(dateKeyInTimeZone(new Date(), tz), 1) };
  });
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function book(f: Fixture, client: { id: string }, professional: { id: string }, time: string, service: { id: string; name: string; durationMin: number; priceCents: number }) {
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${f.actor.salonId},true)`;
    const startAt = localDateTimeToUtc(`${f.date}T${time}`, tz), endAt = new Date(+startAt + service.durationMin * 60_000);
    return tx.appointment.create({ data: { salonId: f.actor.salonId, clientId: client.id, professionalId: professional.id, serviceId: service.id, startAt, endAt, timezone: tz, priceCents: service.priceCents, status: "CONFIRMED",
      serviceItems: { create: [{ serviceId: service.id, position: 0, serviceName: service.name, durationMin: service.durationMin, priceCents: service.priceCents }] } } });
  });
}
const appointments = (f: Fixture) => withTenant(f.actor, tx => tx.appointment.findMany({ where: { salonId: f.actor.salonId }, orderBy: { startAt: "asc" },
  select: { id: true, clientId: true, professionalId: true, startAt: true, endAt: true, priceCents: true, serviceId: true, serviceItems: { orderBy: { position: "asc" }, select: { serviceId: true, position: true, durationMin: true, priceCents: true } } } }));
const day = { kind: "RELATIVE_DAY", offset: 1, weekday: null, week: null, day: null, month: null, year: null, days: null };
const when = [{ field: "date", text: "amanhã", component: day }, { field: "time", text: "às 10", component: { hour: 10, minute: 0, daypart: "UNSPECIFIED" } }];
const fresh = (operation = "appointment.create"): SchedulingState => ({ ...schedulingState(), operation: operation as SchedulingState["operation"] });
const turn = (f: Fixture, c: SchedulingState, fields: Record<string, unknown>, message: string) =>
  applySchedulingInterpretation(f.actor, c, { operation: c.operation, ...fields } as never, message, { askUnprovenService: true });
const confirm = (f: Fixture, c: SchedulingState) => withTenant(f.actor, tx => confirmAppointmentCreate(tx, f.actor, { proposal_ref: c.proposal!.proposal_ref, draft_revision: c.proposal!.draft_revision }));

suite("P2b several services in one appointment / PostgreSQL / domain executor", () => {
  const network = vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); });
  beforeAll(async () => { console.log("P2B_PREFLIGHT", await assertMvpTestDatabase(admin)); expect(process.env.SALON_SECRETARY_ALLOW_PAID_CALLS).toBe("false"); vi.stubGlobal("fetch", network); });
  beforeEach(() => { vi.stubEnv("SALON_SECRETARY_MULTI_SERVICE", "true"); vi.stubEnv("SALON_SECRETARY_TEMPORAL_COMPONENTS", "true"); });
  afterEach(() => { vi.unstubAllEnvs(); vi.stubGlobal("fetch", network); });
  afterAll(async () => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); await admin.$disconnect(); await prisma.$disconnect(); });

  it("two services: ONE appointment, items in the order said, summed duration and price; idempotent", async () => {
    const f = await fixture(), c = fresh();
    await turn(f, c, { customer_name: "Kevin", service_names: ["corte", "barba"], professional_name: "Caio", temporal_evidence: when }, "Marca corte e barba pro Kevin amanhã às 10 com o Caio");
    expect(c.proposal?.snapshot).toMatchObject({ durationMin: 50, priceCents: 7500, startLocal: `${f.date}T10:00`, endLocal: `${f.date}T10:50` });
    expect(await appointments(f)).toEqual([]);
    expect(await confirm(f, c)).toMatchObject({ duplicate: false });
    const [row, ...rest] = await appointments(f);
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ clientId: f.kevin.id, professionalId: f.caio.id, serviceId: f.corte.id, priceCents: 7500 });
    expect(row.endAt.getTime() - row.startAt.getTime()).toBe(50 * 60_000);
    expect(row.serviceItems.map(item => [item.serviceId, item.position, item.durationMin, item.priceCents])).toEqual([[f.corte.id, 0, 30, 4500], [f.barba.id, 1, 20, 3000]]);
    expect(await confirm(f, c)).toMatchObject({ duplicate: true }); expect(await appointments(f)).toHaveLength(1);
  });
  it("three services in an esmalteria: one appointment of 130 min", async () => {
    const f = await fixture("lotus"), c = fresh();
    await turn(f, c, { customer_name: "Yasmin", service_names: ["pé", "mão", "esmaltação em gel"], professional_name: "Jade", temporal_evidence: when }, "Coloca pé, mão e esmaltação em gel pra Yasmin amanhã às 10 com a Jade");
    await confirm(f, c);
    const [row] = await appointments(f);
    expect(row.endAt.getTime() - row.startAt.getTime()).toBe(130 * 60_000);
    expect(row.serviceItems.map(item => item.serviceId)).toEqual([f.corte.id, f.barba.id, f.pezinho.id]);
  });
  it("the summed duration collides with the next client: no proposal, free times for the whole visit, nothing written", async () => {
    const f = await fixture();
    await book(f, f.duda, f.caio, "10:30", f.corte);
    const c = fresh();
    await turn(f, c, { customer_name: "Kevin", service_names: ["corte", "barba"], professional_name: "Caio", temporal_evidence: when }, "Marca corte e barba pro Kevin amanhã às 10 com o Caio");
    expect(c.proposal).toBeUndefined(); expect(c.message).toMatch(/^Esse horário está indisponível/); expect(c.alternatives!.length).toBeGreaterThan(0);
    expect(await appointments(f)).toHaveLength(1);
  });
  it("a catalog combo beside its parts is asked; apart books two items, the combo one item — never both", async () => {
    const f = await fixture();
    const combo = await admin.$transaction(async tx => { await tx.$executeRaw`SELECT set_config('app.current_salon',${f.actor.salonId},true)`;
      const s = await tx.service.create({ data: { salonId: f.actor.salonId, name: "Corte e barba", durationMin: 45, priceCents: 6500 } });
      await tx.professionalService.create({ data: { serviceId: s.id, professionalId: f.caio.id } }); return s; });
    const c = fresh();
    await turn(f, c, { customer_name: "Kevin", service_names: ["corte", "barba"], professional_name: "Caio", temporal_evidence: when }, "Marca corte e barba pro Kevin amanhã às 10 com o Caio");
    expect(c.candidates?.kind).toBe("service_combo_ref"); expect(c.proposal).toBeUndefined();
    await selectScheduling(f.actor, c, combo.id, { clicked: true });
    await confirm(f, c);
    expect((await appointments(f)).map(row => row.serviceItems.map(item => item.serviceId))).toEqual([[combo.id]]);
    const d = fresh();
    await turn(f, d, { customer_name: "Duda", service_names: ["corte", "barba"], professional_name: "Caio", temporal_evidence: [when[0], { field: "time", text: "às 15", component: { hour: 15, minute: 0, daypart: "UNSPECIFIED" } }] },
      "Marca corte e barba pro Duda amanhã às 15 com o Caio");
    await selectScheduling(f.actor, d, SEPARATE_SERVICES_REF, { clicked: true });
    await confirm(f, d);
    expect((await appointments(f)).map(row => row.serviceItems.map(item => item.serviceId))).toEqual([[combo.id], [f.corte.id, f.barba.id]]);
  });
  it("the professional must perform every service: who does is offered and the click is re-checked", async () => {
    const f = await fixture(), c = fresh();
    await turn(f, c, { customer_name: "Kevin", service_names: ["corte", "barba"], professional_name: "Lia", temporal_evidence: when }, "Marca corte e barba pro Kevin amanhã às 10 com a Lia");
    expect(c.proposal).toBeUndefined(); expect(c.candidates?.items.map(item => item.id)).toEqual([f.caio.id]);
    await expect(selectScheduling(f.actor, c, f.lia.id)).rejects.toThrow("SELECTION_INVALID");
    await selectScheduling(f.actor, c, f.caio.id, { clicked: true });
    expect(c.proposal?.snapshot?.professional_ref).toBe(f.caio.id); expect(await appointments(f)).toEqual([]);
  });
  it("tenant isolation: another salon's services are not found; availability is read-only", async () => {
    const f = await fixture(), other = await fixture("lotus"), c = fresh();
    await turn(f, c, { customer_name: "Kevin", service_names: ["corte", "esmaltação em gel"], professional_name: "Caio", temporal_evidence: when }, "Marca corte e esmaltação em gel pro Kevin amanhã às 10 com o Caio");
    expect(c.proposal).toBeUndefined(); expect(c.message).toContain("Não encontrei o serviço “esmaltação em gel” neste salão.");
    const read = fresh("availability.get");
    await applySchedulingInterpretation(other.actor, read, { operation: "availability.get", service_names: ["pé", "mão"], professional_name: "Jade", temporal_evidence: [when[0]] } as never, "Tem horário amanhã pra pé e mão com a Jade?");
    expect(read.message).toMatch(/^Horários livres de Jade para Pé \+ Mão/); expect(await appointments(other)).toEqual([]);
  });
});
