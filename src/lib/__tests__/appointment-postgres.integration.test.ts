import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { lockProfessionalSchedule } from "@/lib/appointment-lock";

const describePostgres =
  process.env.RUN_POSTGRES_INTEGRATION === "1" ? describe : describe.skip;

describePostgres("agenda com PostgreSQL real", () => {
  let suffix: string;
  let salonId: string;
  let professionalId: string;
  let clientId: string;
  let serviceId: string;
  let professionalEmail: string;

  beforeEach(async () => {
    suffix = crypto.randomUUID();
    professionalEmail = `agenda-pro-${suffix}@example.test`;
    const user = await prisma.user.create({
      data: {
        email: professionalEmail,
        name: "Professional Integration",
        passwordHash: "integration-only",
        passwordSetAt: new Date(),
      },
      select: { id: true },
    });
    const salon = await prisma.salon.create({
      data: {
        name: `Agenda Salon ${suffix}`,
        slug: `agenda-salon-${suffix}`,
        services: {
          create: {
            name: "Corte",
            durationMin: 30,
            priceCents: 5_000,
          },
        },
        clients: {
          create: {
            name: "Client Integration",
            phone: "11999999999",
          },
        },
        professionals: {
          create: {
            userId: user.id,
          },
        },
      },
      select: {
        id: true,
        services: { select: { id: true } },
        clients: { select: { id: true } },
        professionals: { select: { id: true } },
      },
    });
    salonId = salon.id;
    serviceId = salon.services[0]!.id;
    clientId = salon.clients[0]!.id;
    professionalId = salon.professionals[0]!.id;
  });

  afterEach(async () => {
    await prisma.salon.deleteMany({ where: { id: salonId } });
    await prisma.user.deleteMany({ where: { email: professionalEmail } });
  });

  it("serializa duas reservas simultâneas e persiste somente uma", async () => {
    const startAt = new Date("2030-01-10T15:00:00.000Z");
    const endAt = new Date("2030-01-10T15:30:00.000Z");

    async function createOnce(id: string) {
      return prisma.$transaction(async (tx) => {
        await lockProfessionalSchedule(tx, professionalId);
        const conflict = await tx.appointment.findFirst({
          where: {
            professionalId,
            status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] },
            startAt: { lt: endAt },
            endAt: { gt: startAt },
          },
          select: { id: true },
        });
        if (conflict) return false;
        await tx.appointment.create({
          data: {
            id,
            salonId,
            clientId,
            professionalId,
            serviceId,
            startAt,
            endAt,
            priceCents: 5_000,
            status: "CONFIRMED",
          },
        });
        return true;
      });
    }

    const results = await Promise.all([
      createOnce(`appointment-a-${suffix}`),
      createOnce(`appointment-b-${suffix}`),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(
      await prisma.appointment.count({
        where: { salonId, professionalId, startAt, endAt },
      }),
    ).toBe(1);
  });
});
