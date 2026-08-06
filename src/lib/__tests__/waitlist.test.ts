import { describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import { fulfillWaitlistOnCancel } from "../waitlist";

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
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      appointment: {
        findFirst: vi.fn().mockResolvedValue({
          serviceId: "service-a",
          professionalId: "professional-a",
          startAt: new Date("2026-08-06T13:00:00.000Z"),
          endAt: new Date("2026-08-06T13:30:00.000Z"),
          priceCents: 5_000,
          timezone: "America/Sao_Paulo",
          serviceItems: [
            {
              serviceId: "service-a",
              serviceName: "Corte",
              durationMin: 30,
              priceCents: 5_000,
            },
          ],
          service: {
            id: "service-a",
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
        data: expect.not.objectContaining({ serviceItems: expect.anything() }),
      }),
    );
    expect(tx.appointmentService.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          appointmentId: "appointment-new",
          salonId: "salon-a",
          serviceId: "service-a",
          position: 0,
        }),
      ],
    });
    expect(tx.waitlistEntry.updateMany).toHaveBeenCalledOnce();
    expect(tx.appointmentEvent.create).toHaveBeenCalledOnce();
    expect(tx.notificationOutbox.createMany).toHaveBeenCalledOnce();
  });
});
