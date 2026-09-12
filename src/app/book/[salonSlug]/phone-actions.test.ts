import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), resolve: vi.fn(), update: vi.fn(), audit: vi.fn(), scope: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/client-auth", () => ({ getClientSession: mocks.session }));
vi.mock("@/lib/public-appointment", () => ({ resolveClientSessionInTenant: mocks.resolve }));
vi.mock("@/lib/prisma-tenant", () => ({ withSalonBySlug: mocks.scope }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.audit }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import { saveClientPhone } from "./phone-actions";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.scope.mockImplementation((_slug, fn) => fn({ clientProfile: { updateMany: mocks.update } }, "salon-a"));
  mocks.resolve.mockResolvedValue({ clientId: "canonical-client", name: "Cliente" });
});
it("atualiza somente o perfil canônico da sessão e invalida as telas da equipe", async () => {
  expect(await saveClientPhone("salon-a", "(11) 91234-5678")).toEqual({ success: true });
  expect(mocks.update).toHaveBeenCalledWith({ where: { id: "canonical-client", salonId: "salon-a", mergedIntoId: null }, data: { phone: "11912345678", phoneNormalized: "11912345678" } });
  expect(mocks.refresh).toHaveBeenCalledWith("/clientes");
  expect(mocks.refresh).toHaveBeenCalledWith("/agenda");
});
it("recusa sessão inválida e telefone vazio sem alterar cadastros", async () => {
  expect(await saveClientPhone("salon-a", "")).toHaveProperty("error");
  expect(mocks.scope).not.toHaveBeenCalled();
  mocks.resolve.mockResolvedValue(null);
  expect(await saveClientPhone("salon-a", "11912345678")).toHaveProperty("error");
  expect(mocks.update).not.toHaveBeenCalled();
});
