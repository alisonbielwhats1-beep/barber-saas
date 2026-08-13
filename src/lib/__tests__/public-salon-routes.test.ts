import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  withApprovedSalon: vi.fn(),
  getClientSession: vi.fn(),
  joinWaitlist: vi.fn(),
}));

vi.mock("@/lib/prisma-tenant", () => ({
  withApprovedSalon: mocks.withApprovedSalon,
}));
vi.mock("@/lib/client-auth", () => ({
  getClientSession: mocks.getClientSession,
}));
vi.mock("@/lib/waitlist", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/waitlist")>();
  return { ...original, joinWaitlist: mocks.joinWaitlist };
});
vi.mock("@/lib/rate-limit", () => ({
  clientIp: () => "test-ip",
  checkRateLimit: () =>
    Promise.resolve({
      allowed: true,
      limit: 10,
      remaining: 9,
      retryAfterSeconds: 60,
      source: "local",
    }),
  rateLimitHeaders: () => ({}),
  rateLimitStatus: () => 429,
}));

import { GET as getAvailability } from "@/app/api/availability/route";
import { POST as joinPublicWaitlist } from "@/app/api/waitlist/join/route";

describe("rotas públicas — acesso do estabelecimento", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withApprovedSalon.mockResolvedValue(null);
    mocks.getClientSession.mockResolvedValue(null);
  });

  it("availability devolve o mesmo 404 sem executar o callback", async () => {
    const response = await getAvailability(
      new NextRequest(
        "http://localhost/api/availability?salonId=salon-a&professionalId=pro-a&serviceId=service-a&date=2030-01-10",
      ),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "NOT_FOUND" });
    expect(mocks.withApprovedSalon).toHaveBeenCalledOnce();
  });

  it("waitlist devolve o mesmo 404 sem executar a mutação", async () => {
    const response = await joinPublicWaitlist(
      new NextRequest("http://localhost/api/waitlist/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          salonId: "salon-a",
          appointmentId: "appointment-a",
          professionalId: "pro-a",
          serviceIds: ["service-a"],
        }),
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "NOT_FOUND" });
    expect(mocks.joinWaitlist).not.toHaveBeenCalled();
  });

  it("waitlist trata JSON malformado como BAD_REQUEST sem tocar no tenant", async () => {
    const response = await joinPublicWaitlist(
      new NextRequest("http://localhost/api/waitlist/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "BAD_REQUEST" });
    expect(mocks.getClientSession).not.toHaveBeenCalled();
    expect(mocks.withApprovedSalon).not.toHaveBeenCalled();
  });

  it.each([
    ["+55 (11) 99999-8888", "11999998888"],
    ["55 11 99999-8888", "11999998888"],
    ["(11) 99999-8888", "11999998888"],
    ["+55 (11) 3333-4444", "1133334444"],
    ["55 11 3333-4444", "1133334444"],
    ["(11) 3333-4444", "1133334444"],
  ])("waitlist normaliza telefone visitante %s no servidor", async (
    clientPhone,
    normalized,
  ) => {
    mocks.withApprovedSalon.mockImplementationOnce(
      async (_salonId: string, callback: (tx: object) => unknown) => callback({}),
    );
    mocks.joinWaitlist.mockResolvedValueOnce({
      entryId: "entry-a",
      position: 1,
      duplicate: false,
      serviceNames: ["Corte"],
      professionalId: "pro-a",
      startAt: new Date("2030-01-10T15:00:00.000Z"),
      timezone: "America/Sao_Paulo",
    });

    const response = await joinPublicWaitlist(
      new NextRequest("http://localhost/api/waitlist/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          salonId: "salon-a",
          appointmentId: "appointment-a",
          professionalId: "pro-a",
          serviceIds: ["service-a"],
          clientName: "Visitante",
          clientPhone,
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.joinWaitlist).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        guestName: "Visitante",
        guestPhone: normalized,
      }),
    );
  });

  it.each([
    "+1 (212) 555-0100",
    "abc (11) 99999-8888",
    "(20) 99999-8888",
    "(11) 9333-4444",
    "(11) 89999-8888",
    "+55 (11) 99999-88889",
  ])("waitlist rejeita telefone inválido antes de sessão, tenant e mutação: %s", async (
    clientPhone,
  ) => {
    const response = await joinPublicWaitlist(
      new NextRequest("http://localhost/api/waitlist/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          salonId: "salon-a",
          appointmentId: "appointment-a",
          professionalId: "pro-a",
          serviceIds: ["service-a"],
          clientName: "Visitante",
          clientPhone,
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "BAD_REQUEST" });
    expect(mocks.getClientSession).not.toHaveBeenCalled();
    expect(mocks.withApprovedSalon).not.toHaveBeenCalled();
    expect(mocks.joinWaitlist).not.toHaveBeenCalled();
  });
});
