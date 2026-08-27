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
import { joinWaitlist, promoteWaitlistEntry } from "../waitlist";
import {
  requestStaffReschedule,
  respondToRescheduleProposal,
} from "../reschedule-proposals";

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
    ["A", "B", "C", "D"].map((name) =>
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

    const waitlist = await withSalon(data.salonId, (tx) =>
      joinWaitlist(tx, {
        salonId: data.salonId,
        appointmentId: replacement.appointment.id,
        professionalId: data.professionalId,
        serviceIds: [data.serviceId],
        clientId: data.clients[2]!.id,
      }),
    );
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
      where: { id: waitlist.entryId },
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
      now: new Date("2032-08-05T15:00:00.000Z"),
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

  it("mantém o horário até o aceite e registra aceite ou recusa da proposta", async () => {
    const data = await fixture();
    const suffix = crypto.randomUUID();
    const [acceptedClient, rejectedClient] = await Promise.all([
      prisma.clientProfile.create({
        data: {
          salonId: data.salonId,
          name: "Cliente com conta",
          email: `accepted-${suffix}@example.test`,
          passwordHash: "integration-account",
        },
        select: { id: true },
      }),
      prisma.clientProfile.create({
        data: {
          salonId: data.salonId,
          name: "Cliente que recusa",
          email: `rejected-${suffix}@example.test`,
          passwordHash: "integration-account",
        },
        select: { id: true },
      }),
    ]);
    const original = await withSalon(data.salonId, (tx) =>
      createAppointment(tx, {
        salonId: data.salonId,
        clientId: acceptedClient.id,
        professionalId: data.professionalId,
        serviceIds: [data.serviceId],
        startLocal: "2032-08-05T10:00",
        origin: "ADMIN",
        actor: { type: "STAFF", id: data.professionalUserId, name: "Dono CI" },
        idempotencyKey: crypto.randomUUID(),
        enforceBookingWindow: false,
      }),
    );
    const requested = await withSalon(data.salonId, (tx) =>
      requestStaffReschedule(tx, {
        salonId: data.salonId,
        appointmentId: original.appointment.id,
        professionalId: data.professionalId,
        serviceIds: [data.serviceId],
        startLocal: "2032-08-05T11:00",
        actor: { type: "STAFF", id: data.professionalUserId, name: "Dono CI" },
        idempotencyKey: crypto.randomUUID(),
        expectedVersion: 1,
      }),
    );
    expect(requested).toMatchObject({ requiresAcceptance: true, duplicate: false });
    if (!requested.requiresAcceptance) throw new Error("proposta esperada");
    expect(await prisma.appointment.findUniqueOrThrow({
      where: { id: original.appointment.id },
      select: { version: true, startAt: true },
    })).toEqual({ version: 1, startAt: new Date("2032-08-05T13:00:00.000Z") });

    const accepted = await withSalon(data.salonId, (tx) =>
      respondToRescheduleProposal(tx, {
        salonId: data.salonId,
        proposalId: requested.proposalId,
        clientId: acceptedClient.id,
        decision: "ACCEPT",
      }),
    );
    expect(accepted).toMatchObject({ status: "ACCEPTED", duplicate: false });
    expect(accepted.appointment.startAt.toISOString()).toBe("2032-08-05T14:00:00.000Z");
    expect(await prisma.rescheduleProposal.findUniqueOrThrow({
      where: { id: requested.proposalId },
      select: { status: true, targetNotes: true },
    })).toEqual({ status: "ACCEPTED", targetNotes: null });
    expect(await prisma.notificationOutbox.count({
      where: {
        salonId: data.salonId,
        appointmentId: original.appointment.id,
        template: { in: ["appointment.reschedule_requested", "appointment.reschedule_accepted"] },
      },
    })).toBe(3);

    const rejectAppointment = await withSalon(data.salonId, (tx) =>
      createAppointment(tx, {
        salonId: data.salonId,
        clientId: rejectedClient.id,
        professionalId: data.professionalId,
        serviceIds: [data.serviceId],
        startLocal: "2032-08-05T12:00",
        origin: "ADMIN",
        actor: { type: "STAFF", id: data.professionalUserId, name: "Dono CI" },
        idempotencyKey: crypto.randomUUID(),
        enforceBookingWindow: false,
      }),
    );
    const rejectedRequest = await withSalon(data.salonId, (tx) =>
      requestStaffReschedule(tx, {
        salonId: data.salonId,
        appointmentId: rejectAppointment.appointment.id,
        professionalId: data.professionalId,
        serviceIds: [data.serviceId],
        startLocal: "2032-08-05T13:00",
        actor: { type: "STAFF", id: data.professionalUserId, name: "Dono CI" },
        idempotencyKey: crypto.randomUUID(),
        expectedVersion: 1,
      }),
    );
    if (!rejectedRequest.requiresAcceptance) throw new Error("segunda proposta esperada");
    const rejected = await withSalon(data.salonId, (tx) =>
      respondToRescheduleProposal(tx, {
        salonId: data.salonId,
        proposalId: rejectedRequest.proposalId,
        clientId: rejectedClient.id,
        decision: "REJECT",
        reason: "Esse horário não funciona",
      }),
    );
    expect(rejected).toMatchObject({ status: "REJECTED", duplicate: false });
    expect(rejected.appointment.startAt.toISOString()).toBe("2032-08-05T15:00:00.000Z");
    expect(await prisma.rescheduleProposal.findUniqueOrThrow({
      where: { id: rejectedRequest.proposalId },
      select: { status: true, responseReason: true },
    })).toEqual({ status: "REJECTED", responseReason: "Esse horário não funciona" });
  });

  it("preserva a fila e permite promover explicitamente a primeira pessoa", async () => {
    const data = await fixture();
    const original = await withSalon(data.salonId, (tx) =>
      createAppointment(tx, {
        salonId: data.salonId,
        clientId: data.clients[0]!.id,
        professionalId: data.professionalId,
        serviceIds: [data.serviceId],
        startLocal: "2032-08-05T10:00",
        origin: "PUBLIC",
        actor: { type: "CLIENT", id: data.clients[0]!.id, name: "Cliente A" },
        idempotencyKey: crypto.randomUUID(),
        enforceBookingWindow: false,
      }),
    );
    const queued: Awaited<ReturnType<typeof joinWaitlist>>[] = [];
    for (const client of data.clients.slice(1)) {
      queued.push(await withSalon(data.salonId, (tx) =>
        joinWaitlist(tx, {
          salonId: data.salonId,
          appointmentId: original.appointment.id,
          professionalId: data.professionalId,
          serviceIds: [data.serviceId],
          clientId: client.id,
        }),
      ));
    }
    expect(queued.map((entry) => entry.position)).toEqual([1, 2, 3]);

    await withSalon(data.salonId, (tx) =>
      cancelAppointmentReliably(tx, {
        salonId: data.salonId,
        appointmentId: original.appointment.id,
        actor: { type: "STAFF", id: data.professionalUserId, name: "Dono CI" },
        idempotencyKey: crypto.randomUUID(),
        expectedVersion: 1,
        reason: "Cancelado pelo estabelecimento",
        enforceClientPolicy: false,
        now: new Date("2032-08-01T12:00:00.000Z"),
      }),
    );

    const activeQueue = await prisma.waitlistEntry.findMany({
      where: {
        salonId: data.salonId,
        appointmentId: original.appointment.id,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        clientId: true,
        fulfilledAt: true,
        fulfilledAppointmentId: true,
        cancelledAt: true,
        cancelledByType: true,
        cancelledById: true,
        cancelledReason: true,
      },
    });
    expect(activeQueue).toEqual([
      expect.objectContaining({
        clientId: data.clients[1]!.id,
        fulfilledAt: null,
        fulfilledAppointmentId: null,
        cancelledAt: null,
        cancelledByType: null,
        cancelledById: null,
        cancelledReason: null,
      }),
      expect.objectContaining({
        clientId: data.clients[2]!.id,
        fulfilledAt: null,
        fulfilledAppointmentId: null,
        cancelledAt: null,
        cancelledByType: null,
        cancelledById: null,
        cancelledReason: null,
      }),
      expect.objectContaining({
        clientId: data.clients[3]!.id,
        fulfilledAt: null,
        fulfilledAppointmentId: null,
        cancelledAt: null,
        cancelledByType: null,
        cancelledById: null,
        cancelledReason: null,
      }),
    ]);
    expect(await prisma.waitlistEntry.count({
      where: {
        salonId: data.salonId,
        appointmentId: original.appointment.id,
        fulfilledAt: null,
        cancelledAt: null,
      },
    })).toBe(3);

    await withSalon(data.salonId, (tx) =>
      promoteWaitlistEntry(tx, {
        salonId: data.salonId,
        appointmentId: original.appointment.id,
        entryId: queued[0]!.entryId,
      }),
    );

    const promoted = await prisma.waitlistEntry.findUniqueOrThrow({
      where: { id: queued[0]!.entryId },
      select: { fulfilledAt: true, fulfilledAppointmentId: true, cancelledAt: true },
    });
    expect(promoted.fulfilledAt).toEqual(expect.any(Date));
    expect(promoted.fulfilledAppointmentId).toBeTruthy();
    expect(promoted.cancelledAt).toBeNull();
    expect(await prisma.waitlistEntry.count({
      where: {
        salonId: data.salonId,
        appointmentId: original.appointment.id,
        fulfilledAt: null,
        cancelledAt: null,
      },
    })).toBe(2);
    expect(await prisma.appointment.count({
      where: {
        salonId: data.salonId,
        professionalId: data.professionalId,
        startAt: new Date("2032-08-05T13:00:00.000Z"),
        status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] },
      },
    })).toBe(1);
    expect(await prisma.notificationOutbox.count({
      where: {
        salonId: data.salonId,
        template: "appointment.waitlist_fulfilled",
      },
    })).toBe(1);
    const cancellationEvent = await prisma.appointmentEvent.findFirstOrThrow({
      where: {
        salonId: data.salonId,
        appointmentId: original.appointment.id,
        eventType: "CANCELLED",
      },
      orderBy: { createdAt: "desc" },
      select: { newValue: true },
    });
    expect(cancellationEvent.newValue).toMatchObject({
      activeWaitlistCount: 3,
      waitlistPreserved: true,
    });
  });

  it("mantém status e slot ativos ao rejeitar início ou conclusão antecipados", async () => {
    const data = await fixture();
    const created = await withSalon(data.salonId, (tx) =>
      createAppointment(tx, {
        salonId: data.salonId,
        clientId: data.clients[0]!.id,
        professionalId: data.professionalId,
        serviceIds: [data.serviceId],
        startLocal: "2032-08-05T10:00",
        origin: "ADMIN",
        actor: { type: "STAFF", id: data.professionalUserId, name: "Dono CI" },
        idempotencyKey: crypto.randomUUID(),
        enforceBookingWindow: false,
      }),
    );

    for (const status of ["IN_PROGRESS", "COMPLETED"] as const) {
      await expect(withSalon(data.salonId, (tx) =>
        updateAppointmentStatusReliably(tx, {
          salonId: data.salonId,
          appointmentId: created.appointment.id,
          status,
          actor: { type: "STAFF", id: data.professionalUserId, name: "Dono CI" },
          idempotencyKey: crypto.randomUUID(),
          expectedVersion: 1,
          now: new Date("2032-08-05T12:59:59.999Z"),
        }),
      )).rejects.toMatchObject({ code: "NOT_STARTED_YET" });
    }

    await expect(prisma.appointment.findUniqueOrThrow({
      where: { id: created.appointment.id },
      select: { status: true, version: true },
    })).resolves.toEqual({ status: "CONFIRMED", version: 1 });
    expect(await prisma.appointment.count({
      where: {
        salonId: data.salonId,
        professionalId: data.professionalId,
        startAt: new Date("2032-08-05T13:00:00.000Z"),
        status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] },
      },
    })).toBe(1);
  });

  it("trata a fila do horário antigo na remarcação e mantém tudo intacto se o destino conflitar", async () => {
    const data = await fixture();
    const original = await withSalon(data.salonId, (tx) =>
      createAppointment(tx, {
        salonId: data.salonId,
        clientId: data.clients[0]!.id,
        professionalId: data.professionalId,
        serviceIds: [data.serviceId],
        startLocal: "2032-08-05T10:00",
        origin: "PUBLIC",
        actor: { type: "CLIENT", id: data.clients[0]!.id, name: "Cliente A" },
        idempotencyKey: crypto.randomUUID(),
        enforceBookingWindow: false,
      }),
    );
    const waiting = await withSalon(data.salonId, (tx) =>
      joinWaitlist(tx, {
        salonId: data.salonId,
        appointmentId: original.appointment.id,
        professionalId: data.professionalId,
        serviceIds: [data.serviceId],
        clientId: data.clients[1]!.id,
      }),
    );
    await withSalon(data.salonId, (tx) =>
      rescheduleAppointment(tx, {
        salonId: data.salonId,
        appointmentId: original.appointment.id,
        professionalId: data.professionalId,
        startLocal: "2032-08-05T11:00",
        actor: { type: "STAFF", id: data.professionalUserId, name: "Dono CI" },
        idempotencyKey: crypto.randomUUID(),
        expectedVersion: 1,
        enforceClientPolicy: false,
        now: new Date("2032-08-01T12:00:00.000Z"),
      }),
    );
    const filled = await prisma.waitlistEntry.findUniqueOrThrow({
      where: { id: waiting.entryId },
      select: { fulfilledAppointmentId: true },
    });
    await expect(prisma.appointment.findUniqueOrThrow({
      where: { id: original.appointment.id },
    })).resolves.toMatchObject({
      clientId: data.clients[0]!.id,
      startAt: new Date("2032-08-05T14:00:00.000Z"),
    });
    await expect(prisma.appointment.findUniqueOrThrow({
      where: { id: filled.fulfilledAppointmentId! },
    })).resolves.toMatchObject({
      clientId: data.clients[1]!.id,
      startAt: new Date("2032-08-05T13:00:00.000Z"),
    });

    await withSalon(data.salonId, (tx) =>
      createAppointment(tx, {
        salonId: data.salonId,
        clientId: data.clients[2]!.id,
        professionalId: data.professionalId,
        serviceIds: [data.serviceId],
        startLocal: "2032-08-05T12:00",
        origin: "PUBLIC",
        actor: { type: "CLIENT", id: data.clients[2]!.id, name: "Cliente C" },
        idempotencyKey: crypto.randomUUID(),
        enforceBookingWindow: false,
      }),
    );
    const secondQueue = await withSalon(data.salonId, (tx) =>
      joinWaitlist(tx, {
        salonId: data.salonId,
        appointmentId: original.appointment.id,
        professionalId: data.professionalId,
        serviceIds: [data.serviceId],
        clientId: data.clients[3]!.id,
      }),
    );
    await expect(withSalon(data.salonId, (tx) =>
      rescheduleAppointment(tx, {
        salonId: data.salonId,
        appointmentId: original.appointment.id,
        professionalId: data.professionalId,
        startLocal: "2032-08-05T12:00",
        actor: { type: "STAFF", id: data.professionalUserId, name: "Dono CI" },
        idempotencyKey: crypto.randomUUID(),
        expectedVersion: 2,
        enforceClientPolicy: false,
        now: new Date("2032-08-01T12:00:00.000Z"),
      }),
    )).rejects.toMatchObject({ code: "SLOT_TAKEN" });
    await expect(prisma.appointment.findUniqueOrThrow({
      where: { id: original.appointment.id },
    })).resolves.toMatchObject({
      startAt: new Date("2032-08-05T14:00:00.000Z"),
      version: 2,
    });
    await expect(prisma.waitlistEntry.findUniqueOrThrow({
      where: { id: secondQueue.entryId },
    })).resolves.toMatchObject({
      appointmentId: original.appointment.id,
      fulfilledAt: null,
      cancelledAt: null,
    });
  });

  it("serializa clique duplo na fila e rejeita IDs de outro tenant no serviço e no banco", async () => {
    const data = await fixture();
    const other = await fixture();
    const occupied = await withSalon(data.salonId, (tx) =>
      createAppointment(tx, {
        salonId: data.salonId,
        clientId: data.clients[0]!.id,
        professionalId: data.professionalId,
        serviceIds: [data.serviceId],
        startLocal: "2032-08-05T10:00",
        origin: "PUBLIC",
        actor: { type: "CLIENT", id: data.clients[0]!.id, name: "Cliente A" },
        idempotencyKey: crypto.randomUUID(),
        enforceBookingWindow: false,
      }),
    );
    const attempts = await Promise.all([
      withSalon(data.salonId, (tx) => joinWaitlist(tx, {
        salonId: data.salonId,
        appointmentId: occupied.appointment.id,
        professionalId: data.professionalId,
        serviceIds: [data.serviceId],
        clientId: data.clients[1]!.id,
      })),
      withSalon(data.salonId, (tx) => joinWaitlist(tx, {
        salonId: data.salonId,
        appointmentId: occupied.appointment.id,
        professionalId: data.professionalId,
        serviceIds: [data.serviceId],
        clientId: data.clients[1]!.id,
      })),
    ]);
    expect(attempts.filter((attempt) => attempt.duplicate)).toHaveLength(1);
    expect(await prisma.waitlistEntry.count({
      where: {
        salonId: data.salonId,
        appointmentId: occupied.appointment.id,
        clientId: data.clients[1]!.id,
        fulfilledAt: null,
        cancelledAt: null,
      },
    })).toBe(1);

    await expect(withSalon(other.salonId, (tx) =>
      joinWaitlist(tx, {
        salonId: other.salonId,
        appointmentId: occupied.appointment.id,
        professionalId: other.professionalId,
        serviceIds: [other.serviceId],
        clientId: other.clients[0]!.id,
      }),
    )).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(prisma.waitlistEntry.create({
      data: {
        salonId: other.salonId,
        appointmentId: occupied.appointment.id,
        clientId: other.clients[0]!.id,
        professionalId: other.professionalId,
        startAt: occupied.appointment.startAt,
        endAt: occupied.appointment.endAt,
        timezone: "America/Sao_Paulo",
        serviceSnapshots: [{
          serviceId: other.serviceId,
          serviceName: "Corte CI",
          durationMin: 30,
          priceCents: 5_000,
        }],
        priceCents: 5_000,
      },
    })).rejects.toBeTruthy();
  });
});
