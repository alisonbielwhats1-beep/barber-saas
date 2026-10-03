// @vitest-environment jsdom
/**
 * Validação de lacunas (crítico de completude). Cobre superfícies que as cinco
 * auditorias anteriores não exercitaram:
 *   G1. Rota do webhook /api/webhooks/mercadopago (assinatura, recurso, tipo).
 *   G2. Pagamento de diferença (efu:) e termos vigentes com a flag de trocas desligada.
 *   G3. Pagamento de diferença fora da cotação, após cancelamento, duplicado ou estornado.
 *   G4. Data de débito da renovação depois de uma troca (upgrade/redução/ciclo):
 *       débito antecipado em até 3 dias, recusa antecipada e reconciliação do worker.
 *   G5. Telas/HQ em estados secundários: GRACE/RESTRICTED e mudança de ciclo no HQ.
 *
 * Banco e Mercado Pago são simulados em memória. Nenhuma chamada externa.
 * Valores esperados são literais em centavos ou aritmética própria.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { createHmac } from "node:crypto";
import { cleanup, render, screen, within } from "@testing-library/react";

type Row = Record<string, any>;
const hoisted = vi.hoisted(() => ({ db: null as any }));

vi.mock("server-only", () => ({}));
vi.mock("next/server", async importOriginal => ({ ...(await importOriginal<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("../prisma-tenant", () => ({
  withSalon: async (_salonId: string, fn: (tx: unknown) => unknown) => fn(hoisted.db.tx),
  withTenant: async (_ctx: unknown, fn: (tx: unknown) => unknown) => fn(hoisted.db.tx),
  withUser: async (_user: string, fn: (tx: unknown) => unknown) => fn(hoisted.db.tx),
}));
vi.mock("./provider", async importOriginal => {
  const actual = await importOriginal<typeof import("./provider")>();
  return { ...actual, mpRequest: vi.fn(), verifySellerAccount: vi.fn(async () => undefined),
    getSubscription: vi.fn(), getInvoice: vi.fn(), getPayment: vi.fn(), listInvoices: vi.fn(), searchSubscriptions: vi.fn() };
});
vi.mock("./http", async () => {
  const { BillingError } = await import("./catalog");
  const { z } = await import("zod");
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  return {
    ownerContext: vi.fn(),
    readBillingBody: async (request: Request) => { try { return JSON.parse(await request.text()); } catch { throw new BillingError("INVALID_JSON", 400); } },
    billingJson: json,
    // Same mapping as src/lib/billing/http.ts:132-136.
    billingFailure: (e: unknown) => json({ error: e instanceof BillingError ? e.code : e instanceof z.ZodError ? "INVALID_REQUEST" : "BILLING_UNAVAILABLE" },
      e instanceof BillingError ? e.status : e instanceof z.ZodError ? 400 : 503),
  };
});
vi.mock("./worker", async importOriginal => {
  const actual = await importOriginal<typeof import("./worker")>();
  return { ...actual, receiveWebhook: vi.fn(actual.receiveWebhook), drainTriggeredSubscription: vi.fn(async () => undefined), runBillingWorker: vi.fn(async () => ({ processed: 0, failed: 0 })) };
});

import * as mp from "./provider";
import * as worker from "./worker";
import { applyInvoice, contract } from "./service";
import { applyUpgradePayment } from "./change-payments";
import { syncPlanChanges } from "./change-worker";
import { currentTerms } from "./change-terms";
import { effectiveEntitlement } from "./entitlements";
import { syncBillingToHq } from "./hq-sync";
import { POST as webhookPOST } from "@/app/api/webhooks/mercadopago/route";
import { CurrentPlanCard } from "@/components/billing/current-plan-card";
import { SubscriptionPortal } from "@/components/billing/subscription-portal";
import type { SubscriptionView } from "./presentation";

// ─── Fixtures ────────────────────────────────────────────────────────────────
const OLD = "2026-09-13", NEW = "2026-10-02";
const SALON = "salon-gap";
const SUB_ID = "0b9f1c7e-1d2a-4c3b-9e8f-222222222222";
const CHANGE_ID = "c1a2b3c4-d5e6-4f70-8a9b-333333333333";
const PERIOD_START = new Date("2026-09-13T17:42:29.000Z");
const PAID_THROUGH = new Date("2026-10-13T17:42:29.000Z");
const QUOTED_AT = new Date("2026-10-03T12:00:00.000Z");
const EXPIRES_AT = new Date("2026-10-03T12:15:00.000Z");
// Individual antigo 5990 → Essencial 7990, 03/10 12:00Z: ceil(2000 × (13/10 17:42:29 − 03/10 12:00) / 30 dias).
const REMAINING_MS = PAID_THROUGH.getTime() - QUOTED_AT.getTime();
const TOTAL_MS = PAID_THROUGH.getTime() - PERIOD_START.getTime();
const DUE = Math.ceil((2000 * REMAINING_MS) / TOTAL_MS);

const terms = (plan: string, cycle: string, amountCents: number, agendaLimit: number, catalogVersion: string) =>
  ({ plan, cycle, amountCents, agendaLimit, intervalMonths: cycle === "ANNUAL" ? 12 : 1, catalogVersion });
const FROM = terms("INDIVIDUAL", "MONTHLY", 5990, 1, OLD);
const TO = terms("TEAM", "MONTHLY", 7990, 3, NEW);

function sub(over: Row = {}): Row {
  return {
    id: SUB_ID, salonId: SALON, requestKey: "req-old", fingerprint: "fp", catalogVersion: OLD, currency: "BRL",
    planCode: "INDIVIDUAL", cycle: "MONTHLY", amountCents: 5990, agendaLimit: 1, intervalMonths: 1,
    mode: "test", collectorId: "123", payerEmail: "dona@example.test", legacyPlan: "FREE",
    providerId: "pre-gap", providerStatus: "authorized", providerUpdatedAt: new Date("2026-09-13T17:42:31.000Z"),
    nextPaymentAt: PAID_THROUGH, checkoutUrl: null, paidThrough: PAID_THROUGH, delinquentSince: null,
    cancelRequestedAt: null, cancelledAt: null, reviewRequired: false, current: true, creationStartedAt: PERIOD_START,
    lastSyncedAt: null, invoiceOffset: 0, createdAt: PERIOD_START, ...over,
  };
}
function upgrade(over: Row = {}): Row {
  return {
    id: CHANGE_ID, salonId: SALON, subscriptionId: SUB_ID, requestKey: "chg-1", actorUserId: "owner-1", kind: "UPGRADE",
    fromTerms: FROM, toTerms: TO, amountDueCents: DUE, state: "AWAITING_PAYMENT", confirmedAt: QUOTED_AT,
    quotedAt: QUOTED_AT, expiresAt: EXPIRES_AT, periodStart: PERIOD_START, periodEnd: PAID_THROUGH, effectiveAt: QUOTED_AT,
    preferenceId: "pref-1", checkoutUrl: "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-1", creationStartedAt: QUOTED_AT,
    providerPaymentId: null, paidAt: null, activatedAt: null, providerStartedAt: null, providerSyncedAt: null,
    cancelledAt: null, replacementSubscriptionId: null, lastError: null, updatedAt: QUOTED_AT, ...over,
  };
}
const remote = (amountCents: number, over: Row = {}) => ({
  id: "pre-gap", collector_id: "123", external_reference: `ef:${SALON}:${SUB_ID}`, status: "authorized", payer_id: "999",
  last_modified: "2026-10-03T12:00:00.000Z", next_payment_date: PAID_THROUGH.toISOString(),
  auto_recurring: { frequency: 1, frequency_type: "months", currency_id: "BRL", transaction_amount: amountCents / 100 }, ...over,
});
const upgradePayment = (id: string, approvedAt: string, over: Row = {}) => ({
  id, collector_id: "123", currency_id: "BRL", transaction_amount: DUE / 100, status: "approved",
  date_last_updated: approvedAt, date_approved: approvedAt, live_mode: false, external_reference: `efu:${SALON}:${CHANGE_ID}`,
  payer: { id: "999" }, ...over,
});

// ─── Minimal in-memory Prisma double (same approach as the other validation suites) ─
function matches(row: Row, where: Row = {}): boolean {
  for (const [key, cond] of Object.entries(where)) {
    if (key === "NOT") { if (matches(row, cond)) return false; continue; }
    // Prisma OR: at least one alternative must match (applyInvoice uses it to apply the early-matched revision).
    if (key === "OR") { if (!(cond as Row[]).some(alternative => matches(row, alternative))) return false; continue; }
    const value = row[key];
    if (cond === null) { if (value != null) return false; continue; }
    if (cond instanceof Date) { if (!(value instanceof Date) || value.getTime() !== cond.getTime()) return false; continue; }
    if (typeof cond === "object") {
      if (value === undefined && !("not" in cond) && !("in" in cond) && !Object.keys(cond).some(k => ["lte", "gte", "gt", "lt", "startsWith"].includes(k))) {
        if (!matches(row, cond)) return false; continue;
      }
      if ("in" in cond && !cond.in.includes(value)) return false;
      if ("not" in cond && (cond.not === null ? value == null : value === cond.not)) return false;
      if ("lte" in cond && !(value != null && value <= cond.lte)) return false;
      if ("lt" in cond && !(value != null && value < cond.lt)) return false;
      if ("gte" in cond && !(value != null && value >= cond.gte)) return false;
      if ("gt" in cond && !(value != null && value > cond.gt)) return false;
      if ("startsWith" in cond && !(typeof value === "string" && value.startsWith(cond.startsWith))) return false;
      continue;
    }
    if (value !== cond) return false;
  }
  return true;
}
function sortRows(rows: Row[], orderBy: any) {
  const keys: [string, string][] = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).map((o: Row) => Object.entries(o)[0] as [string, string]);
  return [...rows].sort((a, b) => {
    for (const [k, dir] of keys) { const x = a[k]?.valueOf?.() ?? a[k], y = b[k]?.valueOf?.() ?? b[k]; if (x === y) continue; return (x < y ? -1 : 1) * (dir === "desc" ? -1 : 1); }
    return 0;
  });
}
function model(rows: Row[], extend: (row: Row, args: Row) => Row = row => row) {
  const first = (args: Row = {}) => { const row = sortRows(rows.filter(r => matches(r, args.where)), args.orderBy)[0]; return row ? extend({ ...row }, args) : null; };
  return {
    rows,
    findFirst: vi.fn(async (args?: Row) => first(args)),
    findUnique: vi.fn(async (args?: Row) => first(args)),
    findFirstOrThrow: vi.fn(async (args?: Row) => { const r = first(args); if (!r) throw new Error("not found"); return r; }),
    findUniqueOrThrow: vi.fn(async (args?: Row) => { const r = first(args); if (!r) throw new Error("not found"); return r; }),
    findMany: vi.fn(async (args: Row = {}) => sortRows(rows.filter(r => matches(r, args.where)), args.orderBy).map(r => extend({ ...r }, args))),
    count: vi.fn(async (args: Row = {}) => rows.filter(r => matches(r, args.where)).length),
    create: vi.fn(async ({ data }: Row) => { const row = { ...data }; rows.push(row); return { ...row }; }),
    update: vi.fn(async ({ where, data }: Row) => { const row = rows.find(r => matches(r, where)); if (!row) throw new Error("update: not found"); Object.assign(row, data); return { ...row }; }),
    updateMany: vi.fn(async ({ where, data }: Row) => { const hit = rows.filter(r => matches(r, where)); hit.forEach(r => Object.assign(r, data)); return { count: hit.length }; }),
    upsert: vi.fn(async ({ where, create, update }: Row) => { const row = rows.find(r => matches(r, where)); if (row) { Object.assign(row, update); return { ...row }; } const created = { ...create }; rows.push(created); return { ...created }; }),
    aggregate: vi.fn(async () => ({ _count: { _all: 0 }, _max: { providerUpdatedAt: null } })),
  };
}
function makeDb(subs: Row[], seed: { changes?: Row[]; charges?: Row[] } = {}) {
  const changes = seed.changes ?? [], charges = seed.charges ?? [], inbox: Row[] = [], queue: Row[] = [];
  const salon = { id: SALON, name: "Salão Lacunas", phone: null, segment: "barbearia", plan: "PRO", accessStatus: "APPROVED" };
  const hq = { subscriptions: [] as Row[] };
  const tx = {
    $executeRaw: vi.fn(async () => 0), $queryRaw: vi.fn(async () => []),
    billingSubscription: model(subs),
    billingPlanChange: model(changes, (row, args) => ({ ...row,
      ...(args.include?.subscription ? { subscription: subs.find(s => s.id === row.subscriptionId) ?? null } : {}),
      ...(args.include?.replacement ? { replacement: subs.find(s => s.id === row.replacementSubscriptionId) ?? null } : {}) })),
    billingCharge: model(charges), billingEvent: model([]), billingQueue: model(queue), billingInbox: model(inbox),
    salon: { findUniqueOrThrow: vi.fn(async () => ({ ...salon })), update: vi.fn(async ({ data }: Row) => Object.assign(salon, data)) },
    membership: { findFirst: vi.fn(async () => ({ role: "OWNER", user: { name: "Dona", email: "dona@example.test" } })) },
    professional: { count: vi.fn(async () => 1) },
    userInvite: { count: vi.fn(async () => 0) },
    user: { findUniqueOrThrow: vi.fn(async () => ({ email: "dona@example.test" })) },
    hqAccounts: { upsert: vi.fn(async () => ({ id: "hq-account" })) },
    hqCustomers: { upsert: vi.fn(async ({ create }: Row) => ({ id: "hq-customer", ...create })) },
    hqSubscriptions: { findUnique: vi.fn(async () => null), upsert: vi.fn(async ({ create }: Row) => { hq.subscriptions.push(create); return { id: "hq-sub", ...create }; }) },
    hqActivities: { create: vi.fn(async ({ data }: Row) => data) },
    hqPayments: { upsert: vi.fn() },
  };
  hoisted.db = { tx, subs, changes, charges, inbox, queue, salon, hq };
  return hoisted.db;
}
function stubEnv(changes: boolean, extra: Record<string, string> = {}) {
  vi.stubEnv("MERCADOPAGO_BILLING_ENABLED", "true"); vi.stubEnv("MERCADOPAGO_MODE", "test"); vi.stubEnv("MERCADOPAGO_COLLECTOR_ID", "123");
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "test-only"); vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "test-secret"); vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("VERCEL_ENV", ""); vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000"); vi.stubEnv("MERCADOPAGO_CHECKOUT_PAUSED", "");
  vi.stubEnv("MERCADOPAGO_PLAN_CHANGES_ENABLED", changes ? "true" : "false"); vi.stubEnv("MERCADOPAGO_PLAN_CHANGES_PAUSED", "");
  for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v);
}
const clock = (iso: string) => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(iso)); };
// clearAllMocks keeps implementations; getSubscription gets per-test answers, so reset it explicitly.
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); vi.mocked(mp.getSubscription).mockReset(); });

it("pré-condição: diferença do caso a) Individual antigo → Essencial em 03/10 12:00Z = 683 centavos", () => {
  // Período 13/09 17:42:29 → 13/10 17:42:29 (30 dias = 2.592.000 s); restam 10d05h42m29s = 884.549 s.
  // 2000 × 884.549 / 2.592.000 = 682,52… → arredonda para cima: 683.
  expect(REMAINING_MS).toBe(((10 * 24 + 5) * 3600 + 42 * 60 + 29) * 1000);
  expect(TOTAL_MS).toBe(30 * 86400 * 1000);
  expect(DUE).toBe(683);
});

// ─── G1. Rota do webhook ─────────────────────────────────────────────────────
describe("G1 · POST /api/webhooks/mercadopago", () => {
  const sign = (resourceId: string, requestId: string, ts: string, secret = "test-secret") =>
    createHmac("sha256", secret).update(`id:${resourceId.toLowerCase()};request-id:${requestId};ts:${ts};`).digest("hex");
  function request(resourceId: string, body: Row, headers: Record<string, string>) {
    return new Request(`http://localhost:3000/api/webhooks/mercadopago?data.id=${resourceId}&type=${body.type}`, {
      method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
    });
  }
  const signed = (resourceId: string, secret?: string) => ({ "x-request-id": "req-abc", "x-signature": `ts=1759492800,v1=${sign(resourceId, "req-abc", "1759492800", secret)}` });

  it.each(["payment", "subscription_preapproval", "subscription_authorized_payment"])("assinatura válida + tipo %s → 200 e encaminha (tipo, recurso, id da notificação)", async type => {
    stubEnv(true);
    vi.mocked(worker.receiveWebhook).mockResolvedValueOnce(null);
    const res = await webhookPOST(request("12345", { id: 987, type, data: { id: "12345" } }, signed("12345")));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(worker.receiveWebhook).toHaveBeenCalledWith(type, "12345", "987");
  });
  it("assinatura com segredo errado → 401 INVALID_SIGNATURE sem processar", async () => {
    stubEnv(true);
    const res = await webhookPOST(request("12345", { id: 1, type: "payment", data: { id: "12345" } }, signed("12345", "outro-segredo")));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "INVALID_SIGNATURE" });
    expect(worker.receiveWebhook).not.toHaveBeenCalled();
  });
  it("sem x-signature → 401 sem processar", async () => {
    stubEnv(true);
    const res = await webhookPOST(request("12345", { id: 1, type: "payment", data: { id: "12345" } }, { "x-request-id": "req-abc" }));
    expect(res.status).toBe(401);
    expect(worker.receiveWebhook).not.toHaveBeenCalled();
  });
  it("assinatura de outro recurso (data.id da URL ≠ assinado) → 401", async () => {
    stubEnv(true);
    const res = await webhookPOST(request("12345", { id: 1, type: "payment", data: { id: "12345" } }, signed("99999")));
    expect(res.status).toBe(401);
    expect(worker.receiveWebhook).not.toHaveBeenCalled();
  });
  it("corpo com data.id diferente do recurso assinado → 400 RESOURCE_MISMATCH", async () => {
    stubEnv(true);
    const res = await webhookPOST(request("12345", { id: 1, type: "payment", data: { id: "55555" } }, signed("12345")));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "RESOURCE_MISMATCH" });
    expect(worker.receiveWebhook).not.toHaveBeenCalled();
  });
  it("tipo não suportado (merchant_order) → 400 INVALID_REQUEST", async () => {
    stubEnv(true);
    const res = await webhookPOST(request("12345", { id: 1, type: "merchant_order", data: { id: "12345" } }, signed("12345")));
    expect(res.status).toBe(400);
    expect(worker.receiveWebhook).not.toHaveBeenCalled();
  });
  it("cobrança desligada → 503 BILLING_DISABLED", async () => {
    vi.stubEnv("MERCADOPAGO_BILLING_ENABLED", "false");
    const res = await webhookPOST(request("12345", { id: 1, type: "payment", data: { id: "12345" } }, signed("12345")));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "BILLING_DISABLED" });
  });
});

// ─── G2. Flag de trocas desligada depois de trocas existirem ─────────────────
describe("G2 · pagamento de diferença (efu:) e termos vigentes x MERCADOPAGO_PLAN_CHANGES_ENABLED", () => {
  const pay = upgradePayment("pay-up-1", "2026-10-03T12:05:00.000Z");
  it("flag ligada: webhook 'payment' efu: grava inbox e enfileira a assinatura da troca", async () => {
    stubEnv(true);
    const db = makeDb([sub()], { changes: [upgrade()] });
    vi.mocked(mp.getPayment).mockResolvedValueOnce(pay as any);
    const target = await worker.receiveWebhook("payment", "pay-up-1", "n-1");
    expect(target).toEqual({ salonId: SALON, subscriptionId: SUB_ID });
    expect(db.inbox).toHaveLength(1);
    expect(db.inbox[0]).toMatchObject({ topic: "payment", resourceId: "pay-up-1", subscriptionId: SUB_ID });
    expect(db.queue).toHaveLength(1);
  });
  it("comportamento atual: com a flag desligada, o mesmo pagamento aprovado é descartado (retorna null, sem inbox/fila/revisão)", async () => {
    stubEnv(false);
    const db = makeDb([sub()], { changes: [upgrade()] });
    vi.mocked(mp.getPayment).mockResolvedValueOnce(pay as any);
    const target = await worker.receiveWebhook("payment", "pay-up-1", "n-1");
    expect(target).toBeNull();
    expect(db.inbox).toHaveLength(0);
    expect(db.queue).toHaveLength(0);
    expect(db.subs[0].reviewRequired).toBe(false);
    // E a reconciliação periódica também não olha a troca com a flag desligada.
    await syncPlanChanges(db.subs[0] as any);
    expect(mp.getSubscription).not.toHaveBeenCalled();
    expect(db.changes[0].state).toBe("AWAITING_PAYMENT");
  });

  const applied = () => upgrade({ state: "APPLIED", providerPaymentId: "pay-up-1", paidAt: QUOTED_AT, activatedAt: QUOTED_AT, providerStartedAt: QUOTED_AT, providerSyncedAt: QUOTED_AT });
  it("flag ligada: upgrade pago vale para capacidade (3) e preço (7990)", async () => {
    stubEnv(true); clock("2026-10-05T12:00:00.000Z");
    const db = makeDb([sub()], { changes: [applied()] });
    const e = await effectiveEntitlement(db.tx as any, SALON, "FREE");
    expect(e).toMatchObject({ maxProfessionals: 3, priceCents: 7990 });
    expect(await currentTerms(db.tx as any, db.subs[0] as any)).toEqual(TO);
  });
  it("comportamento atual: com a flag desligada, o upgrade pago deixa de valer — capacidade 1 e preço 5990", async () => {
    stubEnv(false); clock("2026-10-05T12:00:00.000Z");
    const db = makeDb([sub()], { changes: [applied()] });
    const e = await effectiveEntitlement(db.tx as any, SALON, "FREE");
    expect(e).toMatchObject({ maxProfessionals: 1, priceCents: 5990 });
  });
  const renewalInvoice = (amount: number, debit: Date) => ({ id: "inv-r", preapproval_id: "pre-gap", debit_date: debit.toISOString(), currency_id: "BRL", transaction_amount: amount, last_modified: debit.toISOString(), payment: { id: "pay-r", status: "approved" } });
  const renewalPayment = (amount: number) => ({ id: "pay-r", collector_id: "123", currency_id: "BRL", transaction_amount: amount, status: "approved", date_last_updated: "2026-10-13T18:00:00.000Z", date_approved: "2026-10-13T18:00:00.000Z", live_mode: false, payer: { id: "999" } });
  it("flag ligada: renovação de R$ 79,90 após o upgrade é aceita e estende o período", async () => {
    stubEnv(true); clock("2026-10-14T12:00:00.000Z");
    const db = makeDb([sub()], { changes: [applied()] });
    await applyInvoice(db.subs[0] as any, remote(7990) as any, renewalInvoice(79.9, PAID_THROUGH) as any, renewalPayment(79.9) as any);
    expect(db.charges[0]).toMatchObject({ amountCents: 7990, status: "approved" });
    expect(db.subs[0].paidThrough.toISOString()).toBe("2026-11-13T17:42:29.000Z");
  });
  it("comportamento atual: com a flag desligada, a renovação de R$ 79,90 (já cobrada pelo MP) é recusada e não registra o período pago", async () => {
    stubEnv(false); clock("2026-10-14T12:00:00.000Z");
    const db = makeDb([sub()], { changes: [applied()] });
    await expect(applyInvoice(db.subs[0] as any, remote(7990) as any, renewalInvoice(79.9, PAID_THROUGH) as any, renewalPayment(79.9) as any)).rejects.toThrow("PROVIDER_CONTRACT_MISMATCH");
    expect(db.charges).toHaveLength(0);
    expect(db.subs[0].paidThrough).toEqual(PAID_THROUGH);
  });
});

// ─── G3. Pagamento de diferença em estados de borda ──────────────────────────
describe("G3 · applyUpgradePayment fora do caminho feliz (cliente cobrado → revisão, nunca perda silenciosa)", () => {
  async function pay(change: Row, payment: Row, now = "2026-10-03T12:20:00.000Z") {
    stubEnv(true); clock(now);
    const db = makeDb([sub()], { changes: [change] });
    await applyUpgradePayment(db.subs[0] as any, { ...change } as any, remote(5990) as any, payment as any);
    return db;
  }
  it("caminho feliz (controle): pago às 12:05 dentro da cotação → APPLYING, capacidade liberada, cobrança 683, vencimento mantido", async () => {
    const db = await pay(upgrade(), upgradePayment("pay-1", "2026-10-03T12:05:00.000Z"), "2026-10-03T12:06:00.000Z");
    expect(db.changes[0]).toMatchObject({ state: "APPLYING", providerPaymentId: "pay-1" });
    expect(db.changes[0].activatedAt).toBeInstanceOf(Date);
    expect(db.charges[0]).toMatchObject({ amountCents: 683, status: "approved", providerInvoiceId: `upgrade:${CHANGE_ID}:pay-1`, periodEnd: PAID_THROUGH });
    expect(db.subs[0]).toMatchObject({ paidThrough: PAID_THROUGH, reviewRequired: false });
  });
  it("pago às 12:16 (após expirar a cotação de 15 min) → REVIEW UPGRADE_PAYMENT_OUTSIDE_QUOTE; cobrança registrada; capacidade NÃO liberada", async () => {
    const db = await pay(upgrade(), upgradePayment("pay-1", "2026-10-03T12:16:00.000Z"));
    expect(db.changes[0]).toMatchObject({ state: "REVIEW", lastError: "UPGRADE_PAYMENT_OUTSIDE_QUOTE", activatedAt: null });
    expect(db.subs[0]).toMatchObject({ reviewRequired: true, paidThrough: PAID_THROUGH });
    expect(db.charges[0]).toMatchObject({ amountCents: 683, status: "approved" });
    expect(await currentTerms(db.tx as any, db.subs[0] as any)).toEqual(FROM);
  });
  it("pago às 12:05 mas o dono já tinha pedido cancelamento (CANCEL_REQUESTED) → REVIEW, sem liberar capacidade", async () => {
    const db = await pay(upgrade({ state: "CANCEL_REQUESTED", checkoutUrl: null }), upgradePayment("pay-1", "2026-10-03T12:05:00.000Z"));
    expect(db.changes[0]).toMatchObject({ state: "REVIEW", lastError: "UPGRADE_PAYMENT_OUTSIDE_QUOTE", activatedAt: null });
    expect(db.subs[0].reviewRequired).toBe(true);
  });
  it("segundo pagamento aprovado da mesma preferência → REVIEW UPGRADE_DUPLICATE_PAYMENT; as duas cobranças ficam no livro; vencimento não muda", async () => {
    stubEnv(true); clock("2026-10-03T12:06:00.000Z");
    const db = makeDb([sub()], { changes: [upgrade()] });
    await applyUpgradePayment(db.subs[0] as any, { ...db.changes[0] } as any, remote(5990) as any, upgradePayment("pay-1", "2026-10-03T12:05:00.000Z") as any);
    await applyUpgradePayment(db.subs[0] as any, { ...db.changes[0] } as any, remote(5990) as any, upgradePayment("pay-2", "2026-10-03T12:05:30.000Z") as any);
    expect(db.changes[0]).toMatchObject({ state: "REVIEW", lastError: "UPGRADE_DUPLICATE_PAYMENT", providerPaymentId: "pay-1" });
    expect(db.charges.map((c: Row) => [c.providerPaymentId, c.amountCents])).toEqual([["pay-1", 683], ["pay-2", 683]]);
    expect(db.subs[0]).toMatchObject({ reviewRequired: true, paidThrough: PAID_THROUGH });
  });
  it("estorno total depois de liberado → REVIEW UPGRADE_PAYMENT_REVERSED; capacidade continua liberada até a conferência (registro do comportamento)", async () => {
    stubEnv(true); clock("2026-10-03T12:06:00.000Z");
    const db = makeDb([sub()], { changes: [upgrade()] });
    await applyUpgradePayment(db.subs[0] as any, { ...db.changes[0] } as any, remote(5990) as any, upgradePayment("pay-1", "2026-10-03T12:05:00.000Z") as any);
    await applyUpgradePayment(db.subs[0] as any, { ...db.changes[0] } as any, remote(5990) as any,
      upgradePayment("pay-1", "2026-10-03T12:05:00.000Z", { date_last_updated: "2026-10-04T09:00:00.000Z", transaction_amount_refunded: 6.83 }) as any);
    expect(db.changes[0]).toMatchObject({ state: "REVIEW", lastError: "UPGRADE_PAYMENT_REVERSED" });
    expect(db.charges[0]).toMatchObject({ status: "refunded", refundedCents: 683 });
    expect(db.subs[0].reviewRequired).toBe(true);
    expect(db.changes[0].activatedAt).toBeInstanceOf(Date); // currentTerms segue em Essencial até a plataforma conferir
  });
  it("pagamento de R$ 6,83 com referência de OUTRA troca → PAYMENT_MISMATCH sem gravar nada", async () => {
    stubEnv(true); clock("2026-10-03T12:06:00.000Z");
    const db = makeDb([sub()], { changes: [upgrade()] });
    await expect(applyUpgradePayment(db.subs[0] as any, { ...db.changes[0] } as any, remote(5990) as any,
      upgradePayment("pay-1", "2026-10-03T12:05:00.000Z", { external_reference: `efu:${SALON}:d1a2b3c4-d5e6-4f70-8a9b-444444444444` }) as any)).rejects.toThrow("PAYMENT_MISMATCH");
    expect(db.charges).toHaveLength(0);
  });
});

// ─── G4. Data de débito da renovação após troca ──────────────────────────────
describe("G4 · débito da renovação após troca: até 3 dias antes do vencimento vale o preço da revisão seguinte (invoiceRevision)", () => {
  const inv = (amount: number, debit: Date, over: Row = {}) => ({ id: "inv-r", preapproval_id: "pre-gap", debit_date: debit.toISOString(), currency_id: "BRL", transaction_amount: amount, last_modified: "2026-10-13T18:00:00.000Z", payment: { id: "pay-r", status: "approved" }, ...over });
  const payR = (amount: number, over: Row = {}) => ({ id: "pay-r", collector_id: "123", currency_id: "BRL", transaction_amount: amount, status: "approved", date_last_updated: "2026-10-13T18:00:00.000Z", date_approved: "2026-10-13T18:00:00.000Z", live_mode: false, payer: { id: "999" }, ...over });
  // Vencimento (PAID_THROUGH) em 13/10 17:42:29Z.
  const ONE_SECOND_EARLY = new Date("2026-10-13T17:42:28.000Z");
  const THREE_DAYS_EARLY = new Date("2026-10-10T17:42:29.000Z");
  const BEYOND_TOLERANCE = new Date("2026-10-10T17:42:28.000Z"); // 3 dias + 1 s antes
  const NOW = new Date("2026-10-14T12:00:00.000Z");
  const PAID_AT = new Date("2026-10-13T18:00:00.000Z");
  // Redução agendada no catálogo novo: Equipe 5 (9990) → Essencial (7990), já enviada ao MP.
  const teamPlus = () => sub({ catalogVersion: NEW, planCode: "TEAM_PLUS", amountCents: 9990, agendaLimit: 5 });
  const reduction = (over: Row = {}) => upgrade({ kind: "SCHEDULED", state: "SCHEDULED", amountDueCents: 0, fromTerms: terms("TEAM_PLUS", "MONTHLY", 9990, 5, NEW), toTerms: TO,
    effectiveAt: PAID_THROUGH, providerStartedAt: QUOTED_AT, providerSyncedAt: QUOTED_AT, preferenceId: null, checkoutUrl: null, ...over });

  it("redução: débito exatamente no vencimento a R$ 79,90 → aceito, troca APPLIED, período estendido", async () => {
    stubEnv(true); clock("2026-10-14T12:00:00.000Z");
    const db = makeDb([teamPlus()], { changes: [reduction()] });
    await applyInvoice(db.subs[0] as any, remote(7990) as any, inv(79.9, PAID_THROUGH) as any, payR(79.9) as any);
    expect(db.charges[0]).toMatchObject({ amountCents: 7990, status: "approved" });
    expect(db.changes[0].state).toBe("APPLIED");
    expect(db.subs[0].paidThrough.toISOString()).toBe("2026-11-13T17:42:29.000Z");
  });
  it("redução: débito de R$ 79,90 datado 1 s antes do vencimento → aceito com os termos novos; troca APPLIED e período contado a partir do débito", async () => {
    stubEnv(true); clock("2026-10-14T12:00:00.000Z");
    const db = makeDb([teamPlus()], { changes: [reduction()] });
    await applyInvoice(db.subs[0] as any, remote(7990) as any, inv(79.9, ONE_SECOND_EARLY) as any, payR(79.9) as any);
    expect(db.charges).toHaveLength(1);
    expect(db.charges[0]).toMatchObject({ amountCents: 7990, status: "approved", periodStart: ONE_SECOND_EARLY, paidAt: PAID_AT });
    expect(db.charges[0].periodEnd.toISOString()).toBe("2026-11-13T17:42:28.000Z");
    expect(db.subs[0].paidThrough.toISOString()).toBe("2026-11-13T17:42:28.000Z");
    expect(db.subs[0].reviewRequired).toBe(false);
    expect(db.changes[0]).toMatchObject({ state: "APPLIED", activatedAt: NOW, paidAt: PAID_AT });
    expect(await currentTerms(db.tx as any, db.subs[0] as any)).toEqual(TO);
  });
  it("redução, fronteira: débito de R$ 79,90 exatamente 3 dias antes do vencimento → ainda aceito com os termos novos", async () => {
    stubEnv(true); clock("2026-10-14T12:00:00.000Z");
    const db = makeDb([teamPlus()], { changes: [reduction()] });
    await applyInvoice(db.subs[0] as any, remote(7990) as any, inv(79.9, THREE_DAYS_EARLY) as any, payR(79.9) as any);
    expect(db.charges[0]).toMatchObject({ amountCents: 7990, status: "approved", periodStart: THREE_DAYS_EARLY });
    expect(db.subs[0].paidThrough.toISOString()).toBe("2026-11-10T17:42:29.000Z");
    expect(db.changes[0].state).toBe("APPLIED");
  });
  it("controle: débito de R$ 79,90 a 3 dias + 1 s do vencimento (fora da tolerância) → INVOICE_MISMATCH; nada gravado e a troca segue SCHEDULED", async () => {
    stubEnv(true); clock("2026-10-14T12:00:00.000Z");
    const db = makeDb([teamPlus()], { changes: [reduction()] });
    await expect(applyInvoice(db.subs[0] as any, remote(7990) as any, inv(79.9, BEYOND_TOLERANCE) as any, payR(79.9) as any)).rejects.toThrow("INVOICE_MISMATCH");
    expect(db.charges).toHaveLength(0);
    expect(db.changes[0]).toMatchObject({ state: "SCHEDULED", activatedAt: null });
    expect(db.subs[0].paidThrough).toEqual(PAID_THROUGH);
  });
  it("controle: débito 1 s antes do vencimento com valor que não é de nenhum dos termos (R$ 89,90) → INVOICE_MISMATCH; nada gravado", async () => {
    stubEnv(true); clock("2026-10-14T12:00:00.000Z");
    const db = makeDb([teamPlus()], { changes: [reduction()] });
    await expect(applyInvoice(db.subs[0] as any, remote(7990) as any, inv(89.9, ONE_SECOND_EARLY) as any, payR(89.9) as any)).rejects.toThrow("INVOICE_MISMATCH");
    expect(db.charges).toHaveLength(0);
    expect(db.changes[0]).toMatchObject({ state: "SCHEDULED", activatedAt: null });
    expect(db.subs[0].paidThrough).toEqual(PAID_THROUGH);
  });
  it("controle: débito 1 s antes do vencimento ainda pelo preço antigo (R$ 99,90) → aceito com os termos antigos; a redução segue SCHEDULED", async () => {
    stubEnv(true); clock("2026-10-14T12:00:00.000Z");
    const db = makeDb([teamPlus()], { changes: [reduction()] });
    await applyInvoice(db.subs[0] as any, remote(7990) as any, inv(99.9, ONE_SECOND_EARLY) as any, payR(99.9) as any);
    expect(db.charges[0]).toMatchObject({ amountCents: 9990, status: "approved", periodStart: ONE_SECOND_EARLY });
    expect(db.subs[0].paidThrough.toISOString()).toBe("2026-11-13T17:42:28.000Z");
    expect(db.changes[0]).toMatchObject({ state: "SCHEDULED", activatedAt: null });
    expect(await currentTerms(db.tx as any, db.subs[0] as any)).toEqual(terms("TEAM_PLUS", "MONTHLY", 9990, 5, NEW));
  });
  it("redução de mesmo preço (Equipe 10 + 4 antigos → + 3 no catálogo novo, ambos R$ 209,90): débito 1 s antes → aplica a troca em vez de adiá-la um período", async () => {
    stubEnv(true); clock("2026-10-14T12:00:00.000Z");
    const from = terms("TEAM_MAX", "MONTHLY", 20990, 14, OLD), to = terms("TEAM_MAX", "MONTHLY", 20990, 13, NEW);
    const db = makeDb([sub({ catalogVersion: OLD, planCode: "TEAM_MAX", amountCents: 20990, agendaLimit: 14 })], { changes: [reduction({ fromTerms: from, toTerms: to })] });
    await applyInvoice(db.subs[0] as any, remote(20990) as any, inv(209.9, ONE_SECOND_EARLY) as any, payR(209.9) as any);
    expect(db.charges[0]).toMatchObject({ amountCents: 20990, status: "approved", periodStart: ONE_SECOND_EARLY });
    expect(db.changes[0]).toMatchObject({ state: "APPLIED", activatedAt: NOW, paidAt: PAID_AT });
    expect(await currentTerms(db.tx as any, db.subs[0] as any)).toEqual(to);
  });
  const appliedUpgrade = () => upgrade({ state: "APPLIED", providerPaymentId: "pay-up-1", paidAt: QUOTED_AT, activatedAt: QUOTED_AT, providerStartedAt: QUOTED_AT, providerSyncedAt: QUOTED_AT });
  it("upgrade: renovação de R$ 79,90 no vencimento → aceita", async () => {
    stubEnv(true); clock("2026-10-14T12:00:00.000Z");
    const db = makeDb([sub()], { changes: [appliedUpgrade()] });
    await applyInvoice(db.subs[0] as any, remote(7990) as any, inv(79.9, PAID_THROUGH) as any, payR(79.9) as any);
    expect(db.charges[0]).toMatchObject({ amountCents: 7990 });
  });
  it("upgrade: renovação de R$ 79,90 datada 1 s antes do vencimento → aceita com os termos do upgrade (7990) e período contado a partir do débito", async () => {
    stubEnv(true); clock("2026-10-14T12:00:00.000Z");
    const db = makeDb([sub()], { changes: [appliedUpgrade()] });
    await applyInvoice(db.subs[0] as any, remote(7990) as any, inv(79.9, ONE_SECOND_EARLY) as any, payR(79.9) as any);
    expect(db.charges).toHaveLength(1);
    expect(db.charges[0]).toMatchObject({ amountCents: 7990, status: "approved", periodStart: ONE_SECOND_EARLY });
    expect(db.charges[0].periodEnd.toISOString()).toBe("2026-11-13T17:42:28.000Z");
    expect(db.subs[0].paidThrough.toISOString()).toBe("2026-11-13T17:42:28.000Z");
    expect(db.changes[0]).toMatchObject({ kind: "UPGRADE", state: "APPLIED", activatedAt: QUOTED_AT });
  });
  it("sem troca: renovação 1 s antes do vencimento continua aceita (a fronteira só importa com troca)", async () => {
    stubEnv(true); clock("2026-10-14T12:00:00.000Z");
    const db = makeDb([sub()]);
    await applyInvoice(db.subs[0] as any, remote(5990) as any, inv(59.9, ONE_SECOND_EARLY) as any, payR(59.9) as any);
    expect(db.charges[0]).toMatchObject({ amountCents: 5990 });
  });

  // Renovação recusada: a tentativa debitada pouco antes do vencimento já é falha de renovação.
  const rejected = (debit: Date) => [inv(59.9, debit, { payment: { id: "pay-r", status: "rejected" } }), payR(59.9, { status: "rejected", date_approved: null })] as const;
  it.each([
    ["1 s antes do vencimento", ONE_SECOND_EARLY, new Date("2026-10-13T17:42:28.000Z")],
    ["exatamente 3 dias antes do vencimento", THREE_DAYS_EARLY, new Date("2026-10-10T17:42:29.000Z")],
  ] as const)("renovação recusada debitada %s marca a inadimplência desde o débito, sem mexer no período pago", async (_label, debit, since) => {
    stubEnv(true); clock("2026-10-14T12:00:00.000Z");
    const db = makeDb([sub()]);
    const [invoice, payment] = rejected(debit);
    await applyInvoice(db.subs[0] as any, remote(5990) as any, invoice as any, payment as any);
    expect(db.charges[0]).toMatchObject({ status: "rejected", amountCents: 5990, periodStart: debit, paidAt: null });
    expect(db.subs[0]).toMatchObject({ delinquentSince: since, paidThrough: PAID_THROUGH, reviewRequired: false });
  });
  it("controle: renovação recusada debitada 3 dias + 1 s antes do vencimento não marca inadimplência", async () => {
    stubEnv(true); clock("2026-10-14T12:00:00.000Z");
    const db = makeDb([sub()]);
    const [invoice, payment] = rejected(BEYOND_TOLERANCE);
    await applyInvoice(db.subs[0] as any, remote(5990) as any, invoice as any, payment as any);
    expect(db.charges[0]).toMatchObject({ status: "rejected", amountCents: 5990, periodStart: BEYOND_TOLERANCE });
    expect(db.subs[0]).toMatchObject({ delinquentSince: null, paidThrough: PAID_THROUGH });
  });

  // Worker: reconciliações que procuram a cobrança da renovação aceitam início até 3 dias antes do vencimento.
  it("PUT da redução sem confirmação: o débito de R$ 79,90 1 s antes do vencimento é aceito e syncPlanChanges aplica a troca por essa cobrança", async () => {
    stubEnv(true); clock("2026-10-14T12:00:00.000Z");
    const db = makeDb([teamPlus()], { changes: [reduction({ providerSyncedAt: null })] });
    await applyInvoice(db.subs[0] as any, remote(7990) as any, inv(79.9, ONE_SECOND_EARLY) as any, payR(79.9) as any);
    expect(db.charges[0]).toMatchObject({ amountCents: 7990, status: "approved", periodStart: ONE_SECOND_EARLY });
    // Sem confirmação do PUT, a fatura não aplica a troca sozinha.
    expect(db.changes[0]).toMatchObject({ state: "SCHEDULED", providerSyncedAt: null, activatedAt: null });
    vi.mocked(mp.getSubscription).mockResolvedValueOnce(remote(7990) as any);
    await syncPlanChanges({ ...db.subs[0] } as any);
    expect(mp.mpRequest).not.toHaveBeenCalled(); // a recorrência já está em 79,90: nenhum PUT
    expect(db.changes[0]).toMatchObject({ state: "APPLIED", providerSyncedAt: NOW, activatedAt: NOW, paidAt: PAID_AT });
  });
  it("mudança de ciclo: substituta debitada 1 s antes do início agendado é promovida quando o período antigo termina", async () => {
    stubEnv(true); clock("2026-10-14T12:00:00.000Z");
    const REPL = "0b9f1c7e-1d2a-4c3b-9e8f-777777777777";
    const old = sub({ cancelRequestedAt: new Date("2026-10-04T12:00:00.000Z"), cancelledAt: new Date("2026-10-04T12:00:05.000Z"), providerStatus: "cancelled" });
    const replacement = sub({ id: REPL, requestKey: `change:${CHANGE_ID}`, current: false, planCode: "INDIVIDUAL", cycle: "ANNUAL", amountCents: 39900, intervalMonths: 12,
      catalogVersion: NEW, paidThrough: null, nextPaymentAt: null, providerId: "pre-new", providerStatus: "authorized" });
    const cycle = upgrade({ kind: "CYCLE", state: "SCHEDULED", amountDueCents: 0, toTerms: terms("INDIVIDUAL", "ANNUAL", 39900, 1, NEW), replacementSubscriptionId: REPL,
      preferenceId: null, checkoutUrl: null, effectiveAt: PAID_THROUGH, providerSyncedAt: QUOTED_AT });
    const db = makeDb([old, replacement], { changes: [cycle] });
    const newRemote = { ...remote(39900), id: "pre-new", external_reference: `ef:${SALON}:${REPL}`,
      auto_recurring: { frequency: 12, frequency_type: "months", currency_id: "BRL", transaction_amount: 399, start_date: "2026-10-13T17:42:29.000Z" } };
    // Primeira cobrança anual da substituta, 1 s antes do início agendado (13/10 17:42:29Z).
    await applyInvoice(db.subs[1] as any, newRemote as any, inv(399, ONE_SECOND_EARLY, { id: "inv-new", preapproval_id: "pre-new", payment: { id: "pay-new", status: "approved" } }) as any,
      payR(399, { id: "pay-new" }) as any);
    expect(db.charges[0]).toMatchObject({ subscriptionId: REPL, amountCents: 39900, status: "approved", periodStart: ONE_SECOND_EARLY });
    expect(db.subs[1].paidThrough.toISOString()).toBe("2027-10-13T17:42:28.000Z");
    expect(db.subs.map((s: Row) => [s.id, s.current])).toEqual([[SUB_ID, true], [REPL, false]]);
    vi.mocked(mp.getSubscription).mockImplementation(async (id: string) => (id === "pre-new" ? newRemote : remote(5990, { status: "cancelled" })) as any);
    await syncPlanChanges({ ...db.subs[0] } as any);
    expect(mp.mpRequest).not.toHaveBeenCalled();
    expect(db.changes[0]).toMatchObject({ state: "APPLIED", activatedAt: NOW, paidAt: PAID_AT });
    expect(db.subs.map((s: Row) => [s.id, s.current])).toEqual([[SUB_ID, false], [REPL, true]]);
  });
});

// ─── G5. Estados secundários: inadimplência e HQ durante mudança de ciclo ────
describe("G5 · telas e HQ em estados secundários", () => {
  const view = (over: Partial<SubscriptionView>): SubscriptionView => ({
    id: SUB_ID, plan: "INDIVIDUAL", cycle: "MONTHLY", amountCents: 5990, agendaLimit: 1, state: "GRACE",
    paidThrough: "2026-10-13T17:42:29.000Z", nextPaymentAt: "2026-10-13T17:42:29.000Z", cancelRequestedAt: null, cancelledAt: null,
    reviewRequired: false, renewalCancellationStatus: "AVAILABLE", checkoutUrl: "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=pre-gap",
    providerStatus: "authorized", lastSyncedAt: null, changesAvailable: true, changePending: false, change: null, charges: [], ...over,
  });
  const card = (sub: SubscriptionView) => render(createElement(CurrentPlanCard, { subscription: sub, legacy: { label: "Grátis", agendas: 1, free: true }, occupiedAgendas: 1,
    timezone: "America/Sao_Paulo", email: "dona@example.test", accessBlocked: false, returnedFromCheckout: false, refreshing: false, busy: false,
    preparingChangeCheckout: false, onRefresh: () => undefined, onCancelChange: () => undefined }));

  const RESTART = "Se preferir recomeçar, cancele a renovação abaixo e contrate um plano novamente.";
  it.each([["GRACE", false], ["RESTRICTED", true]] as const)("%s: o aviso explica como trocar o cartão em Seu perfil › Assinaturas e leva à ajuda oficial do Mercado Pago", (state, restart) => {
    card(view({ state }));
    const link = screen.getByRole("link", { name: "Como trocar o cartão no Mercado Pago" });
    expect(link).toHaveAttribute("href", "https://www.mercadopago.com.br/ajuda/18157");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(screen.queryByRole("link", { name: /Abrir Mercado Pago/ })).toBeNull();
    expect(screen.getByText(/^No Mercado Pago, abra Seu perfil › Assinaturas, escolha a assinatura Everflair e altere o meio de pagamento\./)).toBeVisible();
    // Só RESTRICTED sugere recomeçar com um plano novo.
    expect(screen.queryAllByText(RESTART)).toHaveLength(restart ? 1 : 0);
    expect(screen.getByText("Próxima cobrança").nextSibling?.textContent).toMatch(/R\$\s59,90$/); // Intl usa espaço não separável
  });
  it.each([
    ["RESTRICTED", "Regularize o pagamento acima para trocar de plano. Se preferir recomeçar, cancele a renovação abaixo e contrate um plano novamente."],
    ["GRACE", "Regularize a situação da assinatura acima para trocar de plano."],
  ] as const)("portal em %s: troca de plano bloqueada com a orientação certa e 'Cancelar renovação' disponível", async (state, reason) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ subscription: view({ state }) }))));
    render(createElement(SubscriptionPortal, { salonId: SALON, email: "dona@example.test", timezone: "America/Sao_Paulo", occupiedAgendas: 1 }));
    const note = await screen.findByText(reason);
    expect(note).toHaveAttribute("role", "note");
    const essencial = screen.getByRole("heading", { name: "Essencial" }).closest("article")!;
    expect(within(essencial).getByRole("button", { name: "Fazer upgrade: Essencial" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar renovação" })).toBeEnabled();
  });
  it("RESTRICTED (inadimplente, sem cancelamento): nova contratação é bloqueada com SUBSCRIPTION_EXISTS, sem chamar o MP", async () => {
    stubEnv(true); clock("2026-10-25T12:00:00.000Z");
    makeDb([sub({ delinquentSince: PAID_THROUGH })]);
    await expect(contract({ salonId: SALON, userId: "owner-1" }, { plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0 }, "e1a2b3c4-d5e6-4f70-8a9b-555555555555")).rejects.toThrow("SUBSCRIPTION_EXISTS");
    expect(mp.mpRequest).not.toHaveBeenCalled();
  });
  it("comportamento atual (HQ): durante a mudança de ciclo (antiga cancelada no MP, período pago até 13/10, substituta agendada), hq_subscriptions fica 'Cancelado' e sai do MRR", async () => {
    stubEnv(true, { MERCADOPAGO_HQ_SYNC_ENABLED: "true" }); clock("2026-10-05T12:00:00.000Z");
    const REPL = "0b9f1c7e-1d2a-4c3b-9e8f-666666666666";
    const replacement = sub({ id: REPL, current: false, planCode: "INDIVIDUAL", cycle: "ANNUAL", amountCents: 39900, intervalMonths: 12, catalogVersion: NEW, paidThrough: null, providerId: "pre-new" });
    const old = sub({ cancelRequestedAt: new Date("2026-10-04T12:00:00.000Z"), cancelledAt: new Date("2026-10-04T12:00:05.000Z"), providerStatus: "cancelled" });
    const cycle = upgrade({ kind: "CYCLE", state: "SCHEDULED", amountDueCents: 0, toTerms: terms("INDIVIDUAL", "ANNUAL", 39900, 1, NEW), replacementSubscriptionId: REPL, preferenceId: null, checkoutUrl: null, effectiveAt: PAID_THROUGH });
    const db = makeDb([old, replacement], { changes: [cycle] });
    await syncBillingToHq(SALON, SUB_ID);
    expect(db.hq.subscriptions[0]).toMatchObject({ status: "Cancelado", billingState: "Cancelada · acesso até o fim pago", amountCents: 5990, interval: "Mensal" });
    // A substituta só é projetada depois de paga; até 13/10 o cliente não aparece como assinatura ativa.
    expect(await syncBillingToHq(SALON, REPL)).toBe(false);
    expect(db.hq.subscriptions).toHaveLength(1);
  });
});
