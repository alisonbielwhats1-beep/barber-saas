import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getClientSession: vi.fn(),
  prisma: {
    salon: { findUnique: vi.fn() },
    appointment: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/client-auth", () => ({
  getClientSession: mocks.getClientSession,
}));
vi.mock("@/lib/rate-limit", () => ({
  clientIp: () => "test-ip",
  checkRateLimit: () =>
    Promise.resolve({
      allowed: true,
      limit: 15,
      remaining: 14,
      retryAfterSeconds: 60,
      source: "local",
    }),
  rateLimitHeaders: () => ({}),
  rateLimitStatus: () => 429,
}));

import { POST } from "@/app/api/client/cancel/route";

function request() {
  return new NextRequest("http://localhost/api/client/cancel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      salonSlug: "salon-a",
      appointmentId: "appointment-a",
    }),
  });
}

describe("POST /api/client/cancel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-10T12:00:00.000Z"));
    vi.clearAllMocks();
    mocks.getClientSession.mockResolvedValue({
      clientId: "client-a",
      salonId: "salon-a",
    });
    mocks.prisma.salon.findUnique.mockResolvedValue({
      id: "salon-a",
      cancelPolicyHours: 2,
    });
    mocks.prisma.appointment.findFirst.mockResolvedValue({
      id: "appointment-a",
      status: "CONFIRMED",
      startAt: new Date("2030-01-10T14:00:00.000Z"),
    });
    mocks.prisma.appointment.updateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("permite cancelar exatamente no limite e condiciona o update ao estado", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.prisma.appointment.updateMany).toHaveBeenCalledWith({
      where: {
        id: "appointment-a",
        salonId: "salon-a",
        clientId: "client-a",
        status: { in: ["PENDING", "CONFIRMED"] },
        startAt: { gte: new Date("2030-01-10T14:00:00.000Z") },
      },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date("2030-01-10T12:00:00.000Z"),
      },
    });
  });

  it("não cancela atendimento já iniciado", async () => {
    mocks.prisma.appointment.findFirst.mockResolvedValue({
      id: "appointment-a",
      status: "IN_PROGRESS",
      startAt: new Date("2030-01-10T11:30:00.000Z"),
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "ALREADY_STARTED",
    });
    expect(mocks.prisma.appointment.updateMany).not.toHaveBeenCalled();
  });

  it("falha se o estado mudar entre leitura e cancelamento", async () => {
    mocks.prisma.appointment.updateMany.mockResolvedValue({ count: 0 });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "STATE_CHANGED",
    });
  });
});
