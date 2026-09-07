import { describe, expect, it } from "vitest";
import { prisma } from "../prisma";
import { withSalon } from "../prisma-tenant";
import { assertSafeDatabaseOperation } from "../database-safety";
import { createAppointment, rescheduleAppointment, updateAppointmentStatusReliably } from "../appointment-service";
import { joinFlexibleWaitlist, promoteFlexible } from "../flexible-waitlist";
import { addCalendarDays, dateKeyInTimeZone } from "../time";
import { requireCareAppointment } from "../care-access";

const pg = process.env.RUN_POSTGRES_INTEGRATION === "1" ? describe : describe.skip;
async function fixture() {
  assertSafeDatabaseOperation(process.env, { operation: "product019-integration" });
  const suffix = crypto.randomUUID();
  const salon = await prisma.salon.create({ data: { slug: `product019-${suffix}`, name: "Produto CI", plan: "PRO", accessStatus: "APPROVED", timezone: "America/Sao_Paulo" } });
  const resource = await prisma.physicalResource.create({ data: { salonId: salon.id, name: "Sala exclusiva", kind: "ROOM" } });
  const users = await Promise.all([0, 1].map(i => prisma.user.create({ data: { email: `${suffix}-${i}@example.test`, name: `Profissional ${i}`, passwordHash: "fixture-only" } })));
  const professionals = await Promise.all(users.map(u => prisma.professional.create({ data: { salonId: salon.id, userId: u.id } })));
  const service = await prisma.service.create({ data: { salonId: salon.id, name: "Tratamento — longo", durationMin: 60, processingMin: 20, finishingMin: 10, priceCents: 9000, physicalResourceId: resource.id, professionals: { create: professionals.map(p => ({ professionalId: p.id })) } } });
  const clients = await Promise.all([0, 1].map(i => prisma.clientProfile.create({ data: { salonId: salon.id, name: `Titular ${i}` } })));
  const date = addCalendarDays(dateKeyInTimeZone(new Date(), salon.timezone), 2);
  await prisma.professionalOpening.createMany({ data: professionals.map(p => ({ salonId: salon.id, professionalId: p.id, dateKey: date, startMinutes: 480, endMinutes: 1200, reason: "Teste isolado" })) });
  const input = (pro = 0, client = 0, time = "10:00") => ({ salonId: salon.id, professionalId: professionals[pro]!.id, clientId: clients[client]!.id, serviceIds: [service.id], startLocal: `${date}T${time}`, origin: "PUBLIC" as const, enforceBookingWindow: true, idempotencyKey: crypto.randomUUID(), actor: { type: "CLIENT" as const, id: clients[client]!.id, name: clients[client]!.name } });
  return { salon, resource, users, professionals, service, clients, date, input };
}

pg("produto 019 em PostgreSQL descartável", () => {
  it("serializes two professionals competing for the same room and releases it on cancellation", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([0, 1].map(i => withSalon(f.salon.id, tx => createAppointment(tx, f.input(i, i)))));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    const winner = results.find(r => r.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof createAppointment>>>;
    const id = winner.value.appointment.id;
    const snapshots = await withSalon(f.salon.id, tx => tx.appointmentService.findMany({ where: { salonId: f.salon.id, appointmentId: id } }));
    expect(snapshots[0]).toMatchObject({ processingMin: 20, finishingMin: 10 });
    await withSalon(f.salon.id, tx => updateAppointmentStatusReliably(tx, { salonId: f.salon.id, appointmentId: id, status: "CANCELLED", expectedVersion: 1, idempotencyKey: crypto.randomUUID(), reason: "Cancelamento de teste", actor: { type: "STAFF", id: f.users[0]!.id, name: "Equipe" } }));
    expect(await withSalon(f.salon.id, tx => tx.resourceBooking.count({ where: { salonId: f.salon.id, appointmentId: id, active: false } }))).toBe(1);
    await expect(withSalon(f.salon.id, tx => createAppointment(tx, f.input()))).resolves.toHaveProperty("appointment");
  });
  it("rejects a resource conflict during rescheduling without losing the original booking", async () => {
    const f = await fixture();
    const first = await withSalon(f.salon.id, tx => createAppointment(tx, f.input(0, 0, "10:00")));
    const second = await withSalon(f.salon.id, tx => createAppointment(tx, f.input(1, 1, "12:00")));
    await expect(withSalon(f.salon.id, tx => rescheduleAppointment(tx, { salonId: f.salon.id, appointmentId: second.appointment.id, professionalId: f.professionals[1]!.id, startLocal: `${f.date}T10:00`, expectedVersion: 1, idempotencyKey: crypto.randomUUID(), enforceClientPolicy: false, actor: { type: "STAFF", id: f.users[0]!.id, name: "Equipe" } }))).rejects.toThrow();
    const current = await withSalon(f.salon.id, tx => tx.appointment.findFirstOrThrow({ where: { id: second.appointment.id, salonId: f.salon.id } }));
    expect(+current.startAt).toBe(+second.appointment.startAt);
    expect(+current.startAt).not.toBe(+first.appointment.startAt);
  });
  it("ties dependents to the correct titular and preserves the beneficiary snapshot", async () => {
    const f = await fixture();
    const dependent = await withSalon(f.salon.id, tx => tx.clientDependent.create({ data: { salonId: f.salon.id, clientId: f.clients[0]!.id, name: "Dependente CI", relationship: "Filho" } }));
    await expect(withSalon(f.salon.id, tx => createAppointment(tx, { ...f.input(0, 1), dependentId: dependent.id }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    const booking = await withSalon(f.salon.id, tx => createAppointment(tx, { ...f.input(), dependentId: dependent.id }));
    await withSalon(f.salon.id, tx => tx.clientDependent.updateMany({ where: { id: dependent.id, salonId: f.salon.id }, data: { name: "Nome atualizado", active: false } }));
    expect(await withSalon(f.salon.id, tx => tx.appointment.findFirst({ where: { id: booking.appointment.id, salonId: f.salon.id } }))).toMatchObject({ clientId: f.clients[0]!.id, dependentName: "Dependente CI" });
  });
  it("enforces FIFO for compatible flexible requests and prevents double promotion", async () => {
    const f = await fixture();
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    for (const [index, id] of ids.entries()) await withSalon(f.salon.id, tx => joinFlexibleWaitlist(tx, f.salon.id, f.clients[index]!.id, { id, professionalId: f.professionals[0]!.id, serviceIds: [f.service.id], fromDate: f.date, toDate: f.date, startMinutes: 540, endMinutes: 1020 }));
    const ctx = { salonId: f.salon.id, userId: f.users[0]!.id };
    await expect(withSalon(f.salon.id, tx => promoteFlexible(tx, ctx, ids[1]!, `${f.date}T10:00`))).rejects.toThrow("anterior");
    const results = await Promise.all([0, 1].map(() => withSalon(f.salon.id, tx => promoteFlexible(tx, ctx, ids[0]!, `${f.date}T10:00`))));
    expect(results[0]!.appointmentId).toBe(results[1]!.appointmentId);
    expect(await withSalon(f.salon.id, tx => tx.appointment.count({ where: { salonId: f.salon.id } }))).toBe(1);
  });
  it("rejects care access by reception and another professional", async () => {
    const f = await fixture(); const booking = await withSalon(f.salon.id, tx => createAppointment(tx, f.input()));
    await expect(withSalon(f.salon.id, tx => requireCareAppointment(tx, { salonId: f.salon.id, userId: f.users[1]!.id, role: "PROFESSIONAL" }, booking.appointment.id))).rejects.toThrow();
    await expect(withSalon(f.salon.id, tx => requireCareAppointment(tx, { salonId: f.salon.id, userId: f.users[0]!.id, role: "RECEPTIONIST" }, booking.appointment.id))).rejects.toThrow();
    await expect(withSalon(f.salon.id, tx => requireCareAppointment(tx, { salonId: f.salon.id, userId: f.users[0]!.id, role: "PROFESSIONAL" }, booking.appointment.id))).resolves.toHaveProperty("id");
  });
  it("enforces tenant RLS without BYPASSRLS, composite FKs and append-only care grants", async () => {
    const f = await fixture(); const other = await fixture();
    await prisma.$executeRawUnsafe('CREATE ROLE product019_test NOLOGIN NOSUPERUSER NOBYPASSRLS');
    await prisma.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO product019_test');
    await prisma.$executeRawUnsafe('GRANT SELECT, INSERT, UPDATE, DELETE ON "PhysicalResource", "ResourceBooking", "ClientDependent", "FlexibleWaitlist", "FlexibleWaitlistService" TO product019_test');
    await prisma.$executeRawUnsafe('GRANT SELECT, INSERT ON "CareEntry" TO product019_test');
    const visible = await withSalon(f.salon.id, async tx => { await tx.$executeRawUnsafe('SET LOCAL ROLE product019_test'); return tx.physicalResource.findMany(); });
    expect(visible.map(r => r.id)).toEqual([f.resource.id]);
    await expect(withSalon(f.salon.id, async tx => { await tx.$executeRawUnsafe('SET LOCAL ROLE product019_test'); return tx.physicalResource.create({ data: { salonId: other.salon.id, name: "Cross tenant", kind: "ROOM" } }); })).rejects.toThrow();
    await expect(withSalon(f.salon.id, async tx => { await tx.$executeRawUnsafe('SET LOCAL ROLE product019_test'); return tx.clientDependent.create({ data: { salonId: f.salon.id, clientId: other.clients[0]!.id, name: "Cross parent", relationship: "Filho" } }); })).rejects.toThrow();
    await expect(withSalon(f.salon.id, async tx => { await tx.$executeRawUnsafe('SET LOCAL ROLE product019_test'); return tx.careEntry.deleteMany({ where: { salonId: f.salon.id } }); })).rejects.toThrow();
    const none = await prisma.$transaction(async tx => { await tx.$executeRawUnsafe('SET LOCAL ROLE product019_test'); return tx.physicalResource.findMany(); });
    expect(none).toEqual([]);
  });
});
