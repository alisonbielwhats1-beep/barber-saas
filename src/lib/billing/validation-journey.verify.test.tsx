/**
 * Verificação adversarial da jornada (dimensão jornada-redirecionamento).
 * Tudo mockado: sem banco, sem Mercado Pago real. Valores esperados são
 * literais ou aritmética própria (14990 + n*2000; 143900 + n*19200).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ withSalon: vi.fn(), mpRequest: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../prisma-tenant", () => ({ withSalon: h.withSalon, withTenant: vi.fn(), withUser: vi.fn() }));
vi.mock("./provider", async importOriginal => ({
  ...(await importOriginal<typeof import("./provider")>()),
  mpRequest: h.mpRequest,
  verifySellerAccount: vi.fn(async () => undefined),
  searchSubscriptions: vi.fn(async () => []),
}));

import type { BillingSubscription } from "@prisma/client";
import { ensureCreated } from "./service";
import { quoteContract } from "./catalog";
import { resolveBillingIntent } from "./presentation";

function env() {
  for (const [k, v] of Object.entries({ MERCADOPAGO_BILLING_ENABLED: "true", MERCADOPAGO_MODE: "test", MERCADOPAGO_COLLECTOR_ID: "123",
    MERCADOPAGO_ACCESS_TOKEN: "t", MERCADOPAGO_WEBHOOK_SECRET: "s", APP_ENV: "test", VERCEL_ENV: "development",
    NEXTAUTH_URL: "http://localhost:3000", MERCADOPAGO_PLAN_CHANGES_ENABLED: "false", MERCADOPAGO_CHECKOUT_PAUSED: "false" })) vi.stubEnv(k, v);
}

beforeEach(() => { vi.clearAllMocks(); env(); });

describe("Mercado Pago: valor de todas as quantidades de adicionais (0..100) nos dois ciclos", () => {
  it("transaction_amount = centavos/100 e volta exatamente aos centavos", () => {
    for (let n = 0; n <= 100; n++) {
      const monthly = 14990 + n * 2000;
      const annual = 143900 + n * 19200;
      expect(quoteContract({ plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: n }).amountCents).toBe(monthly);
      expect(quoteContract({ plan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: n }).amountCents).toBe(annual);
      expect(Math.round((monthly / 100) * 100)).toBe(monthly);
      expect(Math.round((annual / 100) * 100)).toBe(annual);
    }
  });
});

describe("Mercado Pago: descrição (reason) da pré-aprovação cita a capacidade total do contrato", () => {
  function fakeSub(planCode: string, cycle: string, amountCents: number, agendaLimit: number) {
    const sub = { id: "11111111-1111-4111-8111-111111111111", salonId: "salon-a", planCode, cycle, amountCents, agendaLimit,
      intervalMonths: cycle === "ANNUAL" ? 12 : 1, currency: "BRL", mode: "test", collectorId: "123", payerEmail: "o@example.test",
      providerId: null, cancelledAt: null, cancelRequestedAt: null, creationStartedAt: null, providerUpdatedAt: null } as unknown as BillingSubscription;
    const tx = {
      $executeRaw: vi.fn(async () => 1), $queryRaw: vi.fn(async () => [{ locked: 1 }]),
      billingSubscription: { findUniqueOrThrow: vi.fn(async () => sub), update: vi.fn(async () => sub) },
      billingEvent: { upsert: vi.fn(async () => ({})) },
    };
    h.withSalon.mockImplementation(async (_id: unknown, fn: (t: typeof tx) => unknown) => fn(tx));
    // Interrompe logo após capturar o POST (resposta inválida -> PROVIDER_INVALID_RESPONSE).
    h.mpRequest.mockResolvedValue({});
    return sub;
  }
  async function sentToMercadoPago(sub: BillingSubscription) {
    await expect(ensureCreated(sub)).rejects.toThrow("PROVIDER_INVALID_RESPONSE");
    expect(h.mpRequest).toHaveBeenCalledTimes(1);
    const [path, method, body] = h.mpRequest.mock.calls[0] as [string, string, { reason: string; auto_recurring: { transaction_amount: number; frequency: number } }];
    expect([path, method]).toEqual(["/preapproval", "POST"]);
    return body;
  }

  it("Equipe 10 + 5 adicionais (15 agendas, R$ 249,90) chega ao Mercado Pago descrito como 'Everflair Equipe · 15 agendas — mensal'", async () => {
    const body = await sentToMercadoPago(fakeSub("TEAM_MAX", "MONTHLY", 24990, 15));
    expect(body.auto_recurring.transaction_amount).toBe(249.9);
    expect(body.reason).toBe("Everflair Equipe · 15 agendas — mensal");
    expect(body.reason).not.toContain("10 agendas");
  });

  // [plano, ciclo, centavos, agendas, valor enviado, frequência, descrição] — literais escritos à mão.
  it.each([
    ["INDIVIDUAL", "MONTHLY", 3990, 1, 39.9, 1, "Everflair Individual · 1 agenda — mensal"],
    ["INDIVIDUAL", "ANNUAL", 39900, 1, 399, 12, "Everflair Individual · 1 agenda — anual"],
    ["TEAM", "ANNUAL", 77900, 3, 779, 12, "Everflair Essencial · 3 agendas — anual"],
    ["TEAM_PLUS", "MONTHLY", 9990, 5, 99.9, 1, "Everflair Equipe · 5 agendas — mensal"],
    ["TEAM_MAX", "MONTHLY", 14990, 10, 149.9, 1, "Everflair Equipe · 10 agendas — mensal"],
    // 143.900 + 5 x 19.200 = 239.900
    ["TEAM_MAX", "ANNUAL", 239900, 15, 2399, 12, "Everflair Equipe · 15 agendas — anual"],
    // 143.900 + 100 x 19.200 = 2.063.900
    ["TEAM_MAX", "ANNUAL", 2063900, 110, 20639, 12, "Everflair Equipe · 110 agendas — anual"],
    // Contrato persistido antes de 2026-10-02 (14.990 + 4 x 1.500): descreve a capacidade gravada, sem recalcular.
    ["TEAM_MAX", "MONTHLY", 20990, 14, 209.9, 1, "Everflair Equipe · 14 agendas — mensal"],
  ] as const)("%s %s %i centavos / %i agendas -> valor %d e descrição com a capacidade total", async (plan, cycle, cents, agendas, amount, frequency, reason) => {
    const body = await sentToMercadoPago(fakeSub(plan, cycle, cents, agendas));
    expect(body.auto_recurring.transaction_amount).toBe(amount);
    expect(body.auto_recurring.frequency).toBe(frequency);
    expect(body.reason).toBe(reason);
  });
});

describe("Intenção na URL: entradas de borda adicionais", () => {
  it("cycle vazio descarta; chaves repetidas em /contratar ficam com o último valor (canônico)", () => {
    expect(resolveBillingIntent({ billingPlan: "TEAM", cycle: "" })).toBeUndefined();
    expect(resolveBillingIntent(Object.fromEntries(new URLSearchParams("billingPlan=INDIVIDUAL&billingPlan=TEAM_MAX&extraAgendas=3")))).toEqual({ plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 3 });
    expect(resolveBillingIntent({ billingPlan: "TEAM_MAX", extraAgendas: "1e2" })).toEqual({ plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 100 });
    expect(resolveBillingIntent({ billingPlan: "TEAM_MAX", extraAgendas: "1e3" })).toBeUndefined();
    expect(resolveBillingIntent({ billingPlan: "team_max" })).toBeUndefined();
  });
});
