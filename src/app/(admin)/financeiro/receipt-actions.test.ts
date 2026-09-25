import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ctx: { salonId: "salon-a", userId: "user-a", role: "OWNER" },
  close: vi.fn(),
  tx: {
    appointment: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/tenant", () => ({
  getTenantContext: async () => mocks.ctx,
  assertRole: (ctx: { role: string }, roles: string[]) => {
    if (!roles.includes(ctx.role)) throw new Error("FORBIDDEN_ROLE");
  },
}));
vi.mock("@/lib/prisma-tenant", () => ({
  withTenant: async (_ctx: unknown, fn: (tx: typeof mocks.tx) => unknown) => fn(mocks.tx),
}));
vi.mock("@/lib/comanda-service", () => ({ closeComandaReliably: mocks.close }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { receiveBatch } from "./receipt-actions";

const input = (discountCents?: number) => ({
  receivedDate: "2026-09-24", finalize: false,
  rows: [{ id: "appointment-a", version: 1,
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    method: "PIX" as const, extraServiceIds: [], surchargeCents: 0,
    discountCents, adjustmentReason: "", expectedTotalCents: 3500, products: [],
  }],
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.ctx.role = "OWNER";
  mocks.tx.appointment.findFirst.mockResolvedValue({ status: "COMPLETED" });
  mocks.tx.user.findUnique.mockResolvedValue({ name: "Operador" });
  mocks.close.mockResolvedValue({ duplicate: false, paymentId: "payment-a" });
});
describe("desconto na baixa de recebimentos", () => {
  it.each(["OWNER", "MANAGER"])("encaminha o desconto e o total revisado para %s no tenant autenticado", async role => {
    mocks.ctx.role = role;
    expect(await receiveBatch(input(2000))).toEqual([expect.objectContaining({ success: true })]);
    expect(mocks.close).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({
      salonId: "salon-a", userId: "user-a", role, discountCents: 2000, expectedTotalCents: 3500,
    }));
  });
  it("mantém compatibilidade com clientes que não enviam desconto", async () => {
    await receiveBatch(input());
    expect(mocks.close).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ discountCents: 0 }));
  });
  it.each([-1, 0.5, NaN, 100_000_001])("rejeita desconto inválido %s antes de gravar", async discount => {
    await expect(receiveBatch(input(discount))).rejects.toThrow();
    expect(mocks.close).not.toHaveBeenCalled();
  });
  it.each(["RECEPTIONIST", "PROFESSIONAL"])("bloqueia baixa por %s", async role => {
    mocks.ctx.role = role;
    await expect(receiveBatch(input(2000))).rejects.toThrow("FORBIDDEN_ROLE");
    expect(mocks.close).not.toHaveBeenCalled();
  });
  it("mantém pendente a linha cujo desconto foi recusado pelo domínio", async () => {
    mocks.close.mockRejectedValueOnce(new Error("O desconto não pode superar o total do atendimento."));
    expect(await receiveBatch(input(6000))).toEqual([{
      id: "appointment-a", success: false, message: "O desconto não pode superar o total do atendimento.",
    }]);
  });
});
