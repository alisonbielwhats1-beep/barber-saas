import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { $queryRaw: mocks.queryRaw },
}));

import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "1234567890abcdef");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("retorna saúde sem expor detalhes do banco", async () => {
    mocks.queryRaw.mockResolvedValue([{ "?column?": 1 }]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "salon-saas",
      version: "1234567890ab",
      checks: { database: "ok" },
    });
  });

  it("retorna 503 sem vazar a exceção do banco", async () => {
    mocks.queryRaw.mockRejectedValue(new Error("senha do banco não deve aparecer"));

    const response = await GET();

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual({
      status: "unhealthy",
      service: "salon-saas",
      version: "1234567890ab",
      checks: { database: "error" },
    });
    expect(JSON.stringify(body)).not.toContain("senha");
  });

  it("não precisa receber credenciais para responder", async () => {
    mocks.queryRaw.mockResolvedValue([{ "?column?": 1 }]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
  });
});
