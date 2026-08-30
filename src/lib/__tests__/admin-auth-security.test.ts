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

  it("aceita os metadados de transporte enviados pelo NextAuth", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "user-a",
      email: "owner@example.com",
      name: "Owner",
      passwordHash: "hash",
      passwordSetAt: new Date(),
      sessionVersion: 0,
      avatarUrl: null,
    });
    mocks.compare.mockResolvedValue(true);

    await expect(authorize(
      {
        email: "owner@example.com",
        password: "senha-segura",
        csrfToken: "csrf-interno",
        callbackUrl: "http://localhost:3100/login",
        json: "true",
      },
      { headers: {} },
    )).resolves.toEqual(expect.objectContaining({
      id: "user-a",
      email: "owner@example.com",
      sessionVersion: 0,
    }));
  });

  it("revoga JWT anterior quando a versão da sessão muda", async () => {
    mocks.findUnique.mockResolvedValue({ sessionVersion: 2 });
    const jwt = authOptions.callbacks?.jwt as unknown as (input: {
      token: { uid?: string; sessionVersion?: number };
      user?: undefined;
    }) => Promise<{ uid?: string; sessionVersion?: number }>;

    const token = await jwt({
      token: { uid: "user-a", sessionVersion: 1 },
      user: undefined,
    });

    expect(token.uid).toBeUndefined();
  });
});
