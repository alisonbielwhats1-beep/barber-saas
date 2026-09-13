import { describe, expect, it } from "vitest";
import { prisma } from "../prisma";
import { withSalon } from "../prisma-tenant";
import { assertSafeDatabaseOperation } from "../database-safety";
import {
  createAppointment,
  rescheduleAppointment,
} from "../appointment-service";
import { joinFlexibleWaitlist, promoteFlexible } from "../flexible-waitlist";
import { respondToOffer } from "../waitlist-offers";
import { closeComandaReliably } from "../comanda-service";
import { addCalendarDays, dateKeyInTimeZone } from "../time";
const pg =
  process.env.RUN_POSTGRES_INTEGRATION === "1" ? describe : describe.skip;
async function fixture() {
  assertSafeDatabaseOperation(process.env, {
    operation: "product019-integration",
  });
  const suffix = crypto.randomUUID();
  const salon = await prisma.salon.create({
    data: {
      slug: `product019-${suffix}`,
      name: "Produto CI",
      plan: "PRO",
      accessStatus: "APPROVED",
      timezone: "America/Sao_Paulo",
    },
  });
  const resource = await prisma.physicalResource.create({
    data: { salonId: salon.id, name: "Sala exclusiva", kind: "ROOM" },
  });
  const users = await Promise.all(
    [0, 1].map((i) =>
      prisma.user.create({
        data: {
          email: `${suffix}-${i}@example.test`,
          name: `Profissional ${i}`,
          passwordHash: "fixture-only",
        },
      }),
    ),
  );
  const professionals = await Promise.all(
    users.map((u) =>
      prisma.professional.create({ data: { salonId: salon.id, userId: u.id } }),
    ),
  );
  const service = await prisma.service.create({
    data: {
      salonId: salon.id,
      name: "Tratamento — longo",
      durationMin: 60,
      processingMin: 20,
      finishingMin: 10,
      priceCents: 9000,
      physicalResourceId: resource.id,
      professionals: {
        create: professionals.map((p) => ({ professionalId: p.id })),
      },
    },
  });
  const clients = await Promise.all(
    [0, 1].map((i) =>
      prisma.clientProfile.create({
        data: { salonId: salon.id, name: `Titular ${i}` },
      }),
    ),
  );
  const date = addCalendarDays(
    dateKeyInTimeZone(new Date(), salon.timezone),
    2,
  );
  await prisma.professionalOpening.createMany({
    data: professionals.map((p) => ({
      salonId: salon.id,
      professionalId: p.id,
      dateKey: date,
      startMinutes: 480,
      endMinutes: 1200,
      reason: "Teste isolado",
    })),
  });
  const input = (pro = 0, client = 0, time = "10:00") => ({
    salonId: salon.id,
    professionalId: professionals[pro]!.id,
    clientId: clients[client]!.id,
    serviceIds: [service.id],
    startLocal: `${date}T${time}`,
    origin: "PUBLIC" as const,
    enforceBookingWindow: true,
    idempotencyKey: crypto.randomUUID(),
    actor: {
      type: "CLIENT" as const,
      id: clients[client]!.id,
      name: clients[client]!.name,
    },
  });
  return {
    salon,
    resource,
    users,
    professionals,
    service,
    clients,
    date,
    input,
  };
}

pg("recebimentos e reservas 023 no PostgreSQL", () => {
  it("preserves repeated lines through creation and rescheduling and blocks their whole duration", async () => {
    const f = await fixture();
    const a = await withSalon(f.salon.id, (tx) =>
      createAppointment(tx, {
        ...f.input(),
        serviceIds: [f.service.id, f.service.id, f.service.id],
      }),
    );
    expect(+a.appointment.endAt - +a.appointment.startAt).toBe(180 * 60_000);
    const rows = await prisma.appointmentService.findMany({
      where: { appointmentId: a.appointment.id },
      orderBy: { position: "asc" },
    });
    expect(rows.map((s) => s.serviceId)).toEqual([
      f.service.id,
      f.service.id,
      f.service.id,
    ]);
    expect(rows.reduce((n, s) => n + s.priceCents, 0)).toBe(27000);
    await expect(
      withSalon(f.salon.id, (tx) =>
        createAppointment(tx, f.input(0, 1, "12:30")),
      ),
    ).rejects.toThrow();
    const moved = await withSalon(f.salon.id, (tx) =>
      rescheduleAppointment(tx, {
        salonId: f.salon.id,
        appointmentId: a.appointment.id,
        professionalId: f.professionals[0]!.id,
        serviceIds: [f.service.id, f.service.id, f.service.id],
        startLocal: `${f.date}T14:00`,
        expectedVersion: 1,
        idempotencyKey: crypto.randomUUID(),
        enforceClientPolicy: false,
        actor: { type: "STAFF", id: f.users[0]!.id, name: "Equipe" },
      }),
    );
    expect(+moved.appointment.endAt - +moved.appointment.startAt).toBe(
      180 * 60_000,
    );
  });
  it("records extras, yesterday and audit date atomically, serializes retry and preserves catalog/reservation", async () => {
    const f = await fixture();
    const now = new Date();
    const past = new Date(+now - 2 * 86400_000);
    const a = await prisma.appointment.create({
      data: {
        salonId: f.salon.id,
        clientId: f.clients[0]!.id,
        professionalId: f.professionals[0]!.id,
        serviceId: f.service.id,
        startAt: past,
        endAt: new Date(+past + 3600000),
        status: "COMPLETED",
        priceCents: 9000,
      },
    });
    const receivedDate = addCalendarDays(
      dateKeyInTimeZone(now, f.salon.timezone),
      -1,
    );
    const input = {
      salonId: f.salon.id,
      userId: f.users[0]!.id,
      actorName: "Equipe",
      role: "OWNER" as const,
      appointmentId: a.id,
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: 1,
      discountCents: 0,
      productLines: [],
      method: "PIX" as const,
      extraServiceIds: [f.service.id, f.service.id],
      surchargeCents: 1500,
      adjustmentReason: "Acabamento extra",
      receivedDate,
      expectedTotalCents: 28500,
      now,
    };
    await expect(
      withSalon(f.salon.id, (tx) =>
        closeComandaReliably(tx, { ...input, expectedTotalCents: 28000 }),
      ),
    ).rejects.toThrow("total");
    expect(await prisma.payment.count({ where: { appointmentId: a.id } })).toBe(
      0,
    );
    const results = await Promise.all(
      [0, 1].map(() =>
        withSalon(f.salon.id, (tx) => closeComandaReliably(tx, input)),
      ),
    );
    expect(results.map((r) => r.duplicate).sort()).toEqual([false, true]);
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { appointmentId: a.id },
    });
    expect(payment.amountCents).toBe(28500);
    expect(payment.extraServices).toHaveLength(2);
    expect(dateKeyInTimeZone(payment.paidAt, f.salon.timezone)).toBe(
      receivedDate,
    );
    expect(+payment.recordedAt).toBe(+now);
    expect(
      (await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } }))
        .priceCents,
    ).toBe(9000);
    expect(
      (await prisma.service.findUniqueOrThrow({ where: { id: f.service.id } }))
        .priceCents,
    ).toBe(9000);
    await expect(
      withSalon(f.salon.id, (tx) =>
        closeComandaReliably(tx, { ...input, role: "RECEPTIONIST" }),
      ),
    ).rejects.toThrow("proprietário");
  });
  it("offers by compatible FIFO, protects both professional and shared room, and accepts exactly once", async () => {
    const f = await fixture();
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    for (const [i, id] of ids.entries())
      await withSalon(f.salon.id, (tx) =>
        joinFlexibleWaitlist(tx, f.salon.id, f.clients[i]!.id, {
          id,
          professionalId: f.professionals[0]!.id,
          serviceIds: [f.service.id, f.service.id],
          fromDate: f.date,
          toDate: f.date,
          startMinutes: 540,
          endMinutes: 1100,
        }),
      );
    const ctx = { salonId: f.salon.id, userId: f.users[0]!.id };
    await expect(
      withSalon(f.salon.id, (tx) =>
        promoteFlexible(tx, ctx, ids[1]!, `${f.date}T10:00`, 18000, 15),
      ),
    ).rejects.toThrow("anterior");
    const result = await withSalon(f.salon.id, (tx) =>
      promoteFlexible(tx, ctx, ids[0]!, `${f.date}T10:00`, 18000, 15),
    );
    const id = result.offerId!;
    expect(id).toBeTruthy();
    for (const pro of [0, 1])
      await expect(
        withSalon(f.salon.id, (tx) =>
          createAppointment(tx, f.input(pro, 1, "11:00")),
        ),
      ).rejects.toThrow();
    await expect(
      withSalon(f.salon.id, (tx) =>
        respondToOffer(tx, f.salon.id, f.clients[1]!.id, id, true),
      ),
    ).rejects.toThrow("encontrada");
    const accept = await Promise.all(
      [0, 1].map(() =>
        withSalon(f.salon.id, (tx) =>
          respondToOffer(tx, f.salon.id, f.clients[0]!.id, id, true),
        ),
      ),
    );
    expect(accept[0].appointmentId).toBe(accept[1].appointmentId);
    expect(
      await prisma.appointment.count({ where: { salonId: f.salon.id } }),
    ).toBe(1);
    expect(
      await prisma.appointmentService.count({
        where: { appointmentId: accept[0].appointmentId! },
      }),
    ).toBe(2);
  });
  it("releases declined or expired offers and advances compatible FIFO on the next offer", async () => {
    const f = await fixture();
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    for (const [i, id] of ids.entries())
      await withSalon(f.salon.id, (tx) =>
        joinFlexibleWaitlist(tx, f.salon.id, f.clients[i]!.id, {
          id,
          professionalId: f.professionals[0]!.id,
          serviceIds: [f.service.id],
          fromDate: f.date,
          toDate: f.date,
          startMinutes: 540,
          endMinutes: 1100,
        }),
      );
    const ctx = { salonId: f.salon.id, userId: f.users[0]!.id };
    const offer = await withSalon(f.salon.id, (tx) =>
      promoteFlexible(tx, ctx, ids[0]!, `${f.date}T10:00`, 9000, 15),
    );
    await withSalon(f.salon.id, (tx) =>
      respondToOffer(tx, f.salon.id, f.clients[0]!.id, offer.offerId!, false),
    );
    const next = await withSalon(f.salon.id, (tx) =>
      promoteFlexible(tx, ctx, ids[1]!, `${f.date}T10:00`, 9000, 15),
    );
    await prisma.waitlistOffer.update({
      where: { id: next.offerId! },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      withSalon(f.salon.id, (tx) =>
        respondToOffer(tx, f.salon.id, f.clients[1]!.id, next.offerId!, true),
      ),
    ).resolves.toHaveProperty("error");
    await expect(
      withSalon(f.salon.id, (tx) => createAppointment(tx, f.input())),
    ).resolves.toHaveProperty("appointment");
  });
  it("rejects changed terms without consuming the offer or creating a reservation", async () => {
    const f = await fixture();
    const id = crypto.randomUUID();
    await withSalon(f.salon.id, (tx) =>
      joinFlexibleWaitlist(tx, f.salon.id, f.clients[0]!.id, {
        id,
        professionalId: f.professionals[0]!.id,
        serviceIds: [f.service.id],
        fromDate: f.date,
        toDate: f.date,
        startMinutes: 540,
        endMinutes: 1100,
      }),
    );
    const offered = await withSalon(f.salon.id, (tx) =>
      promoteFlexible(
        tx,
        { salonId: f.salon.id, userId: f.users[0]!.id },
        id,
        `${f.date}T10:00`,
        9000,
        15,
      ),
    );
    await prisma.service.update({
      where: { id: f.service.id },
      data: { priceCents: 10000 },
    });
    await expect(
      withSalon(f.salon.id, (tx) =>
        respondToOffer(
          tx,
          f.salon.id,
          f.clients[0]!.id,
          offered.offerId!,
          true,
        ),
      ),
    ).rejects.toThrow("condições mudaram");
    expect(
      (
        await prisma.waitlistOffer.findUniqueOrThrow({
          where: { id: offered.offerId! },
        })
      ).status,
    ).toBe("OFFERED");
    expect(
      await prisma.appointment.count({ where: { salonId: f.salon.id } }),
    ).toBe(0);
  });
  it("isolates offers with RLS and rejects foreign tenant FKs", async () => {
    const f = await fixture();
    const other = await fixture();
    const id = crypto.randomUUID();
    await withSalon(f.salon.id, (tx) =>
      joinFlexibleWaitlist(tx, f.salon.id, f.clients[0]!.id, {
        id,
        professionalId: f.professionals[0]!.id,
        serviceIds: [f.service.id],
        fromDate: f.date,
        toDate: f.date,
        startMinutes: 540,
        endMinutes: 1100,
      }),
    );
    const o = await withSalon(f.salon.id, (tx) =>
      promoteFlexible(
        tx,
        { salonId: f.salon.id, userId: f.users[0]!.id },
        id,
        `${f.date}T10:00`,
        9000,
        15,
      ),
    );
    await prisma.$executeRawUnsafe(
      "DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='receipt023_test') THEN CREATE ROLE receipt023_test NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$",
    );
    await prisma.$executeRawUnsafe(
      "GRANT USAGE ON SCHEMA public TO receipt023_test",
    );
    await prisma.$executeRawUnsafe(
      'GRANT SELECT ON "WaitlistOffer" TO receipt023_test',
    );
    const read = (salonId: string) =>
      withSalon(salonId, async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE receipt023_test");
        return tx.waitlistOffer.findMany();
      });
    expect((await read(f.salon.id)).map((o) => o.id)).toEqual([o.offerId]);
    expect(await read(other.salon.id)).toEqual([]);
    await expect(
      prisma.waitlistOffer.update({
        where: { id: o.offerId! },
        data: { professionalId: other.professionals[0]!.id },
      }),
    ).rejects.toThrow();
  });
});
