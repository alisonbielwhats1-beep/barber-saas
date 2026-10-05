// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SubscriptionPortal } from "./subscription-portal";
import { goToCheckout } from "./navigation";
import { PlanPicker } from "./plan-picker";
import { MarketingPlans } from "../marketing/marketing-plans";
import { annualSavingsCents, isRenewalReactivation, planBadgeFor, resolveBillingIntent, safeCheckout, subscriptionStatus, type PlanChangeView, type SubscriptionView } from "@/lib/billing/presentation";
const initial = { plan: "TEAM_PLUS" as const, cycle: "MONTHLY" as const, extraAgendas: 0 };
const sub: SubscriptionView = { id: "sub", plan: "TEAM_PLUS", cycle: "MONTHLY", amountCents: 9990, agendaLimit: 5, state: "UNPAID", paidThrough: null, nextPaymentAt: null, cancelRequestedAt: null, cancelledAt: null, reviewRequired: false, checkoutUrl: null, providerStatus: "pending", lastSyncedAt: null, charges: [] };
const paid: SubscriptionView = { ...sub, plan: "INDIVIDUAL", amountCents: 5990, agendaLimit: 1, state: "ACTIVE", paidThrough: "2099-10-13T12:00:00Z", providerStatus: "authorized", changesAvailable: true };
const quote: PlanChangeView = { id: "f5e579be-3c6c-44ae-bb34-b6ec479a4f4e", kind: "UPGRADE", state: "QUOTED", from: { plan: "INDIVIDUAL", cycle: "MONTHLY", amountCents: 5990, agendaLimit: 1, intervalMonths: 1, catalogVersion: "2026-09-13" }, to: { plan: "TEAM_MAX", cycle: "MONTHLY", amountCents: 14990, agendaLimit: 10, intervalMonths: 1, catalogVersion: "2026-09-13" }, amountDueCents: 4500, effectiveAt: "2099-09-28T12:00:00Z", periodEnd: "2099-10-13T12:00:00Z", expiresAt: "2099-09-28T12:15:00Z", paidAt: null, activatedAt: null, checkoutUrl: null, lastError: null };
const reply = (subscription: SubscriptionView | null) => new Response(JSON.stringify({ subscription }));
const legacy = { label: "Essencial", agendas: 3, free: false };
const portal = (props: Partial<Parameters<typeof SubscriptionPortal>[0]> = {}) => render(<SubscriptionPortal salonId="salon" email="owner@example.test" timezone="America/Sao_Paulo" initial={initial} legacy={legacy} occupiedAgendas={1} {...props} />);
const isSync = (url: string) => url.includes("/api/billing/sync");
const synced = () => new Response(JSON.stringify({ queued: true }), { status: 202 });
// Billing writes, excluding the best-effort provider sync that never changes a contract.
const posts = (fetcher: ReturnType<typeof vi.fn>) => (fetcher.mock.calls as unknown as [string, RequestInit?][]).filter(c => c[1]?.method === "POST" && !isSync(c[0]));
vi.mock("./navigation", () => ({ goToCheckout: vi.fn() }));
afterEach(() => { vi.mocked(goToCheckout).mockClear(); cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); sessionStorage.clear(); });

it("uses the full annual amount, savings and extra agendas in the admin catalog", () => {
  const onChoose = vi.fn();
  render(<PlanPicker mode="subscribe" initial={{ plan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: 2 }} onChoose={onChoose} />);
  expect(screen.getByLabelText(/Anual/)).toBeChecked();
  expect(screen.getByLabelText("10 agendas")).toBeChecked();
  expect(screen.getByText(/1\.823/)).toBeVisible();
  expect(screen.getByText(/economize R\$\s455,80/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Adicionar uma agenda adicional" }));
  fireEvent.click(screen.getByRole("button", { name: "Assinar: Equipe · 10 agendas" }));
  expect(onChoose).toHaveBeenCalledWith({ plan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: 3 });
  expect(annualSavingsCents({ plan: "TEAM_PLUS", cycle: "MONTHLY", extraAgendas: 0 })).toBe(23980);
});
it("marks the plan in use and blocks capacities smaller than the team", () => {
  render(<PlanPicker mode="change" current={{ plan: "TEAM", cycle: "MONTHLY", agendaLimit: 3, amountCents: 7990 }} occupiedAgendas={2} onChoose={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Plano atual" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Reduzir para este plano: Individual" })).toBeDisabled();
  expect(screen.getByText(/Sua equipe usa 2 agendas/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Fazer upgrade: Equipe · 5 agendas" })).toBeEnabled();
  fireEvent.click(screen.getByLabelText(/Anual/));
  expect(screen.getByRole("button", { name: "Mudar para anual: Essencial" })).toBeEnabled();
});
it("rejects malformed selection and foreign checkout destinations", () => {
  expect(resolveBillingIntent({ billingPlan: "TEAM", extraAgendas: "2" })).toBeUndefined();
  expect(resolveBillingIntent({ billingPlan: "TEAM_MAX", extraAgendas: "101" })).toBeUndefined();
  for (const value of ["javascript:alert(1)", "https://www.mercadopago.com.br.evil.test/", "https://user@www.mercadopago.com.br/", "http://www.mercadopago.com.br/"]) expect(safeCheckout(value)).toBeNull();
  expect(safeCheckout("https://www.mercadopago.com.br/subscriptions/checkout?id=1")).toContain("https://www.mercadopago.com.br/");
});
it("describes the header shortcut with the real situation of the contract", () => {
  expect(planBadgeFor("Essencial", null)).toEqual({ plan: "Essencial", status: null, tone: "neutral" });
  expect(planBadgeFor(null, null).plan).toBeNull();
  expect(planBadgeFor("Essencial", { plan: "TEAM_PLUS", agendaLimit: 5, state: "UNPAID", renewal: "AVAILABLE", reviewRequired: false })).toEqual({ plan: "Equipe · 5 agendas", status: "Aguardando pagamento", tone: "warn" });
  // An abandoned attempt never replaces the plan in use.
  expect(planBadgeFor("Essencial", { plan: "TEAM_PLUS", agendaLimit: 5, state: "UNPAID", renewal: "CANCELLED", reviewRequired: false }).plan).toBe("Essencial");
  expect(planBadgeFor(null, { plan: "TEAM_MAX", agendaLimit: 12, state: "ACTIVE", renewal: "AVAILABLE", reviewRequired: false })).toEqual({ plan: "Equipe · 12 agendas", status: "Ativo", tone: "ok" });
  expect(subscriptionStatus({ state: "ACTIVE", renewal: "CANCELLED", reviewRequired: false }).label).toBe("Renovação cancelada");
  expect(subscriptionStatus({ state: "GRACE", renewal: "AVAILABLE", reviewRequired: false }).tone).toBe("warn");
  expect(subscriptionStatus({ state: "RESTRICTED", renewal: "AVAILABLE", reviewRequired: false }).tone).toBe("danger");
});
it("keeps the approved annual offer selectable while checkout is unavailable", () => {
  render(<MarketingPlans billingAvailable={false} segment="barbearia" />);
  fireEvent.click(screen.getByLabelText(/Anual/));
  fireEvent.click(screen.getByLabelText("10 agendas"));
  fireEvent.change(screen.getByLabelText("Agendas adicionais às 10 incluídas"), { target: { value: "2" } });
  expect(screen.getByRole("link", { name: "Escolher Equipe" })).toHaveAttribute("href", "/signup?billingPlan=TEAM_MAX&cycle=ANNUAL&extraAgendas=2&segment=barbearia");
  expect(screen.getByText(/1\.823/)).toBeVisible();
  expect(screen.getByText(/Economize.*455,80/)).toBeVisible();
  expect(screen.queryByText(/A renovação é automática/)).toBeNull();
  expect(screen.getByRole("button", { name: "Disponível em breve" })).toBeDisabled();
  expect(screen.getAllByRole("link")).toHaveLength(3);
  fireEvent.click(screen.getByLabelText("5 agendas"));
  expect(screen.getByRole("link", { name: "Escolher Equipe" })).toHaveAttribute("href", "/signup?billingPlan=TEAM_PLUS&cycle=ANNUAL&extraAgendas=0&segment=barbearia");
});
it("never shows a paid plan merely from pending authorization and keeps the plan in use visible", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => reply({ ...sub, checkoutUrl: "https://www.mercadopago.com.br/subscriptions/checkout?id=1" }))); portal();
  expect(await screen.findByText("Aguardando pagamento")).toBeVisible();
  expect(screen.queryByText("Ativo")).toBeNull();
  expect(screen.getByText("Até lá, você continua no plano Essencial.")).toBeVisible();
  expect(screen.getByRole("link", { name: "Continuar pagamento no Mercado Pago" })).toHaveAttribute("href", "https://www.mercadopago.com.br/subscriptions/checkout?id=1");
  // The pending plan continues its own checkout instead of cancelling and recreating it.
  expect(screen.getByRole("link", { name: "Continuar pagamento: Equipe · 5 agendas" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Trocar para este plano: Essencial" })).toBeEnabled();
  expect(screen.queryByText("Próxima cobrança")).toBeNull();
});
it("compares pending plans without creating another subscription until cancellation is confirmed", async () => {
  let current: SubscriptionView = { ...sub };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (isSync(url)) return synced();
    if (init?.method === "POST") {
      expect(url).toContain("/api/billing/cancel");
      current = { ...current, cancelRequestedAt: "2026-09-20T12:00:00Z", renewalCancellationStatus: "PENDING" };
      return new Response("{}");
    }
    return reply(current);
  });
  vi.stubGlobal("fetch", fetcher); portal();
  fireEvent.click(await screen.findByRole("button", { name: "Trocar para este plano: Essencial" }));
  expect(screen.queryByRole("button", { name: "Ir para pagamento" })).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento da tentativa anterior" }));
  expect(await within(screen.getByRole("dialog")).findByText(/aguardando confirmação/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Ir para pagamento" })).toBeNull();
  current = { ...current, cancelledAt: "2026-09-20T12:01:00Z", renewalCancellationStatus: "CANCELLED" };
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Atualizar situação" }));
  expect(await screen.findByRole("button", { name: "Ir para pagamento" })).toBeEnabled();
  expect(screen.getByRole("dialog")).toHaveTextContent("Essencial");
  expect(screen.getByRole("dialog")).toHaveTextContent(/Encerrar a tentativa.*confirmado/);
  expect(posts(fetcher)).toHaveLength(1);
});
it("does not offer a replacement when a pending subscription has a financial review", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => reply({ ...sub, reviewRequired: true }))); portal();
  expect(await screen.findByText("Em revisão")).toBeVisible();
  for (const button of screen.getAllByRole("button", { name: /: (Individual|Essencial|Equipe)/ })) expect(button).toBeDisabled();
  expect(screen.getByRole("note")).toHaveTextContent("ocorrência financeira em revisão");
});
it("shows the actual refunded amount without describing a partial refund as a full refund", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => reply({ ...sub, charges: [{ id: "charge", amountCents: 9990, refundedCents: 2000, status: "refunded", periodStart: "2026-09-13T12:00:00Z", periodEnd: "2026-10-13T12:00:00Z", paidAt: "2026-09-13T12:00:00Z" }] })));
  portal();
  const row = (await screen.findByText("Estorno parcial")).closest("li")!;
  expect(row).toHaveTextContent(/99,90/);
  expect(within(row).getByText(/Estornado:/)).toHaveTextContent(/20/);
});
it("requires explicit review and blocks repeated payment clicks", async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST" ? new Promise<Response>(r => { finish = r; }) : reply(null));
  vi.stubGlobal("fetch", fetcher); portal();
  fireEvent.click(await screen.findByRole("button", { name: "Assinar: Equipe · 5 agendas" }));
  expect(posts(fetcher)).toHaveLength(0);
  const submit = screen.getByRole("button", { name: "Ir para pagamento" });
  fireEvent.click(submit); fireEvent.click(submit);
  expect(posts(fetcher)).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Preparando pagamento…" })).toBeDisabled();
  await act(async () => finish(new Response(JSON.stringify({ error: "PROVIDER_UNAVAILABLE" }), { status: 503 })));
  expect(await screen.findByRole("alert")).toHaveTextContent("Sua solicitação será conferida");
});
it("continues the plan chosen on the public page after signup", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => reply(null))); portal({ legacy: { label: "Grátis", agendas: 1, free: true } });
  fireEvent.click(await screen.findByRole("button", { name: "Continuar com este plano" }));
  expect(screen.getByRole("dialog", { name: "Confirmar contratação" })).toHaveTextContent("Equipe · 5 agendas");
});
it("reuses the idempotency key after an uncertain request", async () => {
  const keys: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") { keys.push(new Headers(init.headers).get("Idempotency-Key")!); throw new Error("response lost"); }
    return reply(null);
  }));
  portal();
  for (let attempt = 0; attempt < 2; attempt++) {
    fireEvent.click(await screen.findByRole("button", { name: "Assinar: Equipe · 5 agendas" }));
    fireEvent.click(screen.getByRole("button", { name: "Ir para pagamento" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  }
  expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
});
it("reviews server-calculated difference and recurrence, then continues to the upgrade checkout", async () => {
  let current: SubscriptionView = { ...paid };
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method !== "POST") return reply(current);
    const body = JSON.parse(String(init.body));
    if (body.action === "quote") return new Response(JSON.stringify({ change: quote }));
    current = { ...current, changePending: true, change: { ...quote, state: "AWAITING_PAYMENT", checkoutUrl: "https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=1" } };
    return new Response(JSON.stringify({ change: { ...quote, state: "PREPARING" } }), { status: 202 });
  });
  vi.stubGlobal("fetch", fetcher); portal();
  fireEvent.click(await screen.findByLabelText("10 agendas"));
  fireEvent.click(await screen.findByRole("button", { name: "Fazer upgrade: Equipe · 10 agendas" }));
  const dialog = await screen.findByRole("dialog", { name: "Revisar troca de plano" });
  expect(dialog).toHaveTextContent(/45/);
  expect(dialog).toHaveTextContent(/149,90 por mês/);
  expect(dialog).toHaveTextContent("O vencimento permanece igual");
  expect(JSON.parse(String(posts(fetcher)[0][1]!.body))).toMatchObject({ action: "quote", selection: { plan: "TEAM_MAX", cycle: "MONTHLY" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar e pagar diferença" }));
  await waitFor(() => expect(goToCheckout).toHaveBeenCalledWith("https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=1"));
  expect(JSON.parse(String(posts(fetcher)[1][1]!.body))).toEqual({ action: "confirm", id: quote.id });
});
it("blocks a competing selection during a change and only uses a trusted checkout URL", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => reply({ ...paid, changePending: true, change: { ...quote, state: "AWAITING_PAYMENT", checkoutUrl: "https://evil.example/checkout" } })));
  portal();
  expect(await screen.findByText("Aguardando você no Mercado Pago")).toBeVisible();
  expect(screen.queryByRole("link", { name: /Pagar diferença/ })).toBeNull();
  expect(screen.getByRole("button", { name: "Fazer upgrade: Equipe · 5 agendas" })).toBeDisabled();
  expect(screen.getByRole("note")).toHaveTextContent("Há uma troca em andamento");
});
it("explains recurrence replacement before accepting a cycle change", async () => {
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST"
    ? new Response(JSON.stringify({ change: { ...quote, kind: "CYCLE", amountDueCents: 0, to: { ...quote.to, plan: "INDIVIDUAL", agendaLimit: 1, cycle: "ANNUAL", intervalMonths: 12, amountCents: 59900 } } }))
    : reply(paid));
  vi.stubGlobal("fetch", fetcher); portal();
  fireEvent.click(await screen.findByLabelText(/Anual/));
  fireEvent.click(screen.getByRole("button", { name: "Mudar para anual: Individual" }));
  const dialog = await screen.findByRole("dialog", { name: "Revisar troca de plano" });
  expect(dialog).toHaveTextContent("Se você não concluir a nova autorização, não haverá renovação automática");
  expect(dialog).toHaveTextContent("R$ 599 a cada 12 meses");
  expect(within(dialog).getByRole("button", { name: "Confirmar troca" })).toBeEnabled();
});
it("warns on a foreign host because billing mutations only accept the official origin", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => reply(paid))); portal({ billingOrigin: "https://everflair.example" });
  expect(await screen.findByText("Abra o endereço oficial para pagar ou trocar de plano")).toBeVisible();
  expect(screen.getByRole("link", { name: "Abrir everflair.example" })).toHaveAttribute("href", "https://everflair.example/assinatura");
  expect(screen.getByRole("button", { name: "Cancelar renovação" })).toBeDisabled();
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
  expect(await screen.findByText("Cancelando renovação")).toBeVisible();
  expect(screen.queryByText("Renovação cancelada")).toBeNull();
  expect(screen.getByText("Acesso pago até")).toBeVisible();
});
it("keeps cancellation visible for a future recurrence and only announces completion after all confirmations", async () => {
  let current: SubscriptionView = { ...sub, state: "ACTIVE", paidThrough: "2099-10-13T12:00:00Z", cancelledAt: "2026-09-13T12:00:00Z", cancelRequestedAt: "2026-09-13T12:00:00Z", renewalCancellationStatus: "AVAILABLE" };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (isSync(url)) return synced();
    if (init?.method === "POST") { current = { ...current, renewalCancellationStatus: "PENDING" }; return new Response("{}", { status: 202 }); }
    return reply(current);
  }));
  portal(); fireEvent.click(await screen.findByRole("button", { name: "Cancelar renovação" }));
  expect(screen.queryByText("Renovação cancelada")).toBeNull();
  expect(screen.getByRole("dialog")).toHaveTextContent("incluindo uma nova assinatura agendada");
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirmar cancelamento" }));
  expect(await screen.findByText("Cancelando renovação")).toBeVisible();
  expect(screen.queryByText("Renovação cancelada")).toBeNull();
  current = { ...current, renewalCancellationStatus: "CANCELLED" };
  fireEvent.click(screen.getByRole("button", { name: "Atualizar situação" }));
  expect(await screen.findByText("Renovação cancelada")).toBeVisible();
  expect(screen.queryByText("Cancelando renovação")).toBeNull();
  expect(screen.getByText(/Você continua usando o plano até/)).toHaveTextContent("13 de out. de 2099, 09:00");
  expect(screen.queryByRole("button", { name: "Cancelar renovação" })).toBeNull();
  expect(screen.getByRole("note")).toHaveTextContent("quando o período pago terminar, em 13 de outubro de 2099");
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
it("keeps only the cancellation available when the panel is administratively blocked", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => reply(paid))); portal({ accessBlocked: true });
  expect(await screen.findByRole("button", { name: "Cancelar renovação" })).toBeEnabled();
  expect(screen.queryByRole("heading", { name: "Mudar de plano" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Fazer upgrade/ })).toBeNull();
});
it("asks the server to consult Mercado Pago on manual refresh and after returning from checkout", async () => {
  const fetcher = vi.fn(async (url: string) => isSync(url) ? synced() : reply(paid));
  vi.stubGlobal("fetch", fetcher); portal({ returnedFromCheckout: true });
  await waitFor(() => expect(fetcher.mock.calls.filter(c => isSync(String(c[0])))).toHaveLength(1));
  fireEvent.click(await screen.findByRole("button", { name: "Atualizar situação" }));
  await waitFor(() => expect(fetcher.mock.calls.filter(c => isSync(String(c[0])))).toHaveLength(2));
  expect(posts(fetcher)).toHaveLength(0);
});
it("reactivates a cancelled renewal without charging now and continues to the new authorization", async () => {
  let current: SubscriptionView = { ...paid, plan: "TEAM", amountCents: 7990, agendaLimit: 3, cancelRequestedAt: "2026-09-13T12:00:00Z", cancelledAt: "2026-09-13T12:01:00Z", renewalCancellationStatus: "CANCELLED" };
  const terms = { plan: "TEAM" as const, cycle: "MONTHLY" as const, amountCents: 7990, agendaLimit: 3, intervalMonths: 1 as const, catalogVersion: "2026-09-13" };
  const reactivation: PlanChangeView = { ...quote, kind: "CYCLE", state: "PREPARING", amountDueCents: 0, from: terms, to: terms, periodEnd: "2099-10-13T12:00:00Z", effectiveAt: "2099-10-13T12:00:00Z" };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (isSync(url)) return synced();
    if (init?.method === "POST") {
      expect(url).toContain("/api/billing/reactivate");
      current = { ...current, renewalCancellationStatus: "AVAILABLE", changePending: true, change: { ...reactivation, state: "AWAITING_PAYMENT", checkoutUrl: "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=2" } };
      return new Response(JSON.stringify({ change: reactivation }), { status: 202 });
    }
    return reply(current);
  });
  vi.stubGlobal("fetch", fetcher); portal();
  expect(screen.queryByRole("button", { name: "Cancelar renovação" })).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "Reativar renovação" }));
  const dialog = screen.getByRole("dialog", { name: "Reativar a renovação?" });
  expect(dialog).toHaveTextContent(/Cobrança agora\s*R\$\s0/);
  expect(dialog).toHaveTextContent(/79,90 por mês/);
  expect(posts(fetcher)).toHaveLength(0);
  fireEvent.click(within(dialog).getByRole("button", { name: "Reativar e autorizar" }));
  await waitFor(() => expect(goToCheckout).toHaveBeenCalledWith("https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=2"));
  const body = JSON.parse(String(posts(fetcher)[0][1]!.body));
  expect(body.subscriptionId).toBe("sub"); expect(body.requestKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(screen.getByText("Reativação da renovação")).toBeVisible();
  expect(screen.getByText("Reativação pendente")).toBeVisible();
});
it("offers a smaller plan that fits the team before cancelling, but not for the smallest plan", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => isSync(url) ? synced() : reply({ ...paid, plan: "TEAM", amountCents: 7990, agendaLimit: 3 })));
  portal();
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar renovação" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Prefere pagar menos?");
  fireEvent.click(screen.getByRole("button", { name: "Ver planos menores" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  cleanup();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => isSync(url) ? synced() : reply(paid)));
  portal();
  fireEvent.click(await screen.findByRole("button", { name: "Cancelar renovação" }));
  expect(screen.getByRole("dialog")).not.toHaveTextContent("Prefere pagar menos?");
});
it("labels a reactivated renewal separately from plan changes", () => {
  const terms = { plan: "TEAM", cycle: "MONTHLY", agendaLimit: 3 };
  expect(isRenewalReactivation({ kind: "CYCLE", from: terms, to: terms })).toBe(true);
  expect(isRenewalReactivation({ kind: "CYCLE", from: terms, to: { ...terms, cycle: "ANNUAL" } })).toBe(false);
  expect(subscriptionStatus({ state: "ACTIVE", renewal: "AVAILABLE", reviewRequired: false, changePending: true, reactivation: "pending" })).toEqual({ label: "Reativação pendente", tone: "warn" });
  expect(subscriptionStatus({ state: "ACTIVE", renewal: "AVAILABLE", reviewRequired: false, changePending: true, reactivation: "scheduled" })).toEqual({ label: "Ativo", tone: "ok" });
});
