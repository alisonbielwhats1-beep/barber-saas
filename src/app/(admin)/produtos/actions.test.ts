import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: "OWNER",
  tx: { salon: { findUnique: vi.fn() }, user: { findUnique: vi.fn() } },
  adjust: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tenant", () => ({
  getTenantContext: async () => ({ salonId: "salon-a", userId: "owner", role: mocks.role }),
  assertRole: (ctx: { role: string }, roles: string[]) => {
    if (!roles.includes(ctx.role)) throw new Error("Forbidden");
  },
}));
vi.mock("@/lib/prisma-tenant", () => ({
  withTenant: async (_ctx: unknown, callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx),
}));
vi.mock("@/lib/inventory-lock", () => ({ lockProductMutations: vi.fn() }));
vi.mock("@/lib/appointment-product-service", () => ({ adjustProductStockReliably: mocks.adjust }));
import { adjustStock } from "./actions";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.role = "OWNER";
  mocks.tx.salon.findUnique.mockResolvedValue({ plan: "PRO" });
  mocks.tx.user.findUnique.mockResolvedValue({ name: "Alison" });
  mocks.adjust.mockResolvedValue({ previousStock: 5, newStock: 8 });
});

describe("movimentação de estoque: o motivo é opcional", () => {
  it.each([
    ["vazio", ""],
    ["só espaços", "   "],
  ])("motivo %s vira 'sem motivo' e a auditoria ainda recebe o ator", async (_label, reason) => {
    await adjustStock("product-1", 3, { reason, kind: "PURCHASE" });

    expect(mocks.adjust).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        salonId: "salon-a",
        productId: "product-1",
        delta: 3,
        userId: "owner",
        actorName: "Alison",
        reason: null,
        kind: "PURCHASE",
      }),
    );
  });

  it("com motivo, repassa o texto; as ações rápidas continuam com o motivo próprio", async () => {
    await adjustStock("product-1", -1, { reason: " Nota 123 ", kind: "LOSS" });
    expect(mocks.adjust).toHaveBeenLastCalledWith(mocks.tx, expect.objectContaining({ reason: "Nota 123", delta: -1 }));
    await adjustStock("product-1", 1, { reason: "Ajuste rápido de entrada", kind: "ADJUSTMENT" });
    expect(mocks.adjust).toHaveBeenLastCalledWith(mocks.tx, expect.objectContaining({ reason: "Ajuste rápido de entrada" }));
  });

  it("continua exigindo quantidade, papel e plano com estoque", async () => {
    await expect(adjustStock("product-1", 0, { reason: "" })).rejects.toThrow();
    await expect(adjustStock("product-1", 1, { reason: "x".repeat(301) })).rejects.toThrow();
    mocks.tx.salon.findUnique.mockResolvedValue({ plan: "FREE" });
    await expect(adjustStock("product-1", 1, { reason: "" })).rejects.toThrow("recurso de estoque");
    mocks.role = "RECEPTIONIST";
    await expect(adjustStock("product-1", 1, { reason: "" })).rejects.toThrow("Forbidden");
    expect(mocks.adjust).not.toHaveBeenCalled();
  });
});
