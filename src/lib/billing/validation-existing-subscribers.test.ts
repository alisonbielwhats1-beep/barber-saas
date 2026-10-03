// @vitest-environment jsdom
/**
 * Validação "assinantes existentes": contratos criados no catálogo 2026-09-13
 * continuam cobrando, exibindo e reativando pelo preço persistido depois da
 * troca de catálogo para 2026-10-02 (Individual R$ 39,90; adicional R$ 20).
 *
 * Tudo aqui usa banco e Mercado Pago simulados em memória. Os valores
 * esperados são literais (centavos) ou aritmética própria, nunca o catálogo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

type Row = Record<string, any>;
const hoisted = vi.hoisted(() => ({ db: null as any, remotes: new Map<string, any>() }));

vi.mock("server-only", () => ({}));
vi.mock("../prisma-tenant", () => ({
  withSalon: async (_salonId: string, fn: (tx: unknown) => unknown) => fn(hoisted.db.tx),
  withTenant: async (_ctx: unknown, fn: (tx: unknown) => unknown) => fn(hoisted.db.tx),
  withUser: async (_user: string, fn: (tx: unknown) => unknown) => fn(hoisted.db.tx),
}));
vi.mock("./provider", async importOriginal => {
  const actual = await importOriginal<typeof import("./provider")>();
  return {
    ...actual,
    mpRequest: vi.fn(), verifySellerAccount: vi.fn(async () => undefined),
    getSubscription: vi.fn(async (id: string) => { const r = hoisted.remotes.get(id); if (!r) throw new Error(`unknown remote ${id}`); return structuredClone(r); }),
    getInvoice: vi.fn(), getPayment: vi.fn(), listInvoices: vi.fn(), searchSubscriptions: vi.fn(),
  };
});
vi.mock("./http", () => ({
  ownerContext: vi.fn(async () => ({ salonId: "salon-old", userId: "owner-1" })),
  readBillingBody: vi.fn(),
  billingJson: (body: unknown, status = 200) => Response.json(body, { status }),
  billingFailure: (e: any) => Response.json({ error: e?.code ?? String(e) }, { status: 500 }),
}));

import * as mp from "./provider";
import { applyInvoice, applyRemoteSubscription, ensureCreated } from "./service";
import { syncSubscription } from "./worker";
import { reactivateRenewal } from "./changes";
import { syncPlanChanges } from "./change-worker";
import { effectiveEntitlement } from "./entitlements";
import { syncBillingToHq } from "./hq-sync";
import { loadPlanBadge } from "./plan-badge";
import { billingTermsSchema, originalTerms, quotePlanChange, sameTerms } from "./change-rules";
import { CATALOG_VERSION } from "./catalog";
import { planBadgeFor, type PlanChangeView, type SubscriptionView } from "./presentation";
import { GET as getSubscriptionRoute } from "@/app/api/billing/subscriptions/route";
import { CurrentPlanCard } from "@/components/billing/current-plan-card";
import { PlanPicker } from "@/components/billing/plan-picker";
import { BillingHistory } from "@/components/billing/billing-history";
import { PlanChangeReview } from "@/components/billing/plan-change-review";
import { SubscriptionPortal } from "@/components/billing/subscription-portal";

// ─── Fixtures ────────────────────────────────────────────────────────────────
const OLD = "2026-09-13";
const SALON = "salon-old";
const SUB_ID = "0b9f1c7e-1d2a-4c3b-9e8f-111111111111";
const REF = `ef:${SALON}:${SUB_ID}`;
const PERIOD_START = new Date("2026-09-13T17:42:29.000Z");
const PAID_THROUGH = new Date("2026-10-13T17:42:29.000Z");

/** Old-catalog contracts exactly as persisted before 2026-10-02. */
const OLD_CONTRACTS = {
  individualMonthly: { planCode: "INDIVIDUAL", cycle: "MONTHLY", amountCents: 5990, agendaLimit: 1, intervalMonths: 1 },
  individualAnnual: { planCode: "INDIVIDUAL", cycle: "ANNUAL", amountCents: 59900, agendaLimit: 1, intervalMonths: 12 },
  // 14990 + 2 × 1500 (old monthly extra)
  teamMax2Monthly: { planCode: "TEAM_MAX", cycle: "MONTHLY", amountCents: 17990, agendaLimit: 12, intervalMonths: 1 },
  // 143900 + 2 × 14400 (old annual extra)
  teamMax2Annual: { planCode: "TEAM_MAX", cycle: "ANNUAL", amountCents: 172700, agendaLimit: 12, intervalMonths: 12 },
} as const;
type OldKey = keyof typeof OLD_CONTRACTS;

function oldSub(key: OldKey, over: Row = {}): Row {
  return {
    id: SUB_ID, salonId: SALON, requestKey: "req-old", fingerprint: "fp-old", catalogVersion: OLD, currency: "BRL",
    ...OLD_CONTRACTS[key],
    mode: "test", collectorId: "123", payerEmail: "dona@example.test", legacyPlan: "FREE",
    providerId: "pre-old", providerStatus: "authorized", providerUpdatedAt: new Date("2026-09-13T17:42:31.000Z"),
    nextPaymentAt: PAID_THROUGH, checkoutUrl: null, paidThrough: PAID_THROUGH, delinquentSince: null,
    cancelRequestedAt: null, cancelledAt: null, reviewRequired: false, current: true, creationStartedAt: PERIOD_START,
    lastSyncedAt: null, invoiceOffset: 0, createdAt: PERIOD_START, ...over,
  };
}
function remoteFor(sub: Row, over: Row = {}, recurring: Row = {}) {
  return {
    id: sub.providerId, collector_id: "123", external_reference: `ef:${sub.salonId}:${sub.id}`, status: "authorized", payer_id: "999",
    last_modified: "2026-10-13T18:00:00.000Z", next_payment_date: "2026-11-13T17:42:29.000Z",
    auto_recurring: { frequency: sub.intervalMonths, frequency_type: "months", currency_id: "BRL", transaction_amount: sub.amountCents / 100, ...recurring },
    ...over,
  };
}
function invoice(amount: number, debit = PAID_THROUGH, over: Row = {}) {
  return { id: "inv-renewal", preapproval_id: "pre-old", debit_date: debit.toISOString(), currency_id: "BRL", transaction_amount: amount,
    last_modified: "2026-10-13T18:00:00.000Z", payment: { id: "pay-renewal", status: "approved" }, ...over };
}
function payment(amount: number, over: Row = {}) {
  return { id: "pay-renewal", collector_id: "123", currency_id: "BRL", transaction_amount: amount, status: "approved",
    date_last_updated: "2026-10-13T18:00:00.000Z", date_approved: "2026-10-13T18:00:00.000Z", live_mode: false, payer: { id: "999" }, ...over };
}
const terms = (plan: string, cycle: string, amountCents: number, agendaLimit: number, catalogVersion = OLD) =>
  ({ plan, cycle, amountCents, agendaLimit, intervalMonths: cycle === "ANNUAL" ? 12 : 1, catalogVersion }) as any;

// ─── Minimal in-memory Prisma double (only what billing code touches) ────────
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
        if (!matches(row, cond)) return false; continue; // compound unique such as salonId_requestKey
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
function makeDb(subs: Row[], seed: { changes?: Row[]; charges?: Row[]; occupied?: number } = {}) {
  const changes = seed.changes ?? [], charges = seed.charges ?? [];
  const salon = { id: SALON, name: "Salão Antigo", phone: null, segment: "barbearia", plan: "PRO", accessStatus: "APPROVED", timezone: "America/Sao_Paulo" };
  const hq = { subscription: null as Row | null, activities: [] as Row[] };
  const tx = {
    $executeRaw: vi.fn(async () => 0), $queryRaw: vi.fn(async () => []),
    billingSubscription: model(subs, (row, args) => args.include?.charges ? { ...row, charges: sortRows(charges.filter(c => c.subscriptionId === row.id), [{ periodStart: "desc" }]) } : row),
    billingPlanChange: model(changes, (row, args) => args.include?.replacement ? { ...row, replacement: subs.find(s => s.id === row.replacementSubscriptionId) ?? null } : row),
    billingCharge: model(charges), billingEvent: model([]), billingQueue: model([]), billingInbox: model([]),
    salon: { findUniqueOrThrow: vi.fn(async () => ({ ...salon })), update: vi.fn(async ({ data }: Row) => Object.assign(salon, data)) },
    membership: { findFirst: vi.fn(async () => ({ role: "OWNER", user: { name: "Dona Antiga", email: "dona@example.test" } })) },
    professional: { count: vi.fn(async () => seed.occupied ?? 1) },
    userInvite: { count: vi.fn(async () => 0) },
    user: { findUniqueOrThrow: vi.fn(async () => ({ email: "dona@example.test" })) },
    hqAccounts: { upsert: vi.fn(async () => ({ id: "hq-account" })) },
    hqCustomers: { upsert: vi.fn(async () => ({ id: "hq-customer" })) },
    hqSubscriptions: { findUnique: vi.fn(async () => null), upsert: vi.fn(async ({ create }: Row) => { hq.subscription = create; return { id: "hq-sub", ...create }; }) },
    hqActivities: { create: vi.fn(async ({ data }: Row) => { hq.activities.push(data); return data; }) },
    hqPayments: { upsert: vi.fn() },
  };
  hoisted.db = { tx, subs, changes, charges, salon, hq };
  return hoisted.db;
}

function stubBillingEnv(changes: boolean) {
  vi.stubEnv("MERCADOPAGO_BILLING_ENABLED", "true"); vi.stubEnv("MERCADOPAGO_MODE", "test"); vi.stubEnv("MERCADOPAGO_COLLECTOR_ID", "123");
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "test-only"); vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "test-secret"); vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("VERCEL_ENV", ""); vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000"); vi.stubEnv("MERCADOPAGO_CHECKOUT_PAUSED", "");
  vi.stubEnv("MERCADOPAGO_PLAN_CHANGES_ENABLED", changes ? "true" : "false"); vi.stubEnv("MERCADOPAGO_PLAN_CHANGES_PAUSED", "");
}
const clock = (iso: string) => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(iso)); };

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); hoisted.remotes.clear(); });

// ─── 1. Termos persistidos não são recalculados pelo catálogo ───────────────
describe("termos do catálogo 2026-09-13", () => {
  it("o catálogo vigente é 2026-10-02 (pré-condição dos cenários)", () => {
    expect(CATALOG_VERSION).toBe("2026-10-02");
  });
  it.each(Object.keys(OLD_CONTRACTS) as OldKey[])("originalTerms preserva valor e versão antigos: %s", key => {
    const sub = oldSub(key);
    const parsed = originalTerms(sub as any);
    expect(parsed).toEqual({ plan: sub.planCode, cycle: sub.cycle, amountCents: OLD_CONTRACTS[key].amountCents, agendaLimit: sub.agendaLimit, intervalMonths: sub.intervalMonths, catalogVersion: OLD });
    // Persisted JSON from BillingPlanChange.fromTerms/toTerms parses identically.
    expect(billingTermsSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });
  it("sameTerms distingue contrato antigo do mesmo plano no catálogo novo (valor e versão)", () => {
    const old = terms("INDIVIDUAL", "MONTHLY", 5990, 1);
    expect(sameTerms(old, { ...old })).toBe(true);
    expect(sameTerms(old, terms("INDIVIDUAL", "MONTHLY", 3990, 1, "2026-10-02"))).toBe(false);
  });
});

// ─── 2. Renovações: fatura e pagamento conferidos contra o preço persistido ─
describe("renovação de assinantes antigos (applyInvoice)", () => {
  beforeEach(() => clock("2026-10-14T12:00:00.000Z"));
  const cases: [OldKey, number, string][] = [
    ["individualMonthly", 59.9, "2026-11-13T17:42:29.000Z"],
    ["individualAnnual", 599, "2027-10-13T17:42:29.000Z"],
    ["teamMax2Monthly", 179.9, "2026-11-13T17:42:29.000Z"],
    ["teamMax2Annual", 1727, "2027-10-13T17:42:29.000Z"],
  ];
  for (const flag of [false, true]) {
    it.each(cases)(`aceita renovação %s de R$ %s (troca de planos ${flag ? "ligada" : "desligada"})`, async (key, amount, nextEnd) => {
      stubBillingEnv(flag);
      const db = makeDb([oldSub(key)]);
      const sub = db.subs[0];
      await applyInvoice({ ...sub } as any, remoteFor(sub) as any, invoice(amount) as any, payment(amount) as any);
      const charge = db.charges.find((c: Row) => c.providerInvoiceId === "inv-renewal");
      expect(charge).toMatchObject({ amountCents: Math.round(amount * 100), status: "approved", periodStart: PAID_THROUGH });
      expect(charge.periodEnd.toISOString()).toBe(nextEnd);
      expect(db.subs[0].paidThrough.toISOString()).toBe(nextEnd);
      expect(db.subs[0].reviewRequired).toBe(false);
      expect(db.salon.plan).toBe("PRO");
    });
  }
  it("rejeita fatura de R$ 39,90 numa assinatura antiga de R$ 59,90 (nunca troca o preço em silêncio)", async () => {
    stubBillingEnv(true);
    const db = makeDb([oldSub("individualMonthly")]);
    const sub = db.subs[0];
    await expect(applyInvoice({ ...sub } as any, remoteFor(sub) as any, invoice(39.9) as any, payment(39.9) as any)).rejects.toThrow("INVOICE_MISMATCH");
    await expect(applyInvoice({ ...sub } as any, remoteFor(sub) as any, invoice(59.9) as any, payment(39.9) as any)).rejects.toThrow("PAYMENT_MISMATCH");
    expect(db.charges).toHaveLength(0);
    expect(db.subs[0].paidThrough).toEqual(PAID_THROUGH);
  });
  it("rejeita adicional antigo repricado: TEAM_MAX+2 cobrado a R$ 189,90 (2 × R$ 20) em vez de R$ 179,90", async () => {
    stubBillingEnv(false);
    const db = makeDb([oldSub("teamMax2Monthly")]);
    const sub = db.subs[0];
    await expect(applyInvoice({ ...sub } as any, remoteFor(sub) as any, invoice(189.9) as any, payment(189.9) as any)).rejects.toThrow("INVOICE_MISMATCH");
  });
  it("recorrência alterada para R$ 39,90 no Mercado Pago é recusada e marca revisão", async () => {
    stubBillingEnv(true);
    const db = makeDb([oldSub("individualMonthly")]);
    const sub = db.subs[0];
    const foreign = remoteFor(sub, { last_modified: "2026-10-14T00:00:00.000Z" }, { transaction_amount: 39.9 });
    await expect(applyInvoice({ ...sub } as any, foreign as any, invoice(39.9) as any, payment(39.9) as any)).rejects.toThrow("PROVIDER_CONTRACT_MISMATCH");
    await applyRemoteSubscription({ ...sub } as any, foreign as any);
    expect(db.subs[0].reviewRequired).toBe(true);
  });
  it("pagamento recusado e depois pago de novo usa o mesmo R$ 59,90 e limpa a inadimplência", async () => {
    stubBillingEnv(true);
    const db = makeDb([oldSub("individualMonthly")]);
    const sub = () => ({ ...db.subs[0] });
    await applyInvoice(sub() as any, remoteFor(sub()) as any, invoice(59.9, PAID_THROUGH, { payment: { id: "pay-renewal", status: "rejected" } }) as any,
      payment(59.9, { status: "rejected", date_approved: null, date_last_updated: "2026-10-13T18:00:00.000Z" }) as any);
    expect(db.subs[0].delinquentSince).toEqual(PAID_THROUGH);
    expect(db.charges[0]).toMatchObject({ status: "rejected", amountCents: 5990 });
    await applyInvoice(sub() as any, remoteFor(sub()) as any, invoice(59.9, PAID_THROUGH, { last_modified: "2026-10-14T09:00:00.000Z" }) as any,
      payment(59.9, { date_last_updated: "2026-10-14T09:00:00.000Z", date_approved: "2026-10-14T09:00:00.000Z" }) as any);
    expect(db.charges).toHaveLength(1);
    expect(db.charges[0]).toMatchObject({ status: "approved", amountCents: 5990 });
    expect(db.subs[0].paidThrough.toISOString()).toBe("2026-11-13T17:42:29.000Z");
    expect(db.subs[0].delinquentSince).toBeNull();
  });
  // TEAM_MAX+2 antigo (17990) → TEAM_MAX+1 no catálogo novo (16990) no vencimento; PUT já confirmado no MP.
  const scheduledReduction = () => ({ id: "a1b2c3d4-0000-4000-8000-000000000001", salonId: SALON, subscriptionId: SUB_ID, kind: "SCHEDULED", state: "SCHEDULED",
    fromTerms: terms("TEAM_MAX", "MONTHLY", 17990, 12), toTerms: terms("TEAM_MAX", "MONTHLY", 16990, 11, "2026-10-02"),
    providerStartedAt: new Date("2026-10-01T00:00:00Z"), providerSyncedAt: new Date("2026-10-01T00:00:01Z"), cancelledAt: null, activatedAt: null,
    periodStart: PERIOD_START, periodEnd: PAID_THROUGH, quotedAt: new Date("2026-10-01T00:00:00Z"), confirmedAt: new Date("2026-10-01T00:00:00Z") });
  it("redução agendada de contrato antigo: período anterior a R$ 179,90 e o seguinte a R$ 169,90 (novo catálogo)", async () => {
    stubBillingEnv(true);
    const db = makeDb([oldSub("teamMax2Monthly")], { changes: [scheduledReduction()] });
    const sub = () => ({ ...db.subs[0] });
    // Mercado Pago already carries the reduced recurrence (16990); the historical invoice keeps 17990.
    const remote = remoteFor(sub(), {}, { transaction_amount: 169.9 });
    await applyInvoice(sub() as any, remote as any, invoice(179.9, PERIOD_START, { id: "inv-previous", payment: { id: "pay-previous" } }) as any,
      payment(179.9, { id: "pay-previous", date_approved: "2026-09-13T18:00:00.000Z", date_last_updated: "2026-09-13T18:00:00.000Z" }) as any);
    expect(db.charges.find((c: Row) => c.providerInvoiceId === "inv-previous").amountCents).toBe(17990);
    await applyInvoice(sub() as any, remote as any, invoice(169.9) as any, payment(169.9) as any);
    expect(db.charges.find((c: Row) => c.providerInvoiceId === "inv-renewal").amountCents).toBe(16990);
    expect(db.changes[0].state).toBe("APPLIED");
    // Wrong side of the boundary is rejected.
    await expect(applyInvoice(sub() as any, remote as any, invoice(179.9, PAID_THROUGH, { id: "inv-x", payment: { id: "pay-x" } }) as any,
      payment(179.9, { id: "pay-x" }) as any)).rejects.toThrow("INVOICE_MISMATCH");
  });
  // Mercado Pago pode debitar a renovação pouco antes do vencimento (13/10 17:42:29Z).
  const ONE_SECOND_EARLY = new Date("2026-10-13T17:42:28.000Z");
  it("redução agendada de contrato antigo debitada 1 s antes do vencimento a R$ 169,90 → aceita com os termos novos e aplica a redução", async () => {
    stubBillingEnv(true);
    const db = makeDb([oldSub("teamMax2Monthly")], { changes: [scheduledReduction()] });
    const sub = () => ({ ...db.subs[0] });
    const remote = remoteFor(sub(), {}, { transaction_amount: 169.9 });
    await applyInvoice(sub() as any, remote as any, invoice(169.9, ONE_SECOND_EARLY) as any, payment(169.9) as any);
    expect(db.charges).toHaveLength(1);
    expect(db.charges[0]).toMatchObject({ amountCents: 16990, status: "approved", periodStart: ONE_SECOND_EARLY });
    expect(db.subs[0].paidThrough.toISOString()).toBe("2026-11-13T17:42:28.000Z");
    expect(db.changes[0].state).toBe("APPLIED");
  });
  it("redução agendada de contrato antigo debitada 1 s antes do vencimento ainda a R$ 179,90 → aceita com os termos antigos; a redução segue agendada", async () => {
    stubBillingEnv(true);
    const db = makeDb([oldSub("teamMax2Monthly")], { changes: [scheduledReduction()] });
    const sub = () => ({ ...db.subs[0] });
    const remote = remoteFor(sub(), {}, { transaction_amount: 169.9 });
    await applyInvoice(sub() as any, remote as any, invoice(179.9, ONE_SECOND_EARLY) as any, payment(179.9) as any);
    expect(db.charges[0]).toMatchObject({ amountCents: 17990, status: "approved", periodStart: ONE_SECOND_EARLY });
    expect(db.subs[0].paidThrough.toISOString()).toBe("2026-11-13T17:42:28.000Z");
    expect(db.changes[0]).toMatchObject({ state: "SCHEDULED", activatedAt: null });
  });
  it("adicionais antigos repricados (R$ 189,90) debitados 1 s antes do vencimento, com redução agendada → INVOICE_MISMATCH (não é o preço de nenhum dos termos)", async () => {
    stubBillingEnv(true);
    const db = makeDb([oldSub("teamMax2Monthly")], { changes: [scheduledReduction()] });
    const sub = () => ({ ...db.subs[0] });
    const remote = remoteFor(sub(), {}, { transaction_amount: 169.9 });
    await expect(applyInvoice(sub() as any, remote as any, invoice(189.9, ONE_SECOND_EARLY) as any, payment(189.9) as any)).rejects.toThrow("INVOICE_MISMATCH");
    expect(db.charges).toHaveLength(0);
    expect(db.subs[0].paidThrough).toEqual(PAID_THROUGH);
    expect(db.changes[0].state).toBe("SCHEDULED");
  });
  it("primeiro pagamento de contratação pendente criada antes da troca é conferido contra R$ 59,90 persistido", async () => {
    stubBillingEnv(true);
    clock("2026-10-03T12:00:00.000Z");
    const pending = oldSub("individualMonthly", { providerStatus: "pending", paidThrough: null, nextPaymentAt: null, createdAt: new Date("2026-10-01T10:00:00Z") });
    const db = makeDb([pending]);
    const debit = new Date("2026-10-03T11:00:00.000Z");
    await applyInvoice({ ...db.subs[0] } as any, remoteFor(db.subs[0], { status: "authorized" }) as any, invoice(59.9, debit) as any,
      payment(59.9, { date_approved: "2026-10-03T11:00:00.000Z", date_last_updated: "2026-10-03T11:00:00.000Z" }) as any);
    expect(db.subs[0].paidThrough.toISOString()).toBe("2026-11-03T11:00:00.000Z");
    await expect(applyInvoice({ ...db.subs[0] } as any, remoteFor(db.subs[0]) as any, invoice(39.9, debit, { id: "inv-y" }) as any, null)).rejects.toThrow("INVOICE_MISMATCH");
  });
});

// ─── 3. Worker de reconciliação (syncSubscription) ──────────────────────────
describe("reconciliação periódica de assinante antigo (syncSubscription)", () => {
  it.each([["individualMonthly", 59.9], ["teamMax2Annual", 1727]] as [OldKey, number][])("processa a fatura %s de R$ %s pela listagem paginada", async (key, amount) => {
    stubBillingEnv(true);
    clock("2026-10-14T12:00:00.000Z");
    const db = makeDb([oldSub(key)]);
    hoisted.remotes.set("pre-old", remoteFor(db.subs[0]));
    vi.mocked(mp.listInvoices).mockResolvedValue({ results: [invoice(amount)], paging: { total: 1 } } as any);
    vi.mocked(mp.getPayment).mockResolvedValue(payment(amount) as any);
    await syncSubscription(SALON, SUB_ID);
    expect(db.charges[0].amountCents).toBe(OLD_CONTRACTS[key].amountCents);
    expect(db.subs[0].reviewRequired).toBe(false);
    expect(db.subs[0].paidThrough > PAID_THROUGH).toBe(true);
    expect(vi.mocked(mp.mpRequest)).not.toHaveBeenCalled(); // nenhum PUT/POST no provedor durante a renovação
  });
});

// ─── 4. Criação pendente e reativação: valor enviado ao Mercado Pago ────────
describe("valor enviado ao Mercado Pago para contratos antigos", () => {
  function captureCreation() {
    vi.mocked(mp.mpRequest).mockImplementation(async (path: string, method?: string, body?: any) => {
      if (path === "/preapproval" && method === "POST") {
        const remote = { id: "pre-new", collector_id: "123", external_reference: body.external_reference, status: "pending",
          init_point: "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=pre-new", last_modified: new Date().toISOString(), auto_recurring: { ...body.auto_recurring } };
        hoisted.remotes.set("pre-new", remote);
        return remote;
      }
      throw new Error(`unexpected ${method} ${path}`);
    });
  }
  it("intenção antiga ainda não enviada (falha antes do POST) é criada pelo preço persistido R$ 59,90", async () => {
    stubBillingEnv(false);
    clock("2026-10-03T12:00:00.000Z");
    captureCreation();
    const db = makeDb([oldSub("individualMonthly", { providerId: null, providerStatus: null, creationStartedAt: null, paidThrough: null, providerUpdatedAt: null })]);
    await ensureCreated({ ...db.subs[0] } as any);
    const [path, method, body] = vi.mocked(mp.mpRequest).mock.calls[0] as [string, string, any];
    expect([path, method]).toEqual(["/preapproval", "POST"]);
    expect(body.reason).toBe("Everflair Individual · 1 agenda — mensal");
    expect(body.auto_recurring).toEqual({ frequency: 1, frequency_type: "months", transaction_amount: 59.9, currency_id: "BRL" });
    expect(db.subs[0]).toMatchObject({ providerId: "pre-new", reviewRequired: false });
  });

  // A descrição no Mercado Pago traz a capacidade total do contrato (Equipe 10 + 2 = 12 agendas).
  const reactivationCases: [OldKey, string, number, number][] = [
    ["individualMonthly", "Everflair Individual · 1 agenda — mensal", 59.9, 1],
    ["individualAnnual", "Everflair Individual · 1 agenda — anual", 599, 12],
    ["teamMax2Monthly", "Everflair Equipe · 12 agendas — mensal", 179.9, 1],
    ["teamMax2Annual", "Everflair Equipe · 12 agendas — anual", 1727, 12],
  ];
  it.each(reactivationCases)("reativar renovação de %s mantém o valor antigo na nova autorização (%s, R$ %s)", async (key, reason, amount, frequency) => {
    stubBillingEnv(true);
    clock("2026-10-03T12:00:00.000Z");
    captureCreation();
    const cancelled = oldSub(key, { providerStatus: "cancelled", cancelRequestedAt: new Date("2026-10-01T00:00:00Z"), cancelledAt: new Date("2026-10-01T00:00:05Z") });
    const periodCharge = { id: "charge-0", salonId: SALON, subscriptionId: SUB_ID, providerInvoiceId: "inv-0", status: "approved", amountCents: OLD_CONTRACTS[key].amountCents, periodStart: PERIOD_START, periodEnd: PAID_THROUGH };
    const db = makeDb([cancelled], { charges: [periodCharge] });
    hoisted.remotes.set("pre-old", remoteFor(cancelled, { status: "cancelled" }));

    const change = await reactivateRenewal({ salonId: SALON, userId: "owner-1" }, SUB_ID, "5d0e7c43-6f5c-4a8e-9c2a-2b8c4f3d1e10");
    const expected = terms(OLD_CONTRACTS[key].planCode, OLD_CONTRACTS[key].cycle, OLD_CONTRACTS[key].amountCents, OLD_CONTRACTS[key].agendaLimit);
    expect(change).toMatchObject({ kind: "CYCLE", state: "PREPARING", amountDueCents: 0, fromTerms: expected, toTerms: expected, periodEnd: PAID_THROUGH, effectiveAt: PAID_THROUGH });

    await syncPlanChanges({ ...db.subs[0] } as any);
    const replacement = db.subs.find((s: Row) => s.id !== SUB_ID);
    expect(replacement).toMatchObject({ amountCents: OLD_CONTRACTS[key].amountCents, catalogVersion: OLD, planCode: OLD_CONTRACTS[key].planCode, agendaLimit: OLD_CONTRACTS[key].agendaLimit, current: false });
    const body = vi.mocked(mp.mpRequest).mock.calls[0][2] as any;
    expect(body.reason).toBe(reason);
    expect(body.auto_recurring).toEqual({ frequency, frequency_type: "months", transaction_amount: amount, currency_id: "BRL", start_date: "2026-10-13T17:42:29.000Z" });
    expect(db.changes[0]).toMatchObject({ state: "AWAITING_PAYMENT", checkoutUrl: "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=pre-new" });
    expect(replacement.reviewRequired).toBeFalsy();
  });
});

// ─── 5. Troca de plano a partir de um contrato antigo ───────────────────────
describe("cotação de troca partindo de termos antigos", () => {
  // 29-day period, 15 days remaining → ceil(diff × 15 / 29)
  const start = new Date("2028-02-01T12:00:00Z"), end = new Date("2028-03-01T12:00:00Z"), now = new Date("2028-02-15T12:00:00Z");
  it("Individual antigo R$ 59,90 → Essencial: diferença sobre o preço persistido (7990 − 5990)", () => {
    const q = quotePlanChange(terms("INDIVIDUAL", "MONTHLY", 5990, 1), { plan: "TEAM", cycle: "MONTHLY" }, { start, end }, 1, now);
    expect(q.kind).toBe("UPGRADE");
    expect(q.amountDueCents).toBe(1035); // 2000 × 15 / 29 = 1034,48 → 1035
    expect(q.to).toMatchObject({ amountCents: 7990, catalogVersion: "2026-10-02" });
  });
  it("Individual antigo não consegue 'trocar' para o próprio Individual a R$ 39,90 (PLAN_UNCHANGED)", () => {
    expect(() => quotePlanChange(terms("INDIVIDUAL", "MONTHLY", 5990, 1), { plan: "INDIVIDUAL", cycle: "MONTHLY" }, { start, end }, 1, now)).toThrow("PLAN_UNCHANGED");
    const cycle = quotePlanChange(terms("INDIVIDUAL", "MONTHLY", 5990, 1), { plan: "INDIVIDUAL", cycle: "ANNUAL" }, { start, end }, 1, now);
    expect(cycle).toMatchObject({ kind: "CYCLE", amountDueCents: 0 });
    expect(cycle.to.amountCents).toBe(39900);
  });
  it("TEAM_MAX+2 antigo → +3: cobra também o reajuste dos 2 adicionais antigos (20990 − 17990)", () => {
    const q = quotePlanChange(terms("TEAM_MAX", "MONTHLY", 17990, 12), { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 3 }, { start, end }, 12, now);
    expect(q.kind).toBe("UPGRADE");
    expect(q.to.amountCents).toBe(20990); // 14990 + 3 × 2000
    expect(q.amountDueCents).toBe(1552); // 3000 × 15 / 29 = 1551,72 → 1552
    const annual = quotePlanChange(terms("TEAM_MAX", "ANNUAL", 172700, 12), { plan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: 3 }, { start, end }, 12, now);
    expect(annual.to.amountCents).toBe(201500); // 143900 + 3 × 19200
    expect(annual.amountDueCents).toBe(14897); // 28800 × 15 / 29 = 14896,55 → 14897
  });
  it("comportamento atual: reduzir adicionais de contrato antigo pode custar mais — TEAM_MAX+5 (R$ 224,90) → +4 (R$ 229,90) é agendado para o vencimento, sem cobrança agora", () => {
    const old5 = terms("TEAM_MAX", "MONTHLY", 22490, 15); // 14990 + 5 × 1500
    const q = quotePlanChange(old5, { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 4 }, { start, end }, 10, now);
    expect(q.kind).toBe("SCHEDULED");
    expect(q.amountDueCents).toBe(0);
    expect(q.to.agendaLimit).toBeLessThan(q.from.agendaLimit);
    expect(q.to.amountCents).toBe(22990); // 14990 + 4 × 2000
    expect(q.to.amountCents).toBeGreaterThan(q.from.amountCents);
    // +4 → +3 costs exactly the same (20990 = 20990) for one agenda less.
    expect(quotePlanChange(terms("TEAM_MAX", "MONTHLY", 20990, 14), { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 3 }, { start, end }, 10, now).to.amountCents).toBe(20990);
  });
});

// ─── 6. Leituras derivadas: entitlement, HQ, selo, API ──────────────────────
describe("projeções lidas dos dados persistidos", () => {
  beforeEach(() => clock("2026-10-03T12:00:00.000Z"));
  it.each([["individualMonthly", 5990, 1], ["teamMax2Monthly", 17990, 12], ["teamMax2Annual", 172700, 12]] as [OldKey, number, number][])("effectiveEntitlement %s → priceCents %i, %i agendas", async (key, price, agendas) => {
    stubBillingEnv(true);
    const db = makeDb([oldSub(key)]);
    const ent = await effectiveEntitlement(db.tx as any, SALON, "FREE");
    expect(ent.priceCents).toBe(price);
    expect(ent.maxProfessionals).toBe(agendas);
  });
  it.each([["individualMonthly", 5990, "Mensal", "Individual"], ["individualAnnual", 59900, "Anual", "Individual"], ["teamMax2Annual", 172700, "Anual", "Equipe · 10 agendas"]] as [OldKey, number, string, string][])("HQ recebe %s com amountCents %i (MRR usa o valor persistido)", async (key, amount, interval, label) => {
    stubBillingEnv(true);
    vi.stubEnv("MERCADOPAGO_HQ_SYNC_ENABLED", "true");
    const db = makeDb([oldSub(key)]);
    await syncBillingToHq(SALON, SUB_ID);
    expect(db.hq.subscription).toMatchObject({ amountCents: amount, interval, plan: label, billingAgendaLimit: OLD_CONTRACTS[key].agendaLimit, discountCents: 0 });
  });
  it("selo do cabeçalho mostra plano/capacidade do contrato antigo", async () => {
    stubBillingEnv(true);
    const db = makeDb([oldSub("teamMax2Monthly")]);
    expect(await loadPlanBadge(db.tx as any, SALON, "Essencial")).toEqual({ plan: "Equipe · 12 agendas", status: "Ativo", tone: "ok" });
    expect(planBadgeFor(null, { plan: "INDIVIDUAL", agendaLimit: 1, state: "ACTIVE", renewal: "AVAILABLE", reviewRequired: false }).plan).toBe("Individual · 1 agenda");
  });
  it("GET /api/billing/subscriptions devolve R$ 59,90 persistido e o histórico com o valor cobrado", async () => {
    stubBillingEnv(true);
    makeDb([oldSub("individualMonthly")], { charges: [{ id: "c1", salonId: SALON, subscriptionId: SUB_ID, providerInvoiceId: "inv-0", status: "approved", amountCents: 5990, refundedCents: 0, periodStart: PERIOD_START, periodEnd: PAID_THROUGH, paidAt: PERIOD_START }] });
    const response = await getSubscriptionRoute(new Request(`http://localhost/api/billing/subscriptions?salonId=${SALON}`));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.subscription).toMatchObject({ plan: "INDIVIDUAL", cycle: "MONTHLY", amountCents: 5990, agendaLimit: 1, state: "ACTIVE" });
    expect(body.subscription.charges.map((c: Row) => c.amountCents)).toEqual([5990]);
  });
});

// ─── 7. Telas: valores exibidos ao assinante antigo ─────────────────────────
const oldView: SubscriptionView = { id: SUB_ID, plan: "INDIVIDUAL", cycle: "MONTHLY", amountCents: 5990, agendaLimit: 1, state: "ACTIVE",
  paidThrough: "2099-10-13T17:42:29.000Z", nextPaymentAt: "2099-10-13T17:42:29.000Z", cancelRequestedAt: null, cancelledAt: null, reviewRequired: false,
  renewalCancellationStatus: "AVAILABLE", checkoutUrl: null, providerStatus: "authorized", lastSyncedAt: null, changesAvailable: true, changePending: false, change: null, charges: [] };
const noop = () => undefined;
const card = (subscription: SubscriptionView) => render(createElement(CurrentPlanCard, { subscription, legacy: { label: "Grátis", agendas: 1, free: true }, occupiedAgendas: 1,
  timezone: "America/Sao_Paulo", email: "dona@example.test", accessBlocked: false, returnedFromCheckout: false, refreshing: false, busy: false,
  preparingChangeCheckout: false, onRefresh: noop, onCancelChange: noop }));

describe("telas do assinante antigo", () => {
  it("cartão do plano atual mostra R$ 59,90/mês e a próxima cobrança de R$ 59,90", () => {
    card(oldView);
    expect(screen.getByText(/59,90\/mês · cobrança mensal pelo Mercado Pago/)).toBeVisible();
    expect(screen.getByText(/· R\$\s59,90$/)).toBeVisible();
    expect(screen.queryByText(/39,90/)).toBeNull();
  });
  it("cartão de TEAM_MAX+2 anual antigo mostra R$ 1.727 e 12 agendas", () => {
    card({ ...oldView, plan: "TEAM_MAX", cycle: "ANNUAL", amountCents: 172700, agendaLimit: 12 });
    expect(screen.getByRole("heading", { name: "Equipe · 12 agendas" })).toBeVisible();
    expect(screen.getByText(/1\.727\/ano · cobrança anual/)).toBeVisible();
  });
  it("histórico mostra o valor efetivamente cobrado (R$ 59,90)", () => {
    render(createElement(BillingHistory, { charges: [{ id: "c1", amountCents: 5990, refundedCents: 0, status: "approved", periodStart: "2026-09-13T17:42:29.000Z", periodEnd: "2026-10-13T17:42:29.000Z", paidAt: "2026-09-13T17:43:00.000Z" }], timezone: "America/Sao_Paulo" }));
    expect(screen.getByText(/R\$\s59,90/)).toBeVisible();
  });
  it("revisão de upgrade mostra o preço antigo como 'Atual' e a diferença proporcional", () => {
    const quote: PlanChangeView = { id: "f5e579be-3c6c-44ae-bb34-b6ec479a4f4e", kind: "UPGRADE", state: "QUOTED", from: terms("INDIVIDUAL", "MONTHLY", 5990, 1), to: terms("TEAM", "MONTHLY", 7990, 3, "2026-10-02"),
      amountDueCents: 1035, effectiveAt: "2099-09-28T12:00:00Z", periodEnd: "2099-10-13T12:00:00Z", expiresAt: "2099-09-28T12:15:00Z", paidAt: null, activatedAt: null, checkoutUrl: null, lastError: null };
    render(createElement(PlanChangeReview, { quote, timezone: "America/Sao_Paulo", busy: false, error: null, onConfirm: noop, onClose: noop }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/R\$\s59,90 por mês/)).toBeVisible();
    expect(within(dialog).getAllByText(/R\$\s79,90 por mês/).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/R\$\s10,35/)).toBeVisible();
  });
  it("seletor de planos: 'Seu plano' no Individual antigo mostra o valor do contrato (R$ 59,90) e o preço para novas contratações (R$ 39,90)", () => {
    render(createElement(PlanPicker, { mode: "change", current: { plan: "INDIVIDUAL", cycle: "MONTHLY", agendaLimit: 1, amountCents: 5990 }, occupiedAgendas: 1, onChoose: noop }));
    const mine = screen.getByText("Seu plano").closest("article")!;
    expect(within(mine).getByRole("heading", { name: "Individual" })).toBeVisible();
    expect(within(mine).getByText(/^R\$\s59,90$/)).toBeVisible();
    expect(within(mine).getByText(/^Valor do seu contrato\. Para novas contratações: R\$\s39,90\/mês\.$/)).toBeVisible();
    expect(within(mine).getByRole("button", { name: "Plano atual" })).toBeDisabled();
  });
  it("seletor de planos: 'Seu plano' no TEAM_MAX+2 antigo mostra o valor do contrato (R$ 179,90) e o preço atual da mesma capacidade (R$ 189,90)", () => {
    render(createElement(PlanPicker, { mode: "change", current: { plan: "TEAM_MAX", cycle: "MONTHLY", agendaLimit: 12, amountCents: 17990 }, occupiedAgendas: 1, onChoose: noop }));
    const mine = screen.getByText("Seu plano").closest("article")!;
    expect(within(mine).getByText("12 agendas")).toBeVisible();
    expect(within(mine).getByText(/^R\$\s179,90$/)).toBeVisible();
    expect(within(mine).getByText(/^Valor do seu contrato\. Para novas contratações: R\$\s189,90\/mês\.$/)).toBeVisible();
  });
  it("controle: contrato no preço da tabela atual (Essencial R$ 79,90) mostra só 'Valor do seu contrato.'", () => {
    render(createElement(PlanPicker, { mode: "change", current: { plan: "TEAM", cycle: "MONTHLY", agendaLimit: 3, amountCents: 7990 }, occupiedAgendas: 1, onChoose: noop }));
    const mine = screen.getByText("Seu plano").closest("article")!;
    expect(within(mine).getByRole("heading", { name: "Essencial" })).toBeVisible();
    expect(within(mine).getByText(/^R\$\s79,90$/)).toBeVisible();
    expect(within(mine).getByText("Valor do seu contrato.")).toBeVisible();
    expect(within(mine).queryByText(/Para novas contratações/)).toBeNull();
  });
  it("TEAM_MAX+5 antigo (R$ 224,90): +4 (R$ 229,90, menos agendas e mais caro) é 'Mudar para este plano'; só +3 (R$ 209,90) é 'Reduzir para este plano'", () => {
    const onChoose = vi.fn();
    render(createElement(PlanPicker, { mode: "change", current: { plan: "TEAM_MAX", cycle: "MONTHLY", agendaLimit: 15, amountCents: 22490 }, occupiedAgendas: 10, onChoose }));
    expect(within(screen.getByText("Seu plano").closest("article")!).getByText(/^R\$\s224,90$/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Remover uma agenda adicional" }));
    const change = screen.getByRole("button", { name: "Mudar para este plano: Equipe · 10 agendas" });
    expect(change).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Reduzir para este plano: Equipe · 10 agendas" })).toBeNull();
    expect(within(change.closest("article")!).getByText(/^R\$\s229,90$/)).toBeVisible();
    fireEvent.click(change);
    expect(onChoose).toHaveBeenLastCalledWith({ plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 4 });
    fireEvent.click(screen.getByRole("button", { name: "Remover uma agenda adicional" }));
    const reduce = screen.getByRole("button", { name: "Reduzir para este plano: Equipe · 10 agendas" });
    expect(reduce).toBeEnabled();
    expect(within(reduce.closest("article")!).getByText(/^R\$\s209,90$/)).toBeVisible();
    fireEvent.click(reduce);
    expect(onChoose).toHaveBeenLastCalledWith({ plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 3 });
  });
  it("revisão da troca TEAM_MAX+5 antigo → +4 avisa que a renovação fica mais cara mesmo com menos agendas e que o contrato atual está abaixo da tabela", () => {
    const quote: PlanChangeView = { id: "0c4d3b2a-1e0f-4a9b-8c7d-6e5f4a3b2c1d", kind: "SCHEDULED", state: "QUOTED", from: terms("TEAM_MAX", "MONTHLY", 22490, 15), to: terms("TEAM_MAX", "MONTHLY", 22990, 14, "2026-10-02"),
      amountDueCents: 0, effectiveAt: "2099-10-13T12:00:00Z", periodEnd: "2099-10-13T12:00:00Z", expiresAt: "2099-09-28T12:15:00Z", paidAt: null, activatedAt: null, checkoutUrl: null, lastError: null };
    render(createElement(PlanChangeReview, { quote, timezone: "America/Sao_Paulo", busy: false, error: null, onConfirm: noop, onClose: noop }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("note")).toHaveTextContent(/^Atenção: mesmo com menos agendas, a renovação passa de R\$\s224,90 para R\$\s229,90 por mês\.$/);
    expect(within(dialog).getByText(/^Hoje você paga R\$\s224,90 por mês, valor anterior à tabela atual \(R\$\s249,90 para a mesma capacidade\)\. Com a troca, o novo plano segue a tabela atual\.$/)).toBeVisible();
    expect(within(dialog).getByText(/^R\$\s0$/)).toBeVisible(); // cobrança adicional agora
  });

  const reply = (subscription: SubscriptionView | null) => new Response(JSON.stringify({ subscription }));
  it("portal: diálogo de reativação de assinante antigo anuncia R$ 59,90 por mês e R$ 0 agora", async () => {
    const cancelledView = { ...oldView, cancelRequestedAt: "2026-10-01T00:00:00Z", cancelledAt: "2026-10-01T00:00:05Z", renewalCancellationStatus: "CANCELLED" as const, providerStatus: "cancelled" };
    vi.stubGlobal("fetch", vi.fn(async () => reply(cancelledView)));
    render(createElement(SubscriptionPortal, { salonId: SALON, email: "dona@example.test", timezone: "America/Sao_Paulo", occupiedAgendas: 1 }));
    fireEvent.click(await screen.findByRole("button", { name: "Reativar renovação" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/R\$\s59,90 por mês/)).toBeVisible();
    expect(within(dialog).getByText(/R\$\s0/)).toBeVisible();
    expect(within(dialog).queryByText(/39,90/)).toBeNull();
  });
  it("portal: contratação pendente criada a R$ 59,90 e ainda não paga fica desatualizada — aviso no topo, card 'Escolhido' a R$ 39,90 e 'Atualizar para o novo preço' no lugar do checkout antigo", async () => {
    const checkout = "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=pre-old";
    const pendingView: SubscriptionView = { ...oldView, state: "UNPAID", paidThrough: null, nextPaymentAt: null, providerStatus: "pending", checkoutUrl: checkout, changesAvailable: true };
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => reply(pendingView));
    vi.stubGlobal("fetch", fetchMock);
    render(createElement(SubscriptionPortal, { salonId: SALON, email: "dona@example.test", timezone: "America/Sao_Paulo", occupiedAgendas: 1 }));
    expect(await screen.findByText(/59,90\/mês · cobrança mensal/)).toBeVisible();
    expect(screen.getByText("O preço deste plano mudou")).toBeVisible();
    expect(screen.getByText(/^Sua contratação ainda não foi paga e foi criada pelo preço anterior, de R\$\s59,90\/mês\. Hoje este plano custa R\$\s39,90\/mês\.$/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Atualizar para o novo preço" })).toBeEnabled();
    expect(screen.queryByText("Falta concluir o pagamento")).toBeNull();
    // Nenhum caminho leva ao checkout antigo de R$ 59,90.
    expect(screen.queryByRole("link", { name: /Continuar pagamento/ })).toBeNull();
    expect(document.querySelector(`a[href="${checkout}"]`)).toBeNull();
    const chosen = screen.getByText("Escolhido").closest("article")!;
    expect(within(chosen).getByText(/^R\$\s39,90$/)).toBeVisible();
    expect(within(chosen).getByText(/^Preço atual\. Sua tentativa, ainda não paga, foi criada a R\$\s59,90\/mês\.$/)).toBeVisible();
    fireEvent.click(within(chosen).getByRole("button", { name: "Atualizar para o novo preço: Individual" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Atualizar para o novo preço")).toBeVisible();
    expect(within(dialog).getByText(/^A tentativa anterior foi criada a R\$\s59,90 por mês e não foi paga\. Primeiro, confirme o encerramento dela no Mercado Pago, sem nenhuma cobrança\./)).toBeVisible();
    expect(within(dialog).getByText(/^R\$\s39,90$/)).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Confirmar cancelamento da tentativa anterior" })).toBeEnabled();
    // Escolher não envia nada: só houve consultas da assinatura.
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });
  it("controle: contratação pendente criada ao preço atual (R$ 39,90) continua com 'Continuar pagamento' para o checkout existente", async () => {
    const checkout = "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=pre-current";
    const pendingView: SubscriptionView = { ...oldView, amountCents: 3990, state: "UNPAID", paidThrough: null, nextPaymentAt: null, providerStatus: "pending", checkoutUrl: checkout, changesAvailable: true };
    vi.stubGlobal("fetch", vi.fn(async () => reply(pendingView)));
    render(createElement(SubscriptionPortal, { salonId: SALON, email: "dona@example.test", timezone: "America/Sao_Paulo", occupiedAgendas: 1 }));
    expect(await screen.findByText("Falta concluir o pagamento")).toBeVisible();
    expect(screen.queryByText("O preço deste plano mudou")).toBeNull();
    expect(screen.getByRole("link", { name: "Continuar pagamento no Mercado Pago" })).toHaveAttribute("href", checkout);
    const chosen = screen.getByText("Escolhido").closest("article")!;
    expect(within(chosen).getByText(/^R\$\s39,90$/)).toBeVisible();
    expect(within(chosen).getByRole("link", { name: "Continuar pagamento: Individual" })).toHaveAttribute("href", checkout);
    expect(screen.queryByRole("button", { name: /Atualizar para o novo preço/ })).toBeNull();
  });
});
