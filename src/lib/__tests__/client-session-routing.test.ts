import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClientSession: vi.fn(),
  redirect: vi.fn(),
  withSalonBySlug: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/lib/client-auth", () => ({
  getClientSession: mocks.getClientSession,
}));

vi.mock("@/lib/prisma-tenant", () => ({
  withSalonBySlug: mocks.withSalonBySlug,
}));

import CadastroPage from "@/app/book/[salonSlug]/cadastro/page";
import LoginPage from "@/app/book/[salonSlug]/login/page";

const OTHER_SALON_SESSION = {
  clientId: "client-other",
  salonId: "salon-other",
  name: "Cliente Outro",
  email: "outro@example.com",
};

const CURRENT_SALON_SESSION = {
  clientId: "client-current",
  salonId: "salon-current",
  name: "Cliente Atual",
  email: "atual@example.com",
};

function loginPage() {
  return LoginPage({
    params: Promise.resolve({ salonSlug: "studio-atual" }),
    searchParams: Promise.resolve({}),
  });
}

function cadastroPage() {
  return CadastroPage({
    params: Promise.resolve({ salonSlug: "studio-atual" }),
    searchParams: Promise.resolve({}),
  });
}

describe("sessão do cliente por tenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirect.mockImplementation((target: string) => {
      throw new Error(`NEXT_REDIRECT:${target}`);
    });
    mocks.withSalonBySlug.mockImplementation(
      async (
        _salonSlug: string,
        callback: (tx: object, salonId: string) => unknown,
      ) => callback({
        clientProfile: {
          findFirst: vi.fn().mockResolvedValue({
            id: CURRENT_SALON_SESSION.clientId,
            mergedIntoId: null,
            name: CURRENT_SALON_SESSION.name,
            email: CURRENT_SALON_SESSION.email,
          }),
        },
      }, "salon-current"),
    );
  });

  it.each([
    ["login", loginPage],
    ["cadastro", cadastroPage],
  ])(
    "mantém a tela de %s acessível quando a sessão pertence a outro salão",
    async (_name, renderPage) => {
      mocks.getClientSession.mockResolvedValue(OTHER_SALON_SESSION);

      await expect(renderPage()).resolves.toBeTruthy();

      expect(mocks.redirect).not.toHaveBeenCalled();
      expect(mocks.withSalonBySlug).toHaveBeenCalledWith(
        "studio-atual",
        expect.any(Function),
      );
    },
  );

  it.each([
    ["login", loginPage],
    ["cadastro", cadastroPage],
  ])(
    "redireciona a tela de %s somente quando a sessão pertence ao salão atual",
    async (_name, renderPage) => {
      mocks.getClientSession.mockResolvedValue(CURRENT_SALON_SESSION);

      await expect(renderPage()).rejects.toThrow(
        "NEXT_REDIRECT:/book/studio-atual/minhas",
      );

      expect(mocks.redirect).toHaveBeenCalledWith(
        "/book/studio-atual/minhas",
      );
    },
  );

  it.each([
    ["login", loginPage],
    ["cadastro", cadastroPage],
  ])("não consulta tenant sem sessão na tela de %s", async (_name, renderPage) => {
    mocks.getClientSession.mockResolvedValue(null);

    await expect(renderPage()).resolves.toBeTruthy();

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.withSalonBySlug).not.toHaveBeenCalled();
  });
});
