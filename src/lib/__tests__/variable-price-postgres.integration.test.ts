import { describe, expect, it } from "vitest";
import { prisma } from "../prisma";
import { withSalon } from "../prisma-tenant";
import { assertSafeDatabaseOperation } from "../database-safety";
import { createAppointment, rescheduleAppointment, updateAppointmentStatusReliably } from "../appointment-service";
import { createAppointmentWithProductReservation } from "../appointment-product-service";
import { joinWaitlist } from "../waitlist";
import { addCalendarDays, dateKeyInTimeZone } from "../time";

const pg = process.env.RUN_POSTGRES_INTEGRATION === "1" ? describe : describe.skip;
async function fixture() {
  assertSafeDatabaseOperation(process.env, { operation: "variable-price-integration" });
  const suffix = crypto.randomUUID();
  const salon = await prisma.salon.create({ data: { slug: `price020-${suffix}`, name: "Preço CI", plan: "PRO", accessStatus: "APPROVED", timezone: "America/Sao_Paulo" } });
  const user = await prisma.user.create({ data: { email: `${suffix}@example.test`, name: "Profissional CI", passwordHash: "fixture-only" } });
  const date = addCalendarDays(dateKeyInTimeZone(new Date(), salon.timezone), 2);
  const data = await withSalon(salon.id, async tx => {
    const pro = await tx.professional.create({ data: { salonId: salon.id, userId: user.id } });
    const service = await tx.service.create({ data: { salonId: salon.id, name: "Progressiva CI", durationMin: 60, priceCents: 18000, priceType: "FROM", priceNote: "Conforme comprimento e volume.", professionals: { create: { professionalId: pro.id } } } });
    const client = await tx.clientProfile.create({ data: { salonId: salon.id, name: "Cliente CI" } });
    const secondClient = await tx.clientProfile.create({ data: { salonId: salon.id, name: "Cliente fila CI" } });
    await tx.professionalOpening.create({ data: { salonId: salon.id, professionalId: pro.id, dateKey: date, startMinutes: 480, endMinutes: 1200, reason: "Teste isolado" } });
    return { pro, service, client, secondClient };
  });
  const input = () => ({ salonId: salon.id, professionalId: data.pro.id, clientId: data.client.id, serviceIds: [data.service.id], startLocal: `${date}T10:00`, origin: "PUBLIC" as const, enforceBookingWindow: true, idempotencyKey: crypto.randomUUID(), actor: { type: "CLIENT" as const, id: data.client.id, name: data.client.name } });
  return { ...data, salon, user, date, input };
}

pg("Preço variável em PostgreSQL descartável", () => {
  it("preserva termos e valor inicial ao editar o catálogo e remarcar", async () => {
    const f = await fixture();
    const created = await withSalon(f.salon.id, tx => createAppointment(tx, f.input()));
    await withSalon(f.salon.id, tx => tx.service.updateMany({ where: { id: f.service.id, salonId: f.salon.id }, data: { priceType: "FIXED", priceNote: null, priceCents: 25000 } }));
    await withSalon(f.salon.id, tx => rescheduleAppointment(tx, { salonId: f.salon.id, appointmentId: created.appointment.id, professionalId: f.pro.id, startLocal: `${f.date}T12:00`, expectedVersion: 1, idempotencyKey: crypto.randomUUID(), enforceClientPolicy: true, expectedClientId: f.client.id, actor: f.input().actor }));
    const items = await withSalon(f.salon.id, tx => tx.appointmentService.findMany({ where: { salonId: f.salon.id, appointmentId: created.appointment.id } }));
    expect(items[0]).toMatchObject({ priceCents: 18000, priceType: "FROM", priceNote: "Conforme comprimento e volume." });
  });

  it("rejeita mudança de fixo para variável mesmo sem alteração numérica e reverte tudo", async () => {
    const f = await fixture();
    await expect(withSalon(f.salon.id, tx => createAppointmentWithProductReservation(tx, {
      appointment: f.input(), expectedTotalCents: 18000,
      expectedPriceTerms: [{ id: f.service.id, priceType: "FIXED", priceNote: null }],
      productReservation: { actorName: "Cliente CI", items: [] },
    }))).rejects.toMatchObject({ code: "PRICE_CHANGED" });
    expect(await withSalon(f.salon.id, tx => tx.appointment.count({ where: { salonId: f.salon.id } }))).toBe(0);
    expect(await withSalon(f.salon.id, tx => tx.appointmentEvent.count({ where: { salonId: f.salon.id } }))).toBe(0);
    const input = { appointment: f.input(), expectedTotalCents: 18000, expectedPriceTerms: [{ id: f.service.id, priceType: "FROM", priceNote: f.service.priceNote }], productReservation: { actorName: "Cliente CI", items: [] } };
    const first = await withSalon(f.salon.id, tx => createAppointmentWithProductReservation(tx, input));
    const retry = await withSalon(f.salon.id, tx => createAppointmentWithProductReservation(tx, input));
    expect(retry.appointment.id).toBe(first.appointment.id);
    expect(retry.duplicate).toBe(true);
  });

  it("mantém os termos da fila quando a vaga é promovida", async () => {
    const f = await fixture();
    const booking = await withSalon(f.salon.id, tx => createAppointment(tx, f.input()));
    await withSalon(f.salon.id, tx => joinWaitlist(tx, { salonId: f.salon.id, appointmentId: booking.appointment.id, professionalId: f.pro.id, serviceIds: [f.service.id], clientId: f.secondClient.id }));
    await withSalon(f.salon.id, tx => tx.service.updateMany({ where: { id: f.service.id, salonId: f.salon.id }, data: { priceType: "FIXED", priceNote: null, priceCents: 25000 } }));
    await withSalon(f.salon.id, tx => updateAppointmentStatusReliably(tx, { salonId: f.salon.id, appointmentId: booking.appointment.id, status: "CANCELLED", expectedVersion: 1, idempotencyKey: crypto.randomUUID(), actor: f.input().actor }));
    const promoted = await withSalon(f.salon.id, tx => tx.appointment.findFirstOrThrow({ where: { salonId: f.salon.id, clientId: f.secondClient.id }, include: { serviceItems: true } }));
    expect(promoted.serviceItems[0]).toMatchObject({ priceType: "FROM", priceNote: f.service.priceNote, priceCents: 18000 });
  });

  it("bloqueia tipos inválidos e avisos ausentes no banco", async () => {
    const f = await fixture();
    for (const data of [{ priceType: "OTHER" }, { priceType: "FROM", priceNote: null }, { priceType: "FIXED", priceNote: "Aviso" }]) {
      await expect(withSalon(f.salon.id, tx => tx.service.updateMany({ where: { id: f.service.id, salonId: f.salon.id }, data }))).rejects.toThrow();
    }
  });
});
