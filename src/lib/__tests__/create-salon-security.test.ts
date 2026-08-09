import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `createSalon` é chamável por qualquer usuário autenticado (é a saída do
 * redirect de quem não tem membership). Sem guardas, viraria uma torneira de
 * criação de salões e de serviços arbitrários. Estes testes travam isso.
 */

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  headers: vi.fn(async () => new Headers()),
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  clientIp: vi.fn(() => "1.2.3.4"),
  uniqueSalonSlug: vi.fn(async () => "novo-salao"),
  membershipCount: vi.fn(),
  transaction: vi.fn(),
  salonCreate: vi.fn(async () => ({ id: "salon-novo" })),
  membershipCreate: vi.fn(),
  serviceCreateMany: vi.fn(),
  accessEventCreate: vi.fn(),
  userFindUnique: vi.fn(async () => ({ name: "Dono Teste", email: "dono@example.com" })),
  executeRaw: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/slug", () => ({ uniqueSalonSlug: mocks.uniqueSalonSlug }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  clientIp: mocks.clientIp,
}));
// createSalon passa por withUser (guarda de membership já existente) e por
// prisma.$transaction direto (criação) — os dois abrem $transaction, então
// o tx mockado precisa ter todos os métodos que qualquer um dos dois usa,
// mais $executeRaw (a GUC que withUser/setSalonGuc setam).
vi.mock("@/lib/prisma", () => ({
  prisma: {
    membership: { count: mocks.membershipCount },
    user: { findUnique: mocks.userFindUnique },
    $transaction: mocks.transaction,
  },
}));

import { createSalon } from "@/app/onboarding/create-salon/actions";

const VALID = {
  salonName: "Studio Teste",
  segmentId: "barbearia",
  serviceNames: ["Corte masculino", "Barba"],
};

describe("createSalon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-1" } });
    mocks.membershipCount.mockResolvedValue(0);
    mocks.checkRateLimit.mockResolvedValue({ allowed: true });
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        membership: { count: mocks.membershipCount, create: mocks.membershipCreate },
        salon: { create: mocks.salonCreate },
        service: { createMany: mocks.serviceCreateMany },
        salonAccessEvent: { create: mocks.accessEventCreate },
        $executeRaw: mocks.executeRaw,
      }),
    );
  });

  it("exige sessão", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const res = await createSalon(VALID);
    expect(res.ok).toBe(false);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("recusa quem já pertence a um estabelecimento", async () => {
    mocks.membershipCount.mockResolvedValue(1);
    const res = await createSalon(VALID);
    expect(res.ok).toBe(false);
    // A guarda em si já roda dentro de um $transaction (withUser) — o que
    // não pode acontecer é a CRIAÇÃO do salão.
    expect(mocks.salonCreate).not.toHaveBeenCalled();
  });

  it("respeita o rate limit", async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false });
    const res = await createSalon(VALID);
    expect(res.ok).toBe(false);
    // Rate limit é checado antes até da guarda de membership.
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejeita segmento inexistente", async () => {
    const res = await createSalon({ ...VALID, segmentId: "cassino" });
    expect(res.ok).toBe(false);
    expect(mocks.salonCreate).not.toHaveBeenCalled();
  });

  it("ignora serviço que não veio das sugestões do segmento", async () => {
    // Sem este filtro, o cliente ditaria o que é criado no banco.
    await createSalon({
      ...VALID,
      serviceNames: ["Corte masculino", "Serviço Inventado <script>"],
    });
    const created = mocks.serviceCreateMany.mock.calls[0][0].data as { name: string }[];
    expect(created.map((s) => s.name)).toEqual(["Corte masculino"]);
  });

  it("cria salão, membership OWNER e os serviços escolhidos", async () => {
    const res = await createSalon(VALID);
    expect(res.ok).toBe(true);
    expect(mocks.membershipCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: "OWNER" }) }),
    );
    expect(mocks.accessEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "REQUESTED", newStatus: "PENDING" }),
      }),
    );
    const created = mocks.serviceCreateMany.mock.calls[0][0].data as {
      name: string;
      priceCents: number;
      durationMin: number;
    }[];
    expect(created).toHaveLength(2);
    // Preço em branco é intencional — inventar valor seria dado falso.
    expect(created.every((s) => s.priceCents === 0)).toBe(true);
    expect(created.every((s) => s.durationMin > 0)).toBe(true);
  });

  it("não cria serviço nenhum se o dono desmarcar tudo", async () => {
    const res = await createSalon({ ...VALID, serviceNames: [] });
    expect(res.ok).toBe(true);
    expect(mocks.serviceCreateMany).not.toHaveBeenCalled();
  });
});
