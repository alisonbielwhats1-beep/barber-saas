import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  compare: vi.fn(),
  checkRateLimit: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
}));

vi.mock("bcryptjs", () => ({
  default: { compare: mocks.compare },
}));
vi.mock("@/lib/rate-limit", () => ({
  clientIp: () => "test-ip",
  checkRateLimit: mocks.checkRateLimit,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
  },
}));

import { authOptions } from "@/lib/auth";

type Authorize = (
  credentials: Record<string, string> | undefined,
  request: { headers: Record<string, string> },
) => Promise<unknown>;

const authorize = (
  authOptions.providers[0] as unknown as { options: { authorize: Authorize } }
).options.authorize;

describe("login da equipe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, source: "local" });
    mocks.findUnique.mockResolvedValue(null);
    mocks.compare.mockResolvedValue(false);
  });

  it.each(["x".repeat(73), "é".repeat(37)])(
    "rejeita senha acima de 72 bytes antes do limiter e do banco",
    async (password) => {
      await expect(authorize(
        { email: "owner@example.com", password },
        { headers: {} },
      )).resolves.toBeNull();

      expect(mocks.checkRateLimit).not.toHaveBeenCalled();
      expect(mocks.findUnique).not.toHaveBeenCalled();
      expect(mocks.compare).not.toHaveBeenCalled();
    },
  );

  it("executa comparação dummy quando o usuário não existe", async () => {
    await expect(authorize(
      { email: "missing@example.com", password: "senha-segura" },
      { headers: {} },
    )).resolves.toBeNull();

    expect(mocks.compare).toHaveBeenCalledOnce();
    expect(mocks.compare.mock.calls[0]?.[1]).toMatch(/^\$2a\$10\$/);
  });
});
