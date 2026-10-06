import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi, describe } from "vitest";
import { assertMvpTestDatabase } from "../../../scripts/service-mvp-test-safety";
import { prisma } from "../prisma";
import { withTenant } from "../prisma-tenant";
import { SalonSecretary } from "../salon-secretary";
import { applySchedulingInterpretation, schedulingState, selectScheduling, type SchedulingState } from "../secretary-scheduling";
import { confirmAppointmentCreate } from "../scheduling-actions";
import { addCalendarDays, dateKeyInTimeZone, localDateTimeToUtc } from "../time";
import { ScriptedServicesModel, call } from "../../test/scripted-services-model";
import { intent, plan } from "../../test/secretary-capability-plan";

/** P2a (flag SALON_SECRETARY_ALTER_APPOINTMENT) on the local disposable PostgreSQL (coordinator only:
 * RUN_SERVICE_MVP_INTEGRATION=1, the MVP test database preflight). The real adapter, journal, change snapshot and domain
 * executor (requestStaffReschedule): a new professional at the same slot, a new service list with the catalog's duration and
 * price, the version and idempotency checks, a collision by the longer duration, a target booked between the proposal and
 * Confirmar, an account customer's acceptance, a professional who does not perform the service, tenant isolation, and the
 * V1 plan route with a scripted (fake) model. Synthetic barbershop "Pezinho"; no network, no paid model. */
const suite = process.env.RUN_SERVICE_MVP_INTEGRATION === "1" ? describe : describe.skip;
const admin = new PrismaClient({ datasources: { db: { url: process.env.MVP_TEST_ADMIN_URL ?? process.env.DATABASE_URL } } });
const tz = "America/Sao_Paulo";
async function fixture() {
  const salonId = randomUUID();
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${salonId},true)`;
    const owner = await tx.user.create({ data: { name: "Dona Regina Sintética", email: `alter-owner-${salonId}@example.test`, passwordHash: "synthetic-no-login" } });
    await tx.salon.create({ data: { id: salonId, name: "Barbearia Pezinho Sintética", slug: `alter-${salonId}`, accessStatus: "APPROVED", plan: "PRO", timezone: tz } });
    await tx.membership.create({ data: { salonId, userId: owner.id, role: "OWNER" } });
    const service = (name: string, durationMin: number, priceCents: number) => tx.service.create({ data: { salonId, name, durationMin, priceCents } });
    const corte = await service("Corte", 30, 4500), barba = await service("Barba", 20, 3000), pezinho = await service("Pezinho", 15, 1200), sobrancelha = await service("Sobrancelha", 15, 1500);
    const pro = async (name: string, services: { id: string }[]) => {
      const user = await tx.user.create({ data: { name, email: `alter-${name.split(" ")[0].toLowerCase()}-${salonId}@example.test`, passwordHash: "synthetic-no-login" } });
      const professional = await tx.professional.create({ data: { salonId, userId: user.id } });
      for (const s of services) await tx.professionalService.create({ data: { serviceId: s.id, professionalId: professional.id } });
      await tx.workingHours.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ salonId, professionalId: professional.id, weekday, startMinutes: 540, endMinutes: 1140 })) });
      return professional;
    };
    const jonas = await pro("Jonas Ferraz", [corte, barba, pezinho]), yasmin = await pro("Yasmin Toledo", [corte, pezinho, sobrancelha]), caua = await pro("Cauã Ribeiro", [barba]);
    const luana = await tx.clientProfile.create({ data: { salonId, name: "Luana Prado" } });
    const otavio = await tx.clientProfile.create({ data: { salonId, name: "Otávio Mendes", passwordHash: "synthetic-account-never-model" } });
    const kauan = await tx.clientProfile.create({ data: { salonId, name: "Kauan Reis" } });
    return { actor: { salonId, userId: owner.id }, corte, barba, pezinho, sobrancelha, jonas, yasmin, caua, luana, otavio, kauan, date: addCalendarDays(dateKeyInTimeZone(new Date(), tz), 1) };
  });
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
/** A booked appointment; `priceCents` is the price it was sold at (the catalog may have changed since). */
async function book(f: Fixture, client: { id: string }, professional: { id: string }, time: string, items: { service: { id: string; name: string; durationMin: number }; priceCents: number }[]) {
  return admin.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon',${f.actor.salonId},true)`;
    const startAt = localDateTimeToUtc(`${f.date}T${time}`, tz), endAt = new Date(+startAt + items.reduce((sum, item) => sum + item.service.durationMin, 0) * 60_000);
    return tx.appointment.create({ data: { salonId: f.actor.salonId, clientId: client.id, professionalId: professional.id, serviceId: items[0].service.id, startAt, endAt, timezone: tz,
      priceCents: items.reduce((sum, item) => sum + item.priceCents, 0), status: "CONFIRMED",
      serviceItems: { create: items.map((item, position) => ({ serviceId: item.service.id, position, serviceName: item.service.name, durationMin: item.service.durationMin, priceCents: item.priceCents })) } } });
  });
}
const read = (f: Fixture, id: string) => withTenant(f.actor, tx => tx.appointment.findFirstOrThrow({ where: { id, salonId: f.actor.salonId },
  select: { professionalId: true, startAt: true, endAt: true, priceCents: true, version: true, serviceId: true, serviceItems: { orderBy: { position: "asc" }, select: { serviceId: true, position: true, priceCents: true } } } }));
const fresh = (): SchedulingState => ({ ...schedulingState(), operation: "appointment.change" });
const turn = (f: Fixture, c: SchedulingState, fields: Record<string, unknown>, message: string) => applySchedulingInterpretation(f.actor, c, { operation: "appointment.change", ...fields } as never, message);
const confirm = (f: Fixture, c: SchedulingState) => withTenant(f.actor, tx => confirmAppointmentCreate(tx, f.actor, { proposal_ref: c.proposal!.proposal_ref, draft_revision: c.proposal!.draft_revision }));

suite("P2a alter an appointment's data / PostgreSQL / domain executor", () => {
  const network = vi.fn(() => { throw Error("NETWORK_FORBIDDEN"); });
  beforeAll(async () => { console.log("P2A_PREFLIGHT", await assertMvpTestDatabase(admin)); expect(process.env.SALON_SECRETARY_ALLOW_PAID_CALLS).toBe("false"); vi.stubGlobal("fetch", network); });
  beforeEach(() => { vi.stubEnv("SALON_SECRETARY_ALTER_APPOINTMENT", "true"); });
  afterEach(() => { vi.unstubAllEnvs(); vi.stubGlobal("fetch", network); });
  afterAll(async () => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); await admin.$disconnect(); await prisma.$disconnect(); });

  it("a new professional at the same slot: executed once, booked price kept, version incremented, idempotent journal", async () => {
    const f = await fixture(), a = await book(f, f.luana, f.jonas, "14:00", [{ service: f.corte, priceCents: 4000 }]), before = await read(f, a.id);
    const c = fresh();
    await turn(f, c, { customer_name: "Luana", target_professional_name: "Yasmin" }, "A Luana vai ser com a Yasmin em vez do Jonas, mesmo horário");
    expect(c.proposal?.action_snapshot).toMatchObject({ professional_ref: f.yasmin.id, before_professional_ref: f.jonas.id, startLocal: `${f.date}T14:00`, priceCents: 4000, requires_acceptance: false });
    expect((await read(f, a.id)).professionalId).toBe(f.jonas.id);
    const receipt = await confirm(f, c), after = await read(f, a.id);
    expect(receipt).toMatchObject({ outcome: "RESCHEDULED", duplicate: false });
    expect(after).toMatchObject({ professionalId: f.yasmin.id, startAt: before.startAt, endAt: before.endAt, priceCents: 4000, version: before.version + 1 });
    expect(after.serviceItems.map(item => item.serviceId)).toEqual([f.corte.id]);
    expect(await confirm(f, c)).toMatchObject({ duplicate: true }); expect((await read(f, a.id)).version).toBe(before.version + 1);
  });
  it("a new service list: catalog duration and price, the items in order, the slot kept", async () => {
    const f = await fixture(), a = await book(f, f.luana, f.jonas, "14:00", [{ service: f.corte, priceCents: 4000 }]), before = await read(f, a.id);
    const c = fresh();
    await turn(f, c, { customer_name: "Luana", service_changes: [{ mode: "SET", service_name: "barba" }, { mode: "SET", service_name: "pezinho" }] }, "Troque o serviço da Luana para barba e pezinho");
    expect(c.proposal?.action_snapshot).toMatchObject({ priceCents: 4200, before_price_cents: 4000, endLocal: `${f.date}T14:35` });
    await confirm(f, c);
    const after = await read(f, a.id);
    expect(after).toMatchObject({ professionalId: f.jonas.id, startAt: before.startAt, priceCents: 4200, serviceId: f.barba.id });
    expect(after.endAt.getTime() - after.startAt.getTime()).toBe(35 * 60_000);
    expect(after.serviceItems.map(item => [item.serviceId, item.position])).toEqual([[f.barba.id, 0], [f.pezinho.id, 1]]);
  });
  it("a longer duration that collides with the next client: no proposal, the free times for the new duration", async () => {
    const f = await fixture(), a = await book(f, f.luana, f.jonas, "14:00", [{ service: f.corte, priceCents: 4000 }]);
    await book(f, f.kauan, f.jonas, "14:30", [{ service: f.corte, priceCents: 4500 }]);
    const c = fresh();
    await turn(f, c, { customer_name: "Luana", service_changes: [{ mode: "INCLUDE", service_name: "barba" }] }, "A Luana vai fazer barba também");
    expect(c.proposal).toBeUndefined(); expect(c.waiting_for).toBe("time"); expect(c.message).toMatch(/^Esse horário está indisponível/);
    expect(c.alternatives!.length).toBeGreaterThan(0);
    expect((await read(f, a.id)).serviceItems).toHaveLength(1);
  });
  it("the target booked between the proposal and Confirmar: nothing is written", async () => {
    const f = await fixture(), a = await book(f, f.luana, f.jonas, "14:00", [{ service: f.corte, priceCents: 4000 }]), before = await read(f, a.id);
    const c = fresh();
    await turn(f, c, { customer_name: "Luana", target_professional_name: "Yasmin" }, "Passa a Luana pra Yasmin, mesmo horário");
    expect(c.proposal).toBeDefined();
    await book(f, f.kauan, f.yasmin, "14:00", [{ service: f.pezinho, priceCents: 1200 }]);
    await expect(confirm(f, c)).rejects.toThrow(/SLOT_CONFLICT|SCHEDULE_CHANGED|SLOT_TAKEN/);
    expect(await read(f, a.id)).toEqual(before);
  });
  it("an account customer: the change awaits their acceptance (PENDING_ACCEPTANCE, a pending proposal), as the preview said", async () => {
    const f = await fixture(), a = await book(f, f.otavio, f.jonas, "16:00", [{ service: f.corte, priceCents: 4000 }]);
    const c = fresh();
    await turn(f, c, { customer_name: "Otávio", target_professional_name: "Yasmin" }, "O Otávio vai ser com a Yasmin");
    expect(c.proposal?.action_snapshot?.requires_acceptance).toBe(true); expect(c.message).toContain("A alteração ficará aguardando o aceite do cliente.");
    expect(await confirm(f, c)).toMatchObject({ outcome: "PENDING_ACCEPTANCE" });
    const proposals = await withTenant(f.actor, tx => tx.rescheduleProposal.findMany({ where: { salonId: f.actor.salonId, appointmentId: a.id }, select: { status: true, targetProfessionalId: true } }));
    expect(proposals).toEqual([expect.objectContaining({ status: "PENDING", targetProfessionalId: f.yasmin.id })]);
  });
  it("a professional who does not perform the service: asked with who does, nothing proposed; the click is re-checked", async () => {
    const f = await fixture(), a = await book(f, f.luana, f.jonas, "14:00", [{ service: f.corte, priceCents: 4000 }]);
    const c = fresh();
    await turn(f, c, { customer_name: "Luana", target_professional_name: "Cauã" }, "Passa a Luana pro Cauã");
    expect(c.proposal).toBeUndefined(); expect(c.message).toContain("Cauã Ribeiro não faz Corte.");
    expect(c.candidates?.items.map(item => item.id)).toEqual([f.yasmin.id]);
    await selectScheduling(f.actor, c, f.yasmin.id, { clicked: true });
    expect(c.proposal?.action_snapshot?.professional_ref).toBe(f.yasmin.id);
    expect((await read(f, a.id)).professionalId).toBe(f.jonas.id);
  });
  it("tenant isolation: another salon never locates this appointment nor its professionals", async () => {
    const f = await fixture(), other = await fixture(), a = await book(f, f.luana, f.jonas, "14:00", [{ service: f.corte, priceCents: 4000 }]);
    const c = fresh();
    await applySchedulingInterpretation(other.actor, c, { operation: "appointment.change", customer_name: "Luana", target_professional_name: "Yasmin" } as never, "Passa a Luana pra Yasmin");
    expect(c.proposal?.action_snapshot?.appointment_ref).not.toBe(a.id);
    expect((await read(f, a.id)).professionalId).toBe(f.jonas.id);
  });
  it("V1 plan route with a scripted model: validated selection, projection, proposal and the authenticated confirmation", async () => {
    const f = await fixture(), a = await book(f, f.luana, f.jonas, "14:00", [{ service: f.corte, priceCents: 4000 }]);
    const fake = new ScriptedServicesModel([call("select_capabilities", plan([intent("appointment.change", { customer_name: "Luana", target_professional_name: "Yasmin", service_changes: null })]))]);
    const secretary = new SalonSecretary(async () => fake, () => "fake-p2a"), session = (await secretary.start(f.actor, "auto")).sessionId;
    const state = await secretary.send(f.actor, { sessionId: session, message: "A Luana vai ser com a Yasmin, mesmo horário" });
    const scheduling = state.operations![0].state.scheduling!;
    expect(scheduling.proposal?.action_snapshot?.professional_ref).toBe(f.yasmin.id);
    await secretary.confirmAutomatic(f.actor, session, state.operations![0].operation_ref, { proposal_ref: scheduling.proposal!.proposal_ref, draft_revision: scheduling.proposal!.draft_revision });
    expect((await read(f, a.id)).professionalId).toBe(f.yasmin.id);
  });
});
