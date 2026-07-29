import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: mocks.queryRaw },
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
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("falha sem cabeçalho de autorização", async () => {
    process.env.CRON_SECRET = "test-secret";

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("falha com segredo incorreto", async () => {
    process.env.CRON_SECRET = "test-secret";

    const response = await GET(request("Bearer incorrect"));

    expect(response.status).toBe(401);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("aceita somente o segredo correto", async () => {
    process.env.CRON_SECRET = "test-secret";
    mocks.queryRaw.mockResolvedValue([]);

    const response = await GET(request("Bearer test-secret"));

    expect(response.status).toBe(200);
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
  });
});
