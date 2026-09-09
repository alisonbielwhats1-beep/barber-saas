import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ ctx: { salonId: "salon-a", userId: "owner", role: "OWNER" }, tx: {
  professional: { findMany: vi.fn() }, workingHours: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() }, salon: { findUniqueOrThrow: vi.fn() },
}, lock: vi.fn(), audit: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/tenant", () => ({ getTenantContext: async () => mocks.ctx, assertRole: (ctx: { role: string }, roles: string[]) => { if (!roles.includes(ctx.role)) throw new Error("Forbidden"); } }));
vi.mock("@/lib/prisma-tenant", () => ({ withTenant: async (_ctx: unknown, fn: (tx: typeof mocks.tx) => unknown) => fn(mocks.tx) }));
vi.mock("@/lib/inventory-lock", () => ({ lockOperationalResources: mocks.lock }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.audit }));
import { previewWeeklyPause, saveWeeklyPause } from "./weekly-pause-actions";
const input = { professionalIds: ["pro-a"], weekdays: [1, 2, 3, 4, 5], startMinutes: 750, endMinutes: 870 };
const before = [{ professionalId: "pro-a", weekday: 1, startMinutes: 540, endMinutes: 1260 }, { professionalId: "pro-a", weekday: 6, startMinutes: 600, endMinutes: 1080 }];
beforeEach(() => { vi.resetAllMocks(); mocks.ctx.role = "OWNER"; mocks.tx.professional.findMany.mockResolvedValue([{ id: "pro-a", user: { name: "Alex" } }]); mocks.tx.workingHours.findMany.mockResolvedValue(before); mocks.tx.salon.findUniqueOrThrow.mockResolvedValue({ slug: "salon-a" }); });
describe("weekly pause actions", () => {
  it("reviews without writing and saves only the reviewed current tenant schedule", async () => {
    const review = await previewWeeklyPause(input);
    expect(mocks.tx.workingHours.deleteMany).not.toHaveBeenCalled();
    expect(mocks.lock).not.toHaveBeenCalled();
    await saveWeeklyPause(input, review.version);
    expect(mocks.tx.workingHours.deleteMany).toHaveBeenCalledWith({ where: { salonId: "salon-a", professionalId: { in: ["pro-a"] } } });
    expect(mocks.tx.workingHours.createMany).toHaveBeenCalledWith({ data: [
      { salonId: "salon-a", professionalId: "pro-a", weekday: 1, startMinutes: 540, endMinutes: 750 },
      { salonId: "salon-a", professionalId: "pro-a", weekday: 1, startMinutes: 870, endMinutes: 1260 },
      { ...before[1], salonId: "salon-a" },
    ] });
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ action: "WEEKLY_PAUSE_ADDED", metadata: expect.objectContaining({ before }) }));
    expect(mocks.revalidate).toHaveBeenCalledWith("/book/salon-a", "layout");
  });
  it("rejects a stale review and a changed request", async () => {
    const review = await previewWeeklyPause(input);
    await expect(saveWeeklyPause({ ...input, endMinutes: 900 }, review.version)).rejects.toThrow("Revise novamente");
    mocks.tx.workingHours.findMany.mockResolvedValue([{ ...before[0], startMinutes: 600 }]);
    await expect(saveWeeklyPause(input, review.version)).rejects.toThrow("Revise novamente");
    expect(mocks.tx.workingHours.deleteMany).not.toHaveBeenCalled();
  });
  it.each(["RECEPTIONIST", "PROFESSIONAL"])("rejects %s before reading", async role => {
    mocks.ctx.role = role;
    await expect(previewWeeklyPause(input)).rejects.toThrow("Forbidden");
    await expect(saveWeeklyPause(input, "a".repeat(64))).rejects.toThrow("Forbidden");
    expect(mocks.tx.professional.findMany).not.toHaveBeenCalled();
  });
  it("rejects inactive or other-tenant professionals and does not create availability", async () => {
    mocks.tx.professional.findMany.mockResolvedValue([]);
    await expect(previewWeeklyPause(input)).rejects.toThrow("deste estabelecimento");
    expect(mocks.tx.professional.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { salonId: "salon-a", id: { in: ["pro-a"] }, active: true } }));
    expect(mocks.tx.workingHours.createMany).not.toHaveBeenCalled();
  });
  it("explains when the time is already unavailable", async () => {
    mocks.tx.workingHours.findMany.mockResolvedValue([]);
    await expect(previewWeeklyPause(input)).rejects.toThrow("já está fora");
  });
});
