import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getClientSession: vi.fn(),
  prisma: {
    salon: { findUnique: vi.fn() },
    clientProfile: { findFirst: vi.fn() },
    appointment: { findMany: vi.fn() },
    $executeRaw: vi.fn().mockResolvedValue(undefined),
  },
}));

// A rota passa por withSalonBySlug (prisma-tenant.ts): resolve o id pelo
// slug com uma consulta crua, depois abre $transaction para o resto — o
// mock precisa de $transaction executando o callback com o próprio client
// mockado, senão "prisma.$transaction is not a function".
vi.mock("@/lib/prisma", () => ({
  prisma: {
    ...mocks.prisma,
    $transaction: (fn: (tx: unknown) => unknown) => fn(mocks.prisma),
  },
}));
vi.mock("@/lib/client-auth", () => ({
  getClientSession: mocks.getClientSession,
}));
vi.mock("@/lib/rate-limit", () => ({
  clientIp: () => "test-ip",
  checkRateLimit: () =>
    Promise.resolve({
      allowed: true,
      limit: 30,
      remaining: 29,
      retryAfterSeconds: 60,
      source: "local",
    }),
  rateLimitHeaders: () => ({}),
}));

import { GET } from "@/app/api/client/appointments/route";

function request(query = "salon=studio-a") {
  return new NextRequest(`http://localhost/api/client/appointments?${query}`);
}

describe("GET /api/client/appointments — histórico privado", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.salon.findUnique.mockResolvedValue({
      id: "salon-a",
      currency: "BRL",
    });
    mocks.prisma.clientProfile.findFirst.mockResolvedValue({
      id: "client-a",
      name: "Cliente A",
    });
    mocks.prisma.appointment.findMany.mockResolvedValue([]);
  });

  it("telefone sem sessão nunca retorna histórico", async () => {
    mocks.getClientSession.mockResolvedValue(null);

    const response = await GET(request("salon=studio-a&phone=11999999999"));

    expect(response.status).toBe(401);
    expect(mocks.prisma.appointment.findMany).not.toHaveBeenCalled();
  });

  it("cliente autenticado recebe somente seus próprios agendamentos", async () => {
    mocks.getClientSession.mockResolvedValue({
      clientId: "client-a",
      salonId: "salon-a",
      name: "Cliente A",
      email: "a@example.com",
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mocks.prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: "client-a", salonId: "salon-a" },
      }),
    );
  });

  it("sessão não acessa histórico de outro salão", async () => {
    mocks.getClientSession.mockResolvedValue({
      clientId: "client-b",
      salonId: "salon-b",
      name: "Cliente B",
      email: "b@example.com",
    });

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(mocks.prisma.clientProfile.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.appointment.findMany).not.toHaveBeenCalled();
  });
});
