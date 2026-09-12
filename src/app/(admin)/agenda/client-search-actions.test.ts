import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  ctx: { salonId: "salon-a", userId: "user-a", role: "OWNER" },
  tx: { professional: { findFirst: vi.fn() }, clientProfile: { findMany: vi.fn() } },
}));
vi.mock("@/lib/tenant", () => ({ getTenantContext: async () => mocks.ctx, assertRole: (ctx: { role: string }, roles: string[]) => { if (!roles.includes(ctx.role)) throw new Error("Forbidden"); } }));
vi.mock("@/lib/prisma-tenant", () => ({ withTenant: async (_ctx: unknown, fn: (tx: typeof mocks.tx) => unknown) => fn(mocks.tx) }));
vi.mock("@/lib/client-list-visibility", () => ({ hiddenClientIds: async () => ["hidden"] }));
import { searchAppointmentClients } from "./client-search-actions";
beforeEach(() => { vi.resetAllMocks(); mocks.ctx.role = "OWNER"; mocks.tx.clientProfile.findMany.mockResolvedValue([]); });
it("consulta nome/telefone dentro do tenant, excluindo mesclados e ocultos antes do limite", async () => {
  await searchAppointmentClients("Gilberto Silva");
  expect(mocks.tx.clientProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ salonId: "salon-a", mergedIntoId: null, id: { notIn: ["hidden"] }, OR: [{ AND: [{ name: { contains: "Gilberto", mode: "insensitive" } }, { name: { contains: "Silva", mode: "insensitive" } }] }] }), take: 50 }));
  await searchAppointmentClients("(11) 91234");
  expect(mocks.tx.clientProfile.findMany.mock.calls[1][0].where.OR).toContainEqual({ phone: { contains: "1191234" } });
});
it("profissional vê somente sua base e falha fechado sem vínculo", async () => {
  mocks.ctx.role = "PROFESSIONAL";
  mocks.tx.professional.findFirst.mockResolvedValue({ id: "own" });
  await searchAppointmentClients("Cliente");
  expect(mocks.tx.clientProfile.findMany.mock.calls[0][0].where.appointments).toEqual({ some: { professionalId: "own" } });
  mocks.tx.professional.findFirst.mockResolvedValue(null);
  expect(await searchAppointmentClients("Cliente")).toEqual([]);
  expect(mocks.tx.clientProfile.findMany).toHaveBeenCalledOnce();
});
it("nega público e consulta vazia sem buscar dados", async () => {
  await expect(searchAppointmentClients(" ")).rejects.toThrow();
  mocks.ctx.role = "CLIENT";
  await expect(searchAppointmentClients("Cliente")).rejects.toThrow("Forbidden");
  expect(mocks.tx.clientProfile.findMany).not.toHaveBeenCalled();
});
