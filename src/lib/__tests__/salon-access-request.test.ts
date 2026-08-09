import { describe, expect, it, vi } from "vitest";
import type { Tx } from "@/lib/prisma-tenant";
import { recordSalonAccessRequest } from "@/lib/salon-access-request";

describe("recordSalonAccessRequest", () => {
  it("usa INSERT sem RETURNING para não exigir policy de leitura do dono", async () => {
    const createMany = vi.fn(async () => ({ count: 1 }));
    const tx = {
      salonAccessEvent: { createMany },
    } as unknown as Tx;

    await recordSalonAccessRequest(tx, {
      salonId: "salon-1",
      actorUserId: "owner-1",
    });

    expect(createMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.any(String),
        salonId: "salon-1",
        actorUserId: "owner-1",
        type: "REQUESTED",
        previousStatus: null,
        newStatus: "PENDING",
        previousPlan: null,
        newPlan: "FREE",
      }),
    });
  });

  it("falha se o evento não for persistido", async () => {
    const tx = {
      salonAccessEvent: { createMany: vi.fn(async () => ({ count: 0 })) },
    } as unknown as Tx;

    await expect(
      recordSalonAccessRequest(tx, {
        salonId: "salon-1",
        actorUserId: "owner-1",
      }),
    ).rejects.toThrow("SALON_ACCESS_REQUEST_NOT_RECORDED");
  });
});
