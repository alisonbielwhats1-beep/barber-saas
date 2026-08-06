import { describe, expect, it } from "vitest";
import { prisma } from "../prisma";
import { withSalon } from "../prisma-tenant";
import {
  cancelAppointmentReliably,
  createAppointment,
  rescheduleAppointment,
  updateAppointmentStatusReliably,
} from "../appointment-service";
import { isAppointmentError } from "../appointment-domain";

const describePostgres =
  process.env.RUN_POSTGRES_INTEGRATION === "1" ? describe : describe.skip;

async function fixture() {
  const suffix = crypto.randomUUID();
  const salon = await prisma.salon.create({
    data: {
      slug: `appointment-ci-${suffix}`,
      name: "Appointment CI",
      timezone: "America/Sao_Paulo",
      bufferMinutes: 0,
    },
    select: { id: true },
  });
  const professionalUser = await prisma.user.create({
    data: {
      email: `pro-${suffix}@example.test`,
      name: "Profissional CI",
      passwordHash: "integration-only",
    },
    select: { id: true },
  });
  const professional = await prisma.professional.create({
    data: { salonId: salon.id, userId: professionalUser.id },
    select: { id: true },
  });
  const service = await prisma.service.create({
    data: {
      salonId: salon.id,
      name: "Corte CI",
      durationMin: 30,
      priceCents: 5_000,
      professionals: { create: { professionalId: professional.id } },
    },
    select: { id: true },
  });
  await prisma.workingHours.create({
    data: {
      salonId: salon.id,
      professionalId: professional.id,
      weekday: 4,
      startMinutes: 9 * 60,
      endMinutes: 18 * 60,
    },
  });
  const clients = await Promise.all(
    ["A", "B", "C"].map((name) =>
      prisma.clientProfile.create({
        data: { salonId: salon.id, name: `Cliente ${name}` },
        select: { id: true },
      }),
    ),
  );
  return {
    salonId: salon.id,
    professionalId: professional.id,
    professionalUserId: professionalUser.id,
    serviceId: service.id,
    clients,
  };
}

describePostgres("concorrência real de agendamentos", () => {
  it("confirma somente uma de duas requisições simultâneas para o mesmo slot", async () => {
    const data = await fixture();
    const create = (clientId: string, idempotencyKey: string) =>
      withSalon(data.salonId, (tx) =>
        createAppointment(tx, {
          salonId: data.salonId,
          clientId,
          professionalId: data.professionalId,
          serviceIds: [data.serviceId],
          startLocal: "2032-08-05T10:00",
          origin: "PUBLIC",
          actor: { type: "CLIENT", id: clientId, name: "Cliente CI" },
          idempotencyKey,
          enforceBookingWindow: false,
        }),
      );

    const results = await Promise.allSettled([
      create(data.clients[0]!.id, crypto.randomUUID()),
      create(data.clients[1]!.id, crypto.randomUUID()),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(
      rejected?.status === "rejected" &&
        isAppointmentError(rejected.reason) &&
        rejected.reason.code === "SLOT_TAKEN",
    ).toBe(true);
    expect(
      await prisma.appointment.count({
        where: {
          salonId: data.salonId,
          professionalId: data.professionalId,
          startAt: new Date("2032-08-05T13:00:00.000Z"),
        },
      }),
    ).toBe(1);
  });

  it("a constraint do banco bloqueia sobreposição e permite intervalos adjacentes", async () => {
    const data = await fixture();
    const base = {
      salonId: data.salonId,
      professionalId: data.professionalId,
      serviceId: data.serviceId,
      priceCents: 5_000,
      status: "CONFIRMED" as const,
      timezone: "America/Sao_Paulo",
      origin: "PUBLIC" as const,
      startAt: new Date("2032-08-05T13:00:00.000Z"),
      endAt: new Date("2032-08-05T13:30:00.000Z"),
    };

    const results = await Promise.allSettled([
      prisma.appointment.create({ data: { ...base, clientId: data.clients[0]!.id } }),
      prisma.appointment.create({ data: { ...base, clientId: data.clients[1]!.id } }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    await expect(
      prisma.appointment.create({
        data: {
          ...base,
          clientId: data.clients[2]!.id,
          startAt: base.endAt,
          endAt: new Date("2032-08-05T14:00:00.000Z"),
        },
      }),
    ).resolves.toMatchObject({ startAt: base.endAt });
  });

  it("mantém criar, remarcar e cancelar atômicos, idempotentes e auditáveis", async () => {
    const data = await fixture();
    const createKey = crypto.randomUUID();
    const createInput = {
      salonId: data.salonId,
      clientId: data.clients[0]!.id,
      professionalId: data.professionalId,
      serviceIds: [data.serviceId],
      startLocal: "2032-08-05T10:00",
      origin: "PUBLIC" as const,
      actor: {
        type: "CLIENT" as const,
        id: data.clients[0]!.id,
        name: "Cliente A",
      },
      idempotencyKey: createKey,
      enforceBookingWindow: false,
      now: new Date("2032-08-01T12:00:00.000Z"),
    };

    const created = await withSalon(data.salonId, (tx) =>
      createAppointment(tx, createInput),
    );
    const createRetry = await withSalon(data.salonId, (tx) =>
      createAppointment(tx, createInput),
    );
    expect(createRetry).toMatchObject({ duplicate: true });
    expect(createRetry.appointment.id).toBe(created.appointment.id);

    const rescheduleKey = crypto.randomUUID();
    // Desativar o catálogo não pode invalidar o serviço já contratado. A
    // remarcação preserva o snapshot histórico e o preço original.
    await prisma.service.update({
      where: { id: data.serviceId },
      data: { active: false },
    });
    const rescheduleInput = {
      salonId: data.salonId,
      appointmentId: created.appointment.id,
      professionalId: data.professionalId,
      startLocal: "2032-08-05T11:00",
      actor: {
        type: "STAFF" as const,
        id: data.professionalUserId,
        name: "Profissional CI",
      },
      idempotencyKey: rescheduleKey,
      expectedVersion: 1,
      enforceClientPolicy: false,
      now: new Date("2032-08-01T12:00:00.000Z"),
    };
    const rescheduled = await withSalon(data.salonId, (tx) =>
      rescheduleAppointment(tx, rescheduleInput),
    );
    expect(rescheduled.appointment).toMatchObject({
      id: created.appointment.id,
      version: 2,
    });
    expect(rescheduled.appointment.startAt.toISOString()).toBe(
      "2032-08-05T14:00:00.000Z",
    );
    await expect(
      withSalon(data.salonId, (tx) =>
        rescheduleAppointment(tx, {
          ...rescheduleInput,
          startLocal: "2032-08-05T12:00",
        }),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    await expect(
      withSalon(data.salonId, (tx) =>
        rescheduleAppointment(tx, rescheduleInput),
      ),
    ).resolves.toMatchObject({ duplicate: true });
    await prisma.service.update({
      where: { id: data.serviceId },
      data: { active: true },
    });

    const otherSalon = await prisma.salon.create({
      data: {
        slug: `appointment-other-${crypto.randomUUID()}`,
        name: "Outro tenant",
      },
      select: { id: true },
    });
    await expect(
      withSalon(otherSalon.id, (tx) =>
        rescheduleAppointment(tx, {
          ...rescheduleInput,
          salonId: otherSalon.id,
          idempotencyKey: crypto.randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await prisma.waitlistEntry.create({
      data: {
        salonId: data.salonId,
        appointmentId: created.appointment.id,
        clientId: data.clients[1]!.id,
      },
    });
    const cancelInput = {
      salonId: data.salonId,
      appointmentId: created.appointment.id,
      actor: {
        type: "STAFF" as const,
        id: data.professionalUserId,
        name: "Profissional CI",
      },
      idempotencyKey: crypto.randomUUID(),
      expectedVersion: 2,
      reason: "Cliente solicitou pelo estabelecimento",
      enforceClientPolicy: false,
      now: new Date("2032-08-01T12:00:00.000Z"),
    };
    const cancelled = await withSalon(data.salonId, (tx) =>
      cancelAppointmentReliably(tx, cancelInput),
    );
    expect(cancelled.appointment).toMatchObject({
      id: created.appointment.id,
      version: 3,
    });
    await expect(
      withSalon(data.salonId, (tx) =>
        cancelAppointmentReliably(tx, cancelInput),
      ),
    ).resolves.toMatchObject({ duplicate: true });

    const persisted = await prisma.appointment.findUniqueOrThrow({
      where: { id: created.appointment.id },
      select: {
        status: true,
        cancelledReason: true,
        cancelledByType: true,
        version: true,
      },
    });
    expect(persisted).toEqual({
      status: "CANCELLED",
      cancelledReason: "Cliente solicitou pelo estabelecimento",
      cancelledByType: "STAFF",
      version: 3,
    });
    // Cancelamento do estabelecimento não realoca automaticamente uma vaga
    // que pode ter sido cancelada por ausência/fechamento.
    expect(
      await prisma.waitlistEntry.count({
        where: {
          salonId: data.salonId,
          appointmentId: created.appointment.id,
          fulfilledAt: { not: null },
        },
      }),
    ).toBe(0);

    const audit = await withSalon(data.salonId, async (tx) => ({
      events: await tx.appointmentEvent.count({
        where: { salonId: data.salonId, appointmentId: created.appointment.id },
      }),
      notifications: await tx.notificationOutbox.count({
        where: { salonId: data.salonId, appointmentId: created.appointment.id },
      }),
    }));
    expect(audit).toEqual({ events: 3, notifications: 4 });

    const replacement = await withSalon(data.salonId, (tx) =>
      createAppointment(tx, {
        ...createInput,
        clientId: data.clients[1]!.id,
        actor: {
          type: "CLIENT",
          id: data.clients[1]!.id,
          name: "Cliente B",
        },
        startLocal: "2032-08-05T11:00",
        idempotencyKey: crypto.randomUUID(),
      }),
    );
    expect(replacement.duplicate).toBe(false);

    const waitlist = await prisma.waitlistEntry.create({
      data: {
        salonId: data.salonId,
        appointmentId: replacement.appointment.id,
        clientId: data.clients[2]!.id,
      },
      select: { id: true },
    });
    await withSalon(data.salonId, (tx) =>
      cancelAppointmentReliably(tx, {
        salonId: data.salonId,
        appointmentId: replacement.appointment.id,
        actor: {
          type: "CLIENT",
          id: data.clients[1]!.id,
          name: "Cliente B",
        },
        idempotencyKey: crypto.randomUUID(),
        expectedVersion: 1,
        expectedClientId: data.clients[1]!.id,
        enforceClientPolicy: false,
        now: new Date("2032-08-01T12:00:00.000Z"),
      }),
    );
    const fulfilled = await prisma.waitlistEntry.findUniqueOrThrow({
      where: { id: waitlist.id },
      select: { fulfilledAt: true, fulfilledAppointmentId: true },
    });
    expect(fulfilled.fulfilledAt).not.toBeNull();
    expect(fulfilled.fulfilledAppointmentId).toBeTruthy();

    const completeKey = crypto.randomUUID();
    const completeInput = {
      salonId: data.salonId,
      appointmentId: fulfilled.fulfilledAppointmentId!,
      status: "COMPLETED" as const,
      actor: {
        type: "STAFF" as const,
        id: data.professionalUserId,
        name: "Profissional CI",
      },
      idempotencyKey: completeKey,
      expectedVersion: 1,
      idempotencyContext: {
        amountCents: 5_000,
        method: "PIX",
      },
    };
    await withSalon(data.salonId, (tx) =>
      updateAppointmentStatusReliably(tx, completeInput),
    );
    await expect(
      withSalon(data.salonId, (tx) =>
        updateAppointmentStatusReliably(tx, {
          ...completeInput,
          idempotencyContext: {
            amountCents: 6_000,
            method: "PIX",
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
  });
});
