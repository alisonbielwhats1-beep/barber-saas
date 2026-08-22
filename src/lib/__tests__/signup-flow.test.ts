import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(async () => new Headers()),
  cookieSet: vi.fn(),
  checkRateLimit: vi.fn(async () => ({ allowed: true, source: "memory" })),
  clientIp: vi.fn(() => "1.2.3.4"),
  uniqueSalonSlug: vi.fn(async () => "studio-teste"),
  userFindUnique: vi.fn(async () => null),
  userCreate: vi.fn(async () => ({ id: "owner-1" })),
  salonCreate: vi.fn(async () => ({ id: "salon-1" })),
  membershipCreate: vi.fn(),
  serviceCreateMany: vi.fn(),
  accessEventCreateMany: vi.fn(async () => ({ count: 1 })),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: mocks.headers,
  cookies: vi.fn(async () => ({ set: mocks.cookieSet })),
}));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn(async () => "password-hash") } }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  clientIp: mocks.clientIp,
}));
vi.mock("@/lib/slug", () => ({ uniqueSalonSlug: mocks.uniqueSalonSlug }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    $transaction: mocks.transaction,
  },
}));

import { signup } from "@/app/(auth)/signup/actions";

const VALID = {
  ownerName: "Dono Teste",
  email: "dono@example.com",
  password: "senha-segura",
  confirmPassword: "senha-segura",
  salonName: "Studio Teste",
  segmentId: "barbearia",
  serviceNames: ["Corte masculino"],
};

describe("signup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindUnique.mockResolvedValue(null);
    mocks.checkRateLimit.mockResolvedValue({ allowed: true, source: "memory" });
    mocks.accessEventCreateMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        user: { create: mocks.userCreate },
        salon: { create: mocks.salonCreate },
        membership: { create: mocks.membershipCreate },
        service: { createMany: mocks.serviceCreateMany },
        salonAccessEvent: { createMany: mocks.accessEventCreateMany },
        $executeRaw: mocks.executeRaw,
      }),
    );
  });

  it("cria conta e libera o plano Grátis de forma atômica", async () => {
    const result = await signup(VALID);

    expect(result).toEqual({ ok: true, slug: "studio-teste" });
    expect(mocks.salonCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          plan: "FREE",
          accessStatus: "APPROVED",
          accessReviewedAt: expect.any(Date),
        }),
      }),
    );
    expect(mocks.membershipCreate).toHaveBeenCalledWith({
      data: { userId: "owner-1", salonId: "salon-1", role: "OWNER" },
    });
    expect(mocks.accessEventCreateMany).not.toHaveBeenCalled();
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "active_salon",
      "salon-1",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    );
  });

  it("rejeita senhas divergentes antes do limiter e do banco", async () => {
    const result = await signup({
      ...VALID,
      confirmPassword: "senha-diferente",
    } as Parameters<typeof signup>[0]);

    expect(result).toEqual({ ok: false, error: "As senhas não coincidem." });
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("devolve erro amigável sem expor a página de exceção", async () => {
    mocks.transaction.mockRejectedValueOnce(
      Object.assign(new Error("RLS"), { code: "42501" }),
    );

    await expect(signup(VALID)).resolves.toEqual({
      ok: false,
      error: "Não foi possível criar o estabelecimento agora. Tente novamente em instantes.",
    });
  });
});
