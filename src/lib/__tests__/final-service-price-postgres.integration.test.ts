import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { withSalon } from "@/lib/prisma-tenant";
import { assertSafeDatabaseOperation } from "@/lib/database-safety";
import { closeComandaReliably } from "@/lib/comanda-service";

const pg = process.env.RUN_POSTGRES_INTEGRATION === "1" ? describe : describe.skip;

pg("valor final de serviço variável na comanda", () => {
  it("guarda preço inicial e final por serviço, cobra o final e atualiza receita", async () => {
    assertSafeDatabaseOperation(process.env, { operation: "final-service-price-integration" });
    const suffix = crypto.randomUUID();
    const salon = await prisma.salon.create({ data: {
      slug: `final-price-${suffix}`, name: "Salão de teste", accessStatus: "APPROVED", plan: "PRO",
    } });
    const user = await prisma.user.create({ data: {
      email: `${suffix}@example.test`, name: "Dona do salão", passwordHash: "fixture-only",
    } });
    const fixture = await withSalon(salon.id, async tx => {
      const professional = await tx.professional.create({ data: { salonId: salon.id, userId: user.id } });
      const client = await tx.clientProfile.create({ data: { salonId: salon.id, name: "Cliente" } });
      const service = await tx.service.create({ data: {
        salonId: salon.id, name: "Progressiva", durationMin: 60, priceCents: 30000,
        priceType: "FROM", priceNote: "Conforme comprimento e volume.",
      } });
      const startAt = new Date(Date.now() - 2 * 86400_000);
      const appointment = await tx.appointment.create({ data: {
        salonId: salon.id, clientId: client.id, professionalId: professional.id,
        serviceId: service.id, startAt, endAt: new Date(startAt.getTime() + 3600000),
        status: "COMPLETED", priceCents: 30000,
      } });
      await tx.appointmentService.create({ data: {
        salonId: salon.id, appointmentId: appointment.id, serviceId: service.id,
        position: 0, serviceName: "Progressiva", durationMin: 60, priceCents: 30000,
        priceType: "FROM", priceNote: "Conforme comprimento e volume.",
      } });
      return { appointment };
    });
    const input = {
      salonId: salon.id, userId: user.id, actorName: user.name, role: "OWNER" as const,
      appointmentId: fixture.appointment.id, idempotencyKey: crypto.randomUUID(),
      expectedVersion: fixture.appointment.version, discountCents: 0, productLines: [],
      method: "PIX" as const, expectedTotalCents: 40000,
      finalServicePrices: [{ position: 0, finalPriceCents: 40000, reason: "Comprimento e volume maiores" }],
    };
    await expect(withSalon(salon.id, tx => closeComandaReliably(tx, {
      ...input, finalServicePrices: [{ position: 0, finalPriceCents: 29000, reason: "Ajuste" }],
    }))).rejects.toThrow("valor inicial");
    await expect(withSalon(salon.id, tx => closeComandaReliably(tx, {
      ...input, finalServicePrices: [{ position: 0, finalPriceCents: 40000 }],
    }))).rejects.toThrow("Explique o reajuste");
    await expect(withSalon(salon.id, tx => closeComandaReliably(tx, {
      ...input, role: "RECEPTIONIST",
    }))).rejects.toThrow("proprietário ou gerente");
    expect(await prisma.payment.count({ where: { appointmentId: fixture.appointment.id } })).toBe(0);

    const first = await withSalon(salon.id, tx => closeComandaReliably(tx, input));
    const retry = await withSalon(salon.id, tx => closeComandaReliably(tx, input));
    expect(first.duplicate).toBe(false);
    expect(retry).toEqual({ duplicate: true, paymentId: first.paymentId });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId: fixture.appointment.id } });
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: fixture.appointment.id } });
    const item = await prisma.appointmentService.findUniqueOrThrow({
      where: { appointmentId_position: { appointmentId: fixture.appointment.id, position: 0 } },
    });
    expect(payment.amountCents).toBe(40000);
    expect(appointment.priceCents).toBe(40000);
    expect(item).toMatchObject({ priceCents: 30000, finalPriceCents: 40000,
      finalPriceReason: "Comprimento e volume maiores", priceType: "FROM" });
  });
});
