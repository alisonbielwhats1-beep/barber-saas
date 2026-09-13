// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PlanChangePanel } from "./plan-change-panel";
import type { PlanChangeView, SubscriptionView } from "@/lib/billing/presentation";
const sub: SubscriptionView = { id: "sub", plan: "INDIVIDUAL", cycle: "MONTHLY", amountCents: 5990, agendaLimit: 1, state: "ACTIVE", paidThrough: "2099-10-13T12:00:00Z", nextPaymentAt: null, cancelRequestedAt: null, cancelledAt: null, reviewRequired: false, checkoutUrl: null, providerStatus: "authorized", lastSyncedAt: null, charges: [], changesAvailable: true };
const quote: PlanChangeView = { id: "f5e579be-3c6c-44ae-bb34-b6ec479a4f4e", kind: "UPGRADE", state: "QUOTED", from: { plan: "INDIVIDUAL", cycle: "MONTHLY", amountCents: 5990, agendaLimit: 1, intervalMonths: 1, catalogVersion: "2026-09-13" }, to: { plan: "TEAM_MAX", cycle: "MONTHLY", amountCents: 14990, agendaLimit: 10, intervalMonths: 1, catalogVersion: "2026-09-13" }, amountDueCents: 4500, effectiveAt: "2099-09-28T12:00:00Z", periodEnd: "2099-10-13T12:00:00Z", expiresAt: "2099-09-28T12:15:00Z", paidAt: null, activatedAt: null, checkoutUrl: null, lastError: null };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("reviews server-calculated difference and recurrence before authorizing any change", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ change: quote })));
  vi.stubGlobal("fetch", fetcher); const refresh = vi.fn(async () => {});
  render(<PlanChangePanel salonId="salon" subscription={sub} timezone="America/Sao_Paulo" onRefresh={refresh} />);
  fireEvent.click(screen.getByRole("button", { name: "Escolher outro plano" }));
  fireEvent.click(screen.getByRole("button", { name: "Escolher Equipe · 10 agendas" }));
  expect(await screen.findByRole("dialog")).toHaveTextContent(/45/);
  expect(screen.getByRole("dialog")).toHaveTextContent(/149,90/);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String((fetcher.mock.calls as unknown as [string, RequestInit][])[0][1].body))).toMatchObject({ action: "quote", selection: { plan: "TEAM_MAX", cycle: "MONTHLY" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar troca" }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(JSON.parse(String((fetcher.mock.calls as unknown as [string, RequestInit][])[1][1].body))).toEqual({ action: "confirm", id: quote.id });
});
it("blocks a competing selection during confirmation and only uses a trusted checkout URL", () => {
  render(<PlanChangePanel salonId="salon" subscription={{ ...sub, changePending: true, change: { ...quote, state: "AWAITING_PAYMENT", checkoutUrl: "https://evil.example/checkout" } }} timezone="America/Sao_Paulo" onRefresh={async () => {}} />);
  expect(screen.queryByRole("button", { name: "Escolher outro plano" })).toBeNull();
  expect(screen.queryByRole("link", { name: /Pagar diferença/ })).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("Aguardando você");
});
it("explains recurrence replacement before accepting a cycle change", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ change: { ...quote, kind: "CYCLE", amountDueCents: 0, to: { ...quote.to, cycle: "ANNUAL", intervalMonths: 12, amountCents: 143900 } } }))));
  render(<PlanChangePanel salonId="salon" subscription={sub} timezone="America/Sao_Paulo" onRefresh={async () => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Escolher outro plano" }));
  fireEvent.click(screen.getByRole("button", { name: "Escolher Equipe · 10 agendas" }));
  expect(await screen.findByRole("dialog")).toHaveTextContent("Se você não concluir a nova autorização, não haverá renovação automática");
  expect(screen.getByRole("dialog")).toHaveTextContent("a cada 12 meses");
});
