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
  it.each([
    ["vazio", ""],
    ["só espaços", "   "],
    ["ausente", undefined],
  ])("motivo %s é opcional: grava o marcador de 'sem motivo' e audita o ator sem motivo", async (_label, reason) => {
    const { reason: _omit, ...withoutReason } = input;
    void _omit;
    const payload = (reason === undefined ? withoutReason : { ...withoutReason, reason }) as typeof input;
    expect(await addOpening(payload)).toHaveProperty("success");
    // O banco exige texto de 3 a 200 caracteres em ProfessionalOpening.reason (migration manual 018).
    expect(mocks.tx.professionalOpening.create).toHaveBeenCalledWith({
      data: { ...withoutReason, reason: "Sem motivo informado", salonId: "salon-a" },
    });
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({
      userId: "owner", actorName: "Equipe", action: "PROFESSIONAL_OPENING_ADDED", reason: null,
      metadata: expect.objectContaining({ reason: null }),
    }));
  });
  it("repetir um pedido sem motivo não duplica e não acusa alteração", async () => {
    mocks.tx.professionalOpening.findFirst.mockResolvedValue({ ...input, reason: "Sem motivo informado" });
    expect(await addOpening({ ...input, reason: "" })).toHaveProperty("success");
    expect(mocks.tx.professionalOpening.create).not.toHaveBeenCalled();
    expect(await addOpening({ ...input, reason: "Outro motivo" })).toHaveProperty("error");
  });
  it("remover uma abertura sem motivo audita motivo nulo", async () => {
    mocks.tx.professionalOpening.findFirst.mockResolvedValue({ ...input, reason: "Sem motivo informado", createdAt: new Date("2032-08-01T12:00:00Z") });
    await removeOpening(input.id);
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ action: "PROFESSIONAL_OPENING_REMOVED", reason: null }));
  });
  it("motivo informado continua gravado e auditado; acima de 200 caracteres segue recusado", async () => {
    expect(await addOpening({ ...input, reason: "  Atendimento especial  " })).toHaveProperty("success");
    expect(mocks.tx.professionalOpening.create).toHaveBeenCalledWith({ data: { ...input, reason: "Atendimento especial", salonId: "salon-a" } });
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ reason: "Atendimento especial" }));
    mocks.tx.professionalOpening.create.mockClear();
    expect(await addOpening({ ...input, reason: "x".repeat(201) })).toHaveProperty("error");
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
