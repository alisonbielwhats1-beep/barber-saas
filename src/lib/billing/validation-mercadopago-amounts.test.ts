// @vitest-environment jsdom
/**
 * Validação "valor-no-mercado-pago": para uma NOVA assinatura, o valor, a moeda,
 * a periodicidade e a descrição enviados ao Mercado Pago correspondem ao plano
 * escolhido. Banco e Mercado Pago são simulados em memória; nenhuma chamada externa.
 * Os valores esperados são literais (ou aritmética própria), nunca vindos do catálogo.
 */
import { createElement } from "react";
import { createHash } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & { id: string };
const h = vi.hoisted(() => {
  const state = {
    subs: new Map<string, Record<string, unknown> & { id: string }>(),
    charges: new Map<string, Record<string, unknown>>(),
    owner: true,
    salon: { plan: "FREE", accessStatus: "APPROVED" } as Record<string, unknown>,
    professionals: 0,
  };
  const clone = <T,>(v: T): T => (v ? { ...v } : v);
  const tx = {
    $executeRaw: async () => 0,
    $queryRaw: async () => [],
    membership: { findFirst: async () => (state.owner ? { role: "OWNER" } : null) },
    salon: {
      findUniqueOrThrow: async () => ({ ...state.salon }),
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(state.salon, data),
    },
    professional: { count: async () => state.professionals },
    userInvite: { count: async () => 0 },
    user: { findUniqueOrThrow: async () => ({ email: "dono@example.test" }) },
    billingEvent: { upsert: async () => ({}) },
    billingQueue: { upsert: async () => ({}) },
    billingSubscription: {
      findUnique: async ({ where }: { where: { id?: string; salonId_requestKey?: { salonId: string; requestKey: string } } }) => {
        if (where.id) return clone(state.subs.get(where.id) ?? null);
        const k = where.salonId_requestKey!;
        return clone([...state.subs.values()].find(s => s.salonId === k.salonId && s.requestKey === k.requestKey) ?? null);
      },
      findFirst: async ({ where }: { where: { salonId: string; current?: boolean } }) =>
        clone([...state.subs.values()].find(s => s.salonId === where.salonId && (where.current === undefined || s.current === where.current)) ?? null),
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const row = state.subs.get(where.id);
        if (!row) throw new Error("not found");
        return { ...row };
      },
      create: async ({ data }: { data: Record<string, unknown> & { id: string } }) => {
        const row = { providerId: null, providerStatus: null, providerUpdatedAt: null, checkoutUrl: null, creationStartedAt: null, cancelRequestedAt: null,
          cancelledAt: null, paidThrough: null, delinquentSince: null, nextPaymentAt: null, reviewRequired: false, current: true, invoiceOffset: 0, lastSyncedAt: null, ...data };
        state.subs.set(row.id, row);
        return { ...row };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = state.subs.get(where.id)!;
        Object.assign(row, data);
        return { ...row };
      },
    },
    billingCharge: {
      findUnique: async ({ where }: { where: { providerInvoiceId: string } }) => state.charges.get(where.providerInvoiceId) ?? null,
      upsert: async ({ where, create, update }: { where: { providerInvoiceId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const prior = state.charges.get(where.providerInvoiceId);
        const row = prior ? Object.assign(prior, update) : { ...create };
        state.charges.set(where.providerInvoiceId, row);
        return row;
      },
    },
  };
  return { state, tx };
});

vi.mock("../prisma-tenant", () => ({
  withTenant: async (_ctx: unknown, fn: (tx: unknown) => unknown) => fn(h.tx),
  withSalon: async (_salonId: string, fn: (tx: unknown) => unknown) => fn(h.tx),
  withUser: async (_userId: string, fn: (tx: unknown) => unknown) => fn(h.tx),
}));
vi.mock("@/components/billing/navigation", () => ({ goToCheckout: vi.fn() }));

import { applyInvoice, applyRemoteSubscription, contract, referenceFor } from "./service";
import { goToCheckout } from "@/components/billing/navigation";
import { SubscriptionPortal } from "@/components/billing/subscription-portal";
import type { BillingSubscription } from "@prisma/client";
import type { RemoteInvoice, RemotePayment, RemoteSubscription } from "./provider";

const ctx = { salonId: "salon-1", userId: "owner-1" };
const BASE = "https://app.example.test";
const OLD_CHECKOUT = "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=pre-antigo";
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

type MpCall = { url: string; method: string; raw?: string };
let mpCalls: MpCall[] = [];
let sellerTags = ["test_user"];
let echoOverride: ((body: Record<string, any>) => Record<string, any>) | null = null;
let portalRoute: ((init: RequestInit) => Promise<Response>) | null = null;
let cancelRoute: ((init: RequestInit) => Promise<Response>) | null = null;
let portalGet: unknown = { subscription: null };

function installFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    if (url.startsWith("https://api.mercadopago.com")) {
      mpCalls.push({ url, method, raw: typeof init.body === "string" ? init.body : undefined });
      const path = url.slice("https://api.mercadopago.com".length);
      if (path === "/users/me") return new Response(JSON.stringify({ id: 123, site_id: "MLB", tags: sellerTags }));
      if (path === "/preapproval" && method === "POST") {
        const body = JSON.parse(String(init.body));
        const n = mpCalls.filter(c => c.method === "POST").length;
        const echo = { id: `pre-${n}`, collector_id: 123, external_reference: body.external_reference, status: "pending",
          init_point: `https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=pre-${n}`,
          last_modified: `2026-10-03T12:00:${String(n % 60).padStart(2, "0")}.000-03:00`, auto_recurring: { ...body.auto_recurring } };
        return new Response(JSON.stringify(echoOverride ? echoOverride(echo) : echo));
      }
      return new Response("{}", { status: 404 });
    }
    if (url.startsWith("/api/billing/subscriptions")) {
      if (method === "POST" && portalRoute) return portalRoute(init);
      return new Response(JSON.stringify(portalGet));
    }
    if (url.startsWith("/api/billing/sync")) return new Response("{}", { status: 202 });
    if (url.startsWith("/api/billing/cancel") && method === "POST" && cancelRoute) return cancelRoute(init);
    throw new Error(`Rede bloqueada no teste: ${url}`);
  }));
}
const posts = () => mpCalls.filter(c => c.method === "POST" && c.url.endsWith("/preapproval"));

function setEnv(mode: "test" | "live" = "test") {
  vi.stubEnv("MERCADOPAGO_BILLING_ENABLED", "true");
  vi.stubEnv("MERCADOPAGO_MODE", mode);
  vi.stubEnv("MERCADOPAGO_COLLECTOR_ID", "123");
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "test-only-token");
  vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "test-only-secret");
  vi.stubEnv("APP_ENV", mode === "live" ? "production" : "test");
  vi.stubEnv("VERCEL_ENV", mode === "live" ? "production" : "preview");
  vi.stubEnv("NEXTAUTH_URL", BASE);
  vi.stubEnv("MERCADOPAGO_CHECKOUT_PAUSED", "false");
  vi.stubEnv("MERCADOPAGO_PLAN_CHANGES_ENABLED", "false");
}
function resetDb() {
  h.state.subs.clear(); h.state.charges.clear(); h.state.owner = true; h.state.professionals = 0;
  h.state.salon = { plan: "FREE", accessStatus: "APPROVED" };
  mpCalls = []; sellerTags = ["test_user"]; echoOverride = null;
}
beforeEach(() => { setEnv(); resetDb(); installFetch(); portalRoute = null; cancelRoute = null; portalGet = { subscription: null }; });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.mocked(goToCheckout).mockClear(); try { sessionStorage.clear(); } catch { /* jsdom */ } });

/** Formata centavos inteiros como o JSON deveria serializar em reais (sem float). */
function reaisJson(cents: number) {
  const int = Math.trunc(cents / 100); const frac = cents % 100;
  if (frac === 0) return String(int);
  return frac % 10 === 0 ? `${int}.${frac / 10}` : `${int}.${String(frac).padStart(2, "0")}`;
}

type Case = { plan: "INDIVIDUAL" | "TEAM" | "TEAM_PLUS" | "TEAM_MAX"; cycle: "MONTHLY" | "ANNUAL"; extraAgendas: number; cents: number; amount: number; reason: string; agendas: number };
// Tabela literal aprovada (catálogo 2026-10-02). A descrição (reason) traz a capacidade TOTAL contratada,
// inclusive as agendas adicionais: um contrato de 12 agendas nunca é descrito como "10 agendas".
const CASES: Case[] = [
  { plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0, cents: 3990, amount: 39.9, reason: "Everflair Individual · 1 agenda — mensal", agendas: 1 },
  { plan: "INDIVIDUAL", cycle: "ANNUAL", extraAgendas: 0, cents: 39900, amount: 399, reason: "Everflair Individual · 1 agenda — anual", agendas: 1 },
  { plan: "TEAM", cycle: "MONTHLY", extraAgendas: 0, cents: 7990, amount: 79.9, reason: "Everflair Essencial · 3 agendas — mensal", agendas: 3 },
  { plan: "TEAM", cycle: "ANNUAL", extraAgendas: 0, cents: 77900, amount: 779, reason: "Everflair Essencial · 3 agendas — anual", agendas: 3 },
  { plan: "TEAM_PLUS", cycle: "MONTHLY", extraAgendas: 0, cents: 9990, amount: 99.9, reason: "Everflair Equipe · 5 agendas — mensal", agendas: 5 },
  { plan: "TEAM_PLUS", cycle: "ANNUAL", extraAgendas: 0, cents: 95900, amount: 959, reason: "Everflair Equipe · 5 agendas — anual", agendas: 5 },
  { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 0, cents: 14990, amount: 149.9, reason: "Everflair Equipe · 10 agendas — mensal", agendas: 10 },
  { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 1, cents: 16990, amount: 169.9, reason: "Everflair Equipe · 11 agendas — mensal", agendas: 11 },
  { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 2, cents: 18990, amount: 189.9, reason: "Everflair Equipe · 12 agendas — mensal", agendas: 12 },
  { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 50, cents: 114990, amount: 1149.9, reason: "Everflair Equipe · 60 agendas — mensal", agendas: 60 },
  { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 100, cents: 214990, amount: 2149.9, reason: "Everflair Equipe · 110 agendas — mensal", agendas: 110 },
  { plan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: 0, cents: 143900, amount: 1439, reason: "Everflair Equipe · 10 agendas — anual", agendas: 10 },
  { plan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: 1, cents: 163100, amount: 1631, reason: "Everflair Equipe · 11 agendas — anual", agendas: 11 },
  { plan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: 2, cents: 182300, amount: 1823, reason: "Everflair Equipe · 12 agendas — anual", agendas: 12 },
  { plan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: 50, cents: 1103900, amount: 11039, reason: "Everflair Equipe · 60 agendas — anual", agendas: 60 },
  { plan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: 100, cents: 2063900, amount: 20639, reason: "Everflair Equipe · 110 agendas — anual", agendas: 110 },
];

describe("POST /preapproval de uma nova assinatura", () => {
  it.each(CASES)("$plan $cycle +$extraAgendas → R$ $amount", async c => {
    const key = uuid();
    const sub = await contract(ctx, { plan: c.plan, cycle: c.cycle, extraAgendas: c.extraAgendas }, key);
    expect(posts()).toHaveLength(1);
    const call = posts()[0];
    expect(call.url).toBe("https://api.mercadopago.com/preapproval");
    // Corpo exato enviado: nada além do que o plano define, sem start_date (cobrança imediata).
    expect(JSON.parse(call.raw!)).toEqual({
      reason: c.reason,
      external_reference: `ef:salon-1:${sub.id}`,
      payer_email: "dono@example.test",
      auto_recurring: { frequency: c.cycle === "ANNUAL" ? 12 : 1, frequency_type: "months", transaction_amount: c.amount, currency_id: "BRL" },
      back_url: `${BASE}/api/billing/return`,
      status: "pending",
    });
    // Serialização textual do valor (sem resíduo de ponto flutuante).
    expect(call.raw).toContain(`"transaction_amount":${reaisJson(c.cents)},`);
    // Contrato persistido no catálogo novo, com o mesmo valor do checkout.
    expect(sub).toMatchObject({ planCode: c.plan, cycle: c.cycle, amountCents: c.cents, currency: "BRL", agendaLimit: c.agendas,
      intervalMonths: c.cycle === "ANNUAL" ? 12 : 1, catalogVersion: "2026-10-02", providerId: "pre-1", reviewRequired: false,
      checkoutUrl: "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=pre-1" });
    // Verificação da conta recebedora antes do POST.
    expect(mpCalls[0].url).toBe("https://api.mercadopago.com/users/me");
  });

  it("serializa exatamente todos os valores alcançáveis do Equipe · 10 agendas com 0..100 adicionais", async () => {
    for (const cycle of ["MONTHLY", "ANNUAL"] as const) {
      for (let n = 0; n <= 100; n++) {
        resetDb();
        const cents = cycle === "MONTHLY" ? 14990 + n * 2000 : 143900 + n * 19200;
        const sub = await contract(ctx, { plan: "TEAM_MAX", cycle, extraAgendas: n }, uuid());
        const raw = posts()[0].raw!;
        expect(raw).toContain(`"transaction_amount":${reaisJson(cents)},`);
        const sent = JSON.parse(raw).auto_recurring.transaction_amount as number;
        expect(Math.round(sent * 100)).toBe(cents);
        expect(sub.amountCents).toBe(cents);
        expect(sub.agendaLimit).toBe(10 + n);
      }
    }
  });

  it("o valor vem só do servidor: entrada do cliente com preço, moeda ou adicionais inválidos é recusada sem chamar o Mercado Pago", async () => {
    const bad: unknown[] = [
      { plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0, amountCents: 1 },
      { plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0, currency: "USD" },
      { plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0, transaction_amount: 0.01 },
      { plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 1 },
      { plan: "TEAM_PLUS", cycle: "ANNUAL", extraAgendas: 2 },
      { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 101 },
      { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: -1 },
      { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 1.5 },
      { plan: "TEAM_MAX", cycle: "WEEKLY", extraAgendas: 0 },
      { plan: "PRO", cycle: "MONTHLY", extraAgendas: 0 },
    ];
    for (const input of bad) await expect(contract(ctx, input, uuid())).rejects.toThrow();
    expect(mpCalls).toHaveLength(0);
    expect(h.state.subs.size).toBe(0);
  });

  it("e-mail do pagador vem do usuário no banco e somente o proprietário contrata", async () => {
    h.state.owner = false;
    await expect(contract(ctx, { plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0 }, uuid())).rejects.toThrow("OWNER_REQUIRED");
    expect(mpCalls).toHaveLength(0);
  });

  it("repetição com a mesma chave e o mesmo plano não cria um segundo checkout", async () => {
    const key = uuid();
    const first = await contract(ctx, { plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0 }, key);
    const again = await contract(ctx, { plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0 }, key);
    expect(again.id).toBe(first.id);
    expect(posts()).toHaveLength(1);
    // Impressão digital = SHA-256 da cotação (inclui catálogo e valor), calculada aqui de forma independente.
    const expected = createHash("sha256").update(JSON.stringify({ plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0, catalogVersion: "2026-10-02",
      label: "Individual", currency: "BRL", amountCents: 3990, agendaLimit: 1, intervalMonths: 1 })).digest("hex");
    expect(first.fingerprint).toBe(expected);
  });

  it("[defesa] se o Mercado Pago devolver outro valor na criação, a assinatura entra em revisão, mas o link ainda é devolvido", async () => {
    echoOverride = echo => ({ ...echo, auto_recurring: { ...echo.auto_recurring, transaction_amount: 59.9 } });
    const sub = await contract(ctx, { plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0 }, uuid());
    expect(sub.reviewRequired).toBe(true);
    // Comportamento observado: a rota /api/billing/subscriptions devolve checkoutUrl mesmo com reviewRequired.
    expect(sub.checkoutUrl).toBe("https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=pre-1");
  });
});

/** Assinatura pendente criada ANTES da troca de preço (catálogo 2026-09-13), nunca paga. */
function stalePending(over: Partial<Row> = {}) {
  const id = "11111111-1111-4111-8111-111111111111";
  const row: Row = { id, salonId: "salon-1", requestKey: "22222222-2222-4222-8222-222222222222",
    fingerprint: createHash("sha256").update(JSON.stringify({ plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0, catalogVersion: "2026-09-13",
      label: "Individual", currency: "BRL", amountCents: 5990, agendaLimit: 1, intervalMonths: 1 })).digest("hex"),
    catalogVersion: "2026-09-13", planCode: "INDIVIDUAL", cycle: "MONTHLY", currency: "BRL", amountCents: 5990, agendaLimit: 1, intervalMonths: 1,
    mode: "test", collectorId: "123", payerEmail: "dono@example.test", legacyPlan: "FREE", providerId: "pre-antigo", providerStatus: "pending",
    providerUpdatedAt: new Date("2026-10-01T12:00:00Z"), checkoutUrl: OLD_CHECKOUT, creationStartedAt: new Date("2026-10-01T12:00:00Z"),
    cancelRequestedAt: null, cancelledAt: null, paidThrough: null, delinquentSince: null, nextPaymentAt: null, reviewRequired: false, current: true,
    invoiceOffset: 0, lastSyncedAt: null, ...over };
  h.state.subs.set(id, row);
  return row;
}

describe("checkout pendente aberto antes da troca de preço", () => {
  it("o servidor NÃO reaproveita nem cria outro: nova chave recebe SUBSCRIPTION_EXISTS e a pendência antiga continua em R$ 59,90", async () => {
    const stale = stalePending();
    await expect(contract(ctx, { plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0 }, uuid())).rejects.toThrow("SUBSCRIPTION_EXISTS");
    expect(posts()).toHaveLength(0);
    expect(h.state.subs.size).toBe(1);
    expect(h.state.subs.get(stale.id)).toMatchObject({ amountCents: 5990, catalogVersion: "2026-09-13", checkoutUrl: OLD_CHECKOUT, current: true });
  });

  it("mesma chave de idempotência da tentativa antiga: a cotação nova tem outra impressão digital → IDEMPOTENCY_MISMATCH", async () => {
    stalePending();
    await expect(contract(ctx, { plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0 }, "22222222-2222-4222-8222-222222222222")).rejects.toThrow("IDEMPOTENCY_MISMATCH");
    expect(posts()).toHaveLength(0);
  });

  it("Equipe · 10 + 2 adicionais pendente no preço antigo (R$ 179,90) também bloqueia a nova contratação", async () => {
    stalePending({ planCode: "TEAM_MAX", amountCents: 17990, agendaLimit: 12, fingerprint: "antiga" });
    await expect(contract(ctx, { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 2 }, uuid())).rejects.toThrow("SUBSCRIPTION_EXISTS");
    expect(posts()).toHaveLength(0);
  });

  it("depois de cancelar a tentativa antiga, a nova contratação sai em R$ 39,90 no catálogo novo", async () => {
    const stale = stalePending({ cancelRequestedAt: new Date("2026-10-02T10:00:00Z"), cancelledAt: new Date("2026-10-02T10:01:00Z"), providerStatus: "cancelled" });
    const sub = await contract(ctx, { plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0 }, uuid());
    expect(JSON.parse(posts()[0].raw!).auto_recurring.transaction_amount).toBe(39.9);
    expect(sub).toMatchObject({ amountCents: 3990, catalogVersion: "2026-10-02", current: true });
    expect(h.state.subs.get(stale.id)!.current).toBe(false);
  });

  it("se o cliente concluir o checkout antigo, a cobrança de R$ 59,90 é aceita (termos persistidos) e se repete a cada mês", async () => {
    const stale = stalePending();
    const remote = remoteFor(stale, 59.9);
    await applyInvoice(stale as unknown as BillingSubscription, remote, invoiceFor(remote, 59.9), paymentFor(59.9));
    expect(h.state.charges.get("inv-1")).toMatchObject({ amountCents: 5990, status: "approved" });
  });

  it("na tela, a tentativa não paga de R$ 59,90 aparece como desatualizada: o card Individual mostra R$ 39,90 com 'Atualizar para o novo preço' e o checkout antigo não é oferecido", async () => {
    portalGet = { subscription: { id: "11111111-1111-4111-8111-111111111111", plan: "INDIVIDUAL", cycle: "MONTHLY", amountCents: 5990, agendaLimit: 1, state: "UNPAID",
      paidThrough: null, nextPaymentAt: null, cancelRequestedAt: null, cancelledAt: null, reviewRequired: false, checkoutUrl: OLD_CHECKOUT,
      providerStatus: "pending", lastSyncedAt: null, charges: [], renewalCancellationStatus: "AVAILABLE", changesAvailable: false } };
    render(createElement(SubscriptionPortal, { salonId: "salon-1", email: "dono@example.test", timezone: "America/Sao_Paulo" }));
    // Cartão do topo: valor persistido da tentativa, aviso de que o preço mudou e atualização para o preço atual.
    expect(await screen.findByText("R$ 59,90/mês · cobrança mensal pelo Mercado Pago")).toBeVisible();
    expect(screen.getByText("O preço deste plano mudou")).toBeVisible();
    expect(screen.getByText("Sua contratação ainda não foi paga e foi criada pelo preço anterior, de R$ 59,90/mês. Hoje este plano custa R$ 39,90/mês.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Atualizar para o novo preço" })).toBeEnabled();
    expect(screen.queryByText("Falta concluir o pagamento")).toBeNull();
    // Card do seletor: preço do catálogo novo, marcado "Escolhido", com a atualização no lugar do checkout antigo.
    const card = screen.getByRole("article", { name: "Individual" });
    expect(within(card).getByText(/^R\$\s39,90$/)).toBeVisible();
    expect(within(card).getByText("Escolhido")).toBeVisible();
    expect(within(card).getByText("Preço atual. Sua tentativa, ainda não paga, foi criada a R$ 59,90/mês.")).toBeVisible();
    expect(within(card).getByRole("button", { name: "Atualizar para o novo preço: Individual" })).toBeEnabled();
    expect(within(card).queryByRole("link", { name: /Continuar pagamento/ })).toBeNull();
    // O checkout antigo de R$ 59,90 não é oferecido em nenhum ponto da tela.
    expect(screen.queryByRole("link", { name: /Continuar pagamento/ })).toBeNull();
    expect(screen.queryAllByRole("link").map(link => link.getAttribute("href"))).not.toContain(OLD_CHECKOUT);
  });

  it("'Atualizar para o novo preço' encerra a tentativa antiga sem cobrança e o novo checkout vai ao Mercado Pago por R$ 39,90", async () => {
    const stale = stalePending();
    const view = { id: stale.id, plan: "INDIVIDUAL", cycle: "MONTHLY", amountCents: 5990, agendaLimit: 1, state: "UNPAID",
      paidThrough: null, nextPaymentAt: null, cancelRequestedAt: null, cancelledAt: null, reviewRequired: false, checkoutUrl: OLD_CHECKOUT,
      providerStatus: "pending", lastSyncedAt: null, charges: [], renewalCancellationStatus: "AVAILABLE", changesAvailable: false };
    portalGet = { subscription: view };
    let cancelBody: unknown = null;
    cancelRoute = async init => {
      cancelBody = JSON.parse(String(init.body));
      // Servidor: o Mercado Pago confirmou o encerramento da tentativa antiga, sem cobrança.
      Object.assign(h.state.subs.get(stale.id)!, { cancelRequestedAt: new Date("2026-10-03T12:00:00Z"), cancelledAt: new Date("2026-10-03T12:00:01Z"), providerStatus: "cancelled" });
      portalGet = { subscription: { ...view, cancelRequestedAt: "2026-10-03T12:00:00.000Z", cancelledAt: "2026-10-03T12:00:01.000Z", providerStatus: "cancelled",
        renewalCancellationStatus: "CANCELLED", checkoutUrl: null } };
      return new Response(JSON.stringify({ status: "CANCELLED", paidThrough: null }));
    };
    let sentBody: unknown = null;
    portalRoute = async init => {
      sentBody = JSON.parse(String(init.body));
      const key = new Headers(init.headers).get("Idempotency-Key")!;
      const sub = await contract(ctx, sentBody, key);
      return new Response(JSON.stringify({ id: sub.id, checkoutUrl: sub.checkoutUrl, state: "UNPAID", providerStatus: sub.providerStatus }), { status: 202 });
    };
    render(createElement(SubscriptionPortal, { salonId: "salon-1", email: "dono@example.test", timezone: "America/Sao_Paulo" }));
    fireEvent.click(await screen.findByRole("button", { name: "Atualizar para o novo preço" }));
    // Revisão: a tentativa anterior é encerrada antes; o novo valor é o da tabela atual.
    let dialog = await screen.findByRole("dialog", { name: "Atualizar para o novo preço" });
    expect(within(dialog).getByText("A tentativa anterior foi criada a R$ 59,90 por mês e não foi paga. Primeiro, confirme o encerramento dela no Mercado Pago, sem nenhuma cobrança. Depois, siga para o pagamento pelo valor atual.")).toBeVisible();
    expect(within(dialog).getByText("Individual · 1 agenda")).toBeVisible();
    const amountLine = within(dialog).getByText("por mês", { exact: false, selector: "span" }).parentElement!;
    expect(amountLine.firstChild!.textContent).toMatch(/^R\$\s39,90$/);
    expect(within(dialog).queryByRole("button", { name: /Ir para pagamento/ })).toBeNull();
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar cancelamento da tentativa anterior" })); });
    expect(cancelBody).toEqual({ subscriptionId: "11111111-1111-4111-8111-111111111111" });
    // Nenhum checkout novo antes de o encerramento ser confirmado.
    expect(posts()).toHaveLength(0);
    dialog = screen.getByRole("dialog", { name: "Atualizar para o novo preço" });
    const pay = await within(dialog).findByRole("button", { name: /Ir para pagamento/ });
    expect(dialog).toHaveTextContent(/Encerrar a tentativa de Individual · 1 agenda no Mercado Pago — confirmado\./);
    await act(async () => { fireEvent.click(pay); });
    await waitFor(() => expect(goToCheckout).toHaveBeenCalledTimes(1));
    expect(sentBody).toEqual({ plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0 });
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(posts()[0].raw!)).toMatchObject({ reason: "Everflair Individual · 1 agenda — mensal",
      auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 39.9, currency_id: "BRL" } });
    expect(posts()[0].raw).toContain(`"transaction_amount":39.9,`);
    expect(goToCheckout).toHaveBeenCalledWith("https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=pre-1");
    // A tentativa antiga fica encerrada com o valor antigo preservado; o contrato atual é o do catálogo novo.
    expect(h.state.subs.get(stale.id)).toMatchObject({ amountCents: 5990, catalogVersion: "2026-09-13", providerStatus: "cancelled", current: false });
    const created = [...h.state.subs.values()].filter(row => row.id !== stale.id);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ planCode: "INDIVIDUAL", cycle: "MONTHLY", amountCents: 3990, catalogVersion: "2026-10-02", current: true, providerId: "pre-1" });
  });
});

function remoteFor(sub: Row, amount: number, over: Partial<RemoteSubscription> = {}): RemoteSubscription {
  return { id: String(sub.providerId), collector_id: "123", external_reference: referenceFor(sub as { salonId: string; id: string }), status: "authorized",
    payer_id: "payer-9", last_modified: "2026-10-03T12:00:00.000Z", next_payment_date: null,
    auto_recurring: { frequency: Number(sub.intervalMonths), frequency_type: "months", currency_id: "BRL", transaction_amount: amount }, ...over } as RemoteSubscription;
}
function invoiceFor(remote: RemoteSubscription, amount: number, over: Partial<RemoteInvoice> = {}): RemoteInvoice {
  return { id: "inv-1", preapproval_id: remote.id, debit_date: "2026-10-03T12:00:00.000Z", currency_id: "BRL", transaction_amount: amount,
    last_modified: "2026-10-03T12:00:05.000Z", payment: { id: "pay-1", status: "approved" }, ...over };
}
function paymentFor(amount: number, over: Partial<RemotePayment> = {}): RemotePayment {
  return { id: "pay-1", collector_id: "123", currency_id: "BRL", transaction_amount: amount, status: "approved", date_last_updated: "2026-10-03T12:00:05.000Z",
    date_approved: "2026-10-03T12:00:05.000Z", live_mode: false, external_reference: null, payer: { id: "payer-9" }, ...over };
}
function newIndividual(over: Partial<Row> = {}) {
  const row: Row = { id: "33333333-3333-4333-8333-333333333333", salonId: "salon-1", requestKey: "k", fingerprint: "f", catalogVersion: "2026-10-02",
    planCode: "INDIVIDUAL", cycle: "MONTHLY", currency: "BRL", amountCents: 3990, agendaLimit: 1, intervalMonths: 1, mode: "test", collectorId: "123",
    payerEmail: "dono@example.test", legacyPlan: "FREE", providerId: "pre-novo", providerStatus: "authorized", providerUpdatedAt: null, checkoutUrl: null,
    creationStartedAt: new Date(), cancelRequestedAt: null, cancelledAt: null, paidThrough: null, delinquentSince: null, nextPaymentAt: null,
    reviewRequired: false, current: true, invoiceOffset: 0, lastSyncedAt: null, ...over };
  h.state.subs.set(row.id, row);
  return row;
}

describe("conferência do pagamento de uma nova assinatura Individual (R$ 39,90)", () => {
  it("aceita R$ 39,90 BRL do recebedor, pagador e preapproval corretos e libera um mês", async () => {
    const sub = newIndividual();
    const remote = remoteFor(sub, 39.9);
    await applyInvoice(sub as unknown as BillingSubscription, remote, invoiceFor(remote, 39.9), paymentFor(39.9));
    expect(h.state.charges.get("inv-1")).toMatchObject({ amountCents: 3990, status: "approved", providerPaymentId: "pay-1",
      periodStart: new Date("2026-10-03T12:00:00.000Z"), periodEnd: new Date("2026-11-03T12:00:00.000Z") });
    expect(h.state.subs.get(sub.id)!.paidThrough).toEqual(new Date("2026-11-03T12:00:00.000Z"));
    expect(h.state.salon.plan).toBe("PRO");
  });

  it("anual R$ 399 libera 12 meses", async () => {
    const sub = newIndividual({ cycle: "ANNUAL", amountCents: 39900, intervalMonths: 12 });
    const remote = remoteFor(sub, 399);
    await applyInvoice(sub as unknown as BillingSubscription, remote, invoiceFor(remote, 399), paymentFor(399));
    expect(h.state.subs.get(sub.id)!.paidThrough).toEqual(new Date("2027-10-03T12:00:00.000Z"));
  });

  const rejections: [string, () => [Partial<RemoteSubscription>, Partial<RemoteInvoice>, Partial<RemotePayment>, number?], string][] = [
    ["pagamento com valor antigo R$ 59,90", () => [{}, {}, { transaction_amount: 59.9 }], "PAYMENT_MISMATCH"],
    ["pagamento de 1 centavo a menos", () => [{}, {}, { transaction_amount: 39.89 }], "PAYMENT_MISMATCH"],
    ["fatura com valor diferente", () => [{}, { transaction_amount: 59.9 }, {}], "INVOICE_MISMATCH"],
    ["preapproval no Mercado Pago com valor antigo", () => [{ auto_recurring: { frequency: 1, frequency_type: "months", currency_id: "BRL", transaction_amount: 59.9 } }, {}, {}], "PROVIDER_CONTRACT_MISMATCH"],
    ["preapproval anual para contrato mensal", () => [{ auto_recurring: { frequency: 12, frequency_type: "months", currency_id: "BRL", transaction_amount: 39.9 } }, {}, {}], "PROVIDER_CONTRACT_MISMATCH"],
    ["preapproval em USD", () => [{ auto_recurring: { frequency: 1, frequency_type: "months", currency_id: "USD", transaction_amount: 39.9 } }, {}, {}], "PROVIDER_CONTRACT_MISMATCH"],
    ["fatura em USD", () => [{}, { currency_id: "USD" }, {}], "INVOICE_MISMATCH"],
    ["pagamento em USD", () => [{}, {}, { currency_id: "USD" }], "PAYMENT_MISMATCH"],
    ["outro recebedor no pagamento", () => [{}, {}, { collector_id: "999" }], "PAYMENT_MISMATCH"],
    ["outro recebedor no preapproval", () => [{ collector_id: "999" }, {}, {}], "PROVIDER_IDENTITY_MISMATCH"],
    ["outro pagador", () => [{}, {}, { payer: { id: "intruso" } }], "PAYMENT_MISMATCH"],
    ["pagamento de outra fatura", () => [{}, {}, { id: "pay-outro" }], "PAYMENT_MISMATCH"],
    ["fatura de outro preapproval", () => [{}, { preapproval_id: "pre-outro" }, {}], "INVOICE_MISMATCH"],
    ["referência externa de outra assinatura", () => [{ external_reference: "ef:salon-1:44444444-4444-4444-8444-444444444444" }, {}, {}], "PROVIDER_IDENTITY_MISMATCH"],
    ["referência de outro salão", () => [{ external_reference: "ef:salon-2:33333333-3333-4333-8333-333333333333" }, {}, {}], "PROVIDER_IDENTITY_MISMATCH"],
  ];
  it.each(rejections)("recusa: %s", async (_label, build, code) => {
    const sub = newIndividual();
    const [r, i, p] = build();
    const remote = { ...remoteFor(sub, 39.9), ...r } as RemoteSubscription;
    await expect(applyInvoice(sub as unknown as BillingSubscription, remote, invoiceFor(remote, 39.9, i), paymentFor(39.9, p))).rejects.toThrow(code);
    expect(h.state.charges.size).toBe(0);
    expect(h.state.subs.get(sub.id)!.paidThrough).toBeNull();
  });

  it("ambiente: contrato live recusa pagamento de teste; contrato de teste não é aceito em configuração live", async () => {
    vi.unstubAllEnvs(); setEnv("live");
    const live = newIndividual({ mode: "live" });
    const remote = remoteFor(live, 39.9);
    await expect(applyInvoice(live as unknown as BillingSubscription, remote, invoiceFor(remote, 39.9), paymentFor(39.9, { live_mode: false }))).rejects.toThrow("PAYMENT_MISMATCH");
    const test = newIndividual({ id: "55555555-5555-4555-8555-555555555555", mode: "test" });
    const remote2 = remoteFor(test, 39.9);
    await expect(applyInvoice(test as unknown as BillingSubscription, remote2, invoiceFor(remote2, 39.9), paymentFor(39.9))).rejects.toThrow("PROVIDER_IDENTITY_MISMATCH");
    expect(h.state.charges.size).toBe(0);
  });

  it("modo teste com live_mode=true só é aceito se a conta recebedora for test_user", async () => {
    const sub = newIndividual();
    const remote = remoteFor(sub, 39.9);
    sellerTags = [];
    await expect(applyInvoice(sub as unknown as BillingSubscription, remote, invoiceFor(remote, 39.9), paymentFor(39.9, { live_mode: true }))).rejects.toThrow("SELLER_ACCOUNT_MISMATCH");
    expect(h.state.charges.size).toBe(0);
  });

  it("preapproval com valor divergente marca revisão ao sincronizar (não libera acesso)", async () => {
    const sub = newIndividual({ providerUpdatedAt: null });
    await applyRemoteSubscription(sub as unknown as BillingSubscription, remoteFor(sub, 59.9));
    expect(h.state.subs.get(sub.id)!.reviewRequired).toBe(true);
    expect(h.state.subs.get(sub.id)!.paidThrough).toBeNull();
  });
});

describe("texto da tela antes do redirecionamento = valor enviado ao Mercado Pago", () => {
  const screens: { intent: { plan: Case["plan"]; cycle: Case["cycle"]; extraAgendas: number }; title: string; price: RegExp; suffix: string; amount: number }[] = [
    { intent: { plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0 }, title: "Individual · 1 agenda", price: /^R\$\s39,90$/, suffix: "por mês", amount: 39.9 },
    { intent: { plan: "INDIVIDUAL", cycle: "ANNUAL", extraAgendas: 0 }, title: "Individual · 1 agenda", price: /^R\$\s399$/, suffix: "a cada 12 meses", amount: 399 },
    { intent: { plan: "TEAM", cycle: "ANNUAL", extraAgendas: 0 }, title: "Essencial · 3 agendas", price: /^R\$\s779$/, suffix: "a cada 12 meses", amount: 779 },
    { intent: { plan: "TEAM_PLUS", cycle: "MONTHLY", extraAgendas: 0 }, title: "Equipe · 5 agendas", price: /^R\$\s99,90$/, suffix: "por mês", amount: 99.9 },
    { intent: { plan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: 2 }, title: "Equipe · 12 agendas", price: /^R\$\s1\.823$/, suffix: "a cada 12 meses", amount: 1823 },
    { intent: { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 100 }, title: "Equipe · 110 agendas", price: /^R\$\s2\.149,90$/, suffix: "por mês", amount: 2149.9 },
    { intent: { plan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: 100 }, title: "Equipe · 110 agendas", price: /^R\$\s20\.639$/, suffix: "a cada 12 meses", amount: 20639 },
  ];
  it.each(screens)("$title $intent.cycle: diálogo mostra o mesmo valor que vai no POST", async s => {
    let sentBody: unknown = null;
    portalRoute = async init => {
      sentBody = JSON.parse(String(init.body));
      const key = new Headers(init.headers).get("Idempotency-Key")!;
      const sub = await contract(ctx, sentBody, key);
      return new Response(JSON.stringify({ id: sub.id, checkoutUrl: sub.checkoutUrl, state: "UNPAID", providerStatus: sub.providerStatus }), { status: 202 });
    };
    render(createElement(SubscriptionPortal, { salonId: "salon-1", email: "dono@example.test", timezone: "America/Sao_Paulo", initial: s.intent }));
    fireEvent.click(await screen.findByRole("button", { name: "Continuar com este plano" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(s.title)).toBeVisible();
    const amountLine = within(dialog).getByText(s.suffix, { exact: false, selector: "span" }).parentElement!;
    expect(amountLine.firstChild!.textContent).toMatch(s.price);
    expect(amountLine.textContent).toContain(s.suffix);
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: /Ir para pagamento/ })); });
    await waitFor(() => expect(goToCheckout).toHaveBeenCalledTimes(1));
    expect(sentBody).toEqual(s.intent);
    expect(JSON.parse(posts()[0].raw!).auto_recurring).toMatchObject({ transaction_amount: s.amount, currency_id: "BRL", frequency: s.intent.cycle === "ANNUAL" ? 12 : 1 });
    expect(goToCheckout).toHaveBeenCalledWith("https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=pre-1");
  });
});
