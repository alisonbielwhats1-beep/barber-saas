import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ tx: {
  salon: { findUnique: vi.fn() }, packagePurchase: { findFirst: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  auditLog: { findFirst: vi.fn(), create: vi.fn() }, $queryRaw: vi.fn(),
} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ getTenantContext: vi.fn().mockResolvedValue({ salonId: "salon-a", userId: "user-a", role: "OWNER" }), assertRole: vi.fn() }));
vi.mock("@/lib/prisma-tenant", () => ({ withTenant: (_: unknown, callback: (tx: unknown) => unknown) => callback(mocks.tx) }));
vi.mock("@/lib/plan-entitlements", () => ({ assertPlanFeature: vi.fn() }));
import { usePackageSession, renewPurchase } from "../../app/(admin)/pacotes/actions";

describe("package lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.packagePurchase.findFirst.mockResolvedValue({ sessionsUsed: 1, sessionsTotal: 2, status: "ACTIVE", expiresAt: new Date("2099-01-01") });
    mocks.tx.packagePurchase.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.auditLog.findFirst.mockResolvedValue(null);
  });
  it("rejects expired sessions without changing the balance", async () => {
    mocks.tx.packagePurchase.findFirst.mockResolvedValue({ sessionsUsed: 0, sessionsTotal: 3, status: "ACTIVE", expiresAt: new Date("2020-01-01") });
    await expect(usePackageSession("purchase-a")).rejects.toThrow("expirou");
    expect(mocks.tx.packagePurchase.updateMany).not.toHaveBeenCalled();
  });
  it("uses an atomic increment and refuses stale concurrent balances", async () => {
    mocks.tx.packagePurchase.updateMany.mockResolvedValue({ count: 0 });
    await expect(usePackageSession("purchase-a")).rejects.toThrow("saldo mudou");
    expect(mocks.tx.packagePurchase.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ salonId: "salon-a", sessionsUsed: 1, status: "ACTIVE" }), data: { sessionsUsed: { increment: 1 }, status: "COMPLETED" } }));
    expect(mocks.tx.auditLog.create).not.toHaveBeenCalled();
  });
  it("creates a new renewal cycle without overwriting used sessions", async () => {
    mocks.tx.packagePurchase.findFirst.mockResolvedValue({ clientId: "client-a", packageId: "package-a", package: { active: true, sessions: 5, priceCents: 50000, validityDays: 30 } });
    mocks.tx.packagePurchase.create.mockResolvedValue({ id: "purchase-new" });
    await renewPurchase("purchase-a");
    expect(mocks.tx.packagePurchase.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.packagePurchase.create).toHaveBeenCalledWith({ data: expect.objectContaining({ salonId: "salon-a", clientId: "client-a", sessionsTotal: 5, priceCents: 50000 }) });
    expect(mocks.tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ entityId: "purchase-a", metadata: { nextPurchaseId: "purchase-new" } }) });
  });
  it("rejects duplicate renewal of the same cycle", async () => {
    mocks.tx.auditLog.findFirst.mockResolvedValue({ id: "already-renewed" });
    await expect(renewPurchase("purchase-a")).rejects.toThrow("já foi renovado");
    expect(mocks.tx.packagePurchase.create).not.toHaveBeenCalled();
  });
});
