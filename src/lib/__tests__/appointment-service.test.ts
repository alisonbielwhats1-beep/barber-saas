import { describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import {
  createAppointment,
  inspectAppointmentAvailability,
  rescheduleAppointment,
} from "../appointment-service";

function schedulingTx() {
  const appointmentCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "appointment-a",
    startAt: data.startAt as Date,
    endAt: data.endAt as Date,
    version: 1,
    clientId: data.clientId as string,
    professionalId: data.professionalId as string,
  }));
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
    salon: {
      findUnique: vi.fn().mockResolvedValue({
        timezone: "America/Sao_Paulo",
        minBookingLeadMinutes: 0,
        maxBookingLeadDays: 365,
        bufferMinutes: 15,
        cancelPolicyHours: 2,
      }),
    },
    service: {
      // Fora de ordem de propósito: o servidor deve respeitar a ordem pedida.
      findMany: vi.fn().mockResolvedValue([
        { id: "service-b", name: "Barba", durationMin: 45, priceCents: 4_000 },
        { id: "service-a", name: "Corte", durationMin: 30, priceCents: 5_000 },
      ]),
    },
    professionalService: {
      findMany: vi.fn().mockResolvedValue([
        { serviceId: "service-a" },
        { serviceId: "service-b" },
      ]),
    },
    workingHours: {
      findMany: vi.fn().mockResolvedValue([{ startMinutes: 9 * 60, endMinutes: 18 * 60 }]),
    },
    salonClosure: { findFirst: vi.fn().mockResolvedValue(null) },
    timeOff: { findFirst: vi.fn().mockResolvedValue(null) },
    appointment: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: appointmentCreate,
    },
    clientProfile: { findFirst: vi.fn().mockResolvedValue({ id: "client-a" }) },
    membership: { findMany: vi.fn().mockResolvedValue([{ userId: "owner-a" }]) },
    professional: { findFirst: vi.fn().mockResolvedValue({ userId: "pro-user-a" }) },
    appointmentEvent: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "event-a" }),
    },
    notificationOutbox: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
  };
  return { tx: tx as unknown as Tx, raw: tx, appointmentCreate };
}

describe("motor central de agendamentos", () => {
  it("impede profissional de transferir atendimento para outro profissional", async () => {
    await expect(
      rescheduleAppointment({} as Tx, {
        salonId: "salon-a",
        appointmentId: "appointment-a",
        professionalId: "professional-other",
        startLocal: "2026-08-06T10:00",
        actor: { type: "STAFF", id: "user-a", name: "Profissional" },
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        permittedProfessionalId: "professional-own",
        enforceClientPolicy: false,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("soma duração/preço no servidor e converte o horário pelo fuso do salão", async () => {
    const { tx, raw } = schedulingTx();

    const result = await inspectAppointmentAvailability(tx, {
      salonId: "salon-a",
      professionalId: "professional-a",
      serviceIds: ["service-a", "service-b"],
      startLocal: "2026-08-06T10:00",
      enforceBookingWindow: false,
    });

    expect(result.violation).toBeNull();
    expect(result.startAt.toISOString()).toBe("2026-08-06T13:00:00.000Z");
    expect(result.endAt.toISOString()).toBe("2026-08-06T14:15:00.000Z");
    expect(result.services.map((service) => service.id)).toEqual([
      "service-a",
      "service-b",
    ]);
    expect(raw.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          startAt: { lt: new Date("2026-08-06T14:30:00.000Z") },
          endAt: { gt: new Date("2026-08-06T12:45:00.000Z") },
        }),
      }),
    );
  });

  it("persiste snapshots, preço, evento e notificações uma única vez por chave", async () => {
    const { tx, raw, appointmentCreate } = schedulingTx();
    const input = {
      salonId: "salon-a",
      professionalId: "professional-a",
      serviceIds: ["service-a", "service-b"],
      startLocal: "2026-08-06T10:00",
      origin: "PUBLIC" as const,
      actor: { type: "CLIENT" as const, id: "client-a", name: "Cliente" },
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      enforceBookingWindow: false,
      clientId: "client-a",
    };

    const first = await createAppointment(tx, input);
    const persisted = appointmentCreate.mock.calls[0]![0].data as Record<string, unknown>;
    raw.appointment.findUnique.mockResolvedValue({
      id: first.appointment.id,
      startAt: first.appointment.startAt,
      endAt: first.appointment.endAt,
      version: 1,
      clientId: "client-a",
      professionalId: "professional-a",
      idempotencyFingerprint: persisted.idempotencyFingerprint,
    });
    const retry = await createAppointment(tx, input);

    expect(first.duplicate).toBe(false);
    expect(retry.duplicate).toBe(true);
    expect(appointmentCreate).toHaveBeenCalledOnce();
    expect(persisted).toEqual(
      expect.objectContaining({
        priceCents: 9_000,
        timezone: "America/Sao_Paulo",
        idempotencyKey: input.idempotencyKey,
        startAt: new Date("2026-08-06T13:00:00.000Z"),
        endAt: new Date("2026-08-06T14:15:00.000Z"),
        serviceItems: {
          create: [
            expect.objectContaining({ serviceId: "service-a", position: 0, priceCents: 5_000 }),
            expect.objectContaining({ serviceId: "service-b", position: 1, priceCents: 4_000 }),
          ],
        },
      }),
    );
    expect(raw.appointmentEvent.create).toHaveBeenCalledOnce();
    expect(raw.notificationOutbox.createMany).toHaveBeenCalledOnce();
  });
});
