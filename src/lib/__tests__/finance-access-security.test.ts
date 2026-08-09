import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regressão: /financeiro e /relatorios liam apenas `salonId` do
 * getTenantContext() e descartavam o `role`. As Server Actions barravam a
 * escrita, mas qualquer membro do salão (inclusive PROFESSIONAL) via o DRE
 * completo, faturamento e a comissão de todos abrindo a URL direto.
 *
 * Estes testes travam o comportamento de `requireRole`, o guarda de página.
 */

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  cookies: vi.fn(),
  redirect: vi.fn((path: string) => {
    // next/navigation.redirect interrompe a execução via throw — replicado
    // aqui para que o teste detecte se o código seguiu depois do redirect.
    throw new Error(`REDIRECT:${path}`);
  }),
  findMany: vi.fn(),
  executeRaw: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
// getTenantContext() passa pelo withUser() de prisma-tenant.ts, que abre uma
// transação para setar a GUC antes de ler Membership — por isso o mock
// precisa de $transaction (executa o callback com o próprio client mockado)
// e $executeRaw (o set_config, que não faz diferença nenhuma sem RLS real).
vi.mock("@/lib/prisma", () => ({
  prisma: {
    membership: { findMany: mocks.findMany },
    $executeRaw: mocks.executeRaw,
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({ membership: { findMany: mocks.findMany }, $executeRaw: mocks.executeRaw }),
  },
}));

import { requireRole, FINANCE_ROLES } from "@/lib/tenant";

function signedInAs(role: string) {
  mocks.getServerSession.mockResolvedValue({ user: { id: "user-1" } });
  mocks.cookies.mockResolvedValue({ get: () => ({ value: "salon-1" }) });
  mocks.findMany.mockResolvedValue([
    { salonId: "salon-1", role, salon: { accessStatus: "APPROVED" } },
  ]);
}

describe("requireRole — guarda de página do financeiro", () => {
  beforeEach(() => vi.clearAllMocks());

  it("FINANCE_ROLES cobre exatamente dono, gerente e super admin", () => {
    expect([...FINANCE_ROLES].sort()).toEqual(["MANAGER", "OWNER", "SUPER_ADMIN"]);
  });

  it.each(["OWNER", "MANAGER", "SUPER_ADMIN"])("permite %s", async (role) => {
    signedInAs(role);
    const ctx = await requireRole(FINANCE_ROLES);
    expect(ctx.salonId).toBe("salon-1");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each([
    ["PROFESSIONAL", "/agenda"],
    ["RECEPTIONIST", "/dashboard"],
  ])("bloqueia %s", async (role, destination) => {
    signedInAs(role);
    await expect(requireRole(FINANCE_ROLES)).rejects.toThrow(`REDIRECT:${destination}`);
    expect(mocks.redirect).toHaveBeenCalledWith(destination);
  });

  it("não vaza o contexto do tenant quando bloqueia", async () => {
    signedInAs("PROFESSIONAL");
    // O redirect precisa interromper: se retornasse o ctx, a página seguiria
    // renderizando o financeiro mesmo sem permissão.
    await expect(requireRole(FINANCE_ROLES)).rejects.toThrow();
  });
});
