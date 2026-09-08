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

  it("preserva autenticação obrigatória para remarcar", async () => {
    await expect(AgendarPage({
      params: Promise.resolve({ salonSlug: "studio-a" }),
      searchParams: Promise.resolve({
        services: "service-a,service-b",
        pro: "pro-a",
        reschedule: "appt-a",
      }),
    })).rejects.toThrow(
      "NEXT_REDIRECT:/book/studio-a/welcome?returnTo=%2Fbook%2Fstudio-a%2Fagendar%3Fservices%3Dservice-a%252Cservice-b%26pro%3Dpro-a%26reschedule%3Dappt-a",
    );

    expect(mocks.withSalonBySlug).not.toHaveBeenCalled();
  });

  it("permite explorar catálogo com sessão nula, dentro do gate do salão aprovado", async () => {
    mocks.withSalonBySlug.mockResolvedValue({ salon: {
      id: "salon-a", name: "Studio A", services: [], currency: "BRL", timezone: "America/Sao_Paulo",
    }, counts: [], validSession: null });
    const result = await AgendarPage({ params: Promise.resolve({ salonSlug: "studio-a" }), searchParams: Promise.resolve({}) });
    expect(mocks.withSalonBySlug).toHaveBeenCalledWith("studio-a", expect.any(Function));
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(result.props.clientSession).toBeNull();
  });
});
