import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ ctx: { salonId: "salon-a", userId: "owner", role: "OWNER" }, tx: {
  $queryRaw: vi.fn(), auditLog: { findFirst: vi.fn() },
  professional: { findMany: vi.fn() }, salon: { findUniqueOrThrow: vi.fn() },
  timeOff: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  appointment: { findMany: vi.fn() }, user: { findUnique: vi.fn() },
}, lock: vi.fn(), audit: vi.fn(), update: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ getTenantContext: async () => mocks.ctx, assertRole: (ctx: { role: string }, roles: string[]) => { if (!roles.includes(ctx.role)) throw new Error("Forbidden"); } }));
vi.mock("@/lib/prisma-tenant", () => ({ withTenant: async (_ctx: unknown, callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx) }));
vi.mock("@/lib/inventory-lock", () => ({ lockOperationalResources: mocks.lock }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.audit }));
vi.mock("@/lib/appointment-service", () => ({ updateAppointmentStatusReliably: mocks.update }));
import { blockAvailability, cancelSelectedAppointments, previewAvailabilityBlock } from "./availability-actions";

const input = { id: "550e8400-e29b-41d4-a716-446655440000", professionalIds: ["pro-a"], startLocal: "2026-09-07T12:00", endLocal: "2026-09-07T13:00", reason: "Almoço" };
beforeEach(() => {
  vi.resetAllMocks(); mocks.ctx.role = "OWNER";
  mocks.tx.professional.findMany.mockResolvedValue([{ id: "pro-a" }]);
  mocks.tx.salon.findUniqueOrThrow.mockResolvedValue({ timezone: "America/Sao_Paulo" });
  mocks.tx.timeOff.findFirst.mockResolvedValue(null);
  mocks.tx.appointment.findMany.mockResolvedValue([]);
  mocks.tx.user.findUnique.mockResolvedValue({ name: "Dono" });
});
describe("availability operations", () => {
  it("previews affected appointments without writing or locking", async () => {
    mocks.tx.appointment.findMany.mockResolvedValue([{ id: "a", version: 1, startAt: new Date("2026-09-07T15:00:00Z"), client: { name: "Ana" } }]);
    expect(await previewAvailabilityBlock(input)).toMatchObject({ affected: [{ id: "a", name: "Ana" }] });
    expect(mocks.tx.timeOff.create).not.toHaveBeenCalled();
    expect(mocks.lock).not.toHaveBeenCalled();
  });
  it("rejects reception before any database mutation", async () => {
    mocks.ctx.role = "RECEPTIONIST";
    await expect(blockAvailability(input)).rejects.toThrow("Forbidden");
    expect(mocks.tx.timeOff.create).not.toHaveBeenCalled();
  });
  it("rejects professionals from another tenant", async () => {
    mocks.tx.professional.findMany.mockResolvedValue([]);
    expect(await blockAvailability(input)).toHaveProperty("error");
    expect(mocks.tx.timeOff.create).not.toHaveBeenCalled();
  });
  it("locks the professional, converts salon time and preserves existing appointments", async () => {
    expect(await blockAvailability(input)).toMatchObject({ success: true });
    expect(mocks.lock).toHaveBeenCalledWith(mocks.tx, { professionalIds: ["pro-a"] });
    expect(mocks.tx.timeOff.create).toHaveBeenCalledWith({ data: expect.objectContaining({ startAt: new Date("2026-09-07T15:00:00Z"), endAt: new Date("2026-09-07T16:00:00Z") }) });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.tx.timeOff.create.mock.invocationCallOrder[0]);
  });
  it("does not duplicate a successful retry", async () => {
    mocks.tx.timeOff.findFirst.mockResolvedValue({ startAt: new Date("2026-09-07T15:00:00Z"), endAt: new Date("2026-09-07T16:00:00Z"), reason: "Almoço" });
    expect(await blockAvailability(input)).toMatchObject({ success: true });
    expect(mocks.tx.timeOff.create).not.toHaveBeenCalled();
  });
  it("reports partial cancellations using the central versioned service", async () => {
    mocks.update.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("VERSION_CONFLICT"));
    const result = await cancelSelectedAppointments({ reason: "Ausência", appointments: [{ id: "a", version: 1, requestId: input.id }, { id: "b", version: 2, requestId: "550e8400-e29b-41d4-a716-446655440001" }] });
    expect(result).toMatchObject([{ id: "a", success: true }, { id: "b", success: false }]);
    expect(mocks.update).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ salonId: "salon-a", expectedVersion: 2, status: "CANCELLED" }));
  });
});
