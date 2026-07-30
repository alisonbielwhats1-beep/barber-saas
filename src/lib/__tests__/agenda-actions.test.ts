import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const clientCreateOutsideTransaction = vi.fn();
  const txClientCreate = vi.fn();
  const txAppointmentCreate = vi.fn();
  const tx = {
    clientProfile: { create: txClientCreate },
    appointment: { create: txAppointmentCreate, findFirst: vi.fn() },
    $queryRaw: vi.fn(),
  };
  return {
    tx,
    txClientCreate,
    txAppointmentCreate,
    clientCreateOutsideTransaction,
    prisma: {
      service: { findFirst: vi.fn() },
      professionalService: { findFirst: vi.fn() },
      appointment: { findFirst: vi.fn() },
      clientProfile: {
        findFirst: vi.fn(),
        create: clientCreateOutsideTransaction,
      },
      $transaction: vi.fn(
        async (callback: (value: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/tenant", () => ({
  getTenantContext: () =>
    Promise.resolve({
      salonId: "salon-a",
      userId: "owner-a",
      role: "OWNER",
    }),
  assertRole: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createAppointmentManually } from "@/app/(admin)/agenda/actions";

describe("createAppointmentManually", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.service.findFirst.mockResolvedValue({
      durationMin: 30,
      priceCents: 5_000,
    });
    mocks.prisma.professionalService.findFirst.mockResolvedValue({
      serviceId: "service-a",
    });
    mocks.prisma.appointment.findFirst.mockResolvedValue(null);
    mocks.txClientCreate.mockResolvedValue({ id: "client-new" });
    mocks.txAppointmentCreate.mockResolvedValue({ id: "appointment-new" });
    mocks.tx.appointment.findFirst.mockResolvedValue(null);
  });

  it("cria contato novo e agendamento dentro da mesma transação", async () => {
    await expect(
      createAppointmentManually({
        professionalId: "professional-a",
        serviceId: "service-a",
        clientName: "Cliente novo",
        clientPhone: "11999999999",
        startAt: "2030-01-10T15:00:00.000Z",
      }),
    ).resolves.toEqual({ success: true });

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.txClientCreate).toHaveBeenCalledWith({
      data: {
        salonId: "salon-a",
        name: "Cliente novo",
        phone: "11999999999",
      },
      select: { id: true },
    });
    expect(mocks.txAppointmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ clientId: "client-new" }),
      }),
    );
    expect(mocks.clientCreateOutsideTransaction).not.toHaveBeenCalled();
  });

  it("traduz conflito da transação sem criar contato fora dela", async () => {
    mocks.txAppointmentCreate.mockRejectedValue(
      new Error("appointment_no_overlap"),
    );

    await expect(
      createAppointmentManually({
        professionalId: "professional-a",
        serviceId: "service-a",
        clientName: "Cliente novo",
        startAt: "2030-01-10T15:00:00.000Z",
      }),
    ).resolves.toEqual({ error: "Horário já ocupado" });

    expect(mocks.txClientCreate).toHaveBeenCalledTimes(1);
    expect(mocks.clientCreateOutsideTransaction).not.toHaveBeenCalled();
  });
});
