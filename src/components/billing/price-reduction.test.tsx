// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SubscriptionPortal } from "./subscription-portal";
import { CurrentPlanCard } from "./current-plan-card";
import type { PlanChangeView, SubscriptionView } from "@/lib/billing/presentation";

vi.mock("./navigation", () => ({ goToCheckout: vi.fn() }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const from = { plan: "INDIVIDUAL" as const, cycle: "MONTHLY" as const, amountCents: 5990, agendaLimit: 1, intervalMonths: 1 as const, catalogVersion: "2026-09-13" };
const to = { ...from, amountCents: 3990, catalogVersion: "2026-10-02" };
const reduction = (state: string): PlanChangeView => ({ id: "0f3c3d6c-6a55-4e4e-9a4c-2d2f3e1b7a10", kind: "SCHEDULED", state, from, to, amountDueCents: 0,
  effectiveAt: "2026-10-13T17:42:29Z", periodEnd: "2026-10-13T17:42:29Z", expiresAt: "2026-10-13T17:42:29Z", paidAt: null, activatedAt: null, checkoutUrl: null, lastError: null, priceReduction: true });
const subscription = (state: string): SubscriptionView => ({ id: "sub", plan: "INDIVIDUAL", cycle: "MONTHLY", amountCents: 5990, agendaLimit: 1, state: "ACTIVE",
  paidThrough: "2026-10-13T17:42:29Z", nextPaymentAt: "2026-10-13T17:42:29Z", cancelRequestedAt: null, cancelledAt: null, reviewRequired: false, renewalCancellationStatus: "AVAILABLE",
  checkoutUrl: null, providerStatus: "authorized", lastSyncedAt: null, changesAvailable: true, changePending: true, change: reduction(state), charges: [] });
const card = (state: string, onCancelChange = vi.fn()) => render(<CurrentPlanCard subscription={subscription(state)} legacy={{ label: "Grátis", agendas: 1, free: true }} occupiedAgendas={1}
  timezone="America/Sao_Paulo" email="dona@example.test" accessBlocked={false} returnedFromCheckout={false} refreshing={false} busy={false} preparingChangeCheckout={false}
  onRefresh={vi.fn()} onCancelChange={onCancelChange} />);

it.each(["PREPARING", "SCHEDULED"])("redução de preço da plataforma (%s): aviso claro, valor novo na próxima cobrança e status Ativo", state => {
  const onCancelChange = vi.fn();
  card(state, onCancelChange);
  expect(screen.getByText("Seu plano ficou mais barato")).toBeVisible();
  expect(screen.getByText(/^A partir de 13 de out\. de 2026, a cobrança mensal passa de R\$\s59,90 para R\$\s39,90\. Nada muda no seu plano e você não precisa fazer nada\.$/)).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Ativo");
  expect(screen.queryByText(/Troca para/)).toBeNull();
  expect(screen.queryByText("Troca em andamento")).toBeNull();
  expect(screen.getByText("Próxima cobrança").nextElementSibling).toHaveTextContent(/^13 de out\. de 2026 · R\$\s39,90$/);
  // The current period keeps the contracted price until the renewal.
  expect(screen.getByText(/R\$\s59,90\/mês · cobrança mensal/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Mudar de plano agora" }));
  expect(onCancelChange).toHaveBeenCalledTimes(1);
});

it("enquanto a redução é desfeita, o aviso explica a liberação e não oferece o botão de novo", () => {
  card("CANCEL_REQUESTED");
  expect(screen.getByText("Liberando a troca de plano")).toBeVisible();
  expect(screen.getByText(/Estamos desfazendo a redução no Mercado Pago/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Mudar de plano agora" })).toBeNull();
});

it("no portal, a troca de plano explica a redução e a confirmação desfaz a redução antes de liberar a troca", async () => {
  let current = subscription("SCHEDULED");
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/api/billing/changes") && init?.method === "POST") {
      expect(JSON.parse(String(init.body))).toEqual({ action: "cancel", id: reduction("SCHEDULED").id });
      current = { ...current, change: reduction("CANCEL_REQUESTED") };
      return new Response(JSON.stringify({ change: current.change }));
    }
    return new Response(JSON.stringify({ subscription: current }));
  });
  vi.stubGlobal("fetch", fetcher);
  render(<SubscriptionPortal salonId="salon" email="dona@example.test" timezone="America/Sao_Paulo" occupiedAgendas={1} />);
  expect(await screen.findByText("Seu plano ficou mais barato")).toBeVisible();
  expect(screen.getByText("Seu plano ficará mais barato no próximo vencimento. Para mudar de plano antes disso, use Mudar de plano agora, acima.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Mudar de plano agora" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("Mudar de plano agora?")).toBeVisible();
  expect(dialog).toHaveTextContent("desfazemos a redução agendada no Mercado Pago e a cobrança volta para R$ 59,90");
  expect(dialog).toHaveTextContent("o próximo vencimento continua em R$ 59,90 e a redução volta a valer no vencimento seguinte");
  expect(within(dialog).getByRole("button", { name: "Manter redução" })).toBeEnabled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Desfazer redução e escolher plano" }));
  await waitFor(() => expect(screen.getByText("Liberando a troca de plano")).toBeVisible());
  expect(screen.getByText("Estamos liberando a troca de plano. Ela fica disponível assim que o Mercado Pago confirmar.")).toBeVisible();
});
