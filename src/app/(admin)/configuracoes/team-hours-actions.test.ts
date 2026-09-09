import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ ctx: { salonId: "salon-a", userId: "owner-a", role: "OWNER" }, tx: {
  professional: { findMany: vi.fn() }, salon: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  workingHours: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
}, lock: vi.fn(), audit: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/tenant", () => ({ getTenantContext: async () => mocks.ctx, assertRole: (ctx: { role: string }, roles: string[]) => { if (!roles.includes(ctx.role)) throw new Error("Forbidden"); } }));
vi.mock("@/lib/prisma-tenant", () => ({ withTenant: async (_ctx: unknown, callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx) }));
vi.mock("@/lib/inventory-lock", () => ({ lockOperationalResources: mocks.lock }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.audit }));
import { saveSalonHours, saveTeamHours } from "./team-hours-actions";

const input = { professionalIds: ["pro-b", "pro-a"], openMinutes: 360, closeMinutes: 1260, pause: { startMinutes: 750, endMinutes: 900 }, confirmed: true as const };
beforeEach(() => {
  vi.resetAllMocks(); mocks.ctx.role = "OWNER";
  mocks.tx.professional.findMany.mockResolvedValue([{ id: "pro-a" }, { id: "pro-b" }]);
  mocks.tx.salon.findUniqueOrThrow.mockResolvedValue({ slug: "studio-test", openMinutes: 540, closeMinutes: 1320 });
  mocks.tx.workingHours.findMany.mockResolvedValue([{ professionalId: "pro-a", weekday: 0, startMinutes: 540, endMinutes: 1080 }, { professionalId: "pro-b", weekday: 2, startMinutes: 540, endMinutes: 1080 }]);
});

describe("horário geral do estabelecimento", () => {
  it("atualiza o salão sem tocar nas jornadas individuais", async () => {
    await saveSalonHours({ openMinutes: 540, closeMinutes: 1260, confirmed: true });
    expect(mocks.tx.salon.update).toHaveBeenCalledWith({
      where: { id: "salon-a" },
      data: { openMinutes: 540, closeMinutes: 1260 },
    });
    expect(mocks.tx.workingHours.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.workingHours.createMany).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({
      action: "SALON_OPENING_HOURS_UPDATED",
      metadata: {
        before: { openMinutes: 540, closeMinutes: 1320 },
        after: { openMinutes: 540, closeMinutes: 1260 },
      },
    }));
  });

  it("rejeita papel sem permissão antes de ler ou gravar", async () => {
    mocks.ctx.role = "PROFESSIONAL";
    await expect(saveSalonHours({ openMinutes: 540, closeMinutes: 1260, confirmed: true })).rejects.toThrow("Forbidden");
    expect(mocks.tx.salon.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});

describe("aplicação conjunta do expediente", () => {
  it("salva salão e jornadas na mesma transação, preserva folgas e audita antes/depois", async () => {
    await saveTeamHours(input);
    expect(mocks.tx.salon.update).toHaveBeenCalledWith({ where: { id: "salon-a" }, data: { openMinutes: 360, closeMinutes: 1260 } });
    expect(mocks.tx.workingHours.deleteMany).toHaveBeenCalledWith({ where: { salonId: "salon-a", professionalId: { in: ["pro-a", "pro-b"] } } });
    expect(mocks.tx.workingHours.createMany).toHaveBeenCalledWith({ data: [
      { salonId: "salon-a", professionalId: "pro-a", weekday: 0, startMinutes: 360, endMinutes: 750 }, { salonId: "salon-a", professionalId: "pro-a", weekday: 0, startMinutes: 900, endMinutes: 1260 },
      { salonId: "salon-a", professionalId: "pro-b", weekday: 2, startMinutes: 360, endMinutes: 750 }, { salonId: "salon-a", professionalId: "pro-b", weekday: 2, startMinutes: 900, endMinutes: 1260 },
    ] });
    expect(mocks.lock).toHaveBeenCalledWith(mocks.tx, { professionalIds: ["pro-a", "pro-b"] });
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.tx.workingHours.findMany.mock.invocationCallOrder[0]);
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ salonId: "salon-a", userId: "owner-a", metadata: expect.objectContaining({ before: expect.any(Object), after: expect.any(Object) }) }));
    expect(mocks.revalidate).toHaveBeenCalledWith("/book/studio-test", "layout");
  });
  it.each(["RECEPTIONIST", "PROFESSIONAL"])("rejeita %s antes de ler ou gravar", async role => {
    mocks.ctx.role = role;
    await expect(saveTeamHours(input)).rejects.toThrow("Forbidden");
    expect(mocks.tx.professional.findMany).not.toHaveBeenCalled();
  });
  it("recusa IDs de outro tenant e profissionais inativos antes de gravar", async () => {
    mocks.tx.professional.findMany.mockResolvedValue([{ id: "pro-a" }]);
    await expect(saveTeamHours(input)).rejects.toThrow("deste estabelecimento");
    expect(mocks.tx.professional.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { salonId: "salon-a", id: { in: ["pro-a", "pro-b"] }, active: true } }));
    expect(mocks.tx.salon.update).not.toHaveBeenCalled();
  });
  it("não transforma ausência de jornada em disponibilidade automática", async () => {
    mocks.tx.workingHours.findMany.mockResolvedValue([]);
    await expect(saveTeamHours(input)).rejects.toThrow("dias de trabalho");
    expect(mocks.tx.salon.update).not.toHaveBeenCalled();
  });
  it("recusa uma pausa inválida e exige revisão explícita", async () => {
    await expect(saveTeamHours({ ...input, pause: { startMinutes: 900, endMinutes: 750 } })).rejects.toThrow("pausa");
    expect(mocks.tx.professional.findMany).not.toHaveBeenCalled();
  });
});
