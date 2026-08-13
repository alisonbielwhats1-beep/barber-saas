import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const context = {
    salonId: "salon-a",
    userId: "user-a",
    role: "OWNER",
  };
  const tx = {
    appointment: { findFirst: vi.fn() },
    product: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
  };
  return {
    context,
    tx,
    withTenant: vi.fn(async (
      _context: typeof context,
      callback: (value: typeof tx) => unknown,
    ) => callback(tx)),
    closeComandaReliably: vi.fn(),
    revalidatePath: vi.fn(),
  };
});

vi.mock("@/lib/tenant", () => ({
  getTenantContext: vi.fn(async () => mocks.context),
  assertRole: (
    context: { role: string },
    allowed: readonly string[],
  ) => {
    if (!allowed.includes(context.role)) throw new Error("FORBIDDEN_ROLE");
  },
}));
vi.mock("@/lib/prisma-tenant", () => ({
  withTenant: mocks.withTenant,
}));
vi.mock("@/lib/comanda-service", () => ({
  closeComandaReliably: mocks.closeComandaReliably,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { closeComanda, getComandaData } from "@/app/(admin)/agenda/actions";

const receipt = {
  id: "appointment-a",
  startAt: new Date("2030-01-10T15:00:00.000Z"),
  version: 1,
  priceCents: 5_000,
  client: { name: "Cliente A" },
  service: { name: "Corte", priceCents: 6_000 },
  serviceItems: [{ serviceName: "Corte snapshot", priceCents: 5_000 }],
  products: [],
  payment: {
    id: "payment-a",
    amountCents: 4_500,
    discountCents: 500,
    method: "PIX",
    notes: null,
    paidAt: new Date("2030-01-10T16:00:00.000Z"),
  },
};

const checkoutInput = {
  id: "appointment-a",
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  expectedVersion: 1,
  discountCents: 0,
  productLines: [],
  method: "PIX" as const,
  notes: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.salonId = "salon-a";
  mocks.context.userId = "user-a";
  mocks.context.role = "OWNER";
  mocks.tx.appointment.findFirst.mockResolvedValue(receipt);
  mocks.tx.product.findMany.mockResolvedValue([]);
  mocks.tx.user.findUnique.mockResolvedValue({ name: "Operador A" });
  mocks.closeComandaReliably.mockResolvedValue({
    duplicate: false,
    paymentId: "payment-a",
  });
});

describe("boundaries de checkout e recibo", () => {
  it.each(["OWNER", "MANAGER", "RECEPTIONIST"])(
    "permite recibo somente para role operacional autorizada %s",
    async (role) => {
      mocks.context.role = role;
      await expect(getComandaData("appointment-a")).resolves.toMatchObject({
        payment: {
          id: "payment-a",
          amountCents: 4_500,
          discountCents: 500,
          method: "PIX",
        },
        serviceItems: [{ serviceName: "Corte snapshot", priceCents: 5_000 }],
      });
      expect(mocks.tx.appointment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "appointment-a", salonId: "salon-a" },
        }),
      );
    },
  );

  it("nega recibo ao profissional antes de abrir transação tenant", async () => {
    mocks.context.role = "PROFESSIONAL";
    await expect(getComandaData("appointment-a")).rejects.toThrow("FORBIDDEN_ROLE");
    expect(mocks.withTenant).not.toHaveBeenCalled();
  });

  it("não retorna recibo de appointment estrangeiro mesmo com id conhecido", async () => {
    mocks.tx.appointment.findFirst.mockResolvedValueOnce(null);
    await expect(getComandaData("appointment-salon-b"))
      .rejects.toThrow("Agendamento não encontrado");
    expect(mocks.tx.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "appointment-salon-b", salonId: "salon-a" },
      }),
    );
    expect(mocks.tx.product.findMany).not.toHaveBeenCalled();
  });

  it.each(["OWNER", "MANAGER", "RECEPTIONIST"])(
    "executa checkout %s passando tenant e role exclusivamente da sessão",
    async (role) => {
      mocks.context.role = role;
      await expect(closeComanda(checkoutInput)).resolves.toEqual({ success: true });
      expect(mocks.closeComandaReliably).toHaveBeenCalledWith(
        mocks.tx,
        expect.objectContaining({
          salonId: "salon-a",
          userId: "user-a",
          role,
          appointmentId: "appointment-a",
        }),
      );
    },
  );

  it("nega checkout ao profissional antes do núcleo e de qualquer escrita", async () => {
    mocks.context.role = "PROFESSIONAL";
    await expect(closeComanda(checkoutInput)).rejects.toThrow("FORBIDDEN_ROLE");
    expect(mocks.withTenant).not.toHaveBeenCalled();
    expect(mocks.closeComandaReliably).not.toHaveBeenCalled();
  });
});

