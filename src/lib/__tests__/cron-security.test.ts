import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  salonFindMany: vi.fn(),
  appointmentFindMany: vi.fn(),
  executeRaw: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    salon: { findMany: mocks.salonFindMany },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        appointment: { findMany: mocks.appointmentFindMany },
        $executeRaw: mocks.executeRaw,
      }),
  },
}));

import { GET } from "@/app/api/cron/reminders/route";

const originalSecret = process.env.CRON_SECRET;

function request(authorization?: string) {
  return new NextRequest("http://localhost/api/cron/reminders", {
    headers: authorization ? { authorization } : undefined,
  });
}

describe("GET /api/cron/reminders — fail closed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it("falha quando CRON_SECRET não está configurado", async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.salonFindMany).not.toHaveBeenCalled();
    expect(mocks.appointmentFindMany).not.toHaveBeenCalled();
  });

  it("falha sem cabeçalho de autorização", async () => {
    process.env.CRON_SECRET = "test-secret";

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.salonFindMany).not.toHaveBeenCalled();
    expect(mocks.appointmentFindMany).not.toHaveBeenCalled();
  });

  it("falha com segredo incorreto", async () => {
    process.env.CRON_SECRET = "test-secret";

    const response = await GET(request("Bearer incorrect"));

    expect(response.status).toBe(401);
    expect(mocks.salonFindMany).not.toHaveBeenCalled();
    expect(mocks.appointmentFindMany).not.toHaveBeenCalled();
  });

  it("aceita o segredo correto e varre um salão por vez (withSalon)", async () => {
    process.env.CRON_SECRET = "test-secret";
    mocks.salonFindMany.mockResolvedValue([
      { id: "salon-a", timezone: "America/Sao_Paulo" },
      { id: "salon-b", timezone: "America/Manaus" },
    ]);
    mocks.appointmentFindMany.mockResolvedValue([]);

    const response = await GET(request("Bearer test-secret"));

    expect(response.status).toBe(200);
    expect(mocks.salonFindMany).toHaveBeenCalledOnce();
    // Um withSalon (que seta a GUC) e uma leitura de agenda por salão.
    expect(mocks.executeRaw).toHaveBeenCalledTimes(2);
    expect(mocks.appointmentFindMany).toHaveBeenCalledTimes(2);
  });
});
