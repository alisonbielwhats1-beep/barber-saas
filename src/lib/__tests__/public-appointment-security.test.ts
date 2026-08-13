import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const createAppointment = vi.fn();
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "salon-a" }]),
    product: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn(),
    },
    appointment: {
      findFirst: vi.fn().mockResolvedValue({ id: "appointment-a", products: [] }),
    },
    appointmentProduct: { createMany: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    $executeRaw: vi.fn().mockResolvedValue(undefined),
  };
  const transaction = vi.fn(
    async (callback: (value: typeof tx) => unknown) => callback(tx),
  );
  return {
    createAppointment,
    getClientSession: vi.fn(),
    transaction,
    tx,
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/appointment-service", () => ({
  createAppointment: mocks.createAppointment,
  appointmentErrorStatus: () => 409,
}));
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
  serviceIds: ["service-a"],
  professionalId: "professional-a",
  startLocal: "2030-01-10T12:00",
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
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
    mocks.tx.$queryRaw.mockResolvedValue([{ id: "salon-a" }]);
    mocks.tx.appointment.findFirst.mockResolvedValue({ id: "appointment-a", products: [] });
    mocks.getClientSession.mockResolvedValue({
      clientId: "client-session",
      salonId: "salon-a",
      name: "Cliente",
      email: "cliente@example.com",
    });
    mocks.createAppointment.mockResolvedValue({
      appointment: {
        id: "appointment-a",
        startAt: new Date("2030-01-10T15:00:00.000Z"),
        endAt: new Date("2030-01-10T15:30:00.000Z"),
        version: 1,
        clientId: "client-session",
        professionalId: "professional-a",
      },
      duplicate: false,
    });
  });

  it("usa exclusivamente o cliente da sessão na operação central", async () => {
    const response = await POST(request(validBody));

    expect(response.status).toBe(201);
    expect(mocks.createAppointment).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        salonId: "salon-a",
        clientId: "client-session",
        actor: expect.objectContaining({ type: "CLIENT", id: "client-session" }),
      }),
    );
    const body = await response.json();
    expect(body.appointment).not.toHaveProperty("clientId");
  });

  it("retry idempotente não depende do estado atual do catálogo", async () => {
    mocks.createAppointment.mockResolvedValueOnce({
      appointment: {
        id: "appointment-a",
        startAt: new Date("2030-01-10T15:00:00.000Z"),
        endAt: new Date("2030-01-10T15:30:00.000Z"),
        version: 1,
        clientId: "client-session",
        professionalId: "professional-a",
      },
      duplicate: true,
    });

    const response = await POST(
      request({
        ...validBody,
        cartItems: [{ productId: "product-now-inactive", quantity: 1 }],
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.product.findMany).not.toHaveBeenCalled();
    expect(mocks.tx.product.updateMany).not.toHaveBeenCalled();
  });

  it("serializa e reserva produto pelo preço do servidor", async () => {
    mocks.tx.product.findMany.mockResolvedValueOnce([{
      id: "product-a",
      name: "Pomada",
      priceCents: 1_500,
      stock: 5,
    }]);
    mocks.tx.product.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.tx.appointmentProduct.createMany.mockResolvedValueOnce({ count: 1 });

    const response = await POST(request({
      ...validBody,
      cartItems: [{ productId: "product-a", quantity: 2 }],
    }));

    expect(response.status).toBe(201);
    expect(mocks.createAppointment).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        idempotencyContext: [{ productId: "product-a", quantity: 2 }],
      }),
    );
    expect(mocks.tx.product.updateMany).toHaveBeenCalledWith({
      where: {
        id: "product-a",
        salonId: "salon-a",
        active: true,
        stock: 5,
      },
      data: { stock: { decrement: 2 } },
    });
    expect(mocks.tx.appointmentProduct.createMany).toHaveBeenCalledWith({
      data: [{
        appointmentId: "appointment-a",
        productId: "product-a",
        quantity: 2,
        priceCentsUnit: 1_500,
      }],
    });
    expect(mocks.tx.$queryRaw.mock.invocationCallOrder.at(-1))
      .toBeLessThan(mocks.tx.product.findMany.mock.invocationCallOrder[0]!);
    expect(mocks.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        salonId: "salon-a",
        action: "STOCK_ADJUSTED",
        entityId: "product-a",
        metadata: expect.objectContaining({
          kind: "RESERVATION",
          delta: -2,
          previousStock: 5,
          newStock: 3,
          appointmentId: "appointment-a",
        }),
      }),
    });
  });

  it("clientId enviado pelo navegador não substitui a sessão", async () => {
    const response = await POST(
      request({ ...validBody, clientId: "client-de-outra-pessoa" }),
    );

    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("trata JSON malformado como BAD_REQUEST sem consultar sessão ou tenant", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/appointments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "BAD_REQUEST" });
    expect(mocks.getClientSession).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("cliente do salão A agenda no salão B somente como visitante", async () => {
    mocks.getClientSession.mockResolvedValue({
      clientId: "client-salon-a",
      salonId: "salon-a",
      name: "Outro",
      email: "outro@example.com",
    });

    const response = await POST(
      request({
        ...validBody,
        salonId: "salon-b",
        clientName: "Visitante B",
        clientPhone: "(11) 98888-7777",
      }),
    );

    expect(response.status).toBe(201);
    const input = mocks.createAppointment.mock.calls[0]![1];
    expect(input).toEqual(
      expect.objectContaining({
        salonId: "salon-b",
        guest: { name: "Visitante B", phone: "11988887777" },
        actor: expect.objectContaining({ type: "GUEST" }),
      }),
    );
    expect(input).not.toHaveProperty("clientId");
  });

  it("sessão de outro tenant nunca é anexada ao agendamento", async () => {
    mocks.getClientSession.mockResolvedValue({
      clientId: "client-salon-a",
      salonId: "salon-a",
      name: "Cliente A",
      email: "a@example.com",
    });

    await POST(
      request({
        ...validBody,
        salonId: "salon-b",
        clientName: "Visitante B",
        clientPhone: "11988887777",
      }),
    );

    const input = mocks.createAppointment.mock.calls[0]![1];
    expect(input).not.toHaveProperty("clientId", "client-salon-a");
    expect(input.guest).toEqual({ name: "Visitante B", phone: "11988887777" });
  });

  it("visitante não reutiliza identidade existente apenas pelo telefone", async () => {
    mocks.getClientSession.mockResolvedValue(null);

    const response = await POST(
      request({
        ...validBody,
        clientName: "Visitante",
        clientPhone: "11999999999",
      }),
    );

    expect(response.status).toBe(201);
    const input = mocks.createAppointment.mock.calls[0]![1];
    expect(input).not.toHaveProperty("clientId");
    expect(input.guest).toEqual({ name: "Visitante", phone: "11999999999" });
  });

  it.each([
    ["+55 (11) 99999-8888", "11999998888"],
    ["55 11 99999-8888", "11999998888"],
    ["(11) 99999-8888", "11999998888"],
    ["+55 (11) 3333-4444", "1133334444"],
    ["55 11 3333-4444", "1133334444"],
    ["(11) 3333-4444", "1133334444"],
  ])("normaliza telefone visitante %s exclusivamente no servidor", async (
    clientPhone,
    normalized,
  ) => {
    mocks.getClientSession.mockResolvedValue(null);

    await POST(
      request({
        ...validBody,
        clientName: "Visitante",
        clientPhone,
      }),
    );

    expect(mocks.createAppointment.mock.calls[0]![1].guest).toEqual({
      name: "Visitante",
      phone: normalized,
    });
  });

  it.each([
    "+1 (212) 555-0100",
    "abc (11) 99999-8888",
    "(20) 99999-8888",
    "(11) 9333-4444",
    "(11) 89999-8888",
    "+55 (11) 99999-88889",
  ])("rejeita telefone visitante inválido sem consultar sessão ou persistir: %s", async (
    clientPhone,
  ) => {
    mocks.getClientSession.mockResolvedValue(null);

    const response = await POST(request({
      ...validBody,
      clientName: "Visitante",
      clientPhone,
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "BAD_REQUEST" });
    expect(mocks.getClientSession).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.createAppointment).not.toHaveBeenCalled();
  });

  it.each(["PENDING", "REJECTED", "SUSPENDED"])(
    "oculta estabelecimento %s e não inicia a criação",
    async () => {
      mocks.tx.$queryRaw.mockResolvedValueOnce([]);

      const response = await POST(request(validBody));

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "NOT_FOUND" });
      expect(mocks.createAppointment).not.toHaveBeenCalled();
      // O salonId já é conhecido nesta API: a GUC transacional precisa ser
      // definida antes do FOR SHARE para a policy RLS de UPDATE enxergar a
      // linha. O callback e a mutação continuam proibidos.
      expect(mocks.tx.$executeRaw).toHaveBeenCalledOnce();
    },
  );
});
