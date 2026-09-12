import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), transaction: vi.fn(), visibility: vi.fn() }));
vi.mock("@/lib/tenant", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/tenant")>(),
  getTenantContext: mocks.context,
}));
vi.mock("@/lib/prisma-tenant", () => ({ withTenant: mocks.transaction }));
vi.mock("@/lib/client-list-visibility", () => ({ setClientListVisibility: mocks.visibility }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { deleteClient, restoreClient } from "@/app/(admin)/clientes/actions";

describe("permissão de excluir e restaurar clientes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation((_ctx, fn) => fn("transaction"));
  });
  for (const role of ["MANAGER", "RECEPTIONIST", "PROFESSIONAL", "CLIENT"]) {
    it(`recusa ${role} antes de acessar o banco`, async () => {
      mocks.context.mockResolvedValue({ salonId: "salon-a", userId: "user-a", role });
      await expect(deleteClient("client-a")).rejects.toThrow();
      await expect(restoreClient("client-a")).rejects.toThrow();
      expect(mocks.transaction).not.toHaveBeenCalled();
    });
  }
  it("deriva tenant e autor da sessão do proprietário", async () => {
    mocks.context.mockResolvedValue({ salonId: "salon-a", userId: "owner-a", role: "OWNER" });
    await deleteClient("client-a");
    await restoreClient("client-a");
    expect(mocks.visibility).toHaveBeenNthCalledWith(1, "transaction", { salonId: "salon-a", userId: "owner-a", clientId: "client-a", hidden: true });
    expect(mocks.visibility).toHaveBeenNthCalledWith(2, "transaction", { salonId: "salon-a", userId: "owner-a", clientId: "client-a", hidden: false });
  });
});
