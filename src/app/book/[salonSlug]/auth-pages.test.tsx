import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClientSession: vi.fn(),
  redirect: vi.fn(),
  withSalonBySlug: vi.fn(),
}));

vi.mock("@/lib/client-auth", () => ({
  getClientSession: mocks.getClientSession,
}));
vi.mock("@/lib/prisma-tenant", () => ({
  withSalonBySlug: mocks.withSalonBySlug,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("./cadastro/cadastro-form", () => ({ CadastroForm: () => null }));
vi.mock("./login/login-form", () => ({ LoginForm: () => null }));

import CadastroPage from "./cadastro/page";
import LoginPage from "./login/page";

const params = Promise.resolve({ salonSlug: "studio-b" });
const searchParams = Promise.resolve({
  returnTo: "/book/studio-b/agendar?services=service-1",
});

describe("client auth routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClientSession.mockResolvedValue({
      clientId: "client-a",
      salonId: "salon-a",
      name: "Maria Silva",
      email: "maria@example.com",
      sessionVersion: 0,
    });
    mocks.withSalonBySlug.mockImplementation(
      async (_slug: string, callback: (_tx: unknown, salonId: string) => unknown) =>
        callback({
          clientProfile: {
            findFirst: vi.fn().mockResolvedValue({
              id: "client-b",
              mergedIntoId: null,
              name: "Joao Silva",
              email: "joao@example.com",
              sessionVersion: 0,
            }),
          },
        }, "salon-b"),
    );
    mocks.redirect.mockImplementation((destination: string) => {
      throw new Error(`REDIRECT:${destination}`);
    });
  });

  it("keeps auth pages open for a session from another salon", async () => {
    await expect(CadastroPage({ params, searchParams })).resolves.toBeTruthy();
    await expect(LoginPage({ params, searchParams })).resolves.toBeTruthy();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("redirects only when the session belongs to the current salon", async () => {
    mocks.getClientSession.mockResolvedValue({
      clientId: "client-b",
      salonId: "salon-b",
      name: "Joao Silva",
      email: "joao@example.com",
      sessionVersion: 0,
    });

    await expect(CadastroPage({ params, searchParams })).rejects.toThrow(
      "REDIRECT:/book/studio-b",
    );
    await expect(LoginPage({ params, searchParams })).rejects.toThrow(
      "REDIRECT:/book/studio-b",
    );
  });
});
