import { describe, expect, it, vi } from "vitest";
import type { Tx } from "./prisma-tenant";
vi.mock("./prisma-tenant", () => ({ setSalonGuc: vi.fn() }));
import { inspectSalonRemoval, removeEmptySalon } from "./salon-removal";

function fixture({ role = "SUPER_ADMIN", status = "SUSPENDED", count = 0n, team = 0, table = "ClientProfile" } = {}) {
  const tx = {
    user: { findUnique: vi.fn(async () => ({ platformRole: role })) },
    salon: { findUnique: vi.fn(async () => ({ id: "salon", name: "Teste", slug: "teste", accessStatus: status })), delete: vi.fn(async () => ({})) },
    membership: { count: vi.fn(async () => team) },
    salonAccessEvent: { findMany: vi.fn(async () => [{ type: "SUSPENDED" }]) },
    hqActivities: { create: vi.fn(async () => ({})) },
    $queryRaw: vi.fn(async (query: unknown) => {
      const sql = Array.isArray(query) ? query.join("") : (query as { sql: string }).sql;
      if (sql.includes("pg_constraint")) return [{ schema: "public", table, column: "salonId" }];
      return [{ table, count }];
    }),
  };
  return { tx: tx as unknown as Tx, mocks: tx };
}
describe("exclusão restrita a cadastro vazio", () => {
  it("blocks unreviewed dependencies even when their read policy could return no rows", async () => {
    const { tx, mocks } = fixture({ table: "UnknownPrivateData", count: 0n });
    await expect(removeEmptySalon(tx, "admin", "salon", "teste")).rejects.toThrow("Exclusão bloqueada");
    expect(mocks.salon.delete).not.toHaveBeenCalled();
  });
  it.each(["ClientProfile", "Appointment", "BillingSubscription", "ProductSale", "hq_accounts", "FutureHistory"])("preserva qualquer vínculo em %s", async table => {
    const { tx, mocks } = fixture({ table, count: 1n });
    await expect(removeEmptySalon(tx, "admin", "salon", "teste")).rejects.toThrow("Exclusão bloqueada");
    expect(mocks.salon.delete).not.toHaveBeenCalled();
  });
  it.each(["APPROVED", "PENDING"])("não exclui cadastro %s", async status => {
    const { tx, mocks } = fixture({ status });
    await expect(removeEmptySalon(tx, "admin", "salon", "teste")).rejects.toThrow("Exclusão bloqueada");
    expect(mocks.salon.delete).not.toHaveBeenCalled();
  });
  it("nega usuário comum e membros da equipe", async () => {
    await expect(inspectSalonRemoval(fixture({ role: "USER" }).tx, "user", "salon")).rejects.toThrow("Acesso restrito");
    await expect(removeEmptySalon(fixture({ team: 1 }).tx, "admin", "salon", "teste")).rejects.toThrow("Exclusão bloqueada");
  });
  it("exige identificador exato e conserva a auditoria antes de excluir", async () => {
    const { tx, mocks } = fixture();
    await expect(removeEmptySalon(tx, "admin", "salon", "outro")).rejects.toThrow("identificador exato");
    expect(mocks.salon.delete).not.toHaveBeenCalled();
    await removeEmptySalon(tx, "admin", "salon", "teste");
    expect(mocks.hqActivities.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorId: "admin", entityId: "salon", metadata: expect.objectContaining({ decisions: [{ type: "SUSPENDED" }] }) }) }));
    expect(mocks.salon.delete).toHaveBeenCalledWith({ where: { id: "salon" } });
    expect(mocks.hqActivities.create.mock.invocationCallOrder[0]).toBeLessThan(mocks.salon.delete.mock.invocationCallOrder[0]);
  });
});
