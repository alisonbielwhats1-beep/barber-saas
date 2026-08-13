import { describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import {
  cancelActiveWaitlistForAppointment,
  cancelWaitlistEntry,
  fulfillWaitlistOnCancel,
  joinWaitlist,
} from "../waitlist";

describe("preenchimento automático da lista de espera", () => {
  it("persiste o agendamento e seus serviços atomicamente sem misturar inputs relacionais", async () => {
    const appointmentCreate = vi.fn().mockResolvedValue({
      id: "appointment-new",
      clientId: "client-a",
    });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
      waitlistEntry: {
        findFirst: vi.fn().mockResolvedValue({
          id: "waitlist-a",
          clientId: "client-a",
          guestName: null,
          guestPhone: null,
          professionalId: "professional-a",
          startAt: new Date("2026-08-06T13:00:00.000Z"),
          endAt: new Date("2026-08-06T13:45:00.000Z"),
          timezone: "America/Sao_Paulo",
          serviceSnapshots: [{
            serviceId: "service-requested",
            serviceName: "Barba",
            durationMin: 45,
            priceCents: 6_500,
          }],
          priceCents: 6_500,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      appointment: {
        findFirst: vi.fn().mockResolvedValue({
          serviceId: "service-original",
          professionalId: "professional-a",
          startAt: new Date("2026-08-06T13:00:00.000Z"),
          endAt: new Date("2026-08-06T13:30:00.000Z"),
          priceCents: 5_000,
          timezone: "America/Sao_Paulo",
          serviceItems: [
            {
              serviceId: "service-original",
              serviceName: "Corte",
              durationMin: 30,
              priceCents: 5_000,
            },
          ],
          service: {
            id: "service-original",
            name: "Corte",
            durationMin: 30,
            priceCents: 5_000,
          },
        }),
        create: appointmentCreate,
      },
      appointmentService: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      clientProfile: { create: vi.fn() },
      membership: {
        findMany: vi.fn().mockResolvedValue([{ userId: "owner-a" }]),
      },
      professional: {
        findFirst: vi.fn().mockResolvedValue({ userId: "professional-user-a" }),
      },
      appointmentEvent: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "event-a" }),
      },
      notificationOutbox: {
        createMany: vi.fn().mockResolvedValue({ count: 3 }),
      },
    };

    const result = await fulfillWaitlistOnCancel(
      tx as unknown as Tx,
      "appointment-old",
      "salon-a",
    );

    expect(result).toEqual({
      appointmentId: "appointment-new",
      clientId: "client-a",
    });
    expect(appointmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          serviceId: "service-requested",
          priceCents: 6_500,
          endAt: new Date("2026-08-06T13:45:00.000Z"),
        }),
      }),
    );
    expect(appointmentCreate.mock.calls[0]?.[0]?.data).not.toHaveProperty("serviceItems");
    expect(tx.appointmentService.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          appointmentId: "appointment-new",
          salonId: "salon-a",
          serviceId: "service-requested",
          position: 0,
        }),
      ],
    });
    expect(tx.waitlistEntry.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.waitlistEntry.updateMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({
        appointmentId: "appointment-old",
        fulfilledAt: null,
        cancelledAt: null,
      }),
      data: { appointmentId: "appointment-new" },
    });
    expect(tx.appointmentEvent.create).toHaveBeenCalledOnce();
    expect(tx.notificationOutbox.createMany).toHaveBeenCalledOnce();
  });

  it("serializa a entrada, devolve a posição e trata clique repetido como idempotente", async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
      appointment: {
        findFirst: vi.fn().mockResolvedValue({
          id: "appointment-a",
          startAt: new Date("2032-08-05T13:00:00.000Z"),
          timezone: "America/Sao_Paulo",
        }),
      },
      service: {
        findMany: vi.fn().mockResolvedValue([{
          id: "service-a",
          name: "Corte",
          durationMin: 30,
          priceCents: 5_000,
        }]),
        count: vi.fn(),
      },
      clientProfile: {
        findFirst: vi.fn().mockResolvedValue({ id: "client-a" }),
      },
      waitlistEntry: {
        findFirst: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: "waitlist-a",
            professionalId: "professional-a",
            startAt: new Date("2032-08-05T13:00:00.000Z"),
            timezone: "America/Sao_Paulo",
            serviceSnapshots: [{
              serviceId: "service-a",
              serviceName: "Corte",
              durationMin: 30,
              priceCents: 5_000,
            }],
          }),
        create: vi.fn().mockResolvedValue({
          id: "waitlist-a",
          professionalId: "professional-a",
          startAt: new Date("2032-08-05T13:00:00.000Z"),
          timezone: "America/Sao_Paulo",
          serviceSnapshots: [{
            serviceId: "service-a",
            serviceName: "Corte",
            durationMin: 30,
            priceCents: 5_000,
          }],
        }),
        findMany: vi.fn().mockResolvedValue([
          { id: "waitlist-before" },
          { id: "waitlist-a" },
        ]),
      },
    };

    await expect(joinWaitlist(tx as unknown as Tx, {
      salonId: "salon-a",
      appointmentId: "appointment-a",
      professionalId: "professional-a",
      serviceIds: ["service-a"],
      clientId: "client-a",
    })).resolves.toMatchObject({
      entryId: "waitlist-a",
      position: 2,
      duplicate: false,
    });
    await expect(joinWaitlist(tx as unknown as Tx, {
      salonId: "salon-a",
      appointmentId: "appointment-a",
      professionalId: "professional-a",
      serviceIds: ["service-a"],
      clientId: "client-a",
    })).resolves.toMatchObject({
      entryId: "waitlist-a",
      position: 2,
      duplicate: true,
    });
    expect(tx.waitlistEntry.create).toHaveBeenCalledOnce();
    expect(tx.waitlistEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        professionalId: "professional-a",
        priceCents: 5_000,
        startAt: new Date("2032-08-05T13:00:00.000Z"),
        endAt: new Date("2032-08-05T13:30:00.000Z"),
        serviceSnapshots: [{
          serviceId: "service-a",
          serviceName: "Corte",
          durationMin: 30,
          priceCents: 5_000,
        }],
      }),
      select: {
        id: true,
        professionalId: true,
        startAt: true,
        timezone: true,
        serviceSnapshots: true,
      },
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("remove apenas uma pessoa da fila e preserva o agendamento principal", async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
      waitlistEntry: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({ appointmentId: "appointment-a" })
          .mockResolvedValueOnce({
            appointmentId: "appointment-a",
            clientId: "client-a",
            fulfilledAt: null,
            cancelledAt: null,
          }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      appointment: {
        updateMany: vi.fn(),
      },
    };

    await expect(cancelWaitlistEntry(tx as unknown as Tx, {
      salonId: "salon-a",
      entryId: "waitlist-a",
      actorType: "STAFF",
      actorId: "owner-a",
      reason: "Cliente pediu remoção",
    })).resolves.toEqual({ appointmentId: "appointment-a", duplicate: false });
    expect(tx.waitlistEntry.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "waitlist-a", salonId: "salon-a" }),
      data: expect.objectContaining({
        cancelledByType: "STAFF",
        cancelledById: "owner-a",
      }),
    });
    expect(tx.appointment.updateMany).not.toHaveBeenCalled();
  });

  it("encerra atomicamente todas as entradas ativas quando a equipe cancela o horário", async () => {
    const cancelledAt = new Date("2026-08-13T15:00:00.000Z");
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
      waitlistEntry: { updateMany },
    };

    await expect(cancelActiveWaitlistForAppointment(tx as unknown as Tx, {
      salonId: "salon-a",
      appointmentId: "appointment-a",
      actorId: "owner-a",
      reason: "Profissional indisponível",
      cancelledAt,
    })).resolves.toBe(3);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        salonId: "salon-a",
        appointmentId: "appointment-a",
        fulfilledAt: null,
        cancelledAt: null,
      },
      data: {
        cancelledAt,
        cancelledByType: "STAFF",
        cancelledById: "owner-a",
        cancelledReason: "Profissional indisponível",
      },
    });
  });
});
