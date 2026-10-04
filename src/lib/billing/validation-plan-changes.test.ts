// @vitest-environment jsdom
/**
 * Validação independente da troca de plano (abatimento do valor pago e cobrança
 * exata da diferença) para assinantes do catálogo novo (2026-10-02) e do catálogo
 * anterior (2026-09-13), que continuam pagando o valor persistido.
 *
 * Todos os valores esperados são calculados aqui, com tabelas de preço próprias e
 * aritmética BigInt, sem chamar a função testada para produzir a expectativa.
 * Nenhum banco ou API externa é usado: prisma-tenant e o Mercado Pago são simulados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { BillingPlanChange, BillingSubscription } from "@prisma/client";

vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({ tx: null as unknown }));
vi.mock("../prisma-tenant", () => ({
  withSalon: async (_salonId: string, fn: (tx: unknown) => unknown) => fn(h.tx),
  withTenant: async (_ctx: unknown, fn: (tx: unknown) => unknown) => fn(h.tx),
}));
vi.mock("./provider", async importOriginal => {
  const real = await importOriginal<typeof import("./provider")>();
  return { ...real, mpRequest: vi.fn(), verifySellerAccount: vi.fn(async () => undefined), getSubscription: vi.fn() };
});

import * as mp from "./provider";
import { quotePlanChange, proportionalDifference, type BillingTerms } from "./change-rules";
import { prepareUpgradeCheckout } from "./change-provider";
import { applyUpgradePayment } from "./change-payments";
import { syncPlanChanges } from "./change-worker";
import { PlanChangeReview } from "@/components/billing/plan-change-review";
import { CurrentPlanCard } from "@/components/billing/current-plan-card";
import { PlanPicker } from "@/components/billing/plan-picker";
import type { PlanChangeView, SubscriptionView } from "./presentation";

// ---------------------------------------------------------------------------
// Tabelas de preço independentes (centavos). NÃO importadas de catalog.ts.
// ---------------------------------------------------------------------------
type Plan = "INDIVIDUAL" | "TEAM" | "TEAM_PLUS" | "TEAM_MAX";
type Cycle = "MONTHLY" | "ANNUAL";
type Catalog = "OLD" | "NEW";
const BASE: Record<Plan, { agendas: number; MONTHLY: Record<Catalog, number>; ANNUAL: Record<Catalog, number> }> = {
  INDIVIDUAL: { agendas: 1, MONTHLY: { OLD: 5990, NEW: 3990 }, ANNUAL: { OLD: 59900, NEW: 39900 } },
  TEAM: { agendas: 3, MONTHLY: { OLD: 7990, NEW: 7990 }, ANNUAL: { OLD: 77900, NEW: 77900 } },
  TEAM_PLUS: { agendas: 5, MONTHLY: { OLD: 9990, NEW: 9990 }, ANNUAL: { OLD: 95900, NEW: 95900 } },
  TEAM_MAX: { agendas: 10, MONTHLY: { OLD: 14990, NEW: 14990 }, ANNUAL: { OLD: 143900, NEW: 143900 } },
};
const EXTRA: Record<Cycle, Record<Catalog, number>> = { MONTHLY: { OLD: 1500, NEW: 2000 }, ANNUAL: { OLD: 14400, NEW: 19200 } };
const VERSION: Record<Catalog, string> = { OLD: "2026-09-13", NEW: "2026-10-02" };
const PLANS: Plan[] = ["INDIVIDUAL", "TEAM", "TEAM_PLUS", "TEAM_MAX"];
const CYCLES: Cycle[] = ["MONTHLY", "ANNUAL"];

function price(catalog: Catalog, plan: Plan, cycle: Cycle, extras = 0) {
  return BASE[plan][cycle][catalog] + extras * EXTRA[cycle][catalog];
}
/** Termos persistidos de um assinante, montados à mão (como estariam no banco). */
function persisted(catalog: Catalog, plan: Plan, cycle: Cycle, extras = 0): BillingTerms {
  return { plan, cycle, amountCents: price(catalog, plan, cycle, extras), agendaLimit: BASE[plan].agendas + extras,
    intervalMonths: cycle === "ANNUAL" ? 12 : 1, catalogVersion: VERSION[catalog] };
}
const ceilDiv = (n: bigint, d: bigint) => (n + d - BigInt(1)) / d;

type Expected = { error: string } | { kind: "UPGRADE" | "SCHEDULED" | "CYCLE"; due: number; to: BillingTerms; effectiveAt: Date };
/** Regra aprovada, reescrita de forma independente a partir dos documentos. */
function expectedQuote(from: BillingTerms, target: { plan: Plan; cycle: Cycle; extraAgendas: number }, start: Date, end: Date, now: Date, occupied: number): Expected {
  const to = persisted("NEW", target.plan, target.cycle, target.extraAgendas);
  if (occupied > to.agendaLimit) return { error: "PLAN_CAPACITY_TOO_SMALL" };
  if (from.plan === to.plan && from.cycle === to.cycle && from.agendaLimit === to.agendaLimit) return { error: "PLAN_UNCHANGED" };
  if (from.cycle !== to.cycle) return { kind: "CYCLE", due: 0, to, effectiveAt: end };
  if (to.agendaLimit > from.agendaLimit && to.amountCents > from.amountCents) {
    const total = BigInt(end.getTime() - start.getTime()), remaining = BigInt(end.getTime() - now.getTime());
    return { kind: "UPGRADE", due: Number(ceilDiv(BigInt(to.amountCents - from.amountCents) * remaining, total)), to, effectiveAt: now };
  }
  return { kind: "SCHEDULED", due: 0, to, effectiveAt: end };
}

// Período pago real mais comum hoje: renovação de 13/09/2026 17:42:29Z.
const START = new Date("2026-09-13T17:42:29.000Z");
const END_MONTH = new Date("2026-10-13T17:42:29.000Z");
const END_YEAR = new Date("2027-09-13T17:42:29.000Z");
const TODAY = new Date("2026-10-03T12:00:00.000Z");
const periodFor = (cycle: Cycle) => ({ start: START, end: cycle === "ANNUAL" ? END_YEAR : END_MONTH });

function sources(catalog: Catalog, extrasSet: number[]) {
  const out: { label: string; terms: BillingTerms }[] = [];
  for (const plan of PLANS) for (const cycle of CYCLES) for (const extras of plan === "TEAM_MAX" ? extrasSet : [0])
    out.push({ label: `${catalog} ${plan}+${extras} ${cycle}`, terms: persisted(catalog, plan, cycle, extras) });
  return out;
}
function targets(extrasSet: number[]) {
  const out: { plan: Plan; cycle: Cycle; extraAgendas: number }[] = [];
  for (const plan of PLANS) for (const cycle of CYCLES) for (const extraAgendas of plan === "TEAM_MAX" ? extrasSet : [0]) out.push({ plan, cycle, extraAgendas });
  return out;
}
function runQuote(from: BillingTerms, target: { plan: Plan; cycle: Cycle; extraAgendas: number }, now: Date, occupied = 0) {
  const period = periodFor(from.cycle as Cycle);
  try { return quotePlanChange(from, target, period, occupied, now); }
  catch (e) { return { error: (e as Error).message }; }
}
function compare(from: BillingTerms, target: { plan: Plan; cycle: Cycle; extraAgendas: number }, now: Date, occupied = 0): string | null {
  const period = periodFor(from.cycle as Cycle);
  const want = expectedQuote(from, target, period.start, period.end, now, occupied);
  const got = runQuote(from, target, now, occupied);
  const tag = `${from.catalogVersion} ${from.plan}/${from.agendaLimit}/${from.cycle}/${from.amountCents} -> ${target.plan}+${target.extraAgendas}/${target.cycle} @${now.toISOString()}`;
  if ("error" in want || "error" in got) {
    const w = "error" in want ? want.error : want.kind, g = "error" in got ? got.error : got.kind;
    return w === g ? null : `${tag}: esperado ${w}, obtido ${g}`;
  }
  if (got.kind !== want.kind) return `${tag}: kind ${got.kind} != ${want.kind}`;
  if (got.amountDueCents !== want.due) return `${tag}: devido ${got.amountDueCents} != ${want.due}`;
  if (JSON.stringify(got.to) !== JSON.stringify(want.to)) return `${tag}: destino ${JSON.stringify(got.to)} != ${JSON.stringify(want.to)}`;
  if (JSON.stringify(got.from) !== JSON.stringify(from)) return `${tag}: origem alterada ${JSON.stringify(got.from)}`;
  if (got.effectiveAt.getTime() !== want.effectiveAt.getTime()) return `${tag}: effectiveAt ${got.effectiveAt.toISOString()}`;
  if (got.periodEnd.getTime() !== period.end.getTime()) return `${tag}: vencimento alterado`;
  if (got.amountDueCents < 0 || (got.kind === "UPGRADE" && (got.amountDueCents < 1 || got.amountDueCents > got.to.amountCents - got.from.amountCents))) return `${tag}: devido fora dos limites`;
  return null;
}

// ---------------------------------------------------------------------------
// 1. Matriz completa de quotePlanChange
// ---------------------------------------------------------------------------
describe("matriz de troca: origem (catálogo antigo/novo) x destino (catálogo novo)", () => {
  const SAMPLE = [0, 1, 2, 3, 4, 5, 6, 7, 10, 50, 99, 100];
  const NOWS = [START, TODAY, new Date(END_MONTH.getTime() - 1000), new Date(END_MONTH.getTime() - 1)];
  for (const catalog of ["OLD", "NEW"] as Catalog[]) {
    it(`todas as combinações plano/ciclo/adicionais a partir do catálogo ${VERSION[catalog]}`, () => {
      const errors: string[] = [];
      let checked = 0;
      for (const source of sources(catalog, SAMPLE)) for (const target of targets(SAMPLE)) for (const now of NOWS) {
        const e = compare(source.terms, target, now); checked++;
        if (e) errors.push(e);
      }
      expect(errors.slice(0, 10)).toEqual([]);
      expect(checked).toBe(((3 * 2) + 2 * SAMPLE.length) ** 2 * NOWS.length);
    });
    it.each(CYCLES)(`Equipe 10 + 0..100 adicionais -> 0..100 adicionais (%s, ${VERSION[catalog]})`, cycle => {
      const errors: string[] = [];
      for (let k = 0; k <= 100; k++) for (let m = 0; m <= 100; m++) {
        const e = compare(persisted(catalog, "TEAM_MAX", cycle, k), { plan: "TEAM_MAX", cycle, extraAgendas: m }, TODAY);
        if (e) errors.push(e);
      }
      expect(errors.slice(0, 10)).toEqual([]);
    });
  }
  it("recusa destino que não comporta a equipe antes de qualquer outra regra", () => {
    for (const catalog of ["OLD", "NEW"] as Catalog[]) for (const source of sources(catalog, [0, 5])) for (const target of targets([0, 4, 5, 6])) {
      const occupied = source.terms.agendaLimit;
      expect(compare(source.terms, target, TODAY, occupied)).toBeNull();
      const got = runQuote(source.terms, target, TODAY, occupied);
      if (BASE[target.plan].agendas + target.extraAgendas < occupied) expect(got).toEqual({ error: "PLAN_CAPACITY_TOO_SMALL" });
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Casos explícitos pedidos (a–h), com números
// ---------------------------------------------------------------------------
describe("casos explícitos", () => {
  const HALF = new Date(START.getTime() + (END_MONTH.getTime() - START.getTime()) / 2);
  it("a) Individual antigo R$ 59,90 -> Essencial R$ 79,90 no meio do ciclo: diferença de R$ 20,00 proporcional", () => {
    const from = persisted("OLD", "INDIVIDUAL", "MONTHLY");
    expect(from.amountCents).toBe(5990);
    const atStart = quotePlanChange(from, { plan: "TEAM", cycle: "MONTHLY" }, periodFor("MONTHLY"), 1, START);
    const atHalf = quotePlanChange(from, { plan: "TEAM", cycle: "MONTHLY" }, periodFor("MONTHLY"), 1, HALF);
    const today = quotePlanChange(from, { plan: "TEAM", cycle: "MONTHLY" }, periodFor("MONTHLY"), 1, TODAY);
    expect([atStart.kind, atStart.amountDueCents]).toEqual(["UPGRADE", 2000]);
    expect(atHalf.amountDueCents).toBe(1000);
    // 03/10 12:00Z: restam 10 d 5 h 42 min 29 s de 30 dias -> 2000 * 884549 / 2592000 = 682,52 -> 683.
    expect(today.amountDueCents).toBe(683);
    expect(today.to).toEqual({ plan: "TEAM", cycle: "MONTHLY", amountCents: 7990, agendaLimit: 3, intervalMonths: 1, catalogVersion: "2026-10-02" });
    expect(today.periodEnd).toEqual(END_MONTH);
    expect(today.effectiveAt).toEqual(TODAY);
  });
  it("b) Individual novo R$ 39,90 -> Essencial R$ 79,90: diferença de R$ 40,00 proporcional", () => {
    const from = persisted("NEW", "INDIVIDUAL", "MONTHLY");
    expect(quotePlanChange(from, { plan: "TEAM", cycle: "MONTHLY" }, periodFor("MONTHLY"), 1, START).amountDueCents).toBe(4000);
    expect(quotePlanChange(from, { plan: "TEAM", cycle: "MONTHLY" }, periodFor("MONTHLY"), 1, HALF).amountDueCents).toBe(2000);
    expect(quotePlanChange(from, { plan: "TEAM", cycle: "MONTHLY" }, periodFor("MONTHLY"), 1, TODAY).amountDueCents).toBe(1366);
  });
  it("c) Individual antigo R$ 59,90 -> Individual mensal: PLAN_UNCHANGED (não migra para R$ 39,90 pela troca)", () => {
    const from = persisted("OLD", "INDIVIDUAL", "MONTHLY");
    expect(() => quotePlanChange(from, { plan: "INDIVIDUAL", cycle: "MONTHLY" }, periodFor("MONTHLY"), 1, TODAY)).toThrow("PLAN_UNCHANGED");
    // Caminhos que levam ao preço novo: mudar de ciclo (vale no vencimento)...
    const cycle = quotePlanChange(from, { plan: "INDIVIDUAL", cycle: "ANNUAL" }, periodFor("MONTHLY"), 1, TODAY);
    expect([cycle.kind, cycle.amountDueCents, cycle.to.amountCents, cycle.effectiveAt.toISOString()]).toEqual(["CYCLE", 0, 39900, END_MONTH.toISOString()]);
    // ...ou subir e depois reduzir: Essencial (novo) -> Individual agenda R$ 39,90 no vencimento.
    const down = quotePlanChange(persisted("NEW", "TEAM", "MONTHLY"), { plan: "INDIVIDUAL", cycle: "MONTHLY" }, periodFor("MONTHLY"), 1, TODAY);
    expect([down.kind, down.amountDueCents, down.to.amountCents]).toEqual(["SCHEDULED", 0, 3990]);
  });
  it("d) Equipe 10 + 5 antigos (R$ 224,90) -> + 4 no catálogo novo (R$ 229,90): redução que AUMENTA a renovação", () => {
    const from = persisted("OLD", "TEAM_MAX", "MONTHLY", 5);
    expect(from.amountCents).toBe(14990 + 5 * 1500);
    const q = quotePlanChange(from, { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 4 }, periodFor("MONTHLY"), 14, TODAY);
    expect([q.kind, q.amountDueCents, q.to.amountCents, q.to.agendaLimit, q.effectiveAt.toISOString()]).toEqual(["SCHEDULED", 0, 22990, 14, END_MONTH.toISOString()]);
    expect(q.to.amountCents - q.from.amountCents).toBe(500);
  });
  it("d') contagem: reduções de adicionais antigos que ficam mais caras no catálogo novo", () => {
    const count = (cycle: Cycle) => {
      let more = 0, equal = 0;
      for (let k = 0; k <= 100; k++) for (let m = 0; m < k; m++) {
        const q = quotePlanChange(persisted("OLD", "TEAM_MAX", cycle, k), { plan: "TEAM_MAX", cycle, extraAgendas: m }, periodFor(cycle), 0, TODAY);
        expect(q.kind).toBe("SCHEDULED");
        if (q.to.amountCents > q.from.amountCents) more++;
        if (q.to.amountCents === q.from.amountCents) equal++;
      }
      return [more, equal];
    };
    // Independente: 2000m > 1500k  <=>  m > 0,75k (mesma razão no anual 19200/14400).
    expect(count("MONTHLY")).toEqual([1200, 25]);
    expect(count("ANNUAL")).toEqual([1200, 25]);
  });
  it("e) Equipe 10 + 5 antigos -> + 6: devido = (26990 - 22490) proporcional; os 5 adicionais passam a R$ 20", () => {
    const from = persisted("OLD", "TEAM_MAX", "MONTHLY", 5);
    const q = (now: Date) => quotePlanChange(from, { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 6 }, periodFor("MONTHLY"), 15, now);
    expect(q(START).amountDueCents).toBe(4500);
    expect(q(HALF).amountDueCents).toBe(2250);
    expect(q(TODAY).amountDueCents).toBe(1536);
    expect(q(TODAY).to.amountCents).toBe(26990);
    // Só a nova agenda custaria 2000; os outros 2500 são a remarcação dos 5 adicionais de R$ 15 para R$ 20.
    expect(q(TODAY).to.amountCents - from.amountCents - EXTRA.MONTHLY.NEW).toBe(5 * (EXTRA.MONTHLY.NEW - EXTRA.MONTHLY.OLD));
  });
  it("f) Individual anual antigo R$ 599 -> Essencial mensal R$ 79,90: CYCLE agendado para o fim do ano pago", () => {
    const from = persisted("OLD", "INDIVIDUAL", "ANNUAL");
    const q = quotePlanChange(from, { plan: "TEAM", cycle: "MONTHLY" }, periodFor("ANNUAL"), 1, TODAY);
    expect([q.kind, q.amountDueCents, q.to.amountCents, q.to.intervalMonths, q.effectiveAt.toISOString(), q.periodEnd.toISOString()])
      .toEqual(["CYCLE", 0, 7990, 1, END_YEAR.toISOString(), END_YEAR.toISOString()]);
  });
  it("g) arredondamento: nunca negativo, no máximo +1 centavo sobre o valor exato, inclusive com pouco tempo restante", () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const amounts = [3990, 5990, 7990, 9990, 14990, 22490, 26990, 39900, 59900, 77900, 95900, 143900, 2063900];
    for (let i = 0; i < 20000; i++) {
      const a = amounts[Math.floor(rnd() * amounts.length)], b = amounts[Math.floor(rnd() * amounts.length)];
      if (b <= a) continue;
      const end = rnd() < 0.5 ? END_MONTH : END_YEAR;
      const total = end.getTime() - START.getTime();
      const remaining = 1 + Math.floor(rnd() * total);
      const due = proportionalDifference(a, b, START, end, new Date(end.getTime() - remaining));
      const exactTimesTotal = BigInt(b - a) * BigInt(remaining);
      expect(due).toBeGreaterThanOrEqual(1);
      expect(BigInt(due) * BigInt(total) >= exactTimesTotal).toBe(true);           // nunca abaixo do exato
      expect(BigInt(due - 1) * BigInt(total) < exactTimesTotal).toBe(true);        // < 1 centavo acima
      expect(due).toBeLessThanOrEqual(b - a);
    }
    const from = persisted("OLD", "INDIVIDUAL", "MONTHLY");
    expect(quotePlanChange(from, { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 100 }, periodFor("MONTHLY"), 1, new Date(END_MONTH.getTime() - 1)).amountDueCents).toBe(1);
    expect(quotePlanChange(from, { plan: "TEAM", cycle: "MONTHLY" }, periodFor("MONTHLY"), 1, new Date(END_MONTH.getTime() - 1000)).amountDueCents).toBe(1);
    expect(() => quotePlanChange(from, { plan: "TEAM", cycle: "MONTHLY" }, periodFor("MONTHLY"), 1, END_MONTH)).toThrow("INVALID_CHANGE_PERIOD");
    // A cotação vence em 15 min ou no fim do período, o que vier antes.
    const late = quotePlanChange(from, { plan: "TEAM", cycle: "MONTHLY" }, periodFor("MONTHLY"), 1, new Date(END_MONTH.getTime() - 60_000));
    expect(late.expiresAt).toEqual(END_MONTH);
  });
  it("h) nenhuma combinação alcançável (catálogos 2026-09-13 e 2026-10-02) aumenta capacidade sem aumentar o preço", () => {
    const found: string[] = [];
    const all = [0, ...Array.from({ length: 100 }, (_, i) => i + 1)];
    for (const catalog of ["OLD", "NEW"] as Catalog[]) for (const s of sources(catalog, all)) for (const t of targets(all)) {
      if (t.cycle !== s.terms.cycle) continue;
      const to = persisted("NEW", t.plan, t.cycle, t.extraAgendas);
      if (to.agendaLimit > s.terms.agendaLimit && to.amountCents <= s.terms.amountCents) found.push(`${s.label} -> ${t.plan}+${t.extraAgendas}`);
    }
    expect(found).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Caminho do dinheiro com Mercado Pago e banco simulados
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
const SALON = "salon-1";
const SUB_ID = "11111111-1111-4111-8111-111111111111";
const CHANGE_ID = "22222222-2222-4222-8222-222222222222";
const state: { sub: Row; change: Row; created: Row | null } = { sub: {}, change: {}, created: null };
function makeTx() {
  const pick = (id: unknown) => (id === state.sub.id ? state.sub : state.created ?? {});
  return {
    $executeRaw: vi.fn(async () => 0), $queryRaw: vi.fn(async () => []),
    billingPlanChange: {
      findUniqueOrThrow: vi.fn(async () => ({ ...state.change })),
      findFirst: vi.fn(async ({ where }: { where: Row }) => {
        if (where.replacementSubscriptionId) return { ...state.change };
        if (where.id === undefined && where.state && where.confirmedAt) return { ...state.change };
        return null; // currentTerms sem revisão ativa, nenhuma outra troca pendente
      }),
      findMany: vi.fn(async () => []),
      update: vi.fn(async ({ data }: { data: Row }) => { Object.assign(state.change, data); return { ...state.change }; }),
      updateMany: vi.fn(async ({ where, data }: { where: { state?: { in: string[] } | string }; data: Row }) => {
        const st = where.state;
        if (st && typeof st === "object" && !st.in.includes(state.change.state as string)) return { count: 0 };
        if (typeof st === "string" && st !== state.change.state) return { count: 0 };
        Object.assign(state.change, data); return { count: 1 };
      }),
    },
    billingSubscription: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => ({ ...pick(where.id) })),
      findFirst: vi.fn(async () => null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => { Object.assign(pick(where.id), data); return { ...pick(where.id) }; }),
      create: vi.fn(async ({ data }: { data: Row }) => { state.created = { providerId: null, cancelledAt: null, cancelRequestedAt: null, creationStartedAt: null, paidThrough: null, ...data }; return { ...state.created }; }),
    },
    billingCharge: { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []), upsert: vi.fn(async () => ({})) },
    billingEvent: { upsert: vi.fn(async () => ({})) },
    billingQueue: { upsert: vi.fn(async () => ({})) },
  };
}
type FakeTx = ReturnType<typeof makeTx>;
const tx = () => h.tx as FakeTx;

function subscriptionRow(terms: BillingTerms, end: Date): Row {
  return { id: SUB_ID, salonId: SALON, requestKey: "rk", fingerprint: "fp", current: true, catalogVersion: terms.catalogVersion, planCode: terms.plan, cycle: terms.cycle,
    amountCents: terms.amountCents, agendaLimit: terms.agendaLimit, intervalMonths: terms.intervalMonths, currency: "BRL", mode: "test", collectorId: "123",
    payerEmail: "owner@example.test", legacyPlan: "FREE", providerId: "mpsub1", providerStatus: "authorized", providerUpdatedAt: null, checkoutUrl: null,
    creationStartedAt: START, cancelRequestedAt: null, cancelledAt: null, paidThrough: end, nextPaymentAt: end, delinquentSince: null, reviewRequired: false,
    lastSyncedAt: null, invoiceOffset: 0, createdAt: START, updatedAt: START };
}
function changeRow(q: ReturnType<typeof quotePlanChange>, extra: Row): Row {
  return { id: CHANGE_ID, salonId: SALON, subscriptionId: SUB_ID, requestKey: "33333333-3333-4333-8333-333333333333", actorUserId: "owner",
    kind: q.kind, state: "PREPARING", fromTerms: q.from, toTerms: q.to, amountDueCents: q.amountDueCents, periodStart: q.periodStart, periodEnd: q.periodEnd,
    effectiveAt: q.effectiveAt, quotedAt: q.quotedAt, expiresAt: q.expiresAt, confirmedAt: q.quotedAt, creationStartedAt: null, preferenceId: null, checkoutUrl: null,
    providerPaymentId: null, paidAt: null, activatedAt: null, providerStartedAt: null, providerSyncedAt: null, cancelledAt: null, replacementSubscriptionId: null,
    lastError: null, updatedAt: q.quotedAt, ...extra };
}
function remoteFor(amountCents: number, intervalMonths: number, end: Date) {
  return { id: "mpsub1", collector_id: "123", external_reference: `ef:${SALON}:${SUB_ID}`, status: "authorized" as const, payer_id: "payer-1",
    last_modified: START.toISOString(), next_payment_date: end.toISOString(), summarized: { pending_charge_quantity: 0 },
    auto_recurring: { frequency: intervalMonths, frequency_type: "months", currency_id: "BRL", transaction_amount: amountCents / 100 } };
}
const calls = () => vi.mocked(mp.mpRequest).mock.calls as unknown as [string, string | undefined, Record<string, unknown> | undefined][];

describe("caminho do dinheiro (Mercado Pago e banco simulados)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(TODAY);
    for (const [k, v] of Object.entries({ MERCADOPAGO_BILLING_ENABLED: "true", MERCADOPAGO_MODE: "test", MERCADOPAGO_COLLECTOR_ID: "123", MERCADOPAGO_ACCESS_TOKEN: "test-only",
      MERCADOPAGO_WEBHOOK_SECRET: "test-secret", APP_ENV: "test", VERCEL_ENV: "", NEXTAUTH_URL: "http://localhost:3000", MERCADOPAGO_PLAN_CHANGES_ENABLED: "true",
      MERCADOPAGO_CHECKOUT_PAUSED: "", MERCADOPAGO_PLAN_CHANGES_PAUSED: "" })) vi.stubEnv(k, v);
    h.tx = makeTx(); state.created = null;
    vi.mocked(mp.mpRequest).mockReset(); vi.mocked(mp.getSubscription).mockReset();
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  // O título da preferência descreve a capacidade total contratada (plano + adicionais).
  const upgradeCases = [
    { name: "a) Individual antigo 59,90 -> Essencial", from: persisted("OLD", "INDIVIDUAL", "MONTHLY"), target: { plan: "TEAM" as Plan, cycle: "MONTHLY" as Cycle, extraAgendas: 0 }, due: 683, unit: 6.83, recurrence: 79.9, title: "Everflair — upgrade para Essencial · 3 agendas" },
    { name: "b) Individual novo 39,90 -> Essencial", from: persisted("NEW", "INDIVIDUAL", "MONTHLY"), target: { plan: "TEAM" as Plan, cycle: "MONTHLY" as Cycle, extraAgendas: 0 }, due: 1366, unit: 13.66, recurrence: 79.9, title: "Everflair — upgrade para Essencial · 3 agendas" },
    { name: "e) Equipe 10+5 antigo -> +6", from: persisted("OLD", "TEAM_MAX", "MONTHLY", 5), target: { plan: "TEAM_MAX" as Plan, cycle: "MONTHLY" as Cycle, extraAgendas: 6 }, due: 1536, unit: 15.36, recurrence: 269.9, title: "Everflair — upgrade para Equipe · 16 agendas" },
  ];

  for (const c of upgradeCases) {
    it(`${c.name}: preferência Checkout Pro "${c.title}" com unit_price = devido/100, BRL, quantidade 1 e referência efu`, async () => {
      const q = quotePlanChange(c.from, c.target, periodFor("MONTHLY"), 1, TODAY);
      expect(q.amountDueCents).toBe(c.due);
      state.sub = subscriptionRow(c.from, END_MONTH); state.change = changeRow(q, {});
      vi.mocked(mp.mpRequest).mockImplementation(async (_path: string, _method?: string, body?: unknown) => {
        const b = body as { items: { unit_price: number }[]; external_reference: string; expiration_date_to: string };
        return { id: "pref-1", collector_id: 123, external_reference: b.external_reference, init_point: "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-1",
          items: [{ quantity: 1, unit_price: b.items[0].unit_price, currency_id: "BRL" }], expires: true, expiration_date_to: b.expiration_date_to };
      });
      await prepareUpgradeCheckout(state.sub as unknown as BillingSubscription, state.change as unknown as BillingPlanChange);
      const [path, method, body] = calls()[0];
      expect([path, method]).toEqual(["/checkout/preferences", "POST"]);
      expect(body!.items).toEqual([{ id: CHANGE_ID, title: c.title, quantity: 1, currency_id: "BRL", unit_price: c.unit }]);
      expect(body!.external_reference).toBe(`efu:${SALON}:${CHANGE_ID}`);
      expect(body!.expiration_date_to).toBe(new Date(TODAY.getTime() + 15 * 60_000).toISOString());
      expect(Math.round((body!.items as { unit_price: number }[])[0].unit_price * 100)).toBe(c.due);
      expect(state.change.state).toBe("AWAITING_PAYMENT");
      expect(state.change.checkoutUrl).toBe("https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-1");
    });

    it(`${c.name}: preferência devolvida com 1 centavo a mais é rejeitada sem expor link`, async () => {
      const q = quotePlanChange(c.from, c.target, periodFor("MONTHLY"), 1, TODAY);
      state.sub = subscriptionRow(c.from, END_MONTH); state.change = changeRow(q, {});
      vi.mocked(mp.mpRequest).mockImplementation(async (_p: string, _m?: string, body?: unknown) => {
        const b = body as { external_reference: string; expiration_date_to: string };
        return { id: "pref-1", collector_id: "123", external_reference: b.external_reference, init_point: "https://www.mercadopago.com.br/x",
          items: [{ quantity: 1, unit_price: (c.due + 1) / 100, currency_id: "BRL" }], expires: true, expiration_date_to: b.expiration_date_to };
      });
      await expect(prepareUpgradeCheckout(state.sub as unknown as BillingSubscription, state.change as unknown as BillingPlanChange)).rejects.toThrow("UPGRADE_CHECKOUT_MISMATCH");
      expect(state.change.checkoutUrl).toBeNull();
      expect(state.change.state).toBe("PREPARING");
    });

    it(`${c.name}: só o pagamento de exatamente ${c.due} centavos libera a capacidade; 1 centavo a menos/mais vai para mismatch`, async () => {
      const q = quotePlanChange(c.from, c.target, periodFor("MONTHLY"), 1, TODAY);
      const payment = (cents: number) => ({ id: "pay-1", collector_id: "123", currency_id: "BRL", transaction_amount: cents / 100, status: "approved",
        date_last_updated: new Date(TODAY.getTime() + 60_000).toISOString(), date_approved: new Date(TODAY.getTime() + 60_000).toISOString(), live_mode: false,
        external_reference: `efu:${SALON}:${CHANGE_ID}`, transaction_amount_refunded: 0, payer: { id: "payer-1" } });
      for (const wrong of [c.due - 1, c.due + 1]) {
        state.sub = subscriptionRow(c.from, END_MONTH); state.change = changeRow(q, { state: "AWAITING_PAYMENT", creationStartedAt: TODAY, preferenceId: "pref-1" });
        await expect(applyUpgradePayment(state.sub as unknown as BillingSubscription, state.change as unknown as BillingPlanChange, remoteFor(c.from.amountCents, 1, END_MONTH), payment(wrong))).rejects.toThrow("PAYMENT_MISMATCH");
        expect(tx().billingCharge.upsert).not.toHaveBeenCalled();
      }
      vi.setSystemTime(new Date(TODAY.getTime() + 90_000));
      state.sub = subscriptionRow(c.from, END_MONTH); state.change = changeRow(q, { state: "AWAITING_PAYMENT", creationStartedAt: TODAY, preferenceId: "pref-1" });
      await applyUpgradePayment(state.sub as unknown as BillingSubscription, state.change as unknown as BillingPlanChange, remoteFor(c.from.amountCents, 1, END_MONTH), payment(c.due));
      const charge = (tx().billingCharge.upsert.mock.calls as unknown as [{ create: Row }][])[0][0];
      expect(charge.create).toMatchObject({ amountCents: c.due, providerInvoiceId: `upgrade:${CHANGE_ID}:pay-1`, periodEnd: END_MONTH, status: "approved" });
      expect(state.change).toMatchObject({ state: "APPLYING", providerPaymentId: "pay-1" });
      expect(state.change.activatedAt).toBeInstanceOf(Date);
      // Pagamento complementar nunca estende o período pago.
      expect(tx().billingSubscription.update).not.toHaveBeenCalled();
      expect(state.sub.paidThrough).toEqual(END_MONTH);
    });

    it(`${c.name}: após o pagamento, PUT da recorrência = ${c.recurrence} e vencimento inalterado`, async () => {
      const q = quotePlanChange(c.from, c.target, periodFor("MONTHLY"), 1, TODAY);
      state.sub = subscriptionRow(c.from, END_MONTH);
      state.change = changeRow(q, { state: "APPLYING", creationStartedAt: TODAY, preferenceId: "pref-1", paidAt: TODAY, activatedAt: TODAY, providerPaymentId: "pay-1" });
      vi.mocked(mp.getSubscription).mockResolvedValueOnce(remoteFor(c.from.amountCents, 1, END_MONTH)).mockResolvedValueOnce(remoteFor(q.to.amountCents, 1, END_MONTH));
      vi.mocked(mp.mpRequest).mockImplementation(async (path: string) => path.startsWith("/v1/payments/search") ? { results: [], paging: { total: 0 } } : {});
      await syncPlanChanges(state.sub as unknown as BillingSubscription);
      const puts = calls().filter(([, m]) => m === "PUT");
      expect(puts).toEqual([["/preapproval/mpsub1", "PUT", { auto_recurring: { transaction_amount: c.recurrence, currency_id: "BRL" } }]]);
      expect(state.change.state).toBe("APPLIED");
      expect(tx().billingSubscription.update).not.toHaveBeenCalled();
      expect(state.sub.paidThrough).toEqual(END_MONTH);
    });
  }

  it("d) redução agendada (Equipe 10+5 antigo -> +4): nada cobrado agora, PUT 229,90 para a próxima renovação", async () => {
    const from = persisted("OLD", "TEAM_MAX", "MONTHLY", 5);
    const q = quotePlanChange(from, { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 4 }, periodFor("MONTHLY"), 14, TODAY);
    state.sub = subscriptionRow(from, END_MONTH); state.change = changeRow(q, {});
    vi.mocked(mp.getSubscription).mockResolvedValueOnce(remoteFor(22490, 1, END_MONTH)).mockResolvedValueOnce(remoteFor(22990, 1, END_MONTH));
    vi.mocked(mp.mpRequest).mockResolvedValue({});
    await syncPlanChanges(state.sub as unknown as BillingSubscription);
    expect(calls()).toEqual([["/preapproval/mpsub1", "PUT", { auto_recurring: { transaction_amount: 229.9, currency_id: "BRL" } }]]);
    expect(state.change.state).toBe("SCHEDULED");
    expect(state.change.amountDueCents).toBe(0);
    expect(state.change.effectiveAt).toEqual(END_MONTH);
    expect(tx().billingSubscription.update).not.toHaveBeenCalled();
  });

  // O motivo da nova assinatura descreve a capacidade total, inclusive adicionais.
  const cycleCases = [
    { name: "f) mudança de ciclo (Individual anual antigo 599 -> Essencial mensal): nova assinatura de 79,90 começando no fim do ano pago",
      from: persisted("OLD", "INDIVIDUAL", "ANNUAL"), target: { plan: "TEAM", cycle: "MONTHLY" }, end: END_YEAR, remote: [59900, 12],
      created: { planCode: "TEAM", cycle: "MONTHLY", amountCents: 7990, agendaLimit: 3, intervalMonths: 1 }, reason: "Everflair Essencial · 3 agendas — mensal", frequency: 1, amount: 79.9 },
    { name: "mudança de ciclo (Equipe 10+5 mensal antigo 224,90 -> Equipe 10+5 anual): nova assinatura de 2.399 começando no fim do mês pago",
      from: persisted("OLD", "TEAM_MAX", "MONTHLY", 5), target: { plan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: 5 }, end: END_MONTH, remote: [22490, 1],
      created: { planCode: "TEAM_MAX", cycle: "ANNUAL", amountCents: 239900, agendaLimit: 15, intervalMonths: 12 }, reason: "Everflair Equipe · 15 agendas — anual", frequency: 12, amount: 2399 },
  ];
  for (const c of cycleCases) {
    it(`${c.name}, com motivo "${c.reason}"`, async () => {
      const q = quotePlanChange(c.from, c.target, periodFor(c.from.cycle), 1, TODAY);
      expect([q.kind, q.amountDueCents]).toEqual(["CYCLE", 0]);
      state.sub = subscriptionRow(c.from, c.end); state.change = changeRow(q, {});
      vi.mocked(mp.getSubscription).mockResolvedValue(remoteFor(c.remote[0], c.remote[1], c.end));
      vi.mocked(mp.mpRequest).mockResolvedValue({}); // resposta inválida: interrompe após capturar o POST
      await expect(syncPlanChanges(state.sub as unknown as BillingSubscription)).rejects.toThrow("PROVIDER_INVALID_RESPONSE");
      expect(state.created).toMatchObject({ ...c.created, catalogVersion: "2026-10-02", current: false });
      const post = calls().find(([p, m]) => p === "/preapproval" && m === "POST");
      expect(post?.[2]).toMatchObject({ reason: c.reason, external_reference: `ef:${SALON}:${state.created!.id}`, status: "pending",
        auto_recurring: { frequency: c.frequency, frequency_type: "months", transaction_amount: c.amount, currency_id: "BRL", start_date: c.end.toISOString() } });
      // A assinatura antiga não é alterada nem cobrada.
      expect(calls().some(([p, m]) => p.startsWith("/preapproval/mpsub1") && m === "PUT")).toBe(false);
    });
  }

  it("conversão centavos -> reais -> centavos é exata para todos os valores alcançáveis", () => {
    const amounts = new Set<number>();
    for (const catalog of ["OLD", "NEW"] as Catalog[]) for (const plan of PLANS) for (const cycle of CYCLES) for (let e = 0; e <= (plan === "TEAM_MAX" ? 100 : 0); e++) amounts.add(price(catalog, plan, cycle, e));
    for (let cents = 1; cents <= 2_100_000; cents++) if (Math.round((cents / 100) * 100) !== cents) amounts.add(-cents);
    expect([...amounts].filter(v => v < 0)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Telas: mesmos números da cotação do servidor
// ---------------------------------------------------------------------------
function view(q: ReturnType<typeof quotePlanChange>, extra: Partial<PlanChangeView> = {}): PlanChangeView {
  return { id: CHANGE_ID, kind: q.kind, state: "QUOTED", from: q.from, to: q.to, amountDueCents: q.amountDueCents, effectiveAt: q.effectiveAt.toISOString(),
    periodEnd: q.periodEnd.toISOString(), expiresAt: q.expiresAt.toISOString(), paidAt: null, activatedAt: null, checkoutUrl: null, lastError: null, ...extra };
}
const money = (s: string) => new RegExp(s.replace("R$ ", "R\\$\\s"));
/** Texto visível com o espaço não separável do Intl trocado por espaço comum, para comparar frases inteiras. */
const text = (el: Element) => el.textContent!.replace(/ /g, " ");
const textOrNull = (el: Element | null) => el ? text(el) : null;
const review = (quote: PlanChangeView) => render(createElement(PlanChangeReview, { quote, timezone: "America/Sao_Paulo", busy: false, error: null, onConfirm: vi.fn(), onClose: vi.fn() }));
const row = (label: RegExp) => screen.getByText(label).closest("div")!;
/** Nota da revisão para contrato abaixo da tabela atual na mesma capacidade. */
const BELOW_TABLE = /valor anterior à tabela atual/;
const warningNote = () => textOrNull(screen.queryByRole("note"));
const belowTableNote = () => textOrNull(screen.queryByText(BELOW_TABLE));

describe("telas de revisão", () => {
  afterEach(() => cleanup());
  it("a) revisão mostra de 59,90 para 79,90, R$ 6,83 agora e nova recorrência em 13/10/2026, sem nota de tabela (59,90 está acima dos 39,90 de hoje)", () => {
    review(view(quotePlanChange(persisted("OLD", "INDIVIDUAL", "MONTHLY"), { plan: "TEAM", cycle: "MONTHLY" }, periodFor("MONTHLY"), 1, TODAY)));
    expect(screen.getByText("Individual · 1 agenda").parentElement!.textContent).toMatch(money("R$ 59,90 por mês"));
    expect(screen.getByText("Essencial · 3 agendas").parentElement!.textContent).toMatch(money("R$ 79,90 por mês"));
    expect(row(/Cobrança adicional agora/).textContent).toMatch(money("R$ 6,83"));
    expect(row(/Nova recorrência a partir de 13 de out\.? de 2026/).textContent).toMatch(money("R$ 79,90 por mês"));
    expect(row(/Quando vale/).textContent).toContain("Logo após o pagamento");
    expect(screen.getByRole("button", { name: "Confirmar e pagar diferença" })).toBeEnabled();
    expect(belowTableNote()).toBeNull();
    expect(warningNote()).toBeNull();
  });
  it("e) revisão do adicional: 224,90 -> 269,90 com R$ 15,36 agora e nota de que o contrato está abaixo da tabela atual (R$ 249,90)", () => {
    review(view(quotePlanChange(persisted("OLD", "TEAM_MAX", "MONTHLY", 5), { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 6 }, periodFor("MONTHLY"), 15, TODAY)));
    expect(screen.getByText("Equipe · 15 agendas").parentElement!.textContent).toMatch(money("R$ 224,90 por mês"));
    expect(screen.getByText("Equipe · 16 agendas").parentElement!.textContent).toMatch(money("R$ 269,90 por mês"));
    expect(row(/Cobrança adicional agora/).textContent).toMatch(money("R$ 15,36"));
    expect(belowTableNote()).toBe("Hoje você paga R$ 224,90 por mês, valor anterior à tabela atual (R$ 249,90 para a mesma capacidade). Com a troca, o novo plano segue a tabela atual.");
    // Upgrade: mais agendas por um valor maior não recebe o aviso de redução mais cara.
    expect(warningNote()).toBeNull();
  });
  it("d) revisão da redução que encarece: R$ 0 agora, 229,90 no vencimento e aviso de que a renovação passa de 224,90 para 229,90", () => {
    review(view(quotePlanChange(persisted("OLD", "TEAM_MAX", "MONTHLY", 5), { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 4 }, periodFor("MONTHLY"), 14, TODAY)));
    expect(row(/Cobrança adicional agora/).textContent).toMatch(money("R$ 0"));
    expect(row(/Nova recorrência a partir de 13 de out\.? de 2026/).textContent).toMatch(money("R$ 229,90 por mês"));
    expect(row(/Quando vale/).textContent).toMatch(/No próximo vencimento, 13 de out\.? de 2026/);
    expect(warningNote()).toBe("Atenção: mesmo com menos agendas, a renovação passa de R$ 224,90 para R$ 229,90 por mês.");
    expect(belowTableNote()).toBe("Hoje você paga R$ 224,90 por mês, valor anterior à tabela atual (R$ 249,90 para a mesma capacidade). Com a troca, o novo plano segue a tabela atual.");
    expect(screen.getByRole("button", { name: "Confirmar troca" })).toBeEnabled();
  });
  it("f) revisão da mudança de ciclo: anual 599 -> mensal 79,90 a partir de 13/09/2027, sem aviso nem nota de tabela", () => {
    review(view(quotePlanChange(persisted("OLD", "INDIVIDUAL", "ANNUAL"), { plan: "TEAM", cycle: "MONTHLY" }, periodFor("ANNUAL"), 1, TODAY)));
    expect(screen.getByText("Individual · 1 agenda").parentElement!.textContent).toMatch(money("R$ 599 a cada 12 meses"));
    expect(row(/Nova recorrência a partir de 13 de set\.? de 2027/).textContent).toMatch(money("R$ 79,90 por mês"));
    expect(row(/Cobrança adicional agora/).textContent).toMatch(money("R$ 0"));
    expect(warningNote()).toBeNull();
    expect(belowTableNote()).toBeNull();
  });

  // Mais casos das notas da revisão, com os textos exatos esperados.
  const noteCases: { name: string; from: BillingTerms; target: { plan: Plan; cycle: Cycle; extraAgendas: number }; occupied: number; warning: string | null; note: string | null }[] = [
    { name: "Equipe 10+5 anual antigo (R$ 2.159) -> +4 anual (R$ 2.207): aviso a cada 12 meses e nota de tabela (R$ 2.399)",
      from: persisted("OLD", "TEAM_MAX", "ANNUAL", 5), target: { plan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: 4 }, occupied: 14,
      warning: "Atenção: mesmo com menos agendas, a renovação passa de R$ 2.159 para R$ 2.207 a cada 12 meses.",
      note: "Hoje você paga R$ 2.159 a cada 12 meses, valor anterior à tabela atual (R$ 2.399 para a mesma capacidade). Com a troca, o novo plano segue a tabela atual." },
    { name: "Equipe 10+4 antigo (R$ 209,90) -> +3 pelo mesmo valor (R$ 209,90): sem aviso, pois a renovação não aumenta; com nota de tabela (R$ 229,90)",
      from: persisted("OLD", "TEAM_MAX", "MONTHLY", 4), target: { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 3 }, occupied: 13,
      warning: null, note: "Hoje você paga R$ 209,90 por mês, valor anterior à tabela atual (R$ 229,90 para a mesma capacidade). Com a troca, o novo plano segue a tabela atual." },
    { name: "Equipe 10+5 pela tabela atual (R$ 249,90) -> +4 (R$ 229,90): nem aviso nem nota",
      from: persisted("NEW", "TEAM_MAX", "MONTHLY", 5), target: { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 4 }, occupied: 14, warning: null, note: null },
  ];
  for (const { name, from, target, occupied, warning, note } of noteCases) {
    it(`notas da revisão: ${name}`, () => {
      const q = quotePlanChange(from, target, periodFor(from.cycle), occupied, TODAY);
      expect([q.kind, q.amountDueCents]).toEqual(["SCHEDULED", 0]);
      review(view(q));
      expect(warningNote()).toBe(warning);
      expect(belowTableNote()).toBe(note);
    });
  }

  const scheduledSub = (): SubscriptionView => {
    const q = quotePlanChange(persisted("NEW", "TEAM", "MONTHLY"), { plan: "INDIVIDUAL", cycle: "MONTHLY" }, periodFor("MONTHLY"), 1, TODAY);
    return { id: SUB_ID, plan: "TEAM", cycle: "MONTHLY", amountCents: 7990, agendaLimit: 3, state: "ACTIVE", paidThrough: END_MONTH.toISOString(), nextPaymentAt: END_MONTH.toISOString(),
      cancelRequestedAt: null, cancelledAt: null, reviewRequired: false, renewalCancellationStatus: "AVAILABLE", checkoutUrl: null, providerStatus: "authorized", lastSyncedAt: null,
      changesAvailable: true, changePending: true, change: view(q, { state: "SCHEDULED" }), charges: [] };
  };
  const card = (subscription: SubscriptionView) => render(createElement(CurrentPlanCard, { subscription, legacy: { label: "Grátis", agendas: 1, free: true }, occupiedAgendas: 1,
    timezone: "America/Sao_Paulo", email: "owner@example.test", accessBlocked: false, returnedFromCheckout: false, refreshing: false, busy: false, preparingChangeCheckout: false,
    onRefresh: vi.fn(), onCancelChange: vi.fn() }));
  it("cartão com redução agendada anuncia o novo valor no aviso da troca", () => {
    card(scheduledSub());
    expect(screen.getByText(/Novo ciclo a partir de/).textContent).toMatch(money("R$ 39,90 por mês"));
  });
  it("cartão com redução agendada: 'Próxima cobrança' mostra a data e o valor agendado (R$ 39,90), o mesmo já enviado ao Mercado Pago", () => {
    card(scheduledSub());
    expect(text(screen.getByText("Próxima cobrança").nextElementSibling!)).toBe("13 de out. de 2026 · R$ 39,90");
    expect(text(screen.getByText("Periodicidade").nextElementSibling!)).toBe("Mensal");
  });

  /** Preço em destaque no card do seletor e a linha logo abaixo dele. */
  const priceLines = (article: HTMLElement) => {
    const price = within(article).getByText(/^\/(mês|ano)$/).parentElement!;
    return [text(price), text(price.nextElementSibling!)];
  };
  it("c) assinante antigo do Individual vê no card 'Seu plano' o valor do contrato (R$ 59,90) e o preço para novas contratações (R$ 39,90)", () => {
    render(createElement(PlanPicker, { mode: "change", current: { plan: "INDIVIDUAL", cycle: "MONTHLY", agendaLimit: 1, amountCents: 5990 }, occupiedAgendas: 1, onChoose: vi.fn() }));
    const individual = screen.getByRole("article", { name: "Individual" });
    expect(within(individual).getByText("Seu plano")).toBeInTheDocument();
    expect(within(individual).getByRole("button", { name: "Plano atual" })).toBeDisabled();
    expect(priceLines(individual)).toEqual(["R$ 59,90/mês", "Valor do seu contrato. Para novas contratações: R$ 39,90/mês."]);
  });
  it("d/e) seletor do Equipe 10+5 antigo: 'Plano atual' a 224,90 (tabela 249,90); +4 a 229,90 = 'Mudar para este plano'; +3 a 209,90 = 'Reduzir'; +6 a 269,90 = 'Fazer upgrade'", () => {
    const onChoose = vi.fn();
    render(createElement(PlanPicker, { mode: "change", current: { plan: "TEAM_MAX", cycle: "MONTHLY", agendaLimit: 15, amountCents: 22490 }, occupiedAgendas: 12, onChoose }));
    const equipe = () => screen.getByRole("article", { name: "Equipe" });
    const click = (name: string) => fireEvent.click(within(equipe()).getByRole("button", { name }));
    expect(within(equipe()).getByText("Seu plano")).toBeInTheDocument();
    expect(within(equipe()).getByRole("button", { name: "Plano atual" })).toBeDisabled();
    expect(priceLines(equipe())).toEqual(["R$ 224,90/mês", "Valor do seu contrato. Para novas contratações: R$ 249,90/mês."]);
    // +4: menos agendas, mas a renovação fica mais cara (229,90 > 224,90). Não é anunciado como redução.
    click("Remover uma agenda adicional");
    expect(priceLines(equipe())[0]).toBe("R$ 229,90/mês");
    expect(within(equipe()).queryByRole("button", { name: /^Reduzir para este plano/ })).toBeNull();
    click("Mudar para este plano: Equipe · 10 agendas");
    expect(onChoose).toHaveBeenLastCalledWith({ plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 4 });
    // +3: menos agendas e mais barato (209,90 < 224,90).
    click("Remover uma agenda adicional");
    expect(priceLines(equipe())[0]).toBe("R$ 209,90/mês");
    click("Reduzir para este plano: Equipe · 10 agendas");
    expect(onChoose).toHaveBeenLastCalledWith({ plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 3 });
    // +6: mais agendas por um valor maior.
    for (let i = 0; i < 3; i++) click("Adicionar uma agenda adicional");
    expect(priceLines(equipe())[0]).toBe("R$ 269,90/mês");
    click("Fazer upgrade: Equipe · 10 agendas");
    expect(onChoose).toHaveBeenLastCalledWith({ plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 6 });
    expect(onChoose).toHaveBeenCalledTimes(3);
  });
});
