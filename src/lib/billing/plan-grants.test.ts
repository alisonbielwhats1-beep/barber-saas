import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import { activePlanGrant, complimentaryEntitlement, featureEntitlement, grantEntitlement, grantExpiry, grantInput, grantPlan } from "./plan-grants";
import { assertInventoryAccess } from "../inventory-catalog";
import { effectiveEntitlement } from "./entitlements";

const now = new Date("2026-10-09T15:00:00Z");
const input = { salonId: "salon-a", requestKey: "70eb8e36-b0da-4de9-bb65-77cb5e8d040b", plan: "INDIVIDUAL", through: "2026-10-19", reason: "Teste autorizado" };
function fixture() {
  const grant = { id: "grant", salonId: "salon-a", planCode: "INDIVIDUAL", agendaLimit: 1, amountCents: 3990, throughDate: input.through, reason: input.reason };
  const mock = {
    user: { findUnique: vi.fn(async () => ({ platformRole: "SUPER_ADMIN" })) },
    salon: { findUniqueOrThrow: vi.fn(async () => ({ id: "salon-a", name: "Synthetic", plan: "FREE", accessStatus: "APPROVED", timezone: "America/Sao_Paulo" })) },
    salonPlanGrant: { findFirst: vi.fn(async (): Promise<typeof grant | null> => grant), findUnique: vi.fn(async (): Promise<null | typeof grant> => null), updateMany: vi.fn(), create: vi.fn(async () => grant) },
    billingSubscription: { count: vi.fn(async () => 0), findFirst: vi.fn(async (): Promise<null | { id: string }> => null) },
    professional: { count: vi.fn(async () => 1) }, userInvite: { count: vi.fn(async () => 0) },
    membership: { findFirst: vi.fn(async () => null) },
    hqAccounts: { upsert: vi.fn(async () => ({ id: "account" })) }, hqCustomers: { upsert: vi.fn() }, hqActivities: { create: vi.fn() },
    $queryRaw: vi.fn(), $executeRaw: vi.fn(),
  };
  return { mock, tx: mock as unknown as Tx, grant };
}
afterEach(() => vi.unstubAllEnvs());
describe("administrative plan courtesy", () => {
  it("keeps all of the 19th in Sao Paulo, expiring at midnight on the 20th", () => {
    expect(grantExpiry(input.through, "America/Sao_Paulo", now).toISOString()).toBe("2026-10-20T03:00:00.000Z");
  });
  it("uses the salon timezone, including calendar month boundaries", () => {
    expect(grantExpiry("2026-10-31", "America/New_York", now).toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });
  it.each(["2026-02-30", "2026-10-08", "2028-10-19", "bad"])("rejects invalid, past or unbounded dates: %s", day => {
    expect(() => grantExpiry(day, "America/Sao_Paulo", now)).toThrow();
  });
  it("does not query an unapplied table while the flag is off", async () => {
    vi.stubEnv("PLATFORM_PLAN_GRANTS_ENABLED", "false");
    const { tx, mock } = fixture();
    expect(await activePlanGrant(tx, "salon-a", now)).toBeNull();
    expect(mock.salonPlanGrant.findFirst).not.toHaveBeenCalled();
    await expect(grantPlan(tx, "admin", input, now)).rejects.toThrow("ativação");
  });
  it("reads only this tenant and excludes the exact end instant", async () => {
    vi.stubEnv("PLATFORM_PLAN_GRANTS_ENABLED", "true");
    const { tx, mock } = fixture(); const end = new Date("2026-10-20T03:00:00Z");
    await activePlanGrant(tx, "salon-a", end);
    expect(mock.salonPlanGrant.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { salonId: "salon-a", revokedAt: null, createdAt: { lte: end }, endsAt: { gt: end } } }));
  });
  it("never treats a courtesy as payment or masks an existing debt/review", async () => {
    vi.stubEnv("PLATFORM_PLAN_GRANTS_ENABLED", "true");
    const { tx, mock } = fixture();
    mock.billingSubscription.findFirst.mockResolvedValue({ id: "paid-or-reviewed" });
    expect(await complimentaryEntitlement(tx, "salon-a", now)).toBeNull();
    expect(mock.billingSubscription.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { salonId: "salon-a", OR: [{ paidThrough: { not: null } }, { reviewRequired: true }] } }));
  });
  it("grants one agenda, unlimited bookings and premium features during the courtesy", async () => {
    vi.stubEnv("PLATFORM_PLAN_GRANTS_ENABLED", "true");
    const { tx } = fixture();
    expect(await effectiveEntitlement(tx, "salon-a", "FREE", now)).toEqual({ label: "Individual", priceCents: 3990, maxProfessionals: 1, monthlyAppointments: null, features: { MARKETING: true, INVENTORY: true, PACKAGES: true } });
    expect((await featureEntitlement(tx, "salon-a", "FREE", now)).features.INVENTORY).toBe(true);
  });
  it("uses the live inventory authorization during courtesy without bypassing membership", async () => {
    vi.stubEnv("PLATFORM_PLAN_GRANTS_ENABLED", "true");
    const { mock, tx } = fixture();
    Object.assign(mock.salon, { findFirstOrThrow: vi.fn(async () => ({ plan: "FREE" })) });
    mock.$queryRaw.mockResolvedValueOnce([{ accessStatus: "APPROVED", currency: "BRL" }]).mockResolvedValueOnce([{ role: "OWNER" }]);
    await expect(assertInventoryAccess(tx, { salonId: "salon-a", userId: "owner" }, true)).resolves.toBeUndefined();
    mock.$queryRaw.mockResolvedValueOnce([{ accessStatus: "APPROVED" }]).mockResolvedValueOnce([]);
    await expect(assertInventoryAccess(tx, { salonId: "salon-a", userId: "outsider" }, true)).rejects.toThrow("FORBIDDEN");
  });
  it("returns the Free features when the database reports no current courtesy", async () => {
    vi.stubEnv("PLATFORM_PLAN_GRANTS_ENABLED", "true");
    const { mock, tx } = fixture();
    mock.salonPlanGrant.findFirst.mockResolvedValue(null);
    expect((await featureEntitlement(tx, "salon-a", "FREE", now)).features.INVENTORY).toBe(false);
  });
  it("reserves the smaller capacity of a pending paid checkout", async () => {
    vi.stubEnv("PLATFORM_PLAN_GRANTS_ENABLED", "true");
    vi.stubEnv("MERCADOPAGO_PLAN_CHANGES_ENABLED", "false");
    const { mock, tx, grant } = fixture(); grant.planCode = "TEAM_MAX"; grant.agendaLimit = 10;
    const pending = { id: "pending", planCode: "INDIVIDUAL", cycle: "MONTHLY", catalogVersion: "2026-10-02", amountCents: 3990, agendaLimit: 1, intervalMonths: 1 };
    mock.billingSubscription.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(pending);
    expect((await effectiveEntitlement(tx, "salon-a", "FREE", now)).maxProfessionals).toBe(1);
  });
  it("cannot choose legacy/unknown codes or client-supplied pricing", () => {
    expect(grantInput.safeParse({ ...input, plan: "PRO" }).success).toBe(false);
    expect(grantInput.safeParse({ ...input, amountCents: 1 }).success).toBe(false);
    expect(() => grantEntitlement({ planCode: "unknown", agendaLimit: 100, amountCents: 1 })).toThrow();
  });
  it("revalidates admin before any mutation", async () => {
    vi.stubEnv("PLATFORM_PLAN_GRANTS_ENABLED", "true");
    const { tx, mock } = fixture(); mock.user.findUnique.mockResolvedValue({ platformRole: "USER" });
    await expect(grantPlan(tx, "owner", input, now)).rejects.toThrow("administração");
    expect(mock.salonPlanGrant.create).not.toHaveBeenCalled();
  });
  it("rejects existing contracts and insufficient capacity without replacing anything", async () => {
    vi.stubEnv("PLATFORM_PLAN_GRANTS_ENABLED", "true");
    const { tx, mock } = fixture();
    mock.billingSubscription.count.mockResolvedValue(1);
    await expect(grantPlan(tx, "admin", input, now)).rejects.toThrow("assinatura");
    mock.billingSubscription.count.mockResolvedValue(0); mock.userInvite.count.mockResolvedValue(1);
    await expect(grantPlan(tx, "admin", input, now)).rejects.toThrow("convites");
    expect(mock.salonPlanGrant.updateMany).not.toHaveBeenCalled();
  });
  it("persists catalog terms and a separate HQ trial, without writing invoices", async () => {
    vi.stubEnv("PLATFORM_PLAN_GRANTS_ENABLED", "true");
    const { tx, mock } = fixture();
    await grantPlan(tx, "admin", input, now);
    expect(mock.salonPlanGrant.create).toHaveBeenCalledWith({ data: expect.objectContaining({ planCode: "INDIVIDUAL", amountCents: 3990, agendaLimit: 1, endsAt: new Date("2026-10-20T03:00:00Z") }) });
    expect(mock.hqCustomers.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ status: "Teste" }) }));
    expect(mock.hqActivities.create).toHaveBeenCalledOnce();
  });
  it("replays the same request without a second grant or HQ record", async () => {
    vi.stubEnv("PLATFORM_PLAN_GRANTS_ENABLED", "true");
    const { tx, mock, grant } = fixture(); mock.salonPlanGrant.findUnique.mockResolvedValue(grant);
    expect(await grantPlan(tx, "admin", input, now)).toEqual(grant);
    expect(mock.salonPlanGrant.create).not.toHaveBeenCalled();
    expect(mock.hqActivities.create).not.toHaveBeenCalled();
    await expect(grantPlan(tx, "admin", { ...input, plan: "TEAM" }, now)).rejects.toThrow("outros dados");
  });
});
