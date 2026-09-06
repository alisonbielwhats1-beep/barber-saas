import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ tx: { auditLog: { findMany: vi.fn(), create: vi.fn() }, payment: { aggregate: vi.fn() }, user: { findUnique: vi.fn() }, $queryRaw: vi.fn() } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ getTenantContext: vi.fn().mockResolvedValue({ salonId: "salon-a", userId: "user-a", role: "OWNER" }), assertRole: vi.fn() }));
vi.mock("@/lib/prisma-tenant", () => ({ withTenant: (_: unknown, callback: (tx: unknown) => unknown) => callback(mocks.tx) }));
import { closeCashRegister } from "../../app/(admin)/pagamentos/actions";
describe("cash register closing", () => {
  beforeEach(() => vi.clearAllMocks());
  it("ignores a forged expected balance and calculates from opening and actual cash payments", async () => {
    const openedAt = new Date("2026-09-01T12:00:00Z");
    mocks.tx.auditLog.findMany.mockResolvedValue([{ action: "CASH_OPENED", createdAt: openedAt, metadata: { openingFloatCents: 10000 } }]);
    mocks.tx.payment.aggregate.mockResolvedValue({ _sum: { amountCents: 27000 } });
    const result = await closeCashRegister({ countedCashCents: 36000, expectedCashCents: 1 });
    expect(result).toEqual({ success: true });
    expect(mocks.tx.payment.aggregate).toHaveBeenCalledWith({ where: { appointment: { salonId: "salon-a" }, method: "CASH", paidAt: { gte: openedAt, lte: expect.any(Date) } }, _sum: { amountCents: true } });
    expect(mocks.tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ metadata: expect.objectContaining({ expectedCashCents: 37000, differenceCents: -1000 }) }) });
    expect(mocks.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(mocks.tx.auditLog.findMany.mock.invocationCallOrder[0]);
  });
  it("rejects a closing when the register is already closed", async () => {
    mocks.tx.auditLog.findMany.mockResolvedValue([]);
    expect(await closeCashRegister({ countedCashCents: 0, expectedCashCents: 0 })).toEqual({ error: "Abra o caixa antes de fechá-lo" });
    expect(mocks.tx.auditLog.create).not.toHaveBeenCalled();
  });
});
