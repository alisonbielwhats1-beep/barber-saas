import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ ctx: { salonId: "salon-a", userId: "owner", role: "OWNER" }, tx: {
  $queryRaw: vi.fn(), auditLog: { findFirst: vi.fn() },
  professional: { findMany: vi.fn() }, salon: { findUniqueOrThrow: vi.fn() },
  timeOff: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn() },
  appointment: { findMany: vi.fn() }, user: { findUnique: vi.fn() },
}, lock: vi.fn(), audit: vi.fn(), update: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ getTenantContext: async () => mocks.ctx, assertRole: (ctx: { role: string }, roles: string[]) => { if (!roles.includes(ctx.role)) throw new Error("Forbidden"); } }));
vi.mock("@/lib/prisma-tenant", () => ({ withTenant: async (_ctx: unknown, callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx) }));
vi.mock("@/lib/inventory-lock", () => ({ lockOperationalResources: mocks.lock }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.audit }));
vi.mock("@/lib/appointment-service", () => ({ updateAppointmentStatusReliably: mocks.update }));
import { updateAvailabilityBlock, blockAvailability, cancelSelectedAppointments, previewAvailabilityBlock, removeAvailabilityBlock } from "./availability-actions";

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
  it("preserves 18:45–19:30 and excludes an appointment ending exactly at 18:45", async () => {
    const appointment = { id: "adjacent", version: 1, startAt: new Date("2026-09-12T18:00:00Z"), endAt: new Date("2026-09-12T21:45:00Z"), client: { name: "Cliente sintético" } };
    mocks.tx.appointment.findMany.mockImplementation(async ({ where }) =>
      where.OR.some((interval: { startAt: { lt: Date }; endAt: { gt: Date } }) => appointment.startAt < interval.startAt.lt && appointment.endAt > interval.endAt.gt) ? [appointment] : []);
    const adjacent = { ...input, startLocal: "2026-09-12T18:45", endLocal: "2026-09-12T19:30" };
    expect(await previewAvailabilityBlock(adjacent)).toMatchObject({ affected: [] });
    expect(await blockAvailability(adjacent)).toMatchObject({ success: true, affected: [] });
    expect(mocks.tx.timeOff.create).toHaveBeenCalledWith({ data: expect.objectContaining({ startAt: new Date("2026-09-12T21:45:00Z"), endAt: new Date("2026-09-12T22:30:00Z") }) });
    expect(await previewAvailabilityBlock({ ...adjacent, startLocal: "2026-09-12T18:40" })).toMatchObject({ affected: [{ id: "adjacent" }] });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("creates Monday-to-Friday pauses and enforces the actual expanded limit", async () => {
    expect(await blockAvailability({ ...input, weekdays: [1, 2, 3, 4, 5], untilDate: "2026-09-13" })).toMatchObject({ success: true });
    expect(mocks.tx.timeOff.create).toHaveBeenCalledTimes(5);
    mocks.tx.timeOff.create.mockClear();
    expect(await blockAvailability({ ...input, weekdays: [0, 1, 2, 3, 4, 5, 6], untilDate: "2027-09-01" })).toHaveProperty("error");
    expect(mocks.tx.timeOff.create).not.toHaveBeenCalled();
  });
  it("creates weekly occurrences while preserving the original local hour", async () => {
    expect(await blockAvailability({ ...input, everyWeeks: 1, count: 2 })).toMatchObject({ success: true });
    expect(mocks.tx.timeOff.create).toHaveBeenCalledTimes(2);
    expect(mocks.tx.timeOff.create).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({ id: `${input.id}:pro-a:1`, startAt: new Date("2026-09-14T15:00:00Z"), endAt: new Date("2026-09-14T16:00:00Z") }) });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects oversized recurring requests before touching the database", async () => {
    expect(await blockAvailability({ ...input, professionalIds: ["a", "b", "c", "d", "e"], everyWeeks: 1, count: 52 })).toHaveProperty("error");
    expect(mocks.tx.$queryRaw).not.toHaveBeenCalled();
  });
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
  it("rejects reopening by reception before reading or mutating a block", async () => {
    mocks.ctx.role = "RECEPTIONIST";
    await expect(removeAvailabilityBlock("block-a")).rejects.toThrow("Forbidden");
    expect(mocks.tx.timeOff.findFirst).not.toHaveBeenCalled();
    expect(mocks.tx.timeOff.deleteMany).not.toHaveBeenCalled();
  });
  it("does not reopen a block outside the active tenant", async () => {
    mocks.tx.timeOff.findFirst.mockResolvedValue(null);
    await expect(removeAvailabilityBlock("block-other-tenant")).resolves.toBeUndefined();
    expect(mocks.tx.timeOff.deleteMany).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
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

const existingBlock = { id: "block-a", professionalId: "pro-a", startAt: new Date("2026-09-12T13:30:00Z"), endAt: new Date("2026-09-12T23:00:00Z"), reason: "Ausência" };
const editBlock = { id: "block-a", requestId: input.id, expectedStartAt: existingBlock.startAt.toISOString(), expectedEndAt: existingBlock.endAt.toISOString(), expectedReason: existingBlock.reason, startLocal: "2026-09-12T08:30", endLocal: "2026-09-13T00:00", reason: "" };
describe("edição auditada de bloqueios", () => {
  it("permite fora da jornada até meia-noite e motivo vazio, preservando reservas", async () => {
    expect(await blockAvailability({ ...input, startLocal: editBlock.startLocal, endLocal: editBlock.endLocal, reason: "" })).toMatchObject({ success: true });
    mocks.tx.timeOff.findFirst.mockResolvedValue(existingBlock);
    mocks.tx.timeOff.updateMany.mockResolvedValue({ count: 1 });
    expect(await updateAvailabilityBlock(editBlock)).toMatchObject({ success: true, duplicate: false });
    expect(mocks.tx.timeOff.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: "block-a", professional: { salonId: "salon-a" }, reason: "Ausência" }), data: { startAt: new Date("2026-09-12T11:30:00Z"), endAt: new Date("2026-09-13T03:00:00Z"), reason: "" } });
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ action: "AVAILABILITY_UPDATED", metadata: expect.objectContaining({ before: expect.objectContaining({ reason: "Ausência" }), after: expect.objectContaining({ reason: "" }) }) }));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.tx.timeOff.deleteMany).not.toHaveBeenCalled();
  });
  it.each(["RECEPTIONIST", "PROFESSIONAL", "CLIENT"])("recusa %s antes de consultar", async role => {
    mocks.ctx.role = role;
    await expect(updateAvailabilityBlock(editBlock)).rejects.toThrow("Forbidden");
    expect(mocks.tx.timeOff.findFirst).not.toHaveBeenCalled();
  });
  it("recusa outro tenant, exclusão concorrente, alteração concorrente e intervalo invertido", async () => {
    expect(await updateAvailabilityBlock(editBlock)).toHaveProperty("error");
    mocks.tx.timeOff.findFirst.mockResolvedValueOnce(existingBlock).mockResolvedValueOnce(null);
    expect(await updateAvailabilityBlock(editBlock)).toHaveProperty("error");
    mocks.tx.timeOff.findFirst.mockResolvedValue({ ...existingBlock, reason: "Outra alteração" });
    expect(await updateAvailabilityBlock(editBlock)).toHaveProperty("error");
    mocks.tx.timeOff.findFirst.mockResolvedValue(existingBlock);
    expect(await updateAvailabilityBlock({ ...editBlock, endLocal: "2026-09-12T07:00" })).toHaveProperty("error");
    expect(mocks.tx.timeOff.updateMany).not.toHaveBeenCalled();
  });
  it("retry idêntico não repete auditoria nem atualização", async () => {
    mocks.tx.timeOff.findFirst.mockResolvedValue(existingBlock);
    mocks.tx.timeOff.updateMany.mockResolvedValue({ count: 1 });
    await updateAvailabilityBlock(editBlock);
    const request = mocks.audit.mock.calls.find(call => call[1].action === "AVAILABILITY_EDIT_REQUEST")![1];
    mocks.tx.auditLog.findFirst.mockResolvedValue({ reason: request.reason });
    expect(await updateAvailabilityBlock(editBlock)).toMatchObject({ duplicate: true });
    expect(await updateAvailabilityBlock({ ...editBlock, reason: "Mudou" })).toHaveProperty("error");
    expect(mocks.tx.timeOff.updateMany).toHaveBeenCalledOnce();
  });
});
