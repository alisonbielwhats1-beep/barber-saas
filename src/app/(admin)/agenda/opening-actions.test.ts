import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ role: "OWNER", tx: {
  professional: { findFirst: vi.fn() }, salon: { findUniqueOrThrow: vi.fn() },
  professionalOpening: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
}, lock: vi.fn(), audit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ getTenantContext: async () => ({ salonId: "salon-a", userId: "owner", role: mocks.role }), assertRole: (ctx: { role: string }, roles: string[]) => { if (!roles.includes(ctx.role)) throw new Error("Forbidden"); } }));
vi.mock("@/lib/prisma-tenant", () => ({ withTenant: async (_ctx: unknown, callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx) }));
vi.mock("@/lib/inventory-lock", () => ({ lockOperationalResources: mocks.lock }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.audit }));
import { addOpening, removeOpening } from "./opening-actions";
const input = { id: "550e8400-e29b-41d4-a716-446655440000", professionalId: "pro-a", dateKey: "2032-08-05", startMinutes: 1080, endMinutes: 1200, reason: "Expediente extra" };
beforeEach(() => {
  vi.resetAllMocks(); mocks.role = "OWNER";
  mocks.tx.professional.findFirst.mockResolvedValue({ id: "pro-a" });
  mocks.tx.salon.findUniqueOrThrow.mockResolvedValue({ timezone: "America/Sao_Paulo" });
  mocks.tx.professionalOpening.findFirst.mockResolvedValue(null);
});
describe("autorização de expediente extra", () => {
  it("recusa criação e remoção por recepcionista", async () => {
    mocks.role = "RECEPTIONIST";
    await expect(addOpening(input)).rejects.toThrow("Forbidden");
    await expect(removeOpening(input.id)).rejects.toThrow("Forbidden");
    expect(mocks.tx.professionalOpening.create).not.toHaveBeenCalled();
  });
  it("recusa profissional fora do tenant e intervalo inválido", async () => {
    mocks.tx.professional.findFirst.mockResolvedValue(null);
    expect(await addOpening(input)).toHaveProperty("error");
    expect(await addOpening({ ...input, endMinutes: 1000 })).toHaveProperty("error");
    expect(mocks.tx.professionalOpening.create).not.toHaveBeenCalled();
  });
  it("aplica lock e auditoria; repetição não duplica o expediente", async () => {
    expect(await addOpening(input)).toHaveProperty("success");
    expect(mocks.tx.professionalOpening.create).toHaveBeenCalledWith({ data: { ...input, salonId: "salon-a" } });
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.tx.professionalOpening.create.mock.invocationCallOrder[0]);
    mocks.tx.professionalOpening.findFirst.mockResolvedValue(input);
    expect(await addOpening(input)).toHaveProperty("success");
    expect(mocks.tx.professionalOpening.create).toHaveBeenCalledTimes(1);
    expect(await addOpening({ ...input, reason: "Outro motivo" })).toHaveProperty("error");
  });
});
