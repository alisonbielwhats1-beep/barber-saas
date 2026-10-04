// @vitest-environment jsdom
/**
 * Validação de coerência de preços (dimensão "precos-telas").
 * Todos os valores esperados são literais calculados à mão a partir da tabela
 * aprovada em 02/10/2026 (catálogo 2026-10-02):
 *   Individual 39,90/mês · 399/ano; Essencial 79,90 · 779; Equipe 5 99,90 · 959;
 *   Equipe 10 149,90 · 1.439; agenda adicional (só Equipe 10) 20/mês · 192/ano.
 * Nenhuma expectativa é produzida chamando a função sob teste.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarketingPlans } from "../marketing/marketing-plans";
import { PlanPicker } from "./plan-picker";
import { CurrentPlanCard } from "./current-plan-card";
import { BillingHistory } from "./billing-history";
import { PlanChangeReview } from "./plan-change-review";
import { SubscriptionPortal } from "./subscription-portal";
import { SignupForm } from "@/app/(auth)/signup/signup-form";
import SignupPage from "@/app/(auth)/signup/page";
import { BILLING_PLANS, CATALOG_VERSION, EXTRA_AGENDA, quoteContract } from "@/lib/billing/catalog";
import type { PlanChangeView, SubscriptionView } from "@/lib/billing/presentation";

const mocks = vi.hoisted(() => ({ signup: vi.fn(), signIn: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/(auth)/signup/actions", () => ({ signup: mocks.signup }));
vi.mock("next-auth/react", () => ({ signIn: mocks.signIn }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("./navigation", () => ({ goToCheckout: vi.fn() }));
vi.mock("@/components/marketing/establishment-shell", () => ({ EstablishmentShell: ({ children }: { children: React.ReactNode }) => children }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); sessionStorage.clear(); });

const norm = (value: string | null | undefined) => (value ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
type Plan = "INDIVIDUAL" | "TEAM" | "TEAM_PLUS" | "TEAM_MAX";
type Cycle = "MONTHLY" | "ANNUAL";
const EXTRAS = [0, 1, 2, 100] as const;

// --- Tabela independente, em centavos (literais) ---
const CENTS: Record<Cycle, Record<Exclude<Plan, "TEAM_MAX">, number> & { TEAM_MAX: Record<number, number> }> = {
  MONTHLY: { INDIVIDUAL: 3990, TEAM: 7990, TEAM_PLUS: 9990, TEAM_MAX: { 0: 14990, 1: 16990, 2: 18990, 100: 214990 } },
  ANNUAL: { INDIVIDUAL: 39900, TEAM: 77900, TEAM_PLUS: 95900, TEAM_MAX: { 0: 143900, 1: 163100, 2: 182300, 100: 2063900 } },
};
// --- Os mesmos valores formatados em BRL (escritos à mão) ---
const BRL: Record<Cycle, Record<Exclude<Plan, "TEAM_MAX">, string> & { TEAM_MAX: Record<number, string> }> = {
  MONTHLY: { INDIVIDUAL: "R$ 39,90", TEAM: "R$ 79,90", TEAM_PLUS: "R$ 99,90", TEAM_MAX: { 0: "R$ 149,90", 1: "R$ 169,90", 2: "R$ 189,90", 100: "R$ 2.149,90" } },
  ANNUAL: { INDIVIDUAL: "R$ 399", TEAM: "R$ 779", TEAM_PLUS: "R$ 959", TEAM_MAX: { 0: "R$ 1.439", 1: "R$ 1.631", 2: "R$ 1.823", 100: "R$ 20.639" } },
};
// 12 mensalidades - anual: Individual 47.880-39.900; Essencial 95.880-77.900; Equipe5 119.880-95.900;
// Equipe10+n: (14.990+2.000n)*12 - (143.900+19.200n) = 35.980 + 4.800n
const SAVING: Record<Exclude<Plan, "TEAM_MAX">, string> & { TEAM_MAX: Record<number, string> } = {
  INDIVIDUAL: "R$ 79,80", TEAM: "R$ 179,80", TEAM_PLUS: "R$ 239,80", TEAM_MAX: { 0: "R$ 359,80", 1: "R$ 407,80", 2: "R$ 455,80", 100: "R$ 5.159,80" },
};
// round(anual/12): 3325; 6491,67->6492; 7991,67->7992; 11991,67->11992; +1600n
const PER_MONTH: Record<Exclude<Plan, "TEAM_MAX">, string> & { TEAM_MAX: Record<number, string> } = {
  INDIVIDUAL: "R$ 33,25", TEAM: "R$ 64,92", TEAM_PLUS: "R$ 79,92", TEAM_MAX: { 0: "R$ 119,92", 1: "R$ 135,92", 2: "R$ 151,92", 100: "R$ 1.719,92" },
};
const pick = <T,>(table: Record<Exclude<Plan, "TEAM_MAX">, T> & { TEAM_MAX: Record<number, T> }, plan: Plan, extra = 0): T =>
  plan === "TEAM_MAX" ? table.TEAM_MAX[extra] : table[plan];
const per = (cycle: Cycle) => cycle === "ANNUAL" ? "ano" : "mês";

describe("catálogo 2026-10-02 contra a tabela aprovada (literais)", () => {
  it("tem versão, preços base e agenda adicional aprovados", () => {
    expect(CATALOG_VERSION).toBe("2026-10-02");
    expect(BILLING_PLANS).toEqual({
      INDIVIDUAL: { label: "Individual", agendas: 1, monthly: 3990, annual: 39900 },
      TEAM: { label: "Essencial", agendas: 3, monthly: 7990, annual: 77900 },
      TEAM_PLUS: { label: "Equipe · 5 agendas", agendas: 5, monthly: 9990, annual: 95900 },
      TEAM_MAX: { label: "Equipe · 10 agendas", agendas: 10, monthly: 14990, annual: 143900 },
    });
    expect(EXTRA_AGENDA).toEqual({ monthly: 2000, annual: 19200 });
  });
  it.each((["MONTHLY", "ANNUAL"] as const).flatMap(cycle => [
    ...(["INDIVIDUAL", "TEAM", "TEAM_PLUS"] as const).map(plan => [plan, cycle, 0] as const),
    ...EXTRAS.map(extra => ["TEAM_MAX", cycle, extra] as const),
  ]))("quoteContract %s %s +%i cobra o literal esperado", (plan, cycle, extra) => {
    const quote = quoteContract({ plan, cycle, extraAgendas: extra });
    expect(quote.amountCents).toBe(pick(CENTS[cycle], plan, extra));
    expect(quote.intervalMonths).toBe(cycle === "ANNUAL" ? 12 : 1);
    expect(quote.agendaLimit).toBe({ INDIVIDUAL: 1, TEAM: 3, TEAM_PLUS: 5, TEAM_MAX: 10 }[plan] + extra);
    expect(quote.catalogVersion).toBe("2026-10-02");
  });
  it("Individual anual = 10 mensalidades (R$ 399) e adicional anual = 12 x 20 com 20% de desconto (R$ 192)", () => {
    expect(3990 * 10).toBe(39900);
    expect(Math.round(2000 * 12 * 0.8)).toBe(19200);
  });
  it("percentual de economia por plano é verdadeiro e o máximo é 20%", () => {
    const pct = (monthly: number, annual: number) => (monthly * 12 - annual) / (monthly * 12) * 100;
    expect(pct(3990, 39900)).toBeCloseTo(16.667, 2);
    expect(pct(7990, 77900)).toBeCloseTo(18.752, 2);
    expect(pct(9990, 95900)).toBeCloseTo(20.003, 2);
    expect(pct(14990, 143900)).toBeCloseTo(20.002, 2);
    expect(pct(2000, 19200)).toBeCloseTo(20, 5);
    // Com adicionais, Equipe 10 tende a 20% por cima: nunca passa de 20,003%.
    for (const n of [1, 2, 50, 100]) expect(pct(14990 + 2000 * n, 143900 + 19200 * n)).toBeGreaterThanOrEqual(20);
  });
  it("adicionais só existem no Equipe · 10 agendas e no máximo 100", () => {
    expect(() => quoteContract({ plan: "TEAM_PLUS", cycle: "MONTHLY", extraAgendas: 1 })).toThrow();
    expect(() => quoteContract({ plan: "INDIVIDUAL", cycle: "ANNUAL", extraAgendas: 1 })).toThrow();
    expect(() => quoteContract({ plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 101 })).toThrow();
  });
});

describe("landing — MarketingPlans", () => {
  const card = (container: HTMLElement, name: string) => container.querySelector(`[aria-label="Plano ${name}"]`) as HTMLElement;
  const setCycle = (cycle: Cycle) => fireEvent.click(screen.getByLabelText(cycle === "ANNUAL" ? /^Anual$/ : /^Mensal$/));

  for (const billingAvailable of [true, false]) {
    const path = billingAvailable ? "/contratar" : "/signup";
    for (const cycle of ["MONTHLY", "ANNUAL"] as const) {
      it(`billingAvailable=${billingAvailable} ${cycle}: Individual, Essencial e Equipe 5`, () => {
        const { container } = render(<MarketingPlans billingAvailable={billingAvailable} segment="barbearia" />);
        setCycle(cycle);
        for (const [name, plan] of [["Individual", "INDIVIDUAL"], ["Essencial", "TEAM"], ["Equipe", "TEAM_PLUS"]] as const) {
          const article = card(container, name);
          expect(norm(article.querySelector(".offer-price")?.textContent)).toBe(`${BRL[cycle][plan]}/${per(cycle)}`);
          const saving = article.querySelector(".offer-saving");
          if (cycle === "ANNUAL") expect(norm(saving?.textContent)).toBe(`Economize ${SAVING[plan]} em relação a 12 mensalidades.`);
          else expect(saving).toBeNull();
          expect(within(article).getByRole("link", { name: `Escolher ${name}` }))
            .toHaveAttribute("href", `${path}?billingPlan=${plan}&cycle=${cycle}&extraAgendas=0&segment=barbearia`);
        }
        const team = card(container, "Equipe");
        expect(norm(team.querySelector(".offer-terms > p")?.textContent)).toBe(`10 agendas: ${BRL[cycle].TEAM_MAX[0]}/${per(cycle)}`);
        expect(norm(team.querySelector(".offer-note p")?.textContent)).toBe(cycle === "ANNUAL" ? "+ R$ 192/ano por agenda extra" : "+ R$ 20/mês por agenda extra");
        expect(norm(team.querySelector(".offer-features li")?.textContent)).toBe("Até 5 agendas profissionais");
        expect(norm(card(container, "Individual").querySelector(".offer-features li")?.textContent)).toBe("1 agenda profissional");
        expect(norm(card(container, "Essencial").querySelector(".offer-features li")?.textContent)).toBe("Até 3 agendas profissionais");
        // Nenhum preço antigo aparece em lugar algum do bloco de planos.
        expect(norm(container.textContent)).not.toMatch(/59,90|R\$ 599\b|R\$ 15\/|R\$ 144/);
      });

      it.each(EXTRAS)(`billingAvailable=${billingAvailable} ${cycle}: Equipe 10 com %i adicionais`, extra => {
        const { container } = render(<MarketingPlans billingAvailable={billingAvailable} />);
        setCycle(cycle);
        fireEvent.click(screen.getByLabelText("10 agendas"));
        fireEvent.change(screen.getByLabelText("Agendas adicionais às 10 incluídas"), { target: { value: String(extra) } });
        const team = card(container, "Equipe");
        expect(norm(team.querySelector(".offer-price")?.textContent)).toBe(`${BRL[cycle].TEAM_MAX[extra]}/${per(cycle)}`);
        expect(norm(team.querySelector(".offer-terms > p")?.textContent)).toBe(`${10 + extra} agendas no total`);
        expect(norm(team.querySelector(".offer-features li")?.textContent)).toBe(`Até ${10 + extra} agendas profissionais`);
        expect(norm(team.querySelector(".offer-note p")?.textContent)).toBe(cycle === "ANNUAL" ? "+ R$ 192/ano por agenda extra" : "+ R$ 20/mês por agenda extra");
        if (cycle === "ANNUAL") expect(norm(team.querySelector(".offer-saving")?.textContent)).toBe(`Economize ${SAVING.TEAM_MAX[extra]} em relação a 12 mensalidades.`);
        expect(within(team).getByRole("link", { name: "Escolher Equipe" })).toHaveAttribute("href", `${path}?billingPlan=TEAM_MAX&cycle=${cycle}&extraAgendas=${extra}`);
      });
    }
  }

  it("limita adicionais a 0..100 e volta para Equipe 5 sem levar adicionais no link", () => {
    const { container } = render(<MarketingPlans billingAvailable />);
    fireEvent.click(screen.getByLabelText("10 agendas"));
    const input = screen.getByLabelText("Agendas adicionais às 10 incluídas");
    fireEvent.change(input, { target: { value: "250" } });
    expect(input).toHaveValue(100);
    expect(norm(card(container, "Equipe").querySelector(".offer-price")?.textContent)).toBe("R$ 2.149,90/mês");
    fireEvent.change(input, { target: { value: "-4" } });
    expect(input).toHaveValue(0);
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.click(screen.getByLabelText("5 agendas"));
    expect(screen.getByRole("link", { name: "Escolher Equipe" })).toHaveAttribute("href", "/contratar?billingPlan=TEAM_PLUS&cycle=MONTHLY&extraAgendas=0");
    expect(norm(card(container, "Equipe").querySelector(".offer-price")?.textContent)).toBe("R$ 99,90/mês");
  });

  it("textos de rodapé: anual é cobrança única a cada 12 meses", () => {
    const { container } = render(<MarketingPlans billingAvailable />);
    setCycle("ANNUAL");
    expect(norm(container.querySelector(".offer-footnote")?.textContent)).toContain("O valor anual é cobrado de uma vez a cada 12 meses.");
    expect(norm(card(container, "Individual").querySelector(".offer-terms")?.textContent)).toContain("Pagamento único por 12 meses.");
  });
});

describe("/assinatura — PlanPicker (novo contrato)", () => {
  const article = (name: string) => screen.getByRole("article", { name });
  const priceOf = (el: HTMLElement) => norm(el.querySelector("p.mt-5")?.textContent);
  const subOf = (el: HTMLElement) => norm(el.querySelector("p.min-h-5")?.textContent);

  for (const cycle of ["MONTHLY", "ANNUAL"] as const) {
    it(`${cycle}: Individual, Essencial e Equipe 5 mostram e escolhem o valor certo`, () => {
      const onChoose = vi.fn();
      render(<PlanPicker mode="subscribe" initial={{ plan: "INDIVIDUAL", cycle, extraAgendas: 0 }} onChoose={onChoose} />);
      expect(norm(screen.getByText(/economize até/).textContent)).toBe("economize até 20%");
      for (const [name, plan, label, agendas] of [["Individual", "INDIVIDUAL", "Individual", "1 agenda profissional"], ["Essencial", "TEAM", "Essencial", "3 agendas profissionais"], ["Equipe", "TEAM_PLUS", "Equipe · 5 agendas", "5 agendas profissionais"]] as const) {
        const el = article(name);
        expect(priceOf(el)).toBe(`${BRL[cycle][plan]}/${per(cycle)}`);
        expect(subOf(el)).toBe(cycle === "ANNUAL" ? `Equivale a ${PER_MONTH[plan]}/mês · economize ${SAVING[plan]}` : "Renovação mensal · cancele quando quiser");
        expect(norm(el.querySelector("li")?.textContent)).toBe(agendas);
        fireEvent.click(within(el).getByRole("button", { name: `Assinar: ${label}` }));
        expect(onChoose).toHaveBeenLastCalledWith({ plan, cycle, extraAgendas: 0 });
      }
    });

    it.each(EXTRAS)(`${cycle}: Equipe 10 com %i adicionais`, extra => {
      const onChoose = vi.fn();
      render(<PlanPicker mode="subscribe" initial={{ plan: "TEAM_MAX", cycle, extraAgendas: 0 }} onChoose={onChoose} />);
      fireEvent.change(screen.getByLabelText("Agendas adicionais às 10 incluídas"), { target: { value: String(extra) } });
      const el = article("Equipe");
      expect(priceOf(el)).toBe(`${BRL[cycle].TEAM_MAX[extra]}/${per(cycle)}`);
      expect(subOf(el)).toBe(cycle === "ANNUAL" ? `Equivale a ${PER_MONTH.TEAM_MAX[extra]}/mês · economize ${SAVING.TEAM_MAX[extra]}` : "Renovação mensal · cancele quando quiser");
      expect(norm(el.querySelector("li")?.textContent)).toBe(`${10 + extra} agendas profissionais`);
      expect(norm(el.textContent)).toContain(cycle === "ANNUAL" ? "R$ 192 por agenda/ano." : "R$ 20 por agenda/mês.");
      fireEvent.click(within(el).getByRole("button", { name: "Assinar: Equipe · 10 agendas" }));
      expect(onChoose).toHaveBeenLastCalledWith({ plan: "TEAM_MAX", cycle, extraAgendas: extra });
    });
  }

  it("botões +/- respeitam 0..100 e o toggle 5/10 troca preço e intenção", () => {
    const onChoose = vi.fn();
    render(<PlanPicker mode="subscribe" initial={{ plan: "TEAM_PLUS", cycle: "MONTHLY", extraAgendas: 0 }} onChoose={onChoose} />);
    expect(priceOf(article("Equipe"))).toBe("R$ 99,90/mês");
    fireEvent.click(screen.getByLabelText("10 agendas"));
    expect(priceOf(article("Equipe"))).toBe("R$ 149,90/mês");
    expect(screen.getByRole("button", { name: "Remover uma agenda adicional" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar uma agenda adicional" }));
    expect(priceOf(article("Equipe"))).toBe("R$ 169,90/mês");
    fireEvent.change(screen.getByLabelText("Agendas adicionais às 10 incluídas"), { target: { value: "500" } });
    expect(screen.getByRole("button", { name: "Adicionar uma agenda adicional" })).toBeDisabled();
    expect(priceOf(article("Equipe"))).toBe("R$ 2.149,90/mês");
    fireEvent.click(screen.getByLabelText("5 agendas"));
    fireEvent.click(screen.getByRole("button", { name: "Assinar: Equipe · 5 agendas" }));
    expect(onChoose).toHaveBeenLastCalledWith({ plan: "TEAM_PLUS", cycle: "MONTHLY", extraAgendas: 0 });
  });
});

describe("/assinatura — contratos persistidos (assinantes anteriores ao catálogo 2026-10-02)", () => {
  const legacyIndividual: SubscriptionView = { id: "legacy", plan: "INDIVIDUAL", cycle: "MONTHLY", amountCents: 5990, agendaLimit: 1, state: "ACTIVE",
    paidThrough: "2099-10-13T12:00:00Z", nextPaymentAt: "2099-10-13T12:00:00Z", cancelRequestedAt: null, cancelledAt: null, reviewRequired: false,
    checkoutUrl: null, providerStatus: "authorized", lastSyncedAt: null, changesAvailable: true,
    charges: [{ id: "c1", amountCents: 5990, refundedCents: 0, status: "approved", periodStart: "2099-09-13T12:00:00Z", periodEnd: "2099-10-13T12:00:00Z", paidAt: "2099-09-13T12:00:00Z" }] };
  const cardProps = { legacy: { label: "Grátis", agendas: 1, free: true }, occupiedAgendas: 1, timezone: "America/Sao_Paulo", email: "owner@example.test",
    accessBlocked: false, returnedFromCheckout: false, refreshing: false, busy: false, preparingChangeCheckout: false, onRefresh: vi.fn(), onCancelChange: vi.fn() };

  it("CurrentPlanCard mostra o valor contratado (R$ 59,90), não o do catálogo", () => {
    const { container } = render(<CurrentPlanCard subscription={legacyIndividual} {...cardProps} />);
    const text = norm(container.textContent);
    expect(text).toContain("R$ 59,90/mês · cobrança mensal pelo Mercado Pago");
    expect(text).toMatch(/Próxima cobrança.*R\$ 59,90/);
    expect(text).not.toContain("39,90");
  });

  it("CurrentPlanCard de Equipe 10 + 4 adicionais antigo mostra R$ 209,90 (14.990 + 4 x 1.500)", () => {
    const { container } = render(<CurrentPlanCard subscription={{ ...legacyIndividual, plan: "TEAM_MAX", agendaLimit: 14, amountCents: 20990 }} {...cardProps} />);
    expect(norm(container.textContent)).toContain("R$ 209,90/mês");
    expect(norm(container.textContent)).toContain("Equipe · 14 agendas");
  });

  it("BillingHistory mostra o valor efetivamente cobrado de cada fatura", () => {
    const { container } = render(<BillingHistory charges={[...legacyIndividual.charges, { id: "c2", amountCents: 59900, refundedCents: 0, status: "approved", periodStart: "2099-01-01T12:00:00Z", periodEnd: "2100-01-01T12:00:00Z", paidAt: "2099-01-01T12:00:00Z" }]} timezone="America/Sao_Paulo" />);
    expect(norm(container.textContent)).toContain("R$ 59,90");
    expect(norm(container.textContent)).toContain("R$ 599");
  });

  it("PlanChangeReview mostra de/para com os termos persistidos e a diferença calculada pelo servidor", () => {
    const quote: PlanChangeView = { id: "q", kind: "UPGRADE", state: "QUOTED",
      from: { plan: "INDIVIDUAL", cycle: "MONTHLY", amountCents: 5990, agendaLimit: 1, intervalMonths: 1, catalogVersion: "2026-09-13" },
      to: { plan: "TEAM", cycle: "MONTHLY", amountCents: 7990, agendaLimit: 3, intervalMonths: 1, catalogVersion: "2026-10-02" },
      amountDueCents: 1000, effectiveAt: "2099-09-28T12:00:00Z", periodEnd: "2099-10-13T12:00:00Z", expiresAt: "2099-09-28T12:15:00Z",
      paidAt: null, activatedAt: null, checkoutUrl: null, lastError: null };
    render(<PlanChangeReview quote={quote} timezone="America/Sao_Paulo" busy={false} error={null} onConfirm={vi.fn()} onClose={vi.fn()} />);
    const dialog = norm(screen.getByRole("dialog").textContent);
    expect(dialog).toContain("Individual · 1 agendaR$ 59,90 por mês");
    expect(dialog).toContain("Essencial · 3 agendasR$ 79,90 por mês");
    expect(dialog).toContain("Cobrança adicional agoraR$ 10");
    expect(dialog).toMatch(/Nova recorrência a partir de .*R\$ 79,90 por mês/);
    // Contrato acima da tabela (59,90 > 39,90) e upgrade: nenhum dos avisos de contrato abaixo da tabela.
    expect(dialog).not.toContain("valor anterior à tabela atual");
    expect(dialog).not.toContain("Atenção");
  });

  it("PlanChangeReview de contrato abaixo da tabela: avisa que a renovação sobe mesmo com menos agendas e que a troca segue a tabela atual", () => {
    // Equipe 10 + 20 a R$ 15: 14.990 + 20 x 1.500 = 44.990 (tabela atual: 14.990 + 20 x 2.000 = 54.990).
    // Para 29 agendas: 14.990 + 19 x 2.000 = 52.990, mais caro que o contrato mesmo com uma agenda a menos.
    const quote: PlanChangeView = { id: "q2", kind: "SCHEDULED", state: "QUOTED",
      from: { plan: "TEAM_MAX", cycle: "MONTHLY", amountCents: 44990, agendaLimit: 30, intervalMonths: 1, catalogVersion: "2026-09-13" },
      to: { plan: "TEAM_MAX", cycle: "MONTHLY", amountCents: 52990, agendaLimit: 29, intervalMonths: 1, catalogVersion: "2026-10-02" },
      amountDueCents: 0, effectiveAt: "2099-10-13T12:00:00Z", periodEnd: "2099-10-13T12:00:00Z", expiresAt: "2099-09-28T12:15:00Z",
      paidAt: null, activatedAt: null, checkoutUrl: null, lastError: null };
    render(<PlanChangeReview quote={quote} timezone="America/Sao_Paulo" busy={false} error={null} onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(norm(screen.getByRole("note").textContent)).toBe("Atenção: mesmo com menos agendas, a renovação passa de R$ 449,90 para R$ 529,90 por mês.");
    expect(norm(screen.getByRole("dialog").textContent)).toContain("Hoje você paga R$ 449,90 por mês, valor anterior à tabela atual (R$ 549,90 para a mesma capacidade). Com a troca, o novo plano segue a tabela atual.");
  });

  it("PlanChangeReview de redução real (menos agendas e valor menor) não mostra o aviso de aumento", () => {
    // Equipe 10 + 4 a R$ 15 (20.990) -> Equipe 10 + 2 na tabela atual (14.990 + 2 x 2.000 = 18.990).
    const quote: PlanChangeView = { id: "q3", kind: "SCHEDULED", state: "QUOTED",
      from: { plan: "TEAM_MAX", cycle: "MONTHLY", amountCents: 20990, agendaLimit: 14, intervalMonths: 1, catalogVersion: "2026-09-13" },
      to: { plan: "TEAM_MAX", cycle: "MONTHLY", amountCents: 18990, agendaLimit: 12, intervalMonths: 1, catalogVersion: "2026-10-02" },
      amountDueCents: 0, effectiveAt: "2099-10-13T12:00:00Z", periodEnd: "2099-10-13T12:00:00Z", expiresAt: "2099-09-28T12:15:00Z",
      paidAt: null, activatedAt: null, checkoutUrl: null, lastError: null };
    render(<PlanChangeReview quote={quote} timezone="America/Sao_Paulo" busy={false} error={null} onConfirm={vi.fn()} onClose={vi.fn()} />);
    const dialog = norm(screen.getByRole("dialog").textContent);
    expect(screen.queryByRole("note")).toBeNull();
    expect(dialog).toContain("Hoje você paga R$ 209,90 por mês, valor anterior à tabela atual (R$ 229,90 para a mesma capacidade). Com a troca, o novo plano segue a tabela atual.");
    expect(dialog).toMatch(/Nova recorrência a partir de .*R\$ 189,90 por mês/);
  });

  it("PlanPicker em modo troca: o card 'Seu plano' mostra o valor contratado (R$ 59,90) e informa R$ 39,90 para novas contratações", () => {
    render(<PlanPicker mode="change" current={{ plan: "INDIVIDUAL", cycle: "MONTHLY", agendaLimit: 1, amountCents: 5990 }} onChoose={vi.fn()} />);
    const individual = screen.getByRole("article", { name: "Individual" });
    expect(within(individual).getByText("Seu plano")).toBeVisible();
    expect(within(individual).getByRole("button", { name: "Plano atual" })).toBeDisabled();
    expect(norm(individual.querySelector("p.mt-5")?.textContent)).toBe("R$ 59,90/mês");
    expect(norm(individual.querySelector("p.min-h-5")?.textContent)).toBe("Valor do seu contrato. Para novas contratações: R$ 39,90/mês.");
    // Os demais cards seguem a tabela e a classificação compara com o contrato: Essencial (3 agendas, 79,90 > 59,90) é upgrade.
    expect(norm(screen.getByRole("article", { name: "Essencial" }).querySelector("p.mt-5")?.textContent)).toBe("R$ 79,90/mês");
    expect(screen.getByRole("button", { name: "Fazer upgrade: Essencial" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Fazer upgrade: Equipe · 5 agendas" })).toBeEnabled();
    // No anual, o Individual não é o contrato atual: preço de tabela e troca de ciclo.
    fireEvent.click(screen.getByLabelText(/Anual/));
    const annual = screen.getByRole("article", { name: "Individual" });
    expect(within(annual).queryByText("Seu plano")).toBeNull();
    expect(screen.getByRole("button", { name: "Mudar para anual: Individual" })).toBeEnabled();
    expect(norm(annual.querySelector("p.mt-5")?.textContent)).toBe("R$ 399/ano");
    expect(norm(annual.querySelector("p.min-h-5")?.textContent)).toBe("Equivale a R$ 33,25/mês · economize R$ 79,80");
  });

  it("PlanPicker em modo troca: Equipe 10 + 4 adicionais antigo mostra R$ 209,90 contratados no 'Seu plano' e R$ 229,90 para novas contratações", () => {
    render(<PlanPicker mode="change" current={{ plan: "TEAM_MAX", cycle: "MONTHLY", agendaLimit: 14, amountCents: 20990 }} onChoose={vi.fn()} />);
    const equipe = screen.getByRole("article", { name: "Equipe" });
    expect(screen.getByLabelText("Agendas adicionais às 10 incluídas")).toHaveValue(4);
    expect(within(equipe).getByText("Seu plano")).toBeVisible();
    expect(within(equipe).getByRole("button", { name: "Plano atual" })).toBeDisabled();
    expect(norm(equipe.querySelector("p.mt-5")?.textContent)).toBe("R$ 209,90/mês");
    expect(norm(equipe.querySelector("p.min-h-5")?.textContent)).toBe("Valor do seu contrato. Para novas contratações: R$ 229,90/mês.");
  });

  it("PlanPicker em modo troca: 'Fazer upgrade' exige mais agendas e valor maior; 'Reduzir' exige menos agendas e valor menor; o resto é 'Mudar para este plano'", () => {
    const onChoose = vi.fn();
    render(<PlanPicker mode="change" current={{ plan: "TEAM_MAX", cycle: "MONTHLY", agendaLimit: 14, amountCents: 20990 }} onChoose={onChoose} />);
    const extras = screen.getByLabelText("Agendas adicionais às 10 incluídas");
    const equipe = () => screen.getByRole("article", { name: "Equipe" });
    // 15 agendas: 14.990 + 5 x 2.000 = 24.990 > 20.990.
    fireEvent.change(extras, { target: { value: "5" } });
    expect(norm(equipe().querySelector("p.mt-5")?.textContent)).toBe("R$ 249,90/mês");
    expect(within(equipe()).getByRole("button", { name: "Fazer upgrade: Equipe · 10 agendas" })).toBeEnabled();
    // 13 agendas: 14.990 + 3 x 2.000 = 20.990, o mesmo valor do contrato: menos agendas sem pagar menos não é redução.
    fireEvent.change(extras, { target: { value: "3" } });
    expect(norm(equipe().querySelector("p.mt-5")?.textContent)).toBe("R$ 209,90/mês");
    expect(within(equipe()).queryByText("Seu plano")).toBeNull();
    fireEvent.click(within(equipe()).getByRole("button", { name: "Mudar para este plano: Equipe · 10 agendas" }));
    expect(onChoose).toHaveBeenLastCalledWith({ plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 3 });
    // 12 agendas: 14.990 + 2 x 2.000 = 18.990 < 20.990.
    fireEvent.change(extras, { target: { value: "2" } });
    expect(within(equipe()).getByRole("button", { name: "Reduzir para este plano: Equipe · 10 agendas" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reduzir para este plano: Essencial" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reduzir para este plano: Individual" })).toBeEnabled();
    fireEvent.click(screen.getByLabelText("5 agendas"));
    expect(screen.getByRole("button", { name: "Reduzir para este plano: Equipe · 5 agendas" })).toBeEnabled();
    fireEvent.click(screen.getByLabelText(/Anual/));
    expect(screen.getByRole("button", { name: "Mudar para anual: Equipe · 5 agendas" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Mudar para anual: Individual" })).toBeEnabled();
  });

  it("PlanPicker em modo troca: em contrato abaixo da tabela (Equipe 10 + 20 a R$ 449,90), 29 agendas custam R$ 529,90 e o botão não diz 'Reduzir'", () => {
    render(<PlanPicker mode="change" current={{ plan: "TEAM_MAX", cycle: "MONTHLY", agendaLimit: 30, amountCents: 44990 }} onChoose={vi.fn()} />);
    const equipe = () => screen.getByRole("article", { name: "Equipe" });
    expect(norm(equipe().querySelector("p.mt-5")?.textContent)).toBe("R$ 449,90/mês");
    expect(norm(equipe().querySelector("p.min-h-5")?.textContent)).toBe("Valor do seu contrato. Para novas contratações: R$ 549,90/mês.");
    fireEvent.change(screen.getByLabelText("Agendas adicionais às 10 incluídas"), { target: { value: "19" } });
    expect(norm(equipe().querySelector("p.mt-5")?.textContent)).toBe("R$ 529,90/mês");
    expect(within(equipe()).getByRole("button", { name: "Mudar para este plano: Equipe · 10 agendas" })).toBeEnabled();
    expect(within(equipe()).queryByRole("button", { name: /^Reduzir/ })).toBeNull();
  });

  it("contratação pendente criada a R$ 59,90: o topo avisa a mudança de preço e o card 'Escolhido' oferece atualizar para R$ 39,90, sem o checkout antigo", async () => {
    const pending: SubscriptionView = { ...legacyIndividual, state: "UNPAID", paidThrough: null, nextPaymentAt: null, providerStatus: "pending", charges: [],
      checkoutUrl: "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=legacy" };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("/api/billing/sync") ? new Response(JSON.stringify({ queued: true }), { status: 202 }) : new Response(JSON.stringify({ subscription: pending }))));
    render(<SubscriptionPortal salonId="salon" email="owner@example.test" timezone="America/Sao_Paulo" legacy={{ label: "Grátis", agendas: 1, free: true }} occupiedAgendas={1} />);
    const card = await screen.findByRole("article", { name: "Individual" });
    expect(within(card).getByText("Escolhido")).toBeVisible();
    expect(norm(card.querySelector("p.mt-5")?.textContent)).toBe("R$ 39,90/mês");
    expect(norm(card.querySelector("p.min-h-5")?.textContent)).toBe("Preço atual. Sua tentativa, ainda não paga, foi criada a R$ 59,90/mês.");
    expect(within(card).getByRole("button", { name: "Atualizar para o novo preço: Individual" })).toBeEnabled();
    // O checkout antigo, de R$ 59,90, não é oferecido em lugar nenhum da página.
    expect(screen.queryByRole("link", { name: /Continuar pagamento/ })).toBeNull();
    expect(document.querySelector(`a[href="${pending.checkoutUrl}"]`)).toBeNull();
    const top = screen.getByRole("region", { name: "Individual · 1 agenda" });
    expect(norm(top.textContent)).toContain("R$ 59,90/mês · cobrança mensal pelo Mercado Pago");
    expect(within(top).getByText("O preço deste plano mudou")).toBeVisible();
    expect(norm(top.textContent)).toContain("Sua contratação ainda não foi paga e foi criada pelo preço anterior, de R$ 59,90/mês. Hoje este plano custa R$ 39,90/mês.");
    // Os dois botões abrem a mesma confirmação, que encerra a tentativa antiga antes de pagar R$ 39,90.
    fireEvent.click(within(top).getByRole("button", { name: "Atualizar para o novo preço" }));
    let dialog = screen.getByRole("dialog", { name: "Atualizar para o novo preço" });
    expect(norm(dialog.textContent)).toContain("A tentativa anterior foi criada a R$ 59,90 por mês e não foi paga.");
    expect(norm(dialog.textContent)).toContain("Individual · 1 agendaR$ 39,90 por mês");
    expect(within(dialog).getByRole("button", { name: "Confirmar cancelamento da tentativa anterior" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Voltar aos planos" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(within(card).getByRole("button", { name: "Atualizar para o novo preço: Individual" }));
    dialog = screen.getByRole("dialog", { name: "Atualizar para o novo preço" });
    expect(norm(dialog.textContent)).toContain("Individual · 1 agendaR$ 39,90 por mês");
  });

  it("contratação pendente já no preço atual (R$ 39,90) continua o checkout existente, sem aviso de mudança de preço", async () => {
    const pending: SubscriptionView = { ...legacyIndividual, amountCents: 3990, state: "UNPAID", paidThrough: null, nextPaymentAt: null, providerStatus: "pending", charges: [],
      checkoutUrl: "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=current" };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("/api/billing/sync") ? new Response(JSON.stringify({ queued: true }), { status: 202 }) : new Response(JSON.stringify({ subscription: pending }))));
    render(<SubscriptionPortal salonId="salon" email="owner@example.test" timezone="America/Sao_Paulo" legacy={{ label: "Grátis", agendas: 1, free: true }} occupiedAgendas={1} />);
    const card = await screen.findByRole("article", { name: "Individual" });
    expect(norm(card.querySelector("p.mt-5")?.textContent)).toBe("R$ 39,90/mês");
    expect(norm(card.querySelector("p.min-h-5")?.textContent)).toBe("Renovação mensal · cancele quando quiser");
    expect(within(card).getByRole("link", { name: "Continuar pagamento: Individual" })).toHaveAttribute("href", pending.checkoutUrl);
    expect(screen.queryByText("O preço deste plano mudou")).toBeNull();
    expect(screen.queryByRole("button", { name: /Atualizar para o novo preço/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Continuar pagamento no Mercado Pago/ })).toHaveAttribute("href", pending.checkoutUrl);
  });
});

describe("cadastro — resumo do plano escolhido", () => {
  it.each((["MONTHLY", "ANNUAL"] as const).flatMap(cycle => [
    ["INDIVIDUAL", cycle, 0, "Individual · 1 agenda"],
    ["TEAM", cycle, 0, "Essencial · 3 agendas"],
    ["TEAM_PLUS", cycle, 0, "Equipe · 5 agendas"],
    ...EXTRAS.map(extra => ["TEAM_MAX", cycle, extra, `Equipe · ${10 + extra} agendas`] as const),
  ] as const))("SignupForm %s %s +%i", (plan, cycle, extra, label) => {
    render(<SignupForm billingIntent={{ plan, cycle, extraAgendas: extra }} billingAvailable />);
    const aside = screen.getByRole("complementary", { name: "Seu plano de interesse" });
    expect(norm(aside.querySelector("div")?.textContent)).toBe(`${label}${pick(BRL[cycle], plan, extra)} ${cycle === "ANNUAL" ? "a cada 12 meses" : "por mês"}`);
    expect(within(aside).getByRole("link", { name: "Já tenho conta · entrar" }))
      .toHaveAttribute("href", `/login?callbackUrl=${encodeURIComponent(`/contratar?billingPlan=${plan}&cycle=${cycle}&extraAgendas=${extra}`)}`);
  });

  it.each([
    // ?plan= antigo -> resumo com o catálogo atual (literais) e o callback de login com a mesma escolha.
    ["equipe", "Equipe · 10 agendasR$ 149,90 por mês", "/contratar?billingPlan=TEAM_MAX&cycle=MONTHLY&extraAgendas=0"],
    ["pro", "Essencial · 3 agendasR$ 79,90 por mês", "/contratar?billingPlan=TEAM&cycle=MONTHLY&extraAgendas=0"],
  ] as const)("link legado ?plan=%s com cobrança ativa mostra o catálogo atual, sem a tabela aposentada", async (plan, summary, callback) => {
    vi.stubEnv("MERCADOPAGO_BILLING_ENABLED", "true");
    vi.stubEnv("MERCADOPAGO_CHECKOUT_PAUSED", "false");
    render(await SignupPage({ searchParams: Promise.resolve({ plan }) }));
    const aside = screen.getByRole("complementary", { name: "Seu plano de interesse" });
    expect(norm(aside.querySelector("div")?.textContent)).toBe(summary);
    expect(within(aside).getByRole("link", { name: "Já tenho conta · entrar" })).toHaveAttribute("href", `/login?callbackUrl=${encodeURIComponent(callback)}`);
    expect(norm(aside.textContent)).not.toMatch(/Seu interesse|R\$ 179,90|R\$ 49,90/);
  });

  it.each(["fundador", "gratis"])("link legado ?plan=%s com cobrança ativa não tem equivalente: mostra o plano Grátis, sem R$ 49,90", async plan => {
    vi.stubEnv("MERCADOPAGO_BILLING_ENABLED", "true");
    vi.stubEnv("MERCADOPAGO_CHECKOUT_PAUSED", "false");
    render(await SignupPage({ searchParams: Promise.resolve({ plan }) }));
    const aside = screen.getByRole("complementary", { name: "Seu plano de interesse" });
    expect(norm(aside.querySelector("div")?.textContent)).toBe("Comece no plano Grátis");
    expect(within(aside).getByRole("link", { name: "Rever planos" })).toHaveAttribute("href", "/#planos");
    expect(norm(aside.textContent)).not.toMatch(/Seu interesse|R\$ 49,90|R\$ 179,90/);
  });
});
