import { describe, expect, it, vi } from "vitest";
import type { Tx } from "../prisma-tenant";
import { hiddenClientIds, setClientListVisibility } from "../client-list-visibility";

function fixture() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    clientProfile: { findFirst: vi.fn().mockResolvedValue({ id: "client-a", name: "Cliente" }), delete: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn().mockResolvedValue({ name: "Dono" }) },
    auditLog: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
  };
}
const input = { salonId: "salon-a", userId: "owner-a", clientId: "client-a", hidden: true };

describe("exclusão apenas da lista", () => {
  it("preserva perfil, senha e relações; grava somente evento auditável", async () => {
    const tx = fixture();
    await setClientListVisibility(tx as unknown as Tx, input);
    expect(tx.clientProfile.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "client-a", salonId: "salon-a", mergedIntoId: null } }));
    expect(tx.clientProfile.delete).not.toHaveBeenCalled();
    expect(tx.clientProfile.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "CLIENT_HIDDEN_FROM_LIST", salonId: "salon-a", entityId: "client-a", metadata: expect.objectContaining({ accountAccessPreserved: true, historyPreserved: true }) }) });
  });
  it("recusa cliente ausente, de outro tenant ou mesclado", async () => {
    const tx = fixture();
    tx.clientProfile.findFirst.mockResolvedValue(null);
    await expect(setClientListVisibility(tx as unknown as Tx, input)).rejects.toThrow("Cliente não encontrado");
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it("é idempotente e restaura com evento posterior mesmo após espera por lock", async () => {
    const tx = fixture();
    const createdAt = new Date(Date.now() + 10_000);
    tx.auditLog.findFirst.mockResolvedValue({ action: "CLIENT_HIDDEN_FROM_LIST", createdAt });
    await setClientListVisibility(tx as unknown as Tx, input);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    await setClientListVisibility(tx as unknown as Tx, { ...input, hidden: false });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "CLIENT_RESTORED_TO_LIST", createdAt: new Date(createdAt.getTime() + 1) }) });
  });
  it("usa último evento de cada cliente e mantém restaurações fora dos ocultos", async () => {
    const tx = fixture();
    tx.auditLog.findMany.mockResolvedValue([{ entityId: "a", action: "CLIENT_HIDDEN_FROM_LIST" }, { entityId: "b", action: "CLIENT_RESTORED_TO_LIST" }]);
    expect(await hiddenClientIds(tx as unknown as Tx, "salon-a")).toEqual(new Set(["a"]));
    expect(tx.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ distinct: ["entityId"], where: expect.objectContaining({ salonId: "salon-a" }) }));
  });
});
