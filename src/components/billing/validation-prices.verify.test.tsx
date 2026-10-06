// @vitest-environment jsdom
/**
 * Verificação adversarial da dimensão "precos-telas".
 * Expectativas são literais calculados à mão (catálogo 2026-10-02):
 * Individual 3990/39900; Essencial 7990/77900; Equipe5 9990/95900; Equipe10 14990/143900; adicional 2000/19200.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), withUser: vi.fn(), enabled: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: mocks.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma-tenant", () => ({ withUser: mocks.withUser }));
vi.mock("@/lib/billing/config", () => ({ billingEnabled: mocks.enabled }));

import { GET } from "@/app/contratar/route";
import { MarketingPlans } from "../marketing/marketing-plans";
import { PlanPicker } from "./plan-picker";
import { SubscriptionPortal } from "./subscription-portal";
import { quotePlanChange } from "@/lib/billing/change-rules";
import { pendingPriceOutdated, type SubscriptionView } from "@/lib/billing/presentation";

const norm = (value: string | null | undefined) => (value ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("/contratar preserva exatamente a escolha", () => {
  beforeEach(() => { mocks.enabled.mockReturnValue(true); });
  const go = async (query: string) => {
    const res = await GET(new Request(`https://everflair.com.br/contratar?${query}`));
    const loc = new URL(res.headers.get("location")!);
    return { status: res.status, path: loc.pathname, params: Object.fromEntries(loc.searchParams) };
  };

  it("sem cobrança ativa manda para /#planos", async () => {
    mocks.enabled.mockReturnValue(false);
    const res = await GET(new Request("https://everflair.com.br/contratar?billingPlan=INDIVIDUAL"));
    expect(res.headers.get("location")).toBe("https://everflair.com.br/#planos");
  });
  it("sem sessão: /signup com plano, ciclo, adicionais e segmento", async () => {
    mocks.session.mockResolvedValue(null);
    expect(await go("billingPlan=TEAM_MAX&cycle=ANNUAL&extraAgendas=3&segment=barbearia")).toMatchObject({ path: "/signup",
      params: { billingPlan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: "3", segment: "barbearia" } });
    // ciclo ausente vira MONTHLY, adicionais ausentes viram 0
    expect((await go("billingPlan=INDIVIDUAL")).params).toEqual({ billingPlan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: "0" });
  });
  it("com sessão e estabelecimento: /assinatura com a mesma escolha", async () => {
    mocks.session.mockResolvedValue({ user: { id: "u1" } });
    mocks.withUser.mockResolvedValue(1);
    expect(await go("billingPlan=TEAM_PLUS&cycle=ANNUAL&extraAgendas=0")).toMatchObject({ path: "/assinatura", params: { billingPlan: "TEAM_PLUS", cycle: "ANNUAL", extraAgendas: "0" } });
  });
  it("com sessão sem estabelecimento: onboarding com a mesma escolha", async () => {
    mocks.session.mockResolvedValue({ user: { id: "u1" } });
    mocks.withUser.mockResolvedValue(0);
    expect(await go("billingPlan=TEAM_MAX&cycle=MONTHLY&extraAgendas=100")).toMatchObject({ path: "/onboarding/create-salon", params: { billingPlan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: "100" } });
  });
  it.each(["billingPlan=TEAM_MAX&extraAgendas=2.5", "billingPlan=TEAM_MAX&extraAgendas=-1", "billingPlan=TEAM_MAX&extraAgendas=101",
    "billingPlan=TEAM&extraAgendas=1", "billingPlan=INDIVIDUAL&cycle=annual", "billingPlan=GOLD"])("intenção adulterada (%s) é descartada, nunca vira outro valor", async query => {
    mocks.session.mockResolvedValue(null);
    expect(await go(query)).toEqual({ status: 307, path: "/signup", params: {} });
  });
});

describe("tentativas de quebrar preço x link", () => {
  it("landing: adicional decimal/texto é truncado e o preço acompanha o link", () => {
    const { container } = render(<MarketingPlans billingAvailable />);
    fireEvent.click(screen.getByLabelText("10 agendas"));
    const input = screen.getByLabelText("Agendas adicionais às 10 incluídas");
    const team = container.querySelector('[aria-label="Plano Equipe"]') as HTMLElement;
    fireEvent.change(input, { target: { value: "2.7" } });
    expect(norm(team.querySelector(".offer-price")?.textContent)).toBe("R$ 189,90/mês"); // 14990 + 2*2000
    expect(within(team).getByRole("link", { name: "Escolher Equipe" })).toHaveAttribute("href", "/contratar?billingPlan=TEAM_MAX&cycle=MONTHLY&extraAgendas=2");
    fireEvent.change(input, { target: { value: "" } });
    expect(norm(team.querySelector(".offer-price")?.textContent)).toBe("R$ 149,90/mês");
    expect(within(team).getByRole("link", { name: "Escolher Equipe" })).toHaveAttribute("href", "/contratar?billingPlan=TEAM_MAX&cycle=MONTHLY&extraAgendas=0");
  });

  it("PlanPicker: adicional decimal é truncado e a intenção enviada bate com o preço exibido", () => {
    const onChoose = vi.fn();
    render(<PlanPicker mode="subscribe" initial={{ plan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: 0 }} onChoose={onChoose} />);
    fireEvent.change(screen.getByLabelText("Agendas adicionais às 10 incluídas"), { target: { value: "3.9" } });
    const equipe = screen.getByRole("article", { name: "Equipe" });
    expect(norm(equipe.querySelector("p.mt-5")?.textContent)).toBe("R$ 2.015/ano"); // 143900 + 3*19200 = 201500
    fireEvent.click(within(equipe).getByRole("button", { name: "Assinar: Equipe · 10 agendas" }));
    expect(onChoose).toHaveBeenLastCalledWith({ plan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: 3 });
  });
});

describe("contratos criados com preço anterior ao catálogo 2026-10-02 (variações F1/F2)", () => {
  it("F1 anual: tentativa não paga do Individual anual criada a R$ 599 aparece 'Escolhido' a R$ 399 e oferece 'Atualizar para o novo preço', nunca o checkout antigo", async () => {
    const checkoutUrl = "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=old";
    const pending: SubscriptionView = { id: "old", plan: "INDIVIDUAL", cycle: "ANNUAL", amountCents: 59900, agendaLimit: 1, state: "UNPAID", paidThrough: null, nextPaymentAt: null,
      cancelRequestedAt: null, cancelledAt: null, reviewRequired: false, checkoutUrl, providerStatus: "pending", lastSyncedAt: null, charges: [] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ subscription: pending }))));
    render(<SubscriptionPortal salonId="salon" email="owner@example.test" timezone="America/Sao_Paulo" />);
    const card = await screen.findByRole("article", { name: "Individual" });
    expect(within(card).getByText("Escolhido")).toBeVisible();
    expect(norm(card.querySelector("p.mt-5")?.textContent)).toBe("R$ 399/ano");
    expect(norm(card.querySelector("p.min-h-5")?.textContent)).toBe("Preço atual. Sua tentativa, ainda não paga, foi criada a R$ 599/ano.");
    expect(within(card).queryByRole("link")).toBeNull();
    expect(document.querySelector(`a[href="${checkoutUrl}"]`)).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Atualizar para o novo preço: Individual" }));
    const dialog = screen.getByRole("dialog", { name: "Atualizar para o novo preço" });
    expect(norm(dialog.textContent)).toContain("A tentativa anterior foi criada a R$ 599 a cada 12 meses e não foi paga.");
    expect(norm(dialog.textContent)).toContain("Individual · 1 agendaR$ 399 a cada 12 meses");
  });

  it("F1 Equipe 10 + 4: tentativa criada a R$ 209,90 aparece a R$ 229,90 (14.990 + 4 x 2.000) e a atualização mantém as 14 agendas", () => {
    const onChoose = vi.fn();
    const pending = { plan: "TEAM_MAX" as const, cycle: "MONTHLY" as const, agendaLimit: 14, amountCents: 20990, checkoutUrl: "https://www.mercadopago.com.br/x" };
    expect(pendingPriceOutdated({ ...pending, providerStatus: "pending" })).toBe(true);
    render(<PlanPicker mode="replace-pending" pending={{ ...pending, outdated: true }} onChoose={onChoose} />);
    const card = screen.getByRole("article", { name: "Equipe" });
    expect(within(card).getByText("Escolhido")).toBeVisible();
    expect(screen.getByLabelText("Agendas adicionais às 10 incluídas")).toHaveValue(4);
    expect(norm(card.querySelector("p.mt-5")?.textContent)).toBe("R$ 229,90/mês");
    expect(norm(card.querySelector("p.min-h-5")?.textContent)).toBe("Preço atual. Sua tentativa, ainda não paga, foi criada a R$ 209,90/mês.");
    expect(within(card).queryByRole("link", { name: /Continuar pagamento/ })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Atualizar para o novo preço: Equipe · 10 agendas" }));
    expect(onChoose).toHaveBeenLastCalledWith({ plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 4 });
  });

  it("F1 limites: só é 'preço anterior' a tentativa ainda pendente no Mercado Pago cujo valor difere da tabela para os mesmos termos", () => {
    // Preços anteriores: Individual R$ 599/ano; Equipe 10 + 2 anual a 143.900 + 2 x 14.400 = 172.700.
    expect(pendingPriceOutdated({ plan: "INDIVIDUAL", cycle: "ANNUAL", agendaLimit: 1, amountCents: 59900, providerStatus: "pending" })).toBe(true);
    expect(pendingPriceOutdated({ plan: "TEAM_MAX", cycle: "ANNUAL", agendaLimit: 12, amountCents: 172700, providerStatus: "pending" })).toBe(true);
    // Já no preço atual (143.900 + 2 x 19.200 = 182.300): segue o checkout existente.
    expect(pendingPriceOutdated({ plan: "TEAM_MAX", cycle: "ANNUAL", agendaLimit: 12, amountCents: 182300, providerStatus: "pending" })).toBe(false);
    // Já autorizada no Mercado Pago: não é substituída.
    expect(pendingPriceOutdated({ plan: "INDIVIDUAL", cycle: "MONTHLY", agendaLimit: 1, amountCents: 5990, providerStatus: "authorized" })).toBe(false);
    // Termos que a tabela atual não vende: sem comparação possível.
    expect(pendingPriceOutdated({ plan: "TEAM_MAX", cycle: "MONTHLY", agendaLimit: 9, amountCents: 14990, providerStatus: "pending" })).toBe(false);
    expect(pendingPriceOutdated({ plan: "PRO", cycle: "MONTHLY", agendaLimit: 3, amountCents: 7990, providerStatus: "pending" })).toBe(false);
    // Sem a marcação de preço anterior, o card pendente continua o checkout existente.
    render(<PlanPicker mode="replace-pending" pending={{ plan: "TEAM_MAX", cycle: "ANNUAL", agendaLimit: 12, amountCents: 182300, checkoutUrl: "https://www.mercadopago.com.br/y" }} onChoose={vi.fn()} />);
    const card = screen.getByRole("article", { name: "Equipe" });
    expect(norm(card.querySelector("p.mt-5")?.textContent)).toBe("R$ 1.823/ano");
    expect(within(card).getByRole("link", { name: "Continuar pagamento: Equipe · 10 agendas" })).toHaveAttribute("href", "https://www.mercadopago.com.br/y");
    expect(within(card).queryByRole("button", { name: /Atualizar para o novo preço/ })).toBeNull();
  });

  it("F2: assinante do Individual a R$ 59,90 mantém o contrato; trocar para o mesmo plano e capacidade é recusado (PLAN_UNCHANGED) — a redução virá em entrega separada (decisão de 03/10/2026)", () => {
    const from = { plan: "INDIVIDUAL" as const, cycle: "MONTHLY" as const, amountCents: 5990, agendaLimit: 1, intervalMonths: 1 as const, catalogVersion: "2026-09-13" };
    const period = { start: new Date("2026-09-20T12:00:00Z"), end: new Date("2026-10-20T12:00:00Z") };
    expect(() => quotePlanChange(from, { plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0 }, period, 1, new Date("2026-10-03T12:00:00Z"))).toThrow("PLAN_UNCHANGED");
  });
});
