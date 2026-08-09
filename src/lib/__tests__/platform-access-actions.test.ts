import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPlatformAdminContext: vi.fn(async () => ({
    userId: "platform-admin",
    email: "admin@example.com",
    name: "Admin",
  })),
  salonFindUnique: vi.fn(),
  salonUpdateMany: vi.fn(async () => ({ count: 1 })),
  eventCreate: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/platform-admin", () => ({
  getPlatformAdminContext: mocks.getPlatformAdminContext,
}));
vi.mock("@/lib/prisma-tenant", () => ({
  withUser: async (_userId: string, callback: (tx: unknown) => unknown) =>
    callback({
      salon: {
        findUnique: mocks.salonFindUnique,
        updateMany: mocks.salonUpdateMany,
      },
      salonAccessEvent: { create: mocks.eventCreate },
    }),
}));

import { reviewSalonAccess } from "@/app/(platform)/plataforma/actions";

describe("decisão de acesso da plataforma", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.salonUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("aprova como Pro e registra valores anteriores e novos", async () => {
    mocks.salonFindUnique.mockResolvedValue({
      id: "salon-1",
      plan: "FREE",
      accessStatus: "PENDING",
    });

    await reviewSalonAccess({
      salonId: "salon-1",
      decision: "APPROVE",
      plan: "PRO",
      reason: "Piloto aprovado",
    });

    expect(mocks.salonUpdateMany).toHaveBeenCalledWith({
      where: { id: "salon-1", accessStatus: "PENDING" },
      data: expect.objectContaining({ accessStatus: "APPROVED", plan: "PRO" }),
    });
    expect(mocks.eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "platform-admin",
        type: "APPROVED",
        previousStatus: "PENDING",
        newStatus: "APPROVED",
        previousPlan: "FREE",
        newPlan: "PRO",
      }),
    });
  });

  it("não recusa um estabelecimento que já está ativo", async () => {
    mocks.salonFindUnique.mockResolvedValue({
      id: "salon-1",
      plan: "FREE",
      accessStatus: "APPROVED",
    });

    await expect(
      reviewSalonAccess({ salonId: "salon-1", decision: "REJECT", reason: "Dados inválidos" }),
    ).rejects.toThrow("Somente solicitações pendentes");
    expect(mocks.salonUpdateMany).not.toHaveBeenCalled();
    expect(mocks.eventCreate).not.toHaveBeenCalled();
  });

  it("detecta revisão concorrente sem sobrescrever a decisão anterior", async () => {
    mocks.salonFindUnique.mockResolvedValue({
      id: "salon-1",
      plan: "FREE",
      accessStatus: "PENDING",
    });
    mocks.salonUpdateMany.mockResolvedValue({ count: 0 });

    await expect(
      reviewSalonAccess({ salonId: "salon-1", decision: "APPROVE", plan: "FREE" }),
    ).rejects.toThrow("alterada por outra pessoa");
    expect(mocks.eventCreate).not.toHaveBeenCalled();
  });
});
