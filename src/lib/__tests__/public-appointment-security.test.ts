import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const appointmentCreate = vi.fn();
  const tx = {
    appointment: { create: appointmentCreate },
    appointmentProduct: { createMany: vi.fn() },
    product: { update: vi.fn() },
  };
  return {
    getClientSession: vi.fn(),
    appointmentCreate,
    tx,
    prisma: {
      service: { findFirst: vi.fn() },
      professionalService: { findFirst: vi.fn() },
      appointment: { findFirst: vi.fn() },
      product: { findMany: vi.fn() },
      clientProfile: { findFirst: vi.fn(), create: vi.fn() },
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) =>
        callback(tx),
      ),
    },
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/client-auth", () => ({
  getClientSession: mocks.getClientSession,
}));
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
}));

import { POST } from "@/app/api/appointments/route";

const validBody = {
  salonId: "salon-a",
  serviceId: "service-a",
  professionalId: "professional-a",
  startAt: "2030-01-10T15:00:00.000Z",
  cartItems: [],
};

function request(body: object) {
  return new NextRequest("http://localhost/api/appointments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/appointments — identidade do cliente", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClientSession.mockResolvedValue({
      clientId: "client-session",
      salonId: "salon-a",
      name: "Cliente",
      email: "cliente@example.com",
    });
    mocks.prisma.service.findFirst.mockResolvedValue({
      durationMin: 30,
      priceCents: 5_000,
    });
    mocks.prisma.professionalService.findFirst.mockResolvedValue({
      serviceId: "service-a",
    });
    mocks.prisma.appointment.findFirst.mockResolvedValue(null);
    mocks.prisma.clientProfile.findFirst.mockResolvedValue({
      id: "client-session",
    });
    mocks.appointmentCreate.mockResolvedValue({
      id: "appointment-a",
      startAt: new Date(validBody.startAt),
      endAt: new Date("2030-01-10T15:30:00.000Z"),
    });
  });

  it("usa exclusivamente o cliente da sessão na persistência", async () => {
    const response = await POST(request(validBody));

    expect(response.status).toBe(201);
    expect(mocks.prisma.clientProfile.findFirst).toHaveBeenCalledWith({
      where: { id: "client-session", salonId: "salon-a" },
      select: { id: true },
    });
    expect(mocks.appointmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ clientId: "client-session" }),
      }),
    );
  });

  it("clientId enviado pelo navegador não substitui a sessão", async () => {
    const response = await POST(
      request({ ...validBody, clientId: "client-de-outra-pessoa" }),
    );

    expect(response.status).toBe(400);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("cliente do salão A consegue agendar como visitante no salão B", async () => {
    mocks.getClientSession.mockResolvedValue({
      clientId: "client-salon-a",
      salonId: "salon-a",
      name: "Outro",
      email: "outro@example.com",
    });
    mocks.prisma.clientProfile.create.mockResolvedValue({ id: "guest-salon-b" });

    const response = await POST(
      request({
        ...validBody,
        salonId: "salon-b",
        clientName: "Visitante B",
        clientPhone: "(11) 98888-7777",
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.prisma.clientProfile.create).toHaveBeenCalledWith({
      data: {
        salonId: "salon-b",
        name: "Visitante B",
        phone: "11988887777",
      },
      select: { id: true },
    });
  });

  it("sessão do salão A nunca é anexada ao agendamento do salão B", async () => {
    mocks.getClientSession.mockResolvedValue({
      clientId: "client-salon-a",
      salonId: "salon-a",
      name: "Cliente A",
      email: "a@example.com",
    });
    mocks.prisma.clientProfile.create.mockResolvedValue({ id: "guest-salon-b" });

    const response = await POST(
      request({
        ...validBody,
        salonId: "salon-b",
        clientName: "Visitante B",
        clientPhone: "11988887777",
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.prisma.clientProfile.findFirst).not.toHaveBeenCalled();
    expect(mocks.appointmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ clientId: "guest-salon-b" }),
      }),
    );
    expect(mocks.appointmentCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ clientId: "client-salon-a" }),
      }),
    );
  });

  it("visitante não reutiliza identidade existente apenas pelo telefone", async () => {
    mocks.getClientSession.mockResolvedValue(null);
    mocks.prisma.clientProfile.create.mockResolvedValue({ id: "guest-new" });

    const response = await POST(
      request({
        ...validBody,
        clientName: "Visitante",
        clientPhone: "11999999999",
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.prisma.clientProfile.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.clientProfile.create).toHaveBeenCalledWith({
      data: {
        salonId: "salon-a",
        name: "Visitante",
        phone: "11999999999",
      },
      select: { id: true },
    });
    expect(mocks.appointmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ clientId: "guest-new" }),
      }),
    );
  });

  it("normaliza telefone do visitante exclusivamente no servidor", async () => {
    mocks.getClientSession.mockResolvedValue(null);
    mocks.prisma.clientProfile.create.mockResolvedValue({ id: "guest-new" });

    const response = await POST(
      request({
        ...validBody,
        clientName: "Visitante",
        clientPhone: "(11) 99999-8888",
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.prisma.clientProfile.create).toHaveBeenCalledWith({
      data: {
        salonId: "salon-a",
        name: "Visitante",
        phone: "11999998888",
      },
      select: { id: true },
    });
  });
});
