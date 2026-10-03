// @vitest-environment jsdom
/**
 * Verificação adversarial da auditoria "troca-de-plano-abatimento", mantida como
 * regressão das correções: "Próxima cobrança" e "Periodicidade" com troca confirmada
 * (nextChargeOf) e rótulos/preços do seletor para contratos do catálogo anterior.
 * Valores esperados escritos à mão ou calculados aqui com tabelas próprias.
 * Nenhum banco ou API externa: só funções puras e componentes renderizados.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { quotePlanChange, type BillingTerms } from "./change-rules";
import { CurrentPlanCard } from "@/components/billing/current-plan-card";
import { PlanPicker } from "@/components/billing/plan-picker";
import { nextChargeOf, type PlanChangeView, type SubscriptionView } from "./presentation";

type Plan = "INDIVIDUAL" | "TEAM" | "TEAM_PLUS" | "TEAM_MAX";
type Cycle = "MONTHLY" | "ANNUAL";
const AG: Record<Plan, number> = { INDIVIDUAL: 1, TEAM: 3, TEAM_PLUS: 5, TEAM_MAX: 10 };
const NEW: Record<Plan, Record<Cycle, number>> = { INDIVIDUAL: { MONTHLY: 3990, ANNUAL: 39900 }, TEAM: { MONTHLY: 7990, ANNUAL: 77900 }, TEAM_PLUS: { MONTHLY: 9990, ANNUAL: 95900 }, TEAM_MAX: { MONTHLY: 14990, ANNUAL: 143900 } };
const OLD: Record<Plan, Record<Cycle, number>> = { ...NEW, INDIVIDUAL: { MONTHLY: 5990, ANNUAL: 59900 } };
const EXTRA_OLD: Record<Cycle, number> = { MONTHLY: 1500, ANNUAL: 14400 };
const EXTRA_NEW: Record<Cycle, number> = { MONTHLY: 2000, ANNUAL: 19200 };
const terms = (old: boolean, plan: Plan, cycle: Cycle, extras = 0): BillingTerms => ({ plan, cycle,
  amountCents: (old ? OLD : NEW)[plan][cycle] + extras * (old ? EXTRA_OLD : EXTRA_NEW)[cycle], agendaLimit: AG[plan] + extras,
  intervalMonths: cycle === "ANNUAL" ? 12 : 1, catalogVersion: old ? "2026-09-13" : "2026-10-02" });

const START = new Date("2026-09-13T17:42:29.000Z");
const END_MONTH = new Date("2026-10-13T17:42:29.000Z");
const END_YEAR = new Date("2027-09-13T17:42:29.000Z");
const TODAY = new Date("2026-10-03T12:00:00.000Z");
const brl = (s: string) => new RegExp(s.replace("R$ ", "R\\$\\s"));
/** Texto visível com o espaço não separável do Intl trocado por espaço comum, para comparar frases inteiras. */
const text = (el: Element) => el.textContent!.replace(/ /g, " ");

function view(from: BillingTerms, to: BillingTerms, kind: string, state: string, end: Date): PlanChangeView {
  return { id: "22222222-2222-4222-8222-222222222222", kind, state, from, to, amountDueCents: 0, effectiveAt: end.toISOString(), periodEnd: end.toISOString(),
    expiresAt: new Date(TODAY.getTime() + 900_000).toISOString(), paidAt: null, activatedAt: null, checkoutUrl: null, lastError: null };
}
function sub(current: BillingTerms, end: Date, change: PlanChangeView | null, extra: Partial<SubscriptionView> = {}): SubscriptionView {
  return { id: "11111111-1111-4111-8111-111111111111", plan: current.plan, cycle: current.cycle, amountCents: current.amountCents, agendaLimit: current.agendaLimit,
    state: "ACTIVE", paidThrough: end.toISOString(), nextPaymentAt: end.toISOString(), cancelRequestedAt: null, cancelledAt: null, reviewRequired: false,
    renewalCancellationStatus: "AVAILABLE", checkoutUrl: null, providerStatus: "authorized", lastSyncedAt: null, changesAvailable: true,
    changePending: Boolean(change), change, charges: [], ...extra };
}
const card = (s: SubscriptionView) => render(createElement(CurrentPlanCard, { subscription: s, legacy: { label: "Grátis", agendas: 1, free: true }, occupiedAgendas: 1,
  timezone: "America/Sao_Paulo", email: "owner@example.test", accessBlocked: false, returnedFromCheckout: false, refreshing: false, busy: false,
  preparingChangeCheckout: false, onRefresh: vi.fn(), onCancelChange: vi.fn() }));
const nextCharge = () => text(screen.getByText("Próxima cobrança").nextElementSibling!);
const periodicity = () => text(screen.getByText("Periodicidade").nextElementSibling!);

// d) Equipe 10+5 antigo (R$ 224,90) -> +4 pela tabela atual (R$ 229,90), agendada para 13/10/2026.
const reductionFrom = terms(true, "TEAM_MAX", "MONTHLY", 5), reductionTo = terms(false, "TEAM_MAX", "MONTHLY", 4);
// f) Individual anual antigo (R$ 599) -> Essencial mensal (R$ 79,90) a partir de 13/09/2027.
const yearlyFrom = terms(true, "INDIVIDUAL", "ANNUAL"), monthlyTo = terms(false, "TEAM", "MONTHLY");
// Individual mensal antigo (R$ 59,90) -> Individual anual (R$ 399) a partir de 13/10/2026.
const monthlyFrom = terms(true, "INDIVIDUAL", "MONTHLY"), yearlyTo = terms(false, "INDIVIDUAL", "ANNUAL");
/** Mudança de ciclo: a recorrência antiga já foi cancelada no MP; com a substituta viva, renewalCancellationStatus segue AVAILABLE (cancellation.ts). */
const replaced: Partial<SubscriptionView> = { cancelledAt: TODAY.toISOString(), nextPaymentAt: null };
/** Renovação cancelada, sem assinatura substituta. */
const cancelledRenewal: Partial<SubscriptionView> = { cancelledAt: TODAY.toISOString(), nextPaymentAt: null, renewalCancellationStatus: "CANCELLED" };

afterEach(() => cleanup());

describe("cartão do plano: 'Próxima cobrança' e 'Periodicidade' anunciam a troca confirmada", () => {
  it("d) Equipe 10+5 antigo com redução agendada para +4: 'Próxima cobrança' mostra 13/10/2026 · R$ 229,90, o valor já enviado ao Mercado Pago", () => {
    expect([reductionFrom.amountCents, reductionTo.amountCents]).toEqual([22490, 22990]);
    card(sub(reductionFrom, END_MONTH, view(reductionFrom, reductionTo, "SCHEDULED", "SCHEDULED", END_MONTH)));
    expect(nextCharge()).toBe("13 de out. de 2026 · R$ 229,90");
    expect(periodicity()).toBe("Mensal");
    expect(screen.getByText(/Novo ciclo a partir de/).textContent).toMatch(brl("R$ 229,90 por mês"));
  });
  it("mudança de ciclo já autorizada (Individual anual antigo R$ 599 -> Essencial mensal): 'Próxima cobrança' 13/09/2027 · R$ 79,90 e periodicidade anunciando o mensal", () => {
    card(sub(yearlyFrom, END_YEAR, view(yearlyFrom, monthlyTo, "CYCLE", "SCHEDULED", END_YEAR), replaced));
    expect(nextCharge()).toBe("13 de set. de 2027 · R$ 79,90");
    expect(periodicity()).toBe("Anual (12 meses) · mensal a partir de 13 de set. de 2027");
    expect(screen.getByText(/Novo ciclo a partir de/).textContent).toMatch(brl("R$ 79,90 por mês"));
  });
  it("mudança de ciclo aguardando a nova autorização (AWAITING_PAYMENT): 'Próxima cobrança' 13/09/2027 · R$ 79,90, após sua autorização", () => {
    card(sub(yearlyFrom, END_YEAR, view(yearlyFrom, monthlyTo, "CYCLE", "AWAITING_PAYMENT", END_YEAR), replaced));
    expect(nextCharge()).toBe("13 de set. de 2027 · R$ 79,90, após sua autorização");
    expect(periodicity()).toBe("Anual (12 meses) · mensal a partir de 13 de set. de 2027");
  });
  it("mudança de mensal para anual aguardando autorização (Individual antigo R$ 59,90 -> anual R$ 399): 13/10/2026 · R$ 399, após sua autorização", () => {
    card(sub(monthlyFrom, END_MONTH, view(monthlyFrom, yearlyTo, "CYCLE", "AWAITING_PAYMENT", END_MONTH), replaced));
    expect(nextCharge()).toBe("13 de out. de 2026 · R$ 399, após sua autorização");
    expect(periodicity()).toBe("Mensal · anual (12 meses) a partir de 13 de out. de 2026");
  });
  for (const state of ["REVIEW", "CANCEL_REQUESTED"]) {
    it(`troca em ${state} não é anunciada: 'Próxima cobrança' mantém 13/10/2026 · R$ 224,90 do contrato vigente`, () => {
      card(sub(reductionFrom, END_MONTH, view(reductionFrom, reductionTo, "SCHEDULED", state, END_MONTH), { reviewRequired: state === "REVIEW" }));
      expect(nextCharge()).toBe("13 de out. de 2026 · R$ 224,90");
      expect(periodicity()).toBe("Mensal");
    });
  }
  it("renovação cancelada: 'Sem novas cobranças', inclusive com mudança de ciclo interrompida no histórico", () => {
    card(sub(reductionFrom, END_MONTH, null, cancelledRenewal));
    expect(nextCharge()).toBe("Sem novas cobranças");
    expect(periodicity()).toBe("Mensal");
    cleanup();
    card(sub(yearlyFrom, END_YEAR, view(yearlyFrom, monthlyTo, "CYCLE", "EXPIRED", END_YEAR), { ...cancelledRenewal, changePending: false }));
    expect(nextCharge()).toBe("Sem novas cobranças");
    expect(periodicity()).toBe("Anual (12 meses)");
  });
  it("upgrade já pago (APPLIED): 'Próxima cobrança' usa o novo valor, porque currentTerms considera activatedAt", () => {
    card(sub(terms(false, "TEAM", "MONTHLY"), END_MONTH, null));
    expect(nextCharge()).toBe("13 de out. de 2026 · R$ 79,90");
  });
});

describe("nextChargeOf: próxima cobrança considerando a troca confirmada", () => {
  it("redução agendada (SCHEDULED): data e valor da troca, sem nova autorização", () => {
    expect(nextChargeOf(sub(reductionFrom, END_MONTH, view(reductionFrom, reductionTo, "SCHEDULED", "SCHEDULED", END_MONTH))))
      .toEqual({ at: "2026-10-13T17:42:29.000Z", amountCents: 22990, cycle: "MONTHLY", afterAuthorization: false });
  });
  const cycleStates: { state: string; extra: Partial<SubscriptionView>; afterAuthorization: boolean }[] = [
    { state: "PREPARING", extra: { cancelRequestedAt: TODAY.toISOString() }, afterAuthorization: true },
    { state: "AWAITING_PAYMENT", extra: replaced, afterAuthorization: true },
    { state: "SCHEDULED", extra: replaced, afterAuthorization: false },
  ];
  for (const { state, extra, afterAuthorization } of cycleStates) {
    it(`mudança de ciclo em ${state}: R$ 79,90 mensal a partir de 13/09/2027, ${afterAuthorization ? "após a nova autorização" : "já autorizada"}`, () => {
      expect(nextChargeOf(sub(yearlyFrom, END_YEAR, view(yearlyFrom, monthlyTo, "CYCLE", state, END_YEAR), extra)))
        .toEqual({ at: "2027-09-13T17:42:29.000Z", amountCents: 7990, cycle: "MONTHLY", afterAuthorization });
    });
  }
  for (const state of ["REVIEW", "CANCEL_REQUESTED"]) {
    it(`troca em ${state}: vale o contrato vigente (R$ 224,90 em 13/10/2026)`, () => {
      expect(nextChargeOf(sub(reductionFrom, END_MONTH, view(reductionFrom, reductionTo, "SCHEDULED", state, END_MONTH), { reviewRequired: state === "REVIEW" })))
        .toEqual({ at: "2026-10-13T17:42:29.000Z", amountCents: 22490, cycle: "MONTHLY", afterAuthorization: false });
    });
  }
  it("renovação cancelada: nenhuma próxima cobrança, inclusive com mudança de ciclo interrompida no histórico", () => {
    expect(nextChargeOf(sub(reductionFrom, END_MONTH, null, cancelledRenewal))).toBeNull();
    // Recorrência cancelada direto no Mercado Pago com uma redução ainda agendada: não há próxima cobrança.
    expect(nextChargeOf(sub(reductionFrom, END_MONTH, view(reductionFrom, reductionTo, "SCHEDULED", "SCHEDULED", END_MONTH), cancelledRenewal))).toBeNull();
    expect(nextChargeOf(sub(yearlyFrom, END_YEAR, view(yearlyFrom, monthlyTo, "CYCLE", "EXPIRED", END_YEAR), { ...cancelledRenewal, changePending: false }))).toBeNull();
  });
});

describe("seletor de planos x regra do servidor, inclusive para contratos antigos", () => {
  const sources: { label: string; t: BillingTerms }[] = [];
  for (const old of [true, false]) for (const cycle of ["MONTHLY", "ANNUAL"] as Cycle[]) {
    for (const plan of ["INDIVIDUAL", "TEAM", "TEAM_PLUS"] as Plan[]) sources.push({ label: `${old ? "antigo" : "novo"} ${plan} ${cycle}`, t: terms(old, plan, cycle) });
    for (const k of [0, 3, 5, 8]) sources.push({ label: `${old ? "antigo" : "novo"} TEAM_MAX+${k} ${cycle}`, t: terms(old, "TEAM_MAX", cycle, k) });
  }
  /** Adicionais percorridos no card Equipe · 10 agendas. */
  const EXTRAS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  // Regra aprovada: upgrade só com mais agendas e preço maior; redução só com menos agendas e preço menor;
  // qualquer outra troca no mesmo ciclo é neutra ("Mudar para este plano").
  function expectedLabel(cur: BillingTerms, plan: Plan, cycle: Cycle, extras: number) {
    const to = terms(false, plan, cycle, extras);
    if (cur.plan === plan && cur.cycle === cycle && cur.agendaLimit === to.agendaLimit) return "Plano atual";
    if (cycle !== cur.cycle) return `Mudar para ${cycle === "ANNUAL" ? "anual" : "mensal"}`;
    if (to.agendaLimit > cur.agendaLimit && to.amountCents > cur.amountCents) return "Fazer upgrade";
    if (to.agendaLimit < cur.agendaLimit && to.amountCents < cur.amountCents) return "Reduzir para este plano";
    return "Mudar para este plano";
  }
  function serverKind(cur: BillingTerms, plan: Plan, cycle: Cycle, extras: number) {
    try { return quotePlanChange(cur, { plan, cycle, extraAgendas: extras }, { start: START, end: cur.cycle === "ANNUAL" ? END_YEAR : END_MONTH }, 0, TODAY).kind; }
    catch (e) { return (e as Error).message; }
  }
  const labelToKind: Record<string, string> = { "Plano atual": "PLAN_UNCHANGED", "Fazer upgrade": "UPGRADE", "Reduzir para este plano": "SCHEDULED", "Mudar para este plano": "SCHEDULED", "Mudar para anual": "CYCLE", "Mudar para mensal": "CYCLE" };
  /** Formatação própria do valor (R$ 1.234,56; centavos zerados omitidos), sem usar billingMoney. */
  const fmt = (cents: number) => {
    const [int, dec] = (cents / 100).toFixed(2).split(".");
    return `R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}${dec === "00" ? "" : `,${dec}`}`;
  };
  /** Preço em destaque no card e a linha logo abaixo dele. */
  const priceLines = (article: HTMLElement) => {
    const price = within(article).getByText(/^\/(mês|ano)$/).parentElement!;
    return [text(price), text(price.nextElementSibling!)];
  };

  it("a matriz inclui as trocas neutras: menos agendas sem renovação mais barata", () => {
    const neutral = sources.flatMap(({ label, t }) => EXTRAS.filter(ex => expectedLabel(t, "TEAM_MAX", t.cycle, ex) === "Mudar para este plano").map(ex => `${label} -> +${ex}`));
    expect(neutral).toEqual(["antigo TEAM_MAX+5 MONTHLY -> +4", "antigo TEAM_MAX+8 MONTHLY -> +6", "antigo TEAM_MAX+8 MONTHLY -> +7",
      "antigo TEAM_MAX+5 ANNUAL -> +4", "antigo TEAM_MAX+8 ANNUAL -> +6", "antigo TEAM_MAX+8 ANNUAL -> +7"]);
  });

  it.each(sources)("$label", ({ t }) => {
    render(createElement(PlanPicker, { mode: "change", current: { plan: t.plan, cycle: t.cycle, agendaLimit: t.agendaLimit, amountCents: t.amountCents }, occupiedAgendas: 0, onChoose: vi.fn() }));
    const mismatches: string[] = [];
    const check = (name: string, plan: Plan, cycle: Cycle, ex: number) => {
      const article = screen.getByRole("article", { name });
      const tag = `${plan}+${ex} ${cycle}`;
      const button = within(article).getAllByRole("button").at(-1)!;
      const label = (button.getAttribute("aria-label") ?? button.textContent ?? "").split(":")[0].trim();
      const want = expectedLabel(t, plan, cycle, ex);
      if (label !== want) mismatches.push(`${tag}: tela "${label}" != esperado "${want}"`);
      const kind = serverKind(t, plan, cycle, ex);
      if (labelToKind[label] !== kind) mismatches.push(`${tag}: tela "${label}" != servidor ${kind}`);
      // Preço em destaque: o valor do contrato no card "Seu plano"; a tabela atual (catálogo novo) nos demais.
      const table = terms(false, plan, cycle, ex).amountCents, per = cycle === "ANNUAL" ? "ano" : "mês";
      const [main, below] = priceLines(article);
      if (want === "Plano atual") {
        const contract = t.amountCents === table ? "Valor do seu contrato." : `Valor do seu contrato. Para novas contratações: ${fmt(table)}/${per}.`;
        if (main !== `${fmt(t.amountCents)}/${per}` || below !== contract) mismatches.push(`${tag}: card "Seu plano" mostra "${main} | ${below}", esperado "${fmt(t.amountCents)}/${per} | ${contract}"`);
      } else if (main !== `${fmt(table)}/${per}` || below.startsWith("Valor do seu contrato")) mismatches.push(`${tag}: card mostra "${main} | ${below}", esperado ${fmt(table)}/${per} pela tabela atual`);
    };
    for (const cycle of ["MONTHLY", "ANNUAL"] as Cycle[]) {
      fireEvent.click(screen.getByRole("radio", { name: cycle === "ANNUAL" ? /Anual/ : /Mensal/ }));
      fireEvent.click(screen.getByRole("radio", { name: "5 agendas" }));
      check("Individual", "INDIVIDUAL", cycle, 0);
      check("Essencial", "TEAM", cycle, 0);
      check("Equipe", "TEAM_PLUS", cycle, 0);
      fireEvent.click(screen.getByRole("radio", { name: "10 agendas" }));
      const input = within(screen.getByRole("article", { name: "Equipe" })).getByRole<HTMLInputElement>("spinbutton");
      // O seletor abre com os adicionais do contrato atual.
      const initial = String(t.plan === "TEAM_MAX" ? t.agendaLimit - 10 : 0);
      if (cycle === "MONTHLY" && input.value !== initial) mismatches.push(`adicionais iniciais ${input.value} != ${initial}`);
      for (const ex of EXTRAS) {
        fireEvent.change(input, { target: { value: String(ex) } });
        check("Equipe", "TEAM_MAX", cycle, ex);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe("abatimento em períodos de duração diferente (calendário real)", () => {
  // Diferença cheia x restante / total, com total = duração real do período em ms.
  const cases: [string, string, string, string, BillingTerms, Plan, number, number][] = [
    // fevereiro (28 dias): Individual antigo -> Essencial, metade exata do período
    ["fev 28d metade", "2027-01-31T10:00:00Z", "2027-02-28T10:00:00Z", "2027-02-14T10:00:00Z", terms(true, "INDIVIDUAL", "MONTHLY"), "TEAM", 0, 1000],
    // ano bissexto (366 dias): Individual anual novo -> Essencial anual, 1/4 restante = 38000/4
    ["ano 366d 1/4", "2027-03-01T00:00:00Z", "2028-03-01T00:00:00Z", "2027-11-30T12:00:00Z", terms(false, "INDIVIDUAL", "ANNUAL"), "TEAM", 0, 9500],
    // Equipe 10+0 anual antigo -> +100 anual: 1 ms após o início -> ceil(1.920.000 x (T-1)/T) = 1.920.000
    ["anual +100 1ms", "2027-03-01T00:00:00Z", "2028-03-01T00:00:00Z", "2027-03-01T00:00:00.001Z", terms(true, "TEAM_MAX", "ANNUAL", 0), "TEAM_MAX", 100, 1920000],
  ];
  it.each(cases)("%s", (_n, s, e, now, from, plan, extras, due) => {
    const q = quotePlanChange(from, { plan, cycle: from.cycle, extraAgendas: extras }, { start: new Date(s), end: new Date(e) }, 0, new Date(now));
    expect([q.kind, q.amountDueCents]).toEqual(["UPGRADE", due]);
  });
});
