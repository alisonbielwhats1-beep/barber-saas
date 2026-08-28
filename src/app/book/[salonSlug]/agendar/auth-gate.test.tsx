import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClientSession: vi.fn(),
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
vi.mock("@/lib/prisma-tenant", () => ({
  withSalonBySlug: mocks.withSalonBySlug,
}));

import AgendarPage from "./page";

describe("gate de autenticação do agendamento", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClientSession.mockResolvedValue(null);
    mocks.redirect.mockImplementation((target: string) => {
      throw new Error(`NEXT_REDIRECT:${target}`);
    });
  });

  it("envia visitante para entrar/criar conta sem consultar ou mutar o tenant", async () => {
    await expect(AgendarPage({
      params: Promise.resolve({ salonSlug: "studio-a" }),
      searchParams: Promise.resolve({
        services: "service-a,service-b",
        pro: "pro-a",
      }),
    })).rejects.toThrow(
      "NEXT_REDIRECT:/book/studio-a/welcome?returnTo=%2Fbook%2Fstudio-a%2Fagendar%3Fservices%3Dservice-a%252Cservice-b%26pro%3Dpro-a",
    );

    expect(mocks.withSalonBySlug).not.toHaveBeenCalled();
  });
});
