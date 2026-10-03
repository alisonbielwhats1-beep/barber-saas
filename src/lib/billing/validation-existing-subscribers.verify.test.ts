// @vitest-environment jsdom
/**
 * Verificação adversarial da dimensão "assinantes-existentes".
 * Valores esperados são literais ou aritmética própria; nada de banco ou
 * Mercado Pago reais (prisma-tenant e provider simulados).
 */
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const hoisted = vi.hoisted(() => ({ tx: null as any }));
vi.mock("server-only", () => ({}));
vi.mock("../prisma-tenant", () => ({
  withSalon: async (_s: string, fn: (tx: unknown) => unknown) => fn(hoisted.tx),
  withTenant: async (_c: unknown, fn: (tx: unknown) => unknown) => fn(hoisted.tx),
}));
vi.mock("./provider", async importOriginal => ({ ...(await importOriginal<typeof import("./provider")>()), mpRequest: vi.fn(), verifySellerAccount: vi.fn(), searchSubscriptions: vi.fn() }));

import * as mp from "./provider";
import { contract } from "./service";
import { quotePlanChange } from "./change-rules";
import { pendingPriceOutdated, type SubscriptionView } from "./presentation";
import { PlanPicker, type PlanTerms } from "@/components/billing/plan-picker";

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

const terms = (plan: string, cycle: string, amountCents: number, agendaLimit: number, catalogVersion = "2026-09-13") =>
  ({ plan, cycle, amountCents, agendaLimit, intervalMonths: cycle === "ANNUAL" ? 12 : 1, catalogVersion }) as any;

describe("F3 — fronteira exata em que 'reduzir adicionais' antigos deixa de baratear", () => {
  const start = new Date("2028-02-01T12:00:00Z"), end = new Date("2028-03-01T12:00:00Z"), now = new Date("2028-02-15T12:00:00Z");
  it("mensal +4 antigo (14990 + 4×1500 = 20990) → +3 novo (14990 + 3×2000 = 20990): mesmo preço com 1 agenda a menos", () => {
    const q = quotePlanChange(terms("TEAM_MAX", "MONTHLY", 20990, 14), { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 3 }, { start, end }, 10, now);
    expect(q).toMatchObject({ kind: "SCHEDULED", amountDueCents: 0 });
    expect(q.to.amountCents).toBe(20990);
  });
  it("mensal +3 antigo (19490) → +2 novo (18990): reduz de fato", () => {
    const q = quotePlanChange(terms("TEAM_MAX", "MONTHLY", 19490, 13), { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 2 }, { start, end }, 10, now);
    expect(q.to.amountCents).toBe(18990);
  });
  it("anual +5 antigo (143900 + 5×14400 = 215900) → +4 novo (143900 + 4×19200 = 220700): menos agendas por um preço maior, agendado sem cobrança agora", () => {
    const q = quotePlanChange(terms("TEAM_MAX", "ANNUAL", 215900, 15), { plan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: 4 }, { start, end }, 10, now);
    expect(q).toMatchObject({ kind: "SCHEDULED", amountDueCents: 0 });
    expect(q.to.amountCents).toBe(220700);
  });
  // Na tela, "Reduzir para este plano" só aparece quando capacidade E preço caem; senão, "Mudar para este plano".
  const labels: [string, string, PlanTerms, RegExp][] = [
    ["mensal +4 antigo (R$ 209,90) → +3 (R$ 209,90, mesmo preço)", "Mudar para este plano", { plan: "TEAM_MAX", cycle: "MONTHLY", agendaLimit: 14, amountCents: 20990 }, /^R\$\s209,90$/],
    ["mensal +3 antigo (R$ 194,90) → +2 (R$ 189,90, mais barato)", "Reduzir para este plano", { plan: "TEAM_MAX", cycle: "MONTHLY", agendaLimit: 13, amountCents: 19490 }, /^R\$\s189,90$/],
    ["anual +5 antigo (R$ 2.159) → +4 (R$ 2.207, mais caro)", "Mudar para este plano", { plan: "TEAM_MAX", cycle: "ANNUAL", agendaLimit: 15, amountCents: 215900 }, /^R\$\s2\.207$/],
  ];
  it.each(labels)("na tela, %s com uma agenda a menos aparece como '%s'", (_label, action, current, price) => {
    const onChoose = vi.fn();
    render(createElement(PlanPicker, { mode: "change", current, occupiedAgendas: 10, onChoose }));
    fireEvent.click(screen.getByRole("button", { name: "Remover uma agenda adicional" }));
    const button = screen.getByRole("button", { name: `${action}: Equipe · 10 agendas` });
    expect(button).toBeEnabled();
    expect(within(button.closest("article")!).getByText(price)).toBeVisible();
    expect(screen.queryAllByRole("button", { name: /: Equipe · 10 agendas$/ })).toHaveLength(1);
  });
});

describe("C17 — upgrade anual a partir de contrato antigo", () => {
  it("Individual anual antigo 59900 → Essencial anual 77900: 18000 × 184/365 = 9073,97 → 9074", () => {
    const q = quotePlanChange(terms("INDIVIDUAL", "ANNUAL", 59900, 1), { plan: "TEAM", cycle: "ANNUAL" },
      { start: new Date("2026-09-13T00:00:00Z"), end: new Date("2027-09-13T00:00:00Z") }, 1, new Date("2027-03-13T00:00:00Z"));
    expect(q.kind).toBe("UPGRADE");
    expect(q.amountDueCents).toBe(9074);
  });
});

describe("F2 — contratação pendente antiga no seletor", () => {
  type PendingSample = Pick<SubscriptionView, "plan" | "cycle" | "agendaLimit" | "amountCents" | "providerStatus">;
  const outdatedCases: [string, boolean, PendingSample][] = [
    ["Individual mensal criado a 5990 (tabela 3990), não pago", true, { plan: "INDIVIDUAL", cycle: "MONTHLY", agendaLimit: 1, amountCents: 5990, providerStatus: "pending" }],
    ["Individual anual criado a 59900 (tabela 39900), não pago", true, { plan: "INDIVIDUAL", cycle: "ANNUAL", agendaLimit: 1, amountCents: 59900, providerStatus: "pending" }],
    ["Equipe 10 + 2 criado a 17990 (tabela 18990), não pago", true, { plan: "TEAM_MAX", cycle: "MONTHLY", agendaLimit: 12, amountCents: 17990, providerStatus: "pending" }],
    ["Individual mensal criado ao preço atual (3990)", false, { plan: "INDIVIDUAL", cycle: "MONTHLY", agendaLimit: 1, amountCents: 3990, providerStatus: "pending" }],
    ["Essencial antigo, preço inalterado (7990)", false, { plan: "TEAM", cycle: "MONTHLY", agendaLimit: 3, amountCents: 7990, providerStatus: "pending" }],
    ["Individual a 5990 já autorizado no Mercado Pago", false, { plan: "INDIVIDUAL", cycle: "MONTHLY", agendaLimit: 1, amountCents: 5990, providerStatus: "authorized" }],
  ];
  it.each(outdatedCases)("tentativa desatualizada (pendingPriceOutdated): %s → %s", (_label, expected, sample) => {
    expect(pendingPriceOutdated(sample)).toBe(expected);
  });

  const checkout = "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=pre-old";
  it("tentativa de R$ 59,90 desatualizada: o card mostra o preço atual, informa o valor da tentativa e troca 'Continuar pagamento' por 'Atualizar para o novo preço'", () => {
    const onChoose = vi.fn();
    render(createElement(PlanPicker, { mode: "replace-pending", pending: { plan: "INDIVIDUAL", cycle: "MONTHLY", agendaLimit: 1, amountCents: 5990, checkoutUrl: checkout, outdated: true }, occupiedAgendas: 1, onChoose }));
    const card = screen.getByText("Escolhido").closest("article")!;
    expect(within(card).getByText(/^R\$\s39,90$/)).toBeVisible();
    expect(within(card).getByText(/^Preço atual\. Sua tentativa, ainda não paga, foi criada a R\$\s59,90\/mês\.$/)).toBeVisible();
    expect(screen.queryByRole("link", { name: /Continuar pagamento/ })).toBeNull();
    expect(document.querySelector(`a[href="${checkout}"]`)).toBeNull();
    expect(screen.queryByRole("button", { name: "Trocar para este plano: Individual" })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Atualizar para o novo preço: Individual" }));
    expect(onChoose).toHaveBeenCalledWith({ plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0 });
    expect(screen.getByRole("button", { name: "Trocar para este plano: Essencial" })).toBeEnabled();
  });
  it("controle: tentativa não desatualizada (sem 'outdated') segue com 'Continuar pagamento' para o checkout existente", () => {
    render(createElement(PlanPicker, { mode: "replace-pending", pending: { plan: "INDIVIDUAL", cycle: "MONTHLY", agendaLimit: 1, amountCents: 3990, checkoutUrl: checkout }, occupiedAgendas: 1, onChoose: () => undefined }));
    const card = screen.getByText("Escolhido").closest("article")!;
    expect(within(card).getByText(/^R\$\s39,90$/)).toBeVisible();
    expect(within(card).getByRole("link", { name: "Continuar pagamento: Individual" })).toHaveAttribute("href", checkout);
    expect(screen.queryByRole("button", { name: /Atualizar para o novo preço/ })).toBeNull();
    expect(screen.queryByText(/Sua tentativa, ainda não paga/)).toBeNull();
  });
});

describe("C21 — idempotência de contratação não reaproveita intenção antiga", () => {
  function setup(previousFingerprint: string) {
    vi.stubEnv("MERCADOPAGO_BILLING_ENABLED", "true"); vi.stubEnv("MERCADOPAGO_MODE", "test"); vi.stubEnv("MERCADOPAGO_COLLECTOR_ID", "123");
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "test-only"); vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "s"); vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("VERCEL_ENV", ""); vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000"); vi.stubEnv("MERCADOPAGO_CHECKOUT_PAUSED", "");
    const previous = { id: "0b9f1c7e-1d2a-4c3b-9e8f-111111111111", salonId: "s1", fingerprint: previousFingerprint, providerId: "pre-old", cancelledAt: null, amountCents: 5990 };
    hoisted.tx = {
      $executeRaw: vi.fn(async () => 0), $queryRaw: vi.fn(async () => []),
      membership: { findFirst: vi.fn(async () => ({ role: "OWNER" })) },
      billingSubscription: { findUnique: vi.fn(async () => previous), findUniqueOrThrow: vi.fn(async () => previous), create: vi.fn() },
    };
    return previous;
  }
  // Literal quotes, in quoteContract's key order, for each catalog.
  const oldQuote = { plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0, catalogVersion: "2026-09-13", label: "Individual", currency: "BRL", amountCents: 5990, agendaLimit: 1, intervalMonths: 1 };
  const newQuote = { ...oldQuote, catalogVersion: "2026-10-02", amountCents: 3990 };
  const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

  it("mesma Idempotency-Key de intenção criada a R$ 59,90 → IDEMPOTENCY_MISMATCH, sem criar nada nem chamar o MP", async () => {
    setup(sha(oldQuote));
    await expect(contract({ salonId: "s1", userId: "u1" }, { plan: "INDIVIDUAL", cycle: "MONTHLY" }, "5d0e7c43-6f5c-4a8e-9c2a-2b8c4f3d1e10")).rejects.toThrow("IDEMPOTENCY_MISMATCH");
    expect(hoisted.tx.billingSubscription.create).not.toHaveBeenCalled();
    expect(vi.mocked(mp.mpRequest)).not.toHaveBeenCalled();
  });
  it("controle: intenção com o fingerprint do catálogo novo (R$ 39,90) é reaproveitada", async () => {
    const previous = setup(sha(newQuote));
    await expect(contract({ salonId: "s1", userId: "u1" }, { plan: "INDIVIDUAL", cycle: "MONTHLY" }, "5d0e7c43-6f5c-4a8e-9c2a-2b8c4f3d1e10")).resolves.toMatchObject({ id: previous.id });
    expect(hoisted.tx.billingSubscription.create).not.toHaveBeenCalled();
  });
});
