// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SubscriptionPortal } from "./subscription-portal";
import { PlanPicker } from "./plan-picker";
import { MarketingPlans } from "../marketing/marketing-plans";
import { resolveBillingIntent, safeCheckout, type SubscriptionView } from "@/lib/billing/presentation";
const initial = { plan: "TEAM_PLUS" as const, cycle: "MONTHLY" as const, extraAgendas: 0 };
const sub: SubscriptionView = { id: "sub", plan: "TEAM_PLUS", cycle: "MONTHLY", amountCents: 9990, agendaLimit: 5, state: "UNPAID", paidThrough: null, nextPaymentAt: null, cancelRequestedAt: null, cancelledAt: null, reviewRequired: false, checkoutUrl: null, providerStatus: "pending", lastSyncedAt: null, charges: [] };
const reply = (subscription: SubscriptionView | null) => new Response(JSON.stringify({ subscription }));
const portal = () => render(<SubscriptionPortal salonId="salon" email="owner@example.test" timezone="America/Sao_Paulo" initial={initial} />);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear(); });
it("uses the full annual amount and preserves capacity and cycle in the public link", () => {
 render(<PlanPicker initial={{ plan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: 2 }} />);
 expect(screen.getByRole("link", { name: "Escolher Equipe · 10 agendas" })).toHaveAttribute("href", "/contratar?billingPlan=TEAM_MAX&cycle=ANNUAL&extraAgendas=2");
 expect(screen.getByText(/1\.727/)).toBeVisible();
 expect(screen.getByLabelText(/Anual/)).toBeChecked();
});
it("rejects malformed selection and foreign checkout destinations", () => {
 expect(resolveBillingIntent({ billingPlan: "TEAM", extraAgendas: "2" })).toBeUndefined();
 expect(resolveBillingIntent({ billingPlan: "TEAM_MAX", extraAgendas: "101" })).toBeUndefined();
 for (const value of ["javascript:alert(1)", "https://www.mercadopago.com.br.evil.test/", "https://user@www.mercadopago.com.br/", "http://www.mercadopago.com.br/"]) expect(safeCheckout(value)).toBeNull();
 expect(safeCheckout("https://www.mercadopago.com.br/subscriptions/checkout?id=1")).toContain("https://www.mercadopago.com.br/");
});
it("keeps the approved annual offer selectable while checkout is unavailable", () => {
 render(<MarketingPlans billingAvailable={false} segment="barbearia" />);
 fireEvent.click(screen.getByLabelText(/Anual/));
 fireEvent.click(screen.getByLabelText("10 agendas"));
 fireEvent.change(screen.getByLabelText("Agendas adicionais às 10 incluídas"), { target: { value: "2" } });
 expect(screen.getByRole("link", { name: "Escolher Equipe" })).toHaveAttribute("href", "/signup?billingPlan=TEAM_MAX&cycle=ANNUAL&extraAgendas=2&segment=barbearia");
 expect(screen.getByText(/1\.727/)).toBeVisible();
 expect(screen.getByText(/Economize.*431,80/)).toBeVisible();
 expect(screen.queryByText(/A renovação é automática/)).toBeNull();
 expect(screen.getByRole("button", { name: "Disponível em breve" })).toBeDisabled();
 expect(screen.getAllByRole("link")).toHaveLength(3);
 fireEvent.click(screen.getByLabelText("5 agendas"));
 expect(screen.getByRole("link", { name: "Escolher Equipe" })).toHaveAttribute("href", "/signup?billingPlan=TEAM_PLUS&cycle=ANNUAL&extraAgendas=0&segment=barbearia");
});
it("never shows a paid plan merely from pending authorization", async () => {
 vi.stubGlobal("fetch", vi.fn(async () => reply(sub))); portal();
 expect(await screen.findByText("Aguardando pagamento")).toBeVisible();
 expect(screen.queryByText("Plano ativo")).toBeNull();
 expect(screen.getByRole("button", { name: "Escolher Equipe · 5 agendas" })).toBeVisible();
});
it("compares pending plans without creating another subscription until cancellation is confirmed", async () => {
 let current: SubscriptionView = { ...sub };
 const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
   if (init?.method === "POST") {
     expect(url).toContain("/api/billing/cancel");
     current = { ...current, cancelRequestedAt: "2026-09-20T12:00:00Z", renewalCancellationStatus: "PENDING" };
     return new Response("{}");
   }
   return reply(current);
 });
 vi.stubGlobal("fetch", fetcher); portal();
 fireEvent.click(await screen.findByRole("button", { name: "Escolher Essencial" }));
 expect(screen.queryByRole("button", { name: "Ir para pagamento" })).toBeNull();
 expect(fetcher).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento da tentativa anterior" }));
 await screen.findByText("Cancelamento em confirmação");
 expect(screen.queryByRole("button", { name: "Ir para pagamento" })).toBeNull();
 current = { ...current, cancelledAt: "2026-09-20T12:01:00Z", renewalCancellationStatus: "CANCELLED" };
 fireEvent.click(screen.getByRole("button", { name: "Atualizar situação" }));
 expect(await screen.findByRole("button", { name: "Ir para pagamento" })).toBeEnabled();
 expect(screen.getByRole("dialog")).toHaveTextContent("Essencial");
 expect(fetcher.mock.calls.filter(c => c[1]?.method === "POST")).toHaveLength(1);
});
it("does not offer a replacement when a pending subscription has a financial review", async () => {
 vi.stubGlobal("fetch", vi.fn(async () => reply({ ...sub, reviewRequired: true }))); portal();
 await screen.findByText("Aguardando pagamento");
 expect(screen.queryByRole("button", { name: "Escolher Essencial" })).toBeNull();
});
it("shows the actual refunded amount without describing a partial refund as a full refund", async () => {
 vi.stubGlobal("fetch", vi.fn(async () => reply({ ...sub, charges: [{ id: "charge", amountCents: 9990, refundedCents: 2000, status: "refunded", periodStart: "2026-09-13T12:00:00Z", periodEnd: "2026-10-13T12:00:00Z", paidAt: "2026-09-13T12:00:00Z" }] })));
 portal();
 expect(await screen.findByText(/Estorno parcial/)).toHaveTextContent(/99,90/);
 expect(screen.getByText(/Estornado:/)).toHaveTextContent(/20/);
});
it("requires explicit review and blocks repeated payment clicks", async () => {
 let finish!: (response: Response) => void;
 const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST" ? new Promise<Response>(r => { finish = r; }) : reply(null));
 vi.stubGlobal("fetch", fetcher); portal();
 fireEvent.click(await screen.findByRole("button", { name: "Escolher Equipe · 5 agendas" }));
 expect(fetcher.mock.calls.filter(c => c[1]?.method === "POST")).toHaveLength(0);
 const submit = screen.getByRole("button", { name: "Ir para pagamento" });
 fireEvent.click(submit); fireEvent.click(submit);
 expect(fetcher.mock.calls.filter(c => c[1]?.method === "POST")).toHaveLength(1);
 expect(submit).toBeDisabled();
 await act(async () => finish(new Response(JSON.stringify({ error: "PROVIDER_UNAVAILABLE" }), { status: 503 })));
 expect(await screen.findByRole("alert")).toHaveTextContent("Sua solicitação será conferida");
});
it("reuses the idempotency key after an uncertain request", async () => {
 const keys: string[] = [];
 vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
   if (init?.method === "POST") { keys.push(new Headers(init.headers).get("Idempotency-Key")!); throw new Error("response lost"); }
   return reply(null);
 }));
 portal();
 for (let attempt = 0; attempt < 2; attempt++) {
   fireEvent.click(await screen.findByRole("button", { name: "Escolher Equipe · 5 agendas" }));
   fireEvent.click(screen.getByRole("button", { name: "Ir para pagamento" }));
   await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
 }
 expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
});
it("cancellation asks for review and waits for server confirmation while preserving paid access", async () => {
 let current = { ...sub, state: "ACTIVE", paidThrough: "2099-10-13T12:00:00Z" };
 const writes = vi.fn();
 vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
   if (init?.method === "POST") { writes(); current = { ...current, cancelRequestedAt: "2026-09-13T12:00:00Z" }; return new Response("{}"); }
   return reply(current);
 }));
 portal(); fireEvent.click(await screen.findByRole("button", { name: "Cancelar renovação" }));
 expect(writes).not.toHaveBeenCalled();
 expect(screen.getByRole("dialog")).toHaveTextContent(/13 de out. de 2099, 09:00/);
 expect(screen.getByRole("dialog")).toHaveTextContent("todos os recursos");
 fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
 expect(await screen.findByText("Cancelamento em confirmação")).toBeVisible();
 expect(screen.queryByText("Renovação cancelada")).toBeNull();
 expect(screen.getByText("Acesso pago até")).toBeVisible();
});
it("keeps cancellation visible for a future recurrence and only announces completion after all confirmations", async () => {
 let current: SubscriptionView = { ...sub, state: "ACTIVE", paidThrough: "2099-10-13T12:00:00Z", cancelledAt: "2026-09-13T12:00:00Z", cancelRequestedAt: "2026-09-13T12:00:00Z", renewalCancellationStatus: "AVAILABLE" };
 vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
   if (init?.method === "POST") { current = { ...current, renewalCancellationStatus: "PENDING" }; return new Response("{}", { status: 202 }); }
   return reply(current);
 }));
 portal(); fireEvent.click(await screen.findByRole("button", { name: "Cancelar renovação" }));
 expect(screen.queryByText("Renovação cancelada")).toBeNull();
 expect(screen.getByRole("dialog")).toHaveTextContent("incluindo uma nova assinatura agendada");
 fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirmar cancelamento" }));
 expect(await screen.findByText("Cancelamento em confirmação")).toBeVisible();
 expect(screen.queryByText("Renovação cancelada")).toBeNull();
 current = { ...current, renewalCancellationStatus: "CANCELLED" };
 fireEvent.click(screen.getByRole("button", { name: "Atualizar situação" }));
 expect(await screen.findByText("Renovação cancelada")).toBeVisible();
 expect(screen.queryByText("Cancelamento em confirmação")).toBeNull();
 expect(screen.getByText(/Você continua usando o plano até/)).toHaveTextContent("13 de out. de 2099, 09:00");
 expect(screen.queryByRole("button", { name: "Cancelar renovação" })).toBeNull();
});
it("allows leaving cancellation review without submitting a reason or changing the subscription", async () => {
 const fetcher = vi.fn(async () => reply({ ...sub, state: "ACTIVE", paidThrough: "2099-09-13T12:00:00Z", cycle: "ANNUAL" }));
 vi.stubGlobal("fetch", fetcher); portal();
 fireEvent.click(await screen.findByRole("button", { name: "Cancelar renovação" }));
 expect(screen.getByRole("dialog")).toHaveTextContent("13 de set. de 2099, 09:00");
 expect(within(screen.getByRole("dialog")).queryByRole("textbox")).toBeNull();
 fireEvent.click(screen.getByRole("button", { name: "Manter assinatura" }));
 expect(screen.queryByRole("dialog")).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1);
});
