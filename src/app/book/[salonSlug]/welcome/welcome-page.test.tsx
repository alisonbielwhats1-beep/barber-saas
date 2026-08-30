import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClientSession: vi.fn(),
  resolveClientSessionInTenant: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
  withSalonBySlug: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}));
vi.mock("@/lib/client-auth", () => ({
  getClientSession: mocks.getClientSession,
}));
vi.mock("@/lib/public-appointment", () => ({
  resolveClientSessionInTenant: mocks.resolveClientSessionInTenant,
}));
vi.mock("@/lib/prisma-tenant", () => ({
  withSalonBySlug: mocks.withSalonBySlug,
}));

import WelcomePage from "./page";

const salon = {
  name: "Studio Atual",
  address: "Rua Principal, 10",
  coverUrl: null,
  segment: null,
};

describe("entrada do app do cliente", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClientSession.mockResolvedValue(null);
    mocks.resolveClientSessionInTenant.mockResolvedValue(null);
    mocks.withSalonBySlug.mockImplementation(
      async (_slug: string, callback: (tx: unknown, salonId: string) => unknown) =>
        callback({ salon: { findUnique: vi.fn().mockResolvedValue(salon) } }, "salon-a"),
    );
    mocks.redirect.mockImplementation((target: string) => {
      throw new Error(`NEXT_REDIRECT:${target}`);
    });
  });

  it("mantém visitantes na tela de entrar ou criar conta", async () => {
    await expect(WelcomePage({
      params: Promise.resolve({ salonSlug: "studio-a" }),
      searchParams: Promise.resolve({}),
    })).resolves.toBeTruthy();

    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("leva cliente autenticado direto para a home", async () => {
    mocks.getClientSession.mockResolvedValue({
      clientId: "client-a",
      salonId: "salon-a",
      name: "Maria Silva",
      email: "maria@example.com",
    });
    mocks.resolveClientSessionInTenant.mockResolvedValue({
      clientId: "client-a",
      salonId: "salon-a",
      name: "Maria Silva",
      email: "maria@example.com",
    });

    await expect(WelcomePage({
      params: Promise.resolve({ salonSlug: "studio-a" }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow("NEXT_REDIRECT:/book/studio-a");
  });

  it("não envia visitante direto ao agendamento antes da autenticação", async () => {
    await expect(WelcomePage({
      params: Promise.resolve({ salonSlug: "studio-a" }),
      searchParams: Promise.resolve({
        returnTo: "/book/studio-a/agendar?services=service-a",
      }),
    })).resolves.toBeTruthy();

    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
