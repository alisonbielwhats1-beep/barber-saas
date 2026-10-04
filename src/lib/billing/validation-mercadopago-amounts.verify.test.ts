// @vitest-environment jsdom
/**
 * Verificação adversarial da dimensão "valor-no-mercado-pago".
 * Somente renderização da UI com respostas simuladas; nenhuma chamada externa.
 * Valores esperados literais.
 */
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/billing/navigation", () => ({ goToCheckout: vi.fn() }));
import { SubscriptionPortal } from "@/components/billing/subscription-portal";

const OLD_CHECKOUT = "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=pre-antigo";
let portalGet: unknown = { subscription: null };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.startsWith("/api/billing/subscriptions")) return new Response(JSON.stringify(portalGet));
    if (url.startsWith("/api/billing/sync")) return new Response("{}", { status: 202 });
    throw new Error(`Rede bloqueada no teste: ${url}`);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const base = { paidThrough: null, nextPaymentAt: null, cancelRequestedAt: null, cancelledAt: null, reviewRequired: false,
  providerStatus: "pending", lastSyncedAt: null, charges: [], renewalCancellationStatus: "AVAILABLE" };

describe("tentativa não paga no preço antigo, mais barata que a tabela atual: Equipe · 10 + 2 criada a R$ 179,90", () => {
  it("o card mostra o preço atual R$ 189,90 'Escolhido' com 'Atualizar para o novo preço' e não oferece o checkout antigo de R$ 179,90", async () => {
    portalGet = { subscription: { ...base, id: "11111111-1111-4111-8111-111111111111", plan: "TEAM_MAX", cycle: "MONTHLY", amountCents: 17990, agendaLimit: 12,
      state: "UNPAID", checkoutUrl: OLD_CHECKOUT, changesAvailable: false } };
    render(createElement(SubscriptionPortal, { salonId: "salon-1", email: "dono@example.test", timezone: "America/Sao_Paulo" }));
    // Topo: valor persistido da tentativa e aviso de que o preço mudou, nos dois valores.
    expect(await screen.findByText("R$ 179,90/mês · cobrança mensal pelo Mercado Pago")).toBeVisible();
    expect(screen.getByText("O preço deste plano mudou")).toBeVisible();
    expect(screen.getByText("Sua contratação ainda não foi paga e foi criada pelo preço anterior, de R$ 179,90/mês. Hoje este plano custa R$ 189,90/mês.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Atualizar para o novo preço" })).toBeEnabled();
    // Card: preço atual da mesma capacidade (12 agendas), sem o link do checkout antigo.
    const card = screen.getByRole("article", { name: "Equipe" });
    expect(within(card).getByText(/^R\$\s189,90$/)).toBeVisible();
    expect(within(card).getByText("12 agendas")).toBeVisible();
    expect(within(card).getByText("Escolhido")).toBeVisible();
    expect(within(card).getByText("Preço atual. Sua tentativa, ainda não paga, foi criada a R$ 179,90/mês.")).toBeVisible();
    expect(within(card).queryByRole("link", { name: /Continuar pagamento/ })).toBeNull();
    expect(screen.queryAllByRole("link").map(link => link.getAttribute("href"))).not.toContain(OLD_CHECKOUT);
    // A atualização abre a troca da tentativa: primeiro o encerramento, depois o pagamento pelo preço atual.
    fireEvent.click(within(card).getByRole("button", { name: "Atualizar para o novo preço: Equipe · 10 agendas" }));
    const dialog = await screen.findByRole("dialog", { name: "Atualizar para o novo preço" });
    expect(within(dialog).getByText("A tentativa anterior foi criada a R$ 179,90 por mês e não foi paga. Primeiro, confirme o encerramento dela no Mercado Pago, sem nenhuma cobrança. Depois, siga para o pagamento pelo valor atual.")).toBeVisible();
    expect(within(dialog).getByText("Equipe · 12 agendas")).toBeVisible();
    const amountLine = within(dialog).getByText("por mês", { exact: false, selector: "span" }).parentElement!;
    expect(amountLine.firstChild!.textContent).toMatch(/^R\$\s189,90$/);
    expect(within(dialog).getByRole("button", { name: "Confirmar cancelamento da tentativa anterior" })).toBeEnabled();
    expect(within(dialog).queryByRole("button", { name: /Ir para pagamento/ })).toBeNull();
  });
});

describe("assinante ATIVO no preço antigo: o card 'Seu plano' mostra o valor do contrato", () => {
  it("Individual pago a R$ 59,90: topo e card 'Seu plano' mostram R$ 59,90; R$ 39,90 aparece só como preço para novas contratações", async () => {
    portalGet = { subscription: { ...base, id: "33333333-3333-4333-8333-333333333333", plan: "INDIVIDUAL", cycle: "MONTHLY", amountCents: 5990, agendaLimit: 1,
      state: "ACTIVE", paidThrough: "2026-10-20T12:00:00.000Z", nextPaymentAt: "2026-10-20T12:00:00.000Z", providerStatus: "authorized",
      checkoutUrl: null, changesAvailable: true, change: null, changePending: false } };
    render(createElement(SubscriptionPortal, { salonId: "salon-1", email: "dono@example.test", timezone: "America/Sao_Paulo" }));
    expect(await screen.findByText(/R\$\s59,90\/mês/)).toBeVisible();
    const card = screen.getByRole("article", { name: "Individual" });
    expect(within(card).getByText(/^R\$\s59,90$/)).toBeVisible();
    expect(within(card).getByText("Valor do seu contrato. Para novas contratações: R$ 39,90/mês.")).toBeVisible();
    expect(within(card).getByText("Seu plano")).toBeVisible();
    expect(within(card).getByRole("button", { name: /Plano atual/ })).toBeDisabled();
    expect(within(card).queryByText(/^R\$\s39,90$/)).toBeNull();
  });

  it("Equipe · 12 (10 + 2) pago a R$ 179,90: card 'Seu plano' mostra R$ 179,90; R$ 189,90 aparece só como preço para novas contratações", async () => {
    portalGet = { subscription: { ...base, id: "44444444-4444-4444-8444-444444444444", plan: "TEAM_MAX", cycle: "MONTHLY", amountCents: 17990, agendaLimit: 12,
      state: "ACTIVE", paidThrough: "2026-10-20T12:00:00.000Z", nextPaymentAt: "2026-10-20T12:00:00.000Z", providerStatus: "authorized",
      checkoutUrl: null, changesAvailable: true, change: null, changePending: false } };
    render(createElement(SubscriptionPortal, { salonId: "salon-1", email: "dono@example.test", timezone: "America/Sao_Paulo" }));
    expect(await screen.findByText(/R\$\s179,90\/mês/)).toBeVisible();
    const card = screen.getByRole("article", { name: "Equipe" });
    expect(within(card).getByText(/^R\$\s179,90$/)).toBeVisible();
    expect(within(card).getByText("Valor do seu contrato. Para novas contratações: R$ 189,90/mês.")).toBeVisible();
    expect(within(card).getByText("12 agendas")).toBeVisible();
    expect(within(card).getByText("Seu plano")).toBeVisible();
    expect(within(card).getByRole("button", { name: /Plano atual/ })).toBeDisabled();
    expect(within(card).queryByText(/^R\$\s189,90$/)).toBeNull();
  });
});
