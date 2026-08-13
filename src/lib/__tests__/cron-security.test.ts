import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  salonFindMany: vi.fn(),
  appointmentFindMany: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    salon: { findMany: mocks.salonFindMany },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        appointment: { findMany: mocks.appointmentFindMany },
        $queryRaw: mocks.queryRaw,
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
    mocks.queryRaw.mockImplementation(
      async (_query: TemplateStringsArray, salonId: string) => [{ id: salonId }],
    );
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

  it("aceita o segredo correto e revalida apenas salões aprovados", async () => {
    process.env.CRON_SECRET = "test-secret";
    mocks.salonFindMany.mockResolvedValue([
      { id: "salon-a", timezone: "America/Sao_Paulo" },
      { id: "salon-b", timezone: "America/Manaus" },
    ]);
    mocks.appointmentFindMany.mockResolvedValue([]);

    const response = await GET(request("Bearer test-secret"));

    expect(response.status).toBe(200);
    expect(mocks.salonFindMany).toHaveBeenCalledWith({
      where: { accessStatus: "APPROVED" },
      select: { id: true, timezone: true },
      orderBy: { id: "asc" },
    });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
    expect(mocks.executeRaw).toHaveBeenCalledTimes(2);
    expect(mocks.appointmentFindMany).toHaveBeenCalledTimes(2);
    await expect(response.json()).resolves.toEqual({ generated: 0, count: 0 });
  });

  it("ignora salão suspenso entre a listagem e a transação", async () => {
    process.env.CRON_SECRET = "test-secret";
    mocks.salonFindMany.mockResolvedValue([
      { id: "salon-a", timezone: "America/Sao_Paulo" },
    ]);
    mocks.queryRaw.mockResolvedValue([]);

    const response = await GET(request("Bearer test-secret"));

    expect(response.status).toBe(200);
    expect(mocks.appointmentFindMany).not.toHaveBeenCalled();
    // O id já foi listado: a GUC local precede o FOR SHARE para que a policy
    // RLS de UPDATE consiga revalidar o salão. O callback permanece fechado.
    expect(mocks.executeRaw).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual({ generated: 0, count: 0 });
  });
});
