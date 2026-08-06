import { describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import { getClientHistory, getClientList } from "../crm";

describe("escopo de clientes do profissional", () => {
  it("lista somente clientes ligados ao profissional e não carrega dados comerciais", async () => {
    const packageGroupBy = vi.fn();
    const subscriptionGroupBy = vi.fn();
    const clientFindMany = vi.fn().mockResolvedValue([]);
    const tx = {
      clientProfile: { findMany: clientFindMany },
      professional: { findMany: vi.fn().mockResolvedValue([]) },
      service: { findMany: vi.fn().mockResolvedValue([]) },
      packagePurchase: { groupBy: packageGroupBy },
      clientSubscription: { groupBy: subscriptionGroupBy },
    } as unknown as Tx;

    await getClientList(tx, "salon-a", {
      professionalId: "professional-a",
      includeCommercialData: false,
    });

    expect(clientFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          salonId: "salon-a",
          appointments: { some: { professionalId: "professional-a" } },
        },
        select: expect.objectContaining({
          appointments: expect.objectContaining({
            where: { status: "COMPLETED", professionalId: "professional-a" },
          }),
        }),
      }),
    );
    expect(packageGroupBy).not.toHaveBeenCalled();
    expect(subscriptionGroupBy).not.toHaveBeenCalled();
  });

  it("filtra também o histórico aberto pelo profissional", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const tx = { appointment: { findMany } } as unknown as Tx;

    await getClientHistory(tx, "salon-a", "client-a", "professional-a");

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          salonId: "salon-a",
          clientId: "client-a",
          professionalId: "professional-a",
        },
      }),
    );
  });
});
