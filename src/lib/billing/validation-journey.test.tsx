// @vitest-environment jsdom
/**
 * Validação da jornada de contratação (landing -> /contratar -> /signup ->
 * /onboarding/create-salon -> /assinatura -> POST /api/billing/subscriptions ->
 * Mercado Pago -> /api/billing/return), incluindo o plano lembrado entre a
 * confirmação de e-mail e o login (cookie ef_billing_intent -> /pos-login).
 *
 * Tudo é simulado: prisma, sessão, rate limit e Mercado Pago são mocks. Nenhuma
 * chamada externa nem banco. Os valores esperados são literais independentes do
 * catálogo (não são calculados chamando o código sob teste).
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  class RedirectSignal extends Error { constructor(public url: string) { super(`REDIRECT:${url}`); } }
  return {
    RedirectSignal,
    session: vi.fn(),
    withUser: vi.fn(),
    withTenant: vi.fn(),
    withSalon: vi.fn(),
    mpRequest: vi.fn(),
    requireRole: vi.fn(),
    push: vi.fn(),
    refresh: vi.fn(),
    signup: vi.fn(),
    signIn: vi.fn(),
    goToCheckout: vi.fn(),
    cookies: vi.fn(),
    isPlatformAdmin: vi.fn(),
  };
});

vi.mock("next-auth", () => ({ getServerSession: h.session }));
vi.mock("next-auth/react", () => ({ signIn: h.signIn }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/prisma-tenant", () => ({ withUser: h.withUser, withTenant: h.withTenant, withSalon: h.withSalon }));
vi.mock("@/lib/tenant", () => ({ requireRole: h.requireRole }));
vi.mock("@/lib/billing/worker", () => ({ runBillingWorker: vi.fn(async () => undefined) }));
vi.mock("@/lib/billing/provider", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/billing/provider")>()),
  mpRequest: h.mpRequest,
  verifySellerAccount: vi.fn(async () => undefined),
  searchSubscriptions: vi.fn(async () => []),
}));
vi.mock("next/server", async importOriginal => ({ ...(await importOriginal<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("next/navigation", async importOriginal => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: h.push, refresh: h.refresh }),
  redirect: vi.fn((url: string) => { throw new h.RedirectSignal(url); }),
}));
vi.mock("@/app/(auth)/signup/actions", () => ({ signup: h.signup }));
vi.mock("@/components/billing/navigation", () => ({ goToCheckout: h.goToCheckout }));
vi.mock("@/components/marketing/establishment-shell", () => ({ EstablishmentShell: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/app/onboarding/create-salon/create-salon-form", () => ({ CreateSalonForm: ({ nextHref }: { nextHref: string }) => <a data-testid="create-salon-next" href={nextHref}>next</a> }));
vi.mock("next/headers", () => ({ cookies: h.cookies }));
vi.mock("@/lib/platform-admin", () => ({ isPlatformAdmin: h.isPlatformAdmin }));
// Da landing real (cenas, segmentos, CSS) só interessa aqui a propagação de billingAvailable até a tabela de planos.
vi.mock("@/components/marketing/landing-experience", async () => {
  const { PricingComparison } = await import("@/components/marketing/pricing-comparison");
  return { LandingExperience: ({ billingAvailable }: { billingAvailable?: boolean }) => <PricingComparison segmentId="barbearia" billingAvailable={billingAvailable} /> };
});

import { RequestCookies } from "next/dist/server/web/spec-extension/cookies";
import { MarketingPlans } from "@/components/marketing/marketing-plans";
import LandingPage from "@/app/page";
import SignupPage from "@/app/(auth)/signup/page";
import PostLoginPage from "@/app/pos-login/page";
import { SignupForm } from "@/app/(auth)/signup/signup-form";
import { SubscriptionPortal } from "@/components/billing/subscription-portal";
import { PlanPicker } from "@/components/billing/plan-picker";
import SubscriptionPage from "@/app/(admin)/assinatura/page";
import CreateSalonPage from "@/app/onboarding/create-salon/page";
import { GET as contratar } from "@/app/contratar/route";
import { POST as createSubscription } from "@/app/api/billing/subscriptions/route";
import { GET as providerReturn } from "@/app/api/billing/return/route";
import { billingIntentHref, billingIntentQuery, resolveBillingIntent, safeCheckout, type BillingIntent, type SubscriptionView } from "@/lib/billing/presentation";
import { sanitizeAuthCallback } from "@/lib/safe-callback";
import { rememberBillingIntent, rememberedBillingIntent } from "@/lib/billing/intent-cookie";
import { billingIntentForLegacyPlan } from "@/lib/marketing-plan";

const BASE = "http://localhost:3000";
const CHECKOUT = "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=pre-1";
/** Set-Cookie de /contratar: o plano lembrado é apagado (nome, valor vazio, Path=/ e Max-Age=0). */
const INTENT_COOKIE_CLEARED = "ef_billing_intent=; Path=/; Max-Age=0";
/** Guia de configuração com retorno ao painel: setupEntryHref("/dashboard?welcome=1"), escrito à mão. */
const SETUP_GUIDE = "/onboarding/configuracao?next=%2Fdashboard%3Fwelcome%3D1";
/** Mesmo parser que o Next usa em cookies(): recebe o cabeçalho Cookie que o navegador enviaria. */
const cookieStore = (header = "") => new RequestCookies(new Headers(header ? { cookie: header } : {}));

/** Tabela de referência: valores aprovados (centavos), digitados à mão. */
type Combo = { plan: BillingIntent["plan"]; cycle: BillingIntent["cycle"]; extra: number; cents: number; agendas: number; label: string; money: string; card: "Individual" | "Essencial" | "Equipe"; reason: string };
const COMBOS: Combo[] = [
  { plan: "INDIVIDUAL", cycle: "MONTHLY", extra: 0, cents: 3990, agendas: 1, label: "Individual · 1 agenda", money: "39,90", card: "Individual", reason: "Everflair Individual · 1 agenda — mensal" },
  { plan: "INDIVIDUAL", cycle: "ANNUAL", extra: 0, cents: 39900, agendas: 1, label: "Individual · 1 agenda", money: "399", card: "Individual", reason: "Everflair Individual · 1 agenda — anual" },
  { plan: "TEAM", cycle: "MONTHLY", extra: 0, cents: 7990, agendas: 3, label: "Essencial · 3 agendas", money: "79,90", card: "Essencial", reason: "Everflair Essencial · 3 agendas — mensal" },
  { plan: "TEAM", cycle: "ANNUAL", extra: 0, cents: 77900, agendas: 3, label: "Essencial · 3 agendas", money: "779", card: "Essencial", reason: "Everflair Essencial · 3 agendas — anual" },
  { plan: "TEAM_PLUS", cycle: "MONTHLY", extra: 0, cents: 9990, agendas: 5, label: "Equipe · 5 agendas", money: "99,90", card: "Equipe", reason: "Everflair Equipe · 5 agendas — mensal" },
  { plan: "TEAM_PLUS", cycle: "ANNUAL", extra: 0, cents: 95900, agendas: 5, label: "Equipe · 5 agendas", money: "959", card: "Equipe", reason: "Everflair Equipe · 5 agendas — anual" },
  { plan: "TEAM_MAX", cycle: "MONTHLY", extra: 0, cents: 14990, agendas: 10, label: "Equipe · 10 agendas", money: "149,90", card: "Equipe", reason: "Everflair Equipe · 10 agendas — mensal" },
  { plan: "TEAM_MAX", cycle: "ANNUAL", extra: 0, cents: 143900, agendas: 10, label: "Equipe · 10 agendas", money: "1.439", card: "Equipe", reason: "Everflair Equipe · 10 agendas — anual" },
  // 14990 + 1 x 2000 ; 143900 + 1 x 19200
  { plan: "TEAM_MAX", cycle: "MONTHLY", extra: 1, cents: 16990, agendas: 11, label: "Equipe · 11 agendas", money: "169,90", card: "Equipe", reason: "Everflair Equipe · 11 agendas — mensal" },
  { plan: "TEAM_MAX", cycle: "ANNUAL", extra: 1, cents: 163100, agendas: 11, label: "Equipe · 11 agendas", money: "1.631", card: "Equipe", reason: "Everflair Equipe · 11 agendas — anual" },
  // 14990 + 100 x 2000 ; 143900 + 100 x 19200
  { plan: "TEAM_MAX", cycle: "MONTHLY", extra: 100, cents: 214990, agendas: 110, label: "Equipe · 110 agendas", money: "2.149,90", card: "Equipe", reason: "Everflair Equipe · 110 agendas — mensal" },
  { plan: "TEAM_MAX", cycle: "ANNUAL", extra: 100, cents: 2063900, agendas: 110, label: "Equipe · 110 agendas", money: "20.639", card: "Equipe", reason: "Everflair Equipe · 110 agendas — anual" },
];
const name = (c: Combo) => `${c.plan}/${c.cycle}/+${c.extra}`;
const money = (value: string) => new RegExp(`R\\$\\s${value.replace(/\./g, "\\.")}(?![\\d,])`);
const queryOf = (c: Combo) => `billingPlan=${c.plan}&cycle=${c.cycle}&extraAgendas=${c.extra}`;

function stubBillingEnv(extra: Record<string, string> = {}) {
  for (const [k, v] of Object.entries({
    MERCADOPAGO_BILLING_ENABLED: "true", MERCADOPAGO_MODE: "test", MERCADOPAGO_COLLECTOR_ID: "123", MERCADOPAGO_ACCESS_TOKEN: "test-token",
    MERCADOPAGO_WEBHOOK_SECRET: "test-secret", APP_ENV: "test", VERCEL_ENV: "development", NEXTAUTH_URL: BASE,
    MERCADOPAGO_PLAN_CHANGES_ENABLED: "false", MERCADOPAGO_CHECKOUT_PAUSED: "false", MERCADOPAGO_PLAN_CHANGES_PAUSED: "false", ...extra,
  })) vi.stubEnv(k, v);
}

type FakeSub = Record<string, unknown> & { id: string };
/** Banco em memória com só o que contract()/ensureCreated() e a página /assinatura usam. */
function fakeDb(opts: { active?: Record<string, unknown> | null; memberships?: number } = {}) {
  const subs = new Map<string, FakeSub>();
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => [{ locked: 1 }]),
    membership: { findFirst: vi.fn(async () => ({ role: "OWNER" })), count: vi.fn(async () => opts.memberships ?? 1) },
    salon: { findUniqueOrThrow: vi.fn(async () => ({ name: "Espaço Teste", timezone: "America/Sao_Paulo", plan: "FREE", accessStatus: "APPROVED" })) },
    professional: { count: vi.fn(async () => 0) },
    userInvite: { count: vi.fn(async () => 0) },
    user: { findUniqueOrThrow: vi.fn(async () => ({ email: "owner@example.test" })) },
    billingEvent: { upsert: vi.fn(async () => ({})) },
    billingQueue: { upsert: vi.fn(async () => ({})) },
    billingPlanChange: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    billingSubscription: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; salonId_requestKey?: { requestKey: string } } }) =>
        where.id ? subs.get(where.id) ?? null : [...subs.values()].find(s => s.requestKey === where.salonId_requestKey?.requestKey) ?? null),
      findFirst: vi.fn(async () => opts.active ?? null),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => { const s = subs.get(where.id); if (!s) throw new Error("NOT_FOUND"); return s; }),
      // contract() sempre envia o id gerado (randomUUID) nos dados do create.
      create: vi.fn(async ({ data }: { data: FakeSub }) => {
        const s: FakeSub = { providerId: null, providerStatus: "pending", providerUpdatedAt: null, checkoutUrl: null, cancelRequestedAt: null, cancelledAt: null, creationStartedAt: null,
          paidThrough: null, delinquentSince: null, nextPaymentAt: null, reviewRequired: false, current: true, ...data };
        subs.set(s.id, s); return s;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { const s = { ...subs.get(where.id)!, ...data }; subs.set(where.id, s); return s; }),
    },
  };
  h.withTenant.mockImplementation(async (_ctx: unknown, fn: (t: typeof tx) => unknown) => fn(tx));
  h.withSalon.mockImplementation(async (_id: unknown, fn: (t: typeof tx) => unknown) => fn(tx));
  h.withUser.mockImplementation(async (_id: unknown, fn: (t: typeof tx) => unknown) => fn(tx));
  return { tx, subs };
}

/** Mercado Pago simulado: devolve a pré-aprovação com os mesmos termos recebidos. */
function fakeMercadoPago(initPoint = CHECKOUT) {
  h.mpRequest.mockImplementation(async (path: string, method?: string, body?: Record<string, unknown>) => {
    if (path === "/preapproval" && method === "POST") {
      return { id: "pre-1", collector_id: 123, external_reference: body!.external_reference, status: "pending", init_point: initPoint,
        last_modified: "2026-10-03T12:00:00.000-03:00", auto_recurring: body!.auto_recurring };
    }
    throw new Error(`unexpected MP call ${method ?? "GET"} ${path}`);
  });
}
const preapprovalCalls = () => h.mpRequest.mock.calls.filter(c => c[0] === "/preapproval" && c[1] === "POST");

function postSubscription(body: unknown, key = crypto.randomUUID(), origin = BASE) {
  return createSubscription(new Request(`${BASE}/api/billing/subscriptions?salonId=salon-a`, {
    method: "POST", headers: { "content-type": "application/json", origin, "idempotency-key": key }, body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}
async function contratarLocation(query: string) {
  const response = await contratar(new Request(`${BASE}/contratar${query ? `?${query}` : ""}`));
  expect(response.status).toBe(307);
  return new URL(response.headers.get("location")!);
}
const paramsOf = (url: URL) => Object.fromEntries(url.searchParams);
const reply = (subscription: SubscriptionView | null) => new Response(JSON.stringify({ subscription }));

function selectOnLanding(c: Combo) {
  fireEvent.click(screen.getByLabelText(c.cycle === "ANNUAL" ? /Anual/ : "Mensal"));
  if (c.card === "Equipe") {
    fireEvent.click(screen.getByLabelText(c.plan === "TEAM_MAX" ? "10 agendas" : "5 agendas"));
    if (c.plan === "TEAM_MAX") fireEvent.change(screen.getByLabelText("Agendas adicionais às 10 incluídas"), { target: { value: String(c.extra) } });
  }
}
function completeSignup() {
  for (const [label, value] of [["Nome do estabelecimento", "Espaço de teste"], ["Seu nome", "Pessoa Teste"], ["Email", "teste@example.com"], ["Senha", "senha-de-teste"], ["Confirmar senha", "senha-de-teste"]]) {
    fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
  }
  fireEvent.submit(screen.getByRole("button", { name: "Criar meu espaço" }).closest("form")!);
}

beforeEach(() => {
  vi.clearAllMocks();
  stubBillingEnv();
  h.session.mockResolvedValue(null);
  h.requireRole.mockResolvedValue({ userId: "owner", salonId: "salon-a", role: "OWNER" });
  h.signup.mockResolvedValue({ ok: true, slug: "teste" });
  h.signIn.mockResolvedValue({ ok: true });
  h.isPlatformAdmin.mockResolvedValue(false);
  h.cookies.mockImplementation(async () => cookieStore());
});
afterEach(() => {
  cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); try { sessionStorage.clear(); } catch { /* jsdom */ }
  document.cookie = "ef_billing_intent=; Path=/; Max-Age=0";
});

describe("1. Landing -> /contratar -> /signup -> /assinatura -> POST -> Mercado Pago (todas as combinações)", () => {
  for (const c of COMBOS) {
    it(`${name(c)} chega ao Mercado Pago com ${c.cents} centavos sem alteração`, async () => {
      const { subs } = fakeDb();
      fakeMercadoPago();

      // Hop 1: landing (cobrança habilitada) monta o link de /contratar com o plano escolhido.
      const landing = render(<MarketingPlans billingAvailable segment="barbearia" />);
      selectOnLanding(c);
      const article = screen.getByRole("article", { name: `Plano ${c.card}` });
      expect(within(article).getByText(money(c.money))).toBeVisible();
      const href = within(article).getByRole("link", { name: `Escolher ${c.card}` }).getAttribute("href")!;
      expect(href).toBe(`/contratar?${queryOf(c)}&segment=barbearia`);
      landing.unmount();

      // Hop 2: /contratar sem sessão -> /signup preservando plano, ciclo, adicionais e segmento.
      const toSignup = await contratarLocation(href.slice("/contratar?".length));
      expect(toSignup.pathname).toBe("/signup");
      expect(paramsOf(toSignup)).toEqual({ billingPlan: c.plan, cycle: c.cycle, extraAgendas: String(c.extra), segment: "barbearia" });

      // Hop 3: /signup mostra o mesmo valor e, depois do cadastro, empurra para /assinatura com a mesma intenção.
      const signupIntent = resolveBillingIntent(paramsOf(toSignup));
      expect(signupIntent).toEqual({ plan: c.plan, cycle: c.cycle, extraAgendas: c.extra });
      const signupView = render(<SignupForm billingIntent={signupIntent} billingAvailable />);
      const aside = screen.getByRole("complementary", { name: "Seu plano de interesse" });
      expect(aside).toHaveTextContent(c.label);
      expect(within(aside).getByText(money(c.money))).toBeVisible();
      expect(aside).toHaveTextContent(c.cycle === "ANNUAL" ? "a cada 12 meses" : "por mês");
      // "Já tenho conta": o callbackUrl sobrevive à sanitização do login.
      const login = new URL(within(aside).getByRole("link", { name: "Já tenho conta · entrar" }).getAttribute("href")!, BASE);
      expect(sanitizeAuthCallback(login.searchParams.get("callbackUrl"))).toBe(`/contratar?${queryOf(c)}`);
      completeSignup();
      await waitFor(() => expect(h.push).toHaveBeenCalled());
      const assinaturaHref = h.push.mock.calls[0][0] as string;
      expect(assinaturaHref).toBe(`/assinatura?${queryOf(c)}`);
      signupView.unmount();

      // Hop 4: /assinatura resolve a intenção e o portal mostra o plano escolhido já marcado.
      h.session.mockResolvedValue({ user: { id: "owner" } });
      const assinaturaUrl = new URL(assinaturaHref, BASE);
      const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "POST" && url.startsWith("/api/billing/subscriptions")) {
          const headers = new Headers(init.headers); headers.set("origin", BASE);
          return createSubscription(new Request(`${BASE}${url}`, { method: "POST", headers, body: init.body }));
        }
        if (init?.method === "POST") throw new Error(`unexpected POST ${url}`);
        return reply(null);
      });
      vi.stubGlobal("fetch", fetcher);
      render(await SubscriptionPage({ searchParams: Promise.resolve(paramsOf(assinaturaUrl)) }));
      const notice = await screen.findByText(`Você escolheu ${c.label} · ${c.cycle === "ANNUAL" ? "anual" : "mensal"}`);
      const noticeBox = notice.closest("div")!.parentElement!.parentElement!;
      expect(noticeBox.textContent).toMatch(money(c.money));
      expect(screen.getByLabelText(c.cycle === "ANNUAL" ? /^Anual/ : "Mensal")).toBeChecked();
      if (c.card === "Equipe") expect(screen.getByLabelText(c.plan === "TEAM_MAX" ? "10 agendas" : "5 agendas")).toBeChecked();
      if (c.plan === "TEAM_MAX") expect(screen.getByLabelText("Agendas adicionais às 10 incluídas")).toHaveValue(c.extra);

      // Hop 5: confirmação mostra o valor e o POST leva exatamente {plan, cycle, extraAgendas}.
      fireEvent.click(screen.getByRole("button", { name: "Continuar com este plano" }));
      const dialog = screen.getByRole("dialog", { name: "Confirmar contratação" });
      expect(dialog).toHaveTextContent(c.label);
      expect(dialog.textContent).toMatch(money(c.money));
      fireEvent.click(within(dialog).getByRole("button", { name: /Ir para pagamento/ }));
      await waitFor(() => expect(h.goToCheckout).toHaveBeenCalledWith(CHECKOUT));
      const post = fetcher.mock.calls.find(call => call[1]?.method === "POST")!;
      expect(JSON.parse(String(post[1]!.body))).toEqual({ plan: c.plan, cycle: c.cycle, extraAgendas: c.extra });

      // Hop 6: contrato persistido e pré-aprovação enviada ao Mercado Pago com o mesmo valor.
      const [stored] = [...subs.values()];
      expect(stored).toMatchObject({ planCode: c.plan, cycle: c.cycle, amountCents: c.cents, agendaLimit: c.agendas, intervalMonths: c.cycle === "ANNUAL" ? 12 : 1, catalogVersion: "2026-10-02", currency: "BRL", reviewRequired: false, checkoutUrl: CHECKOUT });
      expect(preapprovalCalls()).toHaveLength(1);
      const payload = preapprovalCalls()[0][2] as { reason: string; back_url: string; auto_recurring: Record<string, unknown> };
      expect(payload.auto_recurring).toEqual({ frequency: c.cycle === "ANNUAL" ? 12 : 1, frequency_type: "months", transaction_amount: c.cents / 100, currency_id: "BRL" });
      expect(Math.round((payload.auto_recurring.transaction_amount as number) * 100)).toBe(c.cents);
      expect(payload.reason).toBe(c.reason);
      expect(payload.back_url).toBe(`${BASE}/api/billing/return`);
    }, 30_000);
  }
});

describe("2. /contratar por situação de sessão", () => {
  const intent = "billingPlan=TEAM_MAX&cycle=ANNUAL&extraAgendas=1";
  it("cobrança desligada -> volta para /#planos, nunca para checkout", async () => {
    vi.stubEnv("MERCADOPAGO_BILLING_ENABLED", "false");
    const to = await contratarLocation(intent);
    expect(`${to.pathname}${to.hash}`).toBe("/#planos");
    expect(h.session).not.toHaveBeenCalled();
  });
  it("sem sessão -> /signup com a intenção; segmento só se for válido", async () => {
    expect(paramsOf(await contratarLocation(`${intent}&segment=bem-estar`))).toEqual({ billingPlan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: "1", segment: "bem-estar" });
    for (const bad of ["EVIL", "a%2Fb", "x".repeat(41), "javascript:alert(1)"]) expect(paramsOf(await contratarLocation(`${intent}&segment=${bad}`)).segment).toBeUndefined();
  });
  it("com sessão e sem estabelecimento -> /onboarding/create-salon com a intenção", async () => {
    h.session.mockResolvedValue({ user: { id: "u1" } }); fakeDb({ memberships: 0 });
    const to = await contratarLocation(intent);
    expect(to.pathname).toBe("/onboarding/create-salon");
    expect(paramsOf(to)).toEqual({ billingPlan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: "1" });
  });
  it("com sessão e estabelecimento -> /assinatura com a intenção", async () => {
    h.session.mockResolvedValue({ user: { id: "u1" } }); fakeDb({ memberships: 1 });
    const to = await contratarLocation(intent);
    expect(to.pathname).toBe("/assinatura");
    expect(paramsOf(to)).toEqual({ billingPlan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: "1" });
  });
  it("create-salon: com intenção -> /assinatura?…; sem cobrança -> /dashboard; já com estabelecimento redireciona", async () => {
    h.session.mockResolvedValue({ user: { id: "u1" } });
    fakeDb({ memberships: 0 });
    render(await CreateSalonPage({ searchParams: Promise.resolve({ billingPlan: "TEAM", cycle: "ANNUAL", extraAgendas: "0" }) }));
    expect(screen.getByTestId("create-salon-next")).toHaveAttribute("href", "/assinatura?billingPlan=TEAM&cycle=ANNUAL&extraAgendas=0");
    cleanup();
    render(await CreateSalonPage({ searchParams: Promise.resolve({ billingPlan: "INDIVIDUAL", extraAgendas: "5" }) }));
    expect(screen.getByTestId("create-salon-next")).toHaveAttribute("href", "/dashboard");
    cleanup();
    fakeDb({ memberships: 1 });
    await expect(CreateSalonPage({ searchParams: Promise.resolve({ billingPlan: "TEAM_PLUS", cycle: "MONTHLY", extraAgendas: "0" }) })).rejects.toMatchObject({ url: "/assinatura?billingPlan=TEAM_PLUS&cycle=MONTHLY&extraAgendas=0" });
    vi.stubEnv("MERCADOPAGO_BILLING_ENABLED", "false");
    await expect(CreateSalonPage({ searchParams: Promise.resolve({ billingPlan: "TEAM_PLUS", cycle: "MONTHLY", extraAgendas: "0" }) })).rejects.toMatchObject({ url: "/dashboard" });
  });
  it("create-salon sem sessão: com intenção -> /login com callback para /contratar com a mesma escolha; sem intenção, adulterada ou sem cobrança -> /login", async () => {
    h.session.mockResolvedValue(null);
    const signal = await CreateSalonPage({ searchParams: Promise.resolve({ billingPlan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: "3" }) }).then(() => null, (e: unknown) => e);
    expect(signal).toMatchObject({ url: "/login?callbackUrl=%2Fcontratar%3FbillingPlan%3DTEAM_MAX%26cycle%3DANNUAL%26extraAgendas%3D3" });
    // O login aceita esse destino sem alterar a escolha.
    const callback = new URL((signal as { url: string }).url, BASE).searchParams.get("callbackUrl");
    expect(sanitizeAuthCallback(callback)).toBe("/contratar?billingPlan=TEAM_MAX&cycle=ANNUAL&extraAgendas=3");
    await expect(CreateSalonPage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ url: "/login" });
    await expect(CreateSalonPage({ searchParams: Promise.resolve({ billingPlan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: "5" }) })).rejects.toMatchObject({ url: "/login" });
    vi.stubEnv("MERCADOPAGO_BILLING_ENABLED", "false");
    await expect(CreateSalonPage({ searchParams: Promise.resolve({ billingPlan: "TEAM", cycle: "MONTHLY", extraAgendas: "0" }) })).rejects.toMatchObject({ url: "/login" });
    // O próprio onboarding também passou a ser um callback de login aceito, com a intenção na URL.
    expect(sanitizeAuthCallback("/onboarding/create-salon?billingPlan=TEAM&cycle=MONTHLY&extraAgendas=0")).toBe("/onboarding/create-salon?billingPlan=TEAM&cycle=MONTHLY&extraAgendas=0");
  });
});

describe("3. Adulteração da URL nunca produz preço errado", () => {
  const tampered: [string, string][] = [
    ["INDIVIDUAL com adicionais", "billingPlan=INDIVIDUAL&cycle=MONTHLY&extraAgendas=5"],
    ["TEAM com adicionais", "billingPlan=TEAM&cycle=MONTHLY&extraAgendas=1"],
    ["TEAM_PLUS com adicionais", "billingPlan=TEAM_PLUS&cycle=ANNUAL&extraAgendas=2"],
    ["ciclo semanal", "billingPlan=TEAM_MAX&cycle=WEEKLY&extraAgendas=0"],
    ["ciclo minúsculo", "billingPlan=TEAM_MAX&cycle=monthly&extraAgendas=0"],
    ["101 adicionais", "billingPlan=TEAM_MAX&cycle=MONTHLY&extraAgendas=101"],
    ["adicional negativo", "billingPlan=TEAM_MAX&cycle=MONTHLY&extraAgendas=-1"],
    ["adicional fracionado", "billingPlan=TEAM_MAX&cycle=MONTHLY&extraAgendas=1.5"],
    ["adicional texto", "billingPlan=TEAM_MAX&cycle=MONTHLY&extraAgendas=abc"],
    ["plano inexistente", "billingPlan=FREE&cycle=MONTHLY&extraAgendas=0"],
    ["plano PRO legado", "billingPlan=PRO"],
    ["sem plano", "cycle=ANNUAL&extraAgendas=3"],
    ["sem parâmetros", ""],
  ];
  for (const [label, query] of tampered) {
    it(`${label}: /contratar descarta a intenção (sem sessão e com estabelecimento)`, async () => {
      const anon = await contratarLocation(query);
      expect(anon.pathname).toBe("/signup"); expect(anon.search).toBe("");
      h.session.mockResolvedValue({ user: { id: "u1" } }); fakeDb({ memberships: 1 });
      const logged = await contratarLocation(query);
      expect(logged.pathname).toBe("/assinatura"); expect(logged.search).toBe("");
      expect(resolveBillingIntent(Object.fromEntries(new URLSearchParams(query)))).toBeUndefined();
    });
  }
  it("parâmetros ausentes usam padrões determinísticos (mensal, 0 adicionais) e o valor é exibido antes do pagamento", async () => {
    expect(resolveBillingIntent({ billingPlan: "INDIVIDUAL" })).toEqual({ plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0 });
    expect(paramsOf(await contratarLocation("billingPlan=TEAM_MAX"))).toEqual({ billingPlan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: "0" });
  });
  it("formatos numéricos estranhos são canonizados antes de seguir (nunca chegam crus ao checkout)", async () => {
    // Number() aceita "", " 2 ", "0x2", "2e0", "+2": todos viram inteiros válidos e a URL seguinte é canônica.
    expect(resolveBillingIntent({ billingPlan: "TEAM_MAX", extraAgendas: "0x2" })).toEqual({ plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 2 });
    expect(resolveBillingIntent({ billingPlan: "TEAM_MAX", extraAgendas: "" })).toEqual({ plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 0 });
    expect(paramsOf(await contratarLocation("billingPlan=TEAM_MAX&extraAgendas=%202%20"))).toEqual({ billingPlan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: "2" });
    // Next entrega chaves repetidas como array na página: a intenção é descartada.
    expect(resolveBillingIntent({ billingPlan: ["TEAM_MAX", "INDIVIDUAL"], cycle: "MONTHLY" })).toBeUndefined();
    expect(resolveBillingIntent({ billingPlan: "TEAM_MAX", extraAgendas: ["1", "2"] })).toBeUndefined();
  });
  it("round-trip de todos os combos válidos: href -> parse -> href é idempotente", () => {
    for (const c of COMBOS) {
      const intent = { plan: c.plan, cycle: c.cycle, extraAgendas: c.extra };
      const parsed = resolveBillingIntent(Object.fromEntries(new URLSearchParams(billingIntentQuery(intent))));
      expect(parsed).toEqual(intent);
      expect(billingIntentHref(parsed!, "/assinatura")).toBe(`/assinatura?${queryOf(c)}`);
    }
  });
  it("a página /assinatura com intenção adulterada não pré-seleciona nem oferece 'Continuar com este plano'", async () => {
    fakeDb(); vi.stubGlobal("fetch", vi.fn(async () => reply(null)));
    render(await SubscriptionPage({ searchParams: Promise.resolve({ billingPlan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: "5" }) }));
    expect(await screen.findByRole("heading", { name: "Escolha seu plano" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Continuar com este plano" })).toBeNull();
  });
});

describe("4. POST /api/billing/subscriptions: o servidor recalcula e rejeita corpo adulterado", () => {
  const rejected: [string, unknown][] = [
    ["amountCents enviado pelo cliente", { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 0, amountCents: 1 }],
    ["agendaLimit enviado pelo cliente", { plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0, agendaLimit: 50 }],
    ["catalogVersion antigo", { plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0, catalogVersion: "2026-09-13" }],
    ["INDIVIDUAL com adicionais", { plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 5 }],
    ["TEAM_PLUS com adicionais", { plan: "TEAM_PLUS", cycle: "ANNUAL", extraAgendas: 1 }],
    ["ciclo WEEKLY", { plan: "TEAM", cycle: "WEEKLY", extraAgendas: 0 }],
    ["101 adicionais", { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 101 }],
    ["-1 adicional", { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: -1 }],
    ["1.5 adicional", { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 1.5 }],
    ["adicional como texto", { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: "1" }],
    ["plano ausente", { cycle: "MONTHLY", extraAgendas: 0 }],
    ["ciclo ausente", { plan: "TEAM", extraAgendas: 0 }],
    ["array", [{ plan: "TEAM", cycle: "MONTHLY" }]],
  ];
  for (const [label, body] of rejected) {
    it(`${label} -> 400 INVALID_REQUEST, sem contrato nem chamada ao Mercado Pago`, async () => {
      h.session.mockResolvedValue({ user: { id: "owner" } });
      const { tx } = fakeDb(); fakeMercadoPago();
      const response = await postSubscription(body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "INVALID_REQUEST" });
      expect(tx.billingSubscription.create).not.toHaveBeenCalled();
      expect(h.mpRequest).not.toHaveBeenCalled();
    });
  }
  it("JSON inválido, origem estrangeira, sem chave de idempotência e sem sessão são bloqueados antes de cobrar", async () => {
    const { tx } = fakeDb(); fakeMercadoPago();
    h.session.mockResolvedValue({ user: { id: "owner" } });
    expect((await postSubscription("{")).status).toBe(400);
    const foreign = await postSubscription({ plan: "TEAM", cycle: "MONTHLY", extraAgendas: 0 }, crypto.randomUUID(), "https://evil.test");
    expect(foreign.status).toBe(403); expect(await foreign.json()).toEqual({ error: "INVALID_ORIGIN" });
    const noKey = await createSubscription(new Request(`${BASE}/api/billing/subscriptions?salonId=salon-a`, { method: "POST", headers: { origin: BASE }, body: "{}" }));
    expect(noKey.status).toBe(400);
    h.session.mockResolvedValue(null);
    expect((await postSubscription({ plan: "TEAM", cycle: "MONTHLY", extraAgendas: 0 })).status).toBe(401);
    expect(tx.billingSubscription.create).not.toHaveBeenCalled();
    expect(h.mpRequest).not.toHaveBeenCalled();
  });
  it("extraAgendas omitido vale 0 (padrão do contrato) e cobra o preço base", async () => {
    h.session.mockResolvedValue({ user: { id: "owner" } });
    const { subs } = fakeDb(); fakeMercadoPago();
    const response = await postSubscription({ plan: "TEAM_MAX", cycle: "MONTHLY" });
    expect(response.status).toBe(202);
    expect([...subs.values()][0]).toMatchObject({ amountCents: 14990, agendaLimit: 10 });
    expect((preapprovalCalls()[0][2] as { auto_recurring: { transaction_amount: number } }).auto_recurring.transaction_amount).toBe(149.9);
  });
  it("assinatura ATIVA existente -> 409 SUBSCRIPTION_EXISTS: nunca cria uma segunda assinatura", async () => {
    h.session.mockResolvedValue({ user: { id: "owner" } });
    const { tx } = fakeDb({ active: { id: "old", salonId: "salon-a", current: true, cancelledAt: null, paidThrough: new Date("2099-01-01T00:00:00Z") } }); fakeMercadoPago();
    const response = await postSubscription({ plan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: 3 });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "SUBSCRIPTION_EXISTS" });
    expect(tx.billingSubscription.create).not.toHaveBeenCalled();
    expect(h.mpRequest).not.toHaveBeenCalled();
  });
  it("assinatura cancelada mas ainda dentro do período pago também bloqueia nova contratação", async () => {
    h.session.mockResolvedValue({ user: { id: "owner" } });
    const { tx } = fakeDb({ active: { id: "old", salonId: "salon-a", current: true, cancelledAt: new Date("2026-09-01T00:00:00Z"), paidThrough: new Date("2099-01-01T00:00:00Z") } }); fakeMercadoPago();
    expect((await postSubscription({ plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0 })).status).toBe(409);
    expect(tx.billingSubscription.create).not.toHaveBeenCalled();
  });
  it("clique repetido com a mesma chave não gera segundo contrato nem segunda pré-aprovação; chave reutilizada com outro plano é recusada", async () => {
    h.session.mockResolvedValue({ user: { id: "owner" } });
    const { tx } = fakeDb(); fakeMercadoPago();
    const key = crypto.randomUUID();
    const first = await postSubscription({ plan: "INDIVIDUAL", cycle: "ANNUAL", extraAgendas: 0 }, key);
    const second = await postSubscription({ plan: "INDIVIDUAL", cycle: "ANNUAL", extraAgendas: 0 }, key);
    expect(first.status).toBe(202); expect(second.status).toBe(202);
    expect((await first.json()).id).toBe((await second.json()).id);
    expect(tx.billingSubscription.create).toHaveBeenCalledTimes(1);
    expect(preapprovalCalls()).toHaveLength(1);
    const swapped = await postSubscription({ plan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: 100 }, key);
    expect(swapped.status).toBe(409); expect(await swapped.json()).toEqual({ error: "IDEMPOTENCY_MISMATCH" });
    expect(preapprovalCalls()).toHaveLength(1);
  });
  it("init_point fora de https://www.mercadopago.com.br nunca vira link de checkout", async () => {
    h.session.mockResolvedValue({ user: { id: "owner" } });
    const { subs } = fakeDb(); fakeMercadoPago("https://www.mercadopago.com.br.evil.test/checkout");
    const response = await postSubscription({ plan: "TEAM", cycle: "MONTHLY", extraAgendas: 0 });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "INVALID_CHECKOUT" });
    expect([...subs.values()][0].checkoutUrl).toBeNull();
  });
  it("safeCheckout aceita apenas o checkout do Mercado Pago e as páginas hospedadas da Stripe, em https", () => {
    for (const bad of [null, "", "javascript:alert(1)", "http://www.mercadopago.com.br/x", "https://mercadopago.com.br/x", "https://www.mercadopago.com.br.evil.test/x",
      "https://user:pw@www.mercadopago.com.br/x", "https://www.mercadopago.com.br:8443/x", "https://www.mercadopago.com.ar/x", "/assinatura",
      "http://checkout.stripe.com/c/pay/cs_test_1", "https://checkout.stripe.com.evil.test/c/pay/cs_test_1", "https://stripe.com/x", "https://dashboard.stripe.com/x",
      "https://evil.checkout.stripe.com/x", "https://user@billing.stripe.com/p/session/x", "https://checkout.stripe.com:8443/x"]) expect(safeCheckout(bad)).toBeNull();
    expect(safeCheckout(CHECKOUT)).toBe(CHECKOUT);
    for (const good of ["https://checkout.stripe.com/c/pay/cs_test_a1B2c3", "https://billing.stripe.com/p/session/test_YWNjdF8x"]) expect(safeCheckout(good)).toBe(good);
  });
  it("o portal não navega para checkoutUrl inseguro devolvido pela API", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST"
      ? new Response(JSON.stringify({ id: "s", checkoutUrl: "http://www.mercadopago.com.br/x", state: "UNPAID", providerStatus: "pending" }), { status: 202 }) : reply(null)));
    render(<SubscriptionPortal salonId="salon-a" email="o@example.test" timezone="America/Sao_Paulo" initial={{ plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0 }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Continuar com este plano" }));
    fireEvent.click(screen.getByRole("button", { name: /Ir para pagamento/ }));
    expect(await screen.findByText("Sua solicitação foi recebida. Estamos preparando o pagamento.")).toBeVisible();
    expect(h.goToCheckout).not.toHaveBeenCalled();
  });
  it("com a Stripe disponível, o dono escolhe o meio de pagamento e o pedido leva o gateway escolhido", async () => {
    const posts: Array<{ body: unknown; key: string | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return reply(null);
      posts.push({ body: JSON.parse(String(init.body)), key: new Headers(init.headers).get("Idempotency-Key") });
      return new Response(JSON.stringify({ id: "s", checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_a1", state: "UNPAID", providerStatus: "pending" }), { status: 202 });
    }));
    render(<SubscriptionPortal salonId="salon-a" email="o@example.test" timezone="America/Sao_Paulo" initial={{ plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0 }} stripeAvailable />);
    fireEvent.click(await screen.findByRole("button", { name: "Continuar com este plano" }));
    expect(screen.getByText(/Cartão de crédito pela Stripe/)).toBeVisible();
    expect(screen.getByRole("button", { name: /Pagar pelo Mercado Pago/ })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Ir para pagamento/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Pagar com cartão/ }));
    await waitFor(() => expect(h.goToCheckout).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test_a1"));
    expect(posts).toEqual([{ body: { plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0, provider: "stripe" }, key: expect.stringMatching(/^[a-f0-9-]{36}$/) }]);
  });
  it("com o checkout do Mercado Pago pausado, só o cartão pela Stripe é oferecido", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(null)));
    render(<SubscriptionPortal salonId="salon-a" email="o@example.test" timezone="America/Sao_Paulo" initial={{ plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0 }} stripeAvailable mercadoPagoPaused />);
    fireEvent.click(await screen.findByRole("button", { name: "Continuar com este plano" }));
    expect(screen.getByRole("button", { name: /Pagar com cartão/ })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Pagar pelo Mercado Pago/ })).toBeNull();
  });
});

describe("5. Quem já tem assinatura ativa vai para o fluxo de troca", () => {
  const active: SubscriptionView = { id: "sub-1", plan: "INDIVIDUAL", cycle: "MONTHLY", amountCents: 3990, agendaLimit: 1, state: "ACTIVE", paidThrough: "2099-10-13T12:00:00Z",
    nextPaymentAt: "2099-10-13T12:00:00Z", cancelRequestedAt: null, cancelledAt: null, reviewRequired: false, checkoutUrl: null, providerStatus: "authorized", lastSyncedAt: null,
    changesAvailable: true, changePending: false, change: null, charges: [] };
  it("/contratar -> /assinatura?…; o portal usa POST /api/billing/changes (cotação), nunca /api/billing/subscriptions", async () => {
    h.session.mockResolvedValue({ user: { id: "u1" } }); fakeDb({ memberships: 1 });
    const to = await contratarLocation("billingPlan=TEAM_PLUS&cycle=MONTHLY&extraAgendas=0");
    expect(to.pathname).toBe("/assinatura");
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => init?.method === "POST"
      ? new Response(JSON.stringify({ error: "PLAN_CHANGES_DISABLED" }), { status: 409 }) : reply(active));
    vi.stubGlobal("fetch", fetcher);
    render(await SubscriptionPage({ searchParams: Promise.resolve(paramsOf(to)) }));
    expect(await screen.findByRole("heading", { name: "Mudar de plano" })).toBeVisible();
    // A intenção da landing não vira "Continuar com este plano" nem nova assinatura.
    expect(screen.queryByRole("button", { name: "Continuar com este plano" })).toBeNull();
    expect(screen.getByRole("button", { name: "Plano atual" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Fazer upgrade: Equipe · 5 agendas" }));
    await waitFor(() => expect(fetcher.mock.calls.some(c => c[1]?.method === "POST")).toBe(true));
    const posts = fetcher.mock.calls.filter(c => c[1]?.method === "POST");
    expect(posts.every(c => String(c[0]).startsWith("/api/billing/changes"))).toBe(true);
    expect(JSON.parse(String(posts[0][1]!.body))).toMatchObject({ action: "quote", selection: { plan: "TEAM_PLUS", cycle: "MONTHLY", extraAgendas: 0 } });
  });
  it("comportamento atual: no modo troca, o plano escolhido na landing não é pré-selecionado; a troca parte do plano em uso", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(active)));
    render(<SubscriptionPortal salonId="salon-a" email="o@example.test" timezone="America/Sao_Paulo" initial={{ plan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: 4 }} />);
    expect(await screen.findByRole("heading", { name: "Mudar de plano" })).toBeVisible();
    // Ciclo e capacidade seguem o plano atual (mensal, 5 agendas), não a escolha anual de 10+4.
    expect(screen.getByLabelText("Mensal")).toBeChecked();
    expect(screen.getByLabelText("5 agendas")).toBeChecked();
  });
});

describe("6. Retorno do Mercado Pago", () => {
  for (const query of ["status=approved&collection_status=approved&preapproval_id=pre-1", "status=pending&collection_status=in_process", "status=rejected&collection_status=rejected", "status=whatever&salonId=other", ""]) {
    it(`/api/billing/return?${query || "(vazio)"} -> /assinatura?retorno=mercadopago, descartando a alegação do provedor`, async () => {
      const response = await providerReturn(new Request(`${BASE}/api/billing/return${query ? `?${query}` : ""}`));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(`${BASE}/assinatura?retorno=mercadopago`);
    });
  }
  it("sessão expirada: o callback do login preserva o retorno", () => {
    expect(sanitizeAuthCallback("/assinatura?retorno=mercadopago")).toBe("/assinatura?retorno=mercadopago");
  });
  it("ao voltar: pede sincronização ao servidor e mostra 'Pagamento em confirmação' enquanto não pago (mesma mensagem para aprovado, pendente ou recusado)", async () => {
    fakeDb();
    const unpaid: SubscriptionView = { id: "sub-1", plan: "INDIVIDUAL", cycle: "MONTHLY", amountCents: 3990, agendaLimit: 1, state: "UNPAID", paidThrough: null, nextPaymentAt: null,
      cancelRequestedAt: null, cancelledAt: null, reviewRequired: false, checkoutUrl: CHECKOUT, providerStatus: "pending", lastSyncedAt: null, charges: [] };
    const fetcher = vi.fn(async (url: string) => url.startsWith("/api/billing/sync") ? new Response(JSON.stringify({ queued: true }), { status: 202 }) : reply(unpaid));
    vi.stubGlobal("fetch", fetcher);
    render(await SubscriptionPage({ searchParams: Promise.resolve({ retorno: "mercadopago" }) }));
    expect(await screen.findByText("Pagamento em confirmação")).toBeVisible();
    expect(screen.getByText(/Recebemos seu retorno do Mercado Pago\./)).toBeVisible();
    // Pagamento recusado: o texto indica o mesmo botão para tentar de novo (o contrato está no preço atual).
    expect(screen.getByText(/Recebemos seu retorno do Mercado Pago\. Se o pagamento foi recusado, use o botão abaixo para tentar novamente\./)).toBeVisible();
    expect(screen.getByRole("link", { name: /Continuar pagamento no Mercado Pago/ })).toHaveAttribute("href", CHECKOUT);
    expect(screen.getByText(/Individual · 1 agenda/, { selector: "h2" })).toBeVisible();
    expect(screen.getByText(/R\$\s39,90\/mês/)).toBeVisible();
    await waitFor(() => expect(fetcher.mock.calls.some(c => String(c[0]).startsWith("/api/billing/sync"))).toBe(true));
    expect(screen.queryByText("Ativo")).toBeNull();
  });
});

describe("7. Cobrança desligada ou pausada", () => {
  const PAUSED_NOTE = "Novas contratações estão temporariamente pausadas. Seu histórico e cancelamento continuam disponíveis.";
  const CHANGES_PAUSED_NOTE = "As trocas de plano estão temporariamente pausadas. Seu plano atual, o histórico e o cancelamento continuam disponíveis.";
  const activeIndividual: SubscriptionView = { id: "sub-1", plan: "INDIVIDUAL", cycle: "MONTHLY", amountCents: 3990, agendaLimit: 1, state: "ACTIVE", paidThrough: "2099-10-13T12:00:00Z",
    nextPaymentAt: "2099-10-13T12:00:00Z", cancelRequestedAt: null, cancelledAt: null, reviewRequired: false, checkoutUrl: null, providerStatus: "authorized", lastSyncedAt: null,
    changesAvailable: true, changePending: false, change: null, charges: [] };

  it("desligada: landing leva a /signup sem cobrança; /signup avisa e o cadastro segue para o guia de configuração; /assinatura mostra indisponível", async () => {
    vi.stubEnv("MERCADOPAGO_BILLING_ENABLED", "false");
    render(<LandingPage />);
    expect(screen.getByRole("link", { name: "Escolher Individual" })).toHaveAttribute("href", "/signup?billingPlan=INDIVIDUAL&cycle=MONTHLY&extraAgendas=0&segment=barbearia");
    expect(screen.getByText(/Nenhuma cobrança é feita ao escolher um plano/)).toBeVisible();
    cleanup();
    render(await SignupPage({ searchParams: Promise.resolve({ billingPlan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: "0" }) }));
    expect(screen.getByText(/A contratação online está em preparação/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Já tenho conta · entrar" })).toHaveAttribute("href", `/login?callbackUrl=${encodeURIComponent("/assinatura?billingPlan=INDIVIDUAL&cycle=MONTHLY&extraAgendas=0")}`);
    completeSignup();
    // Sem contratação online, o cadastro vai para o guia de configuração (como /onboarding/create-salon), não para /assinatura.
    await waitFor(() => expect(h.push).toHaveBeenCalledWith(SETUP_GUIDE));
    expect(h.push).toHaveBeenCalledTimes(1);
    cleanup();
    fakeDb();
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    render(await SubscriptionPage({ searchParams: Promise.resolve({ billingPlan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: "0" }) }));
    expect(screen.getByText("A contratação online ainda não está disponível. Seu acesso atual permanece preservado.")).toBeVisible();
    expect(fetcher).not.toHaveBeenCalled();
    // Com cobrança desligada, a API também recusa.
    h.session.mockResolvedValue({ user: { id: "owner" } }); fakeMercadoPago();
    const response = await postSubscription({ plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0 });
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "BILLING_DISABLED" });
    expect(h.mpRequest).not.toHaveBeenCalled();
  });
  it("pausada: API devolve CHECKOUT_PAUSED sem criar contrato; se a pausa começa com a página já aberta, o portal explica a recusa e nada vai ao checkout", async () => {
    vi.stubEnv("MERCADOPAGO_CHECKOUT_PAUSED", "true");
    h.session.mockResolvedValue({ user: { id: "owner" } });
    const { tx } = fakeDb(); fakeMercadoPago();
    const paused = await postSubscription({ plan: "TEAM", cycle: "ANNUAL", extraAgendas: 0 });
    expect(paused.status).toBe(503); expect(await paused.json()).toEqual({ error: "CHECKOUT_PAUSED" });
    expect(tx.billingSubscription.create).not.toHaveBeenCalled(); expect(h.mpRequest).not.toHaveBeenCalled();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST"
      ? new Response(JSON.stringify({ error: "CHECKOUT_PAUSED" }), { status: 503 }) : reply(null)));
    // Página carregada antes da pausa (newContractsPaused ainda falso).
    render(<SubscriptionPortal salonId="salon-a" email="o@example.test" timezone="America/Sao_Paulo" initial={{ plan: "TEAM", cycle: "ANNUAL", extraAgendas: 0 }} />);
    fireEvent.click(await screen.findByRole("button", { name: "Continuar com este plano" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Ir para pagamento/ })); });
    expect(await screen.findByText(/Novas contratações estão temporariamente pausadas/)).toBeVisible();
    expect(h.goToCheckout).not.toHaveBeenCalled();
  });
  it("pausada: landing e cadastro deixam de oferecer pagamento (billingAvailable=false) e o cadastro segue para o guia; sem pausa, a landing volta a /contratar", async () => {
    vi.stubEnv("MERCADOPAGO_CHECKOUT_PAUSED", "true");
    render(<LandingPage />);
    expect(screen.getByRole("link", { name: "Escolher Essencial" })).toHaveAttribute("href", "/signup?billingPlan=TEAM&cycle=MONTHLY&extraAgendas=0&segment=barbearia");
    expect(screen.getByText(/Nenhuma cobrança é feita ao escolher um plano/)).toBeVisible();
    // Nenhum card leva a /contratar durante a pausa.
    expect(screen.getAllByRole("link", { name: /^Escolher / }).map(link => link.getAttribute("href")!.split("?")[0])).toEqual(["/signup", "/signup", "/signup"]);
    cleanup();
    render(await SignupPage({ searchParams: Promise.resolve({ billingPlan: "TEAM", cycle: "ANNUAL", extraAgendas: "0" }) }));
    const aside = screen.getByRole("complementary", { name: "Seu plano de interesse" });
    expect(aside).toHaveTextContent("Essencial · 3 agendas");
    expect(aside).toHaveTextContent(/A contratação online está em preparação/);
    expect(within(aside).getByRole("link", { name: "Já tenho conta · entrar" })).toHaveAttribute("href", `/login?callbackUrl=${encodeURIComponent("/assinatura?billingPlan=TEAM&cycle=ANNUAL&extraAgendas=0")}`);
    completeSignup();
    await waitFor(() => expect(h.push).toHaveBeenCalledWith(SETUP_GUIDE));
    expect(h.push).toHaveBeenCalledTimes(1);
    cleanup();
    vi.stubEnv("MERCADOPAGO_CHECKOUT_PAUSED", "false");
    render(<LandingPage />);
    expect(screen.getByRole("link", { name: "Escolher Essencial" })).toHaveAttribute("href", "/contratar?billingPlan=TEAM&cycle=MONTHLY&extraAgendas=0&segment=barbearia");
  });
  it("pausada: /assinatura esconde 'Você escolheu', trava os planos com o aviso de pausa e não envia nada", async () => {
    vi.stubEnv("MERCADOPAGO_CHECKOUT_PAUSED", "true");
    fakeDb();
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => reply(null)); vi.stubGlobal("fetch", fetcher);
    render(await SubscriptionPage({ searchParams: Promise.resolve({ billingPlan: "TEAM", cycle: "ANNUAL", extraAgendas: "0" }) }));
    expect(await screen.findByRole("heading", { name: "Escolha seu plano" })).toBeVisible();
    expect(screen.queryByText(/Você escolheu/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Continuar com este plano" })).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent(PAUSED_NOTE);
    for (const name of ["Assinar: Individual", "Assinar: Essencial", "Assinar: Equipe · 5 agendas"]) expect(screen.getByRole("button", { name })).toBeDisabled();
    // A escolha da landing segue visível (anual), só não pode ser contratada agora.
    expect(screen.getByLabelText(/^Anual/)).toBeChecked();
    expect(fetcher.mock.calls.some(call => call[1]?.method === "POST")).toBe(false);
  });
  it("pausada com tentativa não paga criada a preço anterior: atualizar e trocar ficam travados com o aviso de pausa; cancelar a tentativa continua disponível", async () => {
    const pending: SubscriptionView = { id: "sub-old", plan: "INDIVIDUAL", cycle: "MONTHLY", amountCents: 5990, agendaLimit: 1, state: "UNPAID", paidThrough: null, nextPaymentAt: null,
      cancelRequestedAt: null, cancelledAt: null, reviewRequired: false, checkoutUrl: CHECKOUT, providerStatus: "pending", lastSyncedAt: null, charges: [] };
    vi.stubGlobal("fetch", vi.fn(async () => reply(pending)));
    render(<SubscriptionPortal salonId="salon-a" email="o@example.test" timezone="America/Sao_Paulo" newContractsPaused />);
    expect(await screen.findByRole("heading", { name: "Prefere outro plano?" })).toBeVisible();
    expect(screen.getByRole("note")).toHaveTextContent(PAUSED_NOTE);
    expect(screen.getByRole("button", { name: "Atualizar para o novo preço: Individual" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Trocar para este plano: Essencial" })).toBeDisabled();
    // O aviso de preço continua, sem botão de atualizar (nenhum pagamento novo durante a pausa) e sem o checkout antigo.
    expect(screen.getByText("O preço deste plano mudou")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Atualizar para o novo preço" })).toBeNull();
    expect(screen.queryByRole("link", { name: /Continuar pagamento/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancelar contratação" })).toBeEnabled();
  });
  it.each(["MERCADOPAGO_PLAN_CHANGES_PAUSED", "MERCADOPAGO_CHECKOUT_PAUSED"])("trocas pausadas (%s=true): assinatura ativa vê o aviso e os botões de troca travados; cancelar a renovação continua disponível", async variable => {
    vi.stubEnv(variable, "true");
    fakeDb();
    vi.stubGlobal("fetch", vi.fn(async () => reply(activeIndividual)));
    render(await SubscriptionPage({ searchParams: Promise.resolve({}) }));
    expect(await screen.findByRole("heading", { name: "Mudar de plano" })).toBeVisible();
    expect(screen.getByRole("note")).toHaveTextContent(CHANGES_PAUSED_NOTE);
    expect(screen.getByRole("button", { name: "Plano atual" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Fazer upgrade: Essencial" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Fazer upgrade: Equipe · 5 agendas" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar renovação" })).toBeEnabled();
  });
});

describe("8. Cadastro com confirmação de e-mail (provedor Supabase)", () => {
  it("o link 'entre com sua senha' leva a escolha no callback do login e o plano fica lembrado; no login, /pos-login retoma /contratar, que consome o cookie", async () => {
    h.signup.mockResolvedValue({ ok: true, slug: "teste", confirmationRequired: true });
    render(<SignupForm billingIntent={{ plan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: 2 }} billingAvailable provider />);
    completeSignup();
    const status = await screen.findByText(/Conta criada\. Confirme seu e-mail/);
    const login = within(status).getByRole("link", { name: "entre com sua senha" });
    expect(login).toHaveAttribute("href", "/login?callbackUrl=%2Fcontratar%3FbillingPlan%3DTEAM_MAX%26cycle%3DANNUAL%26extraAgendas%3D2");
    expect(sanitizeAuthCallback(new URL(login.getAttribute("href")!, BASE).searchParams.get("callbackUrl"))).toBe("/contratar?billingPlan=TEAM_MAX&cycle=ANNUAL&extraAgendas=2");
    expect(h.push).not.toHaveBeenCalled();
    expect(h.signIn).not.toHaveBeenCalled();
    // Login por outro caminho no mesmo navegador (ex.: link do e-mail): o cookie leva a escolha até /pos-login.
    expect(document.cookie).toContain("ef_billing_intent=billingPlan%3DTEAM_MAX%26cycle%3DANNUAL%26extraAgendas%3D2");
    h.session.mockResolvedValue({ user: { id: "owner" } });
    h.cookies.mockImplementation(async () => cookieStore(document.cookie));
    await expect(PostLoginPage()).rejects.toMatchObject({ url: "/contratar?billingPlan=TEAM_MAX&cycle=ANNUAL&extraAgendas=2" });
    // /contratar leva ao estabelecimento criado no cadastro e apaga o cookie: daqui em diante a escolha segue só pela URL.
    fakeDb({ memberships: 1 });
    const response = await contratar(new Request(`${BASE}/contratar?billingPlan=TEAM_MAX&cycle=ANNUAL&extraAgendas=2`));
    expect(response.headers.get("location")).toBe(`${BASE}/assinatura?billingPlan=TEAM_MAX&cycle=ANNUAL&extraAgendas=2`);
    expect(response.headers.get("set-cookie")).toBe(INTENT_COOKIE_CLEARED);
  });
  it("sem contratação online disponível, a confirmação de e-mail não guarda plano, o link volta a ser /login e /pos-login vai ao painel", async () => {
    h.signup.mockResolvedValue({ ok: true, slug: "teste", confirmationRequired: true });
    render(<SignupForm billingIntent={{ plan: "TEAM", cycle: "MONTHLY", extraAgendas: 0 }} billingAvailable={false} provider />);
    completeSignup();
    const status = await screen.findByText(/Conta criada\. Confirme seu e-mail/);
    expect(within(status).getByRole("link", { name: "entre com sua senha" })).toHaveAttribute("href", "/login");
    expect(document.cookie).not.toContain("ef_billing_intent");
    h.session.mockResolvedValue({ user: { id: "owner" } });
    h.cookies.mockImplementation(async () => cookieStore(document.cookie));
    await expect(PostLoginPage()).rejects.toMatchObject({ url: "/dashboard" });
  });
});

describe("9. PlanPicker: seleção inicial e envio para cada combinação", () => {
  for (const c of COMBOS) {
    it(`${name(c)}: pré-seleciona e envia exatamente a intenção`, () => {
      const onChoose = vi.fn();
      render(<PlanPicker mode="subscribe" initial={{ plan: c.plan, cycle: c.cycle, extraAgendas: c.extra }} onChoose={onChoose} />);
      const label = c.plan === "TEAM_PLUS" || c.plan === "TEAM_MAX" ? (c.plan === "TEAM_PLUS" ? "Equipe · 5 agendas" : "Equipe · 10 agendas") : c.card;
      const card = screen.getByRole("article", { name: c.card });
      expect(card.className).toContain("ring-primary");
      expect(card.textContent).toMatch(money(c.money));
      fireEvent.click(within(card).getByRole("button", { name: `Assinar: ${label}` }));
      expect(onChoose).toHaveBeenCalledWith({ plan: c.plan, cycle: c.cycle, extraAgendas: c.extra });
    });
  }
});

describe("10. Links antigos ?plan= (tabela aposentada)", () => {
  it("billingIntentForLegacyPlan: pro -> Essencial mensal; equipe -> Equipe · 10 agendas mensal; fundador, gratis e valores desconhecidos -> nenhum", () => {
    expect(billingIntentForLegacyPlan("pro")).toEqual({ plan: "TEAM", cycle: "MONTHLY", extraAgendas: 0 });
    expect(billingIntentForLegacyPlan("equipe")).toEqual({ plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 0 });
    for (const value of ["fundador", "gratis", "PRO", "ENTERPRISE", "Equipe", "essencial", "", undefined, null, 1, ["pro"]]) expect(billingIntentForLegacyPlan(value)).toBeUndefined();
  });
  it.each([
    ["pro", "Essencial · 3 agendas", "79,90", "billingPlan=TEAM&cycle=MONTHLY&extraAgendas=0"],
    ["equipe", "Equipe · 10 agendas", "149,90", "billingPlan=TEAM_MAX&cycle=MONTHLY&extraAgendas=0"],
  ] as const)("com cobrança ativa, /signup?plan=%s mostra o catálogo atual (%s) e o cadastro segue para /assinatura com essa escolha", async (plan, label, price, query) => {
    render(await SignupPage({ searchParams: Promise.resolve({ plan }) }));
    const aside = screen.getByRole("complementary", { name: "Seu plano de interesse" });
    expect(aside).toHaveTextContent(label);
    expect(within(aside).getByText(money(price))).toBeVisible();
    expect(aside).toHaveTextContent("por mês");
    expect(aside.textContent).not.toMatch(/Seu interesse|R\$\s179,90|R\$\s49,90/);
    expect(within(aside).getByRole("link", { name: "Já tenho conta · entrar" })).toHaveAttribute("href", `/login?callbackUrl=${encodeURIComponent(`/contratar?${query}`)}`);
    completeSignup();
    await waitFor(() => expect(h.push).toHaveBeenCalledWith(`/assinatura?${query}`));
  });
  it.each(["fundador", "gratis"])("com cobrança ativa, /signup?plan=%s (sem capacidade equivalente) mostra o plano Grátis e o cadastro segue para o guia", async plan => {
    render(await SignupPage({ searchParams: Promise.resolve({ plan }) }));
    const aside = screen.getByRole("complementary", { name: "Seu plano de interesse" });
    expect(aside).toHaveTextContent("Comece no plano Grátis");
    expect(aside.textContent).not.toMatch(/Seu interesse|R\$\s49,90|R\$\s179,90/);
    expect(within(aside).getByRole("link", { name: "Rever planos" })).toHaveAttribute("href", "/#planos");
    completeSignup();
    await waitFor(() => expect(h.push).toHaveBeenCalledWith(SETUP_GUIDE));
  });
  it("billingPlan na URL prevalece sobre um ?plan= antigo", async () => {
    render(await SignupPage({ searchParams: Promise.resolve({ plan: "equipe", billingPlan: "INDIVIDUAL", cycle: "ANNUAL" }) }));
    const aside = screen.getByRole("complementary", { name: "Seu plano de interesse" });
    expect(aside).toHaveTextContent("Individual · 1 agenda");
    expect(within(aside).getByText(money("399"))).toBeVisible();
    expect(aside).toHaveTextContent("a cada 12 meses");
  });
  it("sem cobrança online, ?plan= não vira intenção de contratação: continua só como interesse informativo e o cadastro segue para o guia", async () => {
    vi.stubEnv("MERCADOPAGO_BILLING_ENABLED", "false");
    render(await SignupPage({ searchParams: Promise.resolve({ plan: "equipe" }) }));
    const aside = screen.getByRole("complementary", { name: "Seu plano de interesse" });
    expect(aside).toHaveTextContent("Seu interesse: Equipe");
    expect(within(aside).queryByRole("link", { name: "Já tenho conta · entrar" })).toBeNull();
    expect(within(aside).getByRole("link", { name: "Rever planos" })).toHaveAttribute("href", "/#planos");
    completeSignup();
    // setupEntryHref("/dashboard?welcome=1&plan=equipe"), escrito à mão.
    await waitFor(() => expect(h.push).toHaveBeenCalledWith("/onboarding/configuracao?next=%2Fdashboard%3Fwelcome%3D1%26plan%3Dequipe"));
  });
});

describe("11. Plano lembrado entre a confirmação de e-mail e o login (cookie ef_billing_intent)", () => {
  it("rememberBillingIntent grava só a seleção, por 2 dias, em Path=/ com SameSite=Lax; o valor lido de volta é a mesma escolha", () => {
    let owner: object | null = document;
    let accessor: PropertyDescriptor | undefined;
    while (owner && !(accessor = Object.getOwnPropertyDescriptor(owner, "cookie"))) owner = Object.getPrototypeOf(owner);
    const writes: string[] = [];
    Object.defineProperty(document, "cookie", { configurable: true, get: () => accessor!.get!.call(document), set: (value: string) => { writes.push(value); accessor!.set!.call(document, value); } });
    try { rememberBillingIntent({ plan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: 2 }); }
    finally { Reflect.deleteProperty(document, "cookie"); }
    // 2 x 24 x 60 x 60 = 172.800 s; a página de teste é http, então sem Secure.
    expect(writes).toEqual(["ef_billing_intent=billingPlan%3DTEAM_MAX%26cycle%3DANNUAL%26extraAgendas%3D2; Path=/; Max-Age=172800; SameSite=Lax"]);
    expect(document.cookie).toContain("ef_billing_intent=billingPlan%3DTEAM_MAX%26cycle%3DANNUAL%26extraAgendas%3D2");
    expect(rememberedBillingIntent(cookieStore(document.cookie).get("ef_billing_intent")?.value)).toEqual({ plan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: 2 });
  });
  it("rememberedBillingIntent aceita o valor codificado ou já decodificado e recusa valores adulterados", () => {
    expect(rememberedBillingIntent("billingPlan%3DTEAM_MAX%26cycle%3DANNUAL%26extraAgendas%3D2")).toEqual({ plan: "TEAM_MAX", cycle: "ANNUAL", extraAgendas: 2 });
    expect(rememberedBillingIntent("billingPlan=INDIVIDUAL&cycle=MONTHLY&extraAgendas=0")).toEqual({ plan: "INDIVIDUAL", cycle: "MONTHLY", extraAgendas: 0 });
    // Só a seleção é lida: valor e limite gravados no cookie são ignorados (o preço é sempre recalculado).
    expect(rememberedBillingIntent("billingPlan=TEAM&cycle=MONTHLY&extraAgendas=0&amountCents=1&agendaLimit=50")).toEqual({ plan: "TEAM", cycle: "MONTHLY", extraAgendas: 0 });
    for (const tampered of [undefined, "", "billingPlan=INDIVIDUAL&cycle=MONTHLY&extraAgendas=5", "billingPlan=TEAM_PLUS&cycle=ANNUAL&extraAgendas=1",
      "billingPlan=TEAM_MAX&cycle=MONTHLY&extraAgendas=101", "billingPlan=TEAM_MAX&cycle=MONTHLY&extraAgendas=-1", "billingPlan=TEAM_MAX&cycle=MONTHLY&extraAgendas=1.5",
      "billingPlan=TEAM_MAX&cycle=WEEKLY", "billingPlan=GOLD", "billingPlan=team_max", "cycle=ANNUAL&extraAgendas=3", "%E0%A4%A", "billingPlan%3DTEAM%25"]) {
      expect(rememberedBillingIntent(tampered)).toBeUndefined();
    }
  });
  it("/pos-login com cobrança ativa e plano lembrado válido -> /contratar com a mesma escolha", async () => {
    h.session.mockResolvedValue({ user: { id: "owner" } });
    h.cookies.mockImplementation(async () => cookieStore("theme=dark; ef_billing_intent=billingPlan%3DTEAM_PLUS%26cycle%3DANNUAL%26extraAgendas%3D0"));
    await expect(PostLoginPage()).rejects.toMatchObject({ url: "/contratar?billingPlan=TEAM_PLUS&cycle=ANNUAL&extraAgendas=0" });
  });
  it("/pos-login sem plano lembrado, com cookie adulterado ou com a cobrança desligada -> /dashboard", async () => {
    h.session.mockResolvedValue({ user: { id: "owner" } });
    for (const header of ["", "theme=dark", "ef_billing_intent=", "ef_billing_intent=billingPlan%3DINDIVIDUAL%26extraAgendas%3D5", "ef_billing_intent=billingPlan%3DGOLD", "ef_billing_intent=%E0%A4%A"]) {
      h.cookies.mockImplementation(async () => cookieStore(header));
      await expect(PostLoginPage()).rejects.toMatchObject({ url: "/dashboard" });
    }
    vi.stubEnv("MERCADOPAGO_BILLING_ENABLED", "false");
    h.cookies.mockImplementation(async () => cookieStore("ef_billing_intent=billingPlan%3DTEAM%26cycle%3DMONTHLY%26extraAgendas%3D0"));
    await expect(PostLoginPage()).rejects.toMatchObject({ url: "/dashboard" });
  });
  it("/pos-login: administrador da plataforma vai para /plataforma e sessão ausente para /login, mesmo com plano lembrado", async () => {
    h.cookies.mockImplementation(async () => cookieStore("ef_billing_intent=billingPlan%3DTEAM%26cycle%3DMONTHLY%26extraAgendas%3D0"));
    h.session.mockResolvedValue({ user: { id: "admin" } }); h.isPlatformAdmin.mockResolvedValue(true);
    await expect(PostLoginPage()).rejects.toMatchObject({ url: "/plataforma" });
    h.session.mockResolvedValue(null);
    await expect(PostLoginPage()).rejects.toMatchObject({ url: "/login" });
  });
  it("/contratar consome o plano lembrado: todas as saídas apagam o cookie (Max-Age=0)", async () => {
    const intent = "billingPlan=TEAM_MAX&cycle=ANNUAL&extraAgendas=1";
    const go = async (query: string) => {
      const response = await contratar(new Request(`${BASE}/contratar?${query}`));
      const to = new URL(response.headers.get("location")!);
      return { to: `${to.pathname}${to.search}${to.hash}`, cookie: response.headers.get("set-cookie") };
    };
    expect(await go(intent)).toEqual({ to: "/signup?billingPlan=TEAM_MAX&cycle=ANNUAL&extraAgendas=1", cookie: INTENT_COOKIE_CLEARED });
    expect(await go("billingPlan=INDIVIDUAL&extraAgendas=5")).toEqual({ to: "/signup", cookie: INTENT_COOKIE_CLEARED });
    h.session.mockResolvedValue({ user: { id: "u1" } }); fakeDb({ memberships: 0 });
    expect(await go(intent)).toEqual({ to: "/onboarding/create-salon?billingPlan=TEAM_MAX&cycle=ANNUAL&extraAgendas=1", cookie: INTENT_COOKIE_CLEARED });
    fakeDb({ memberships: 1 });
    expect(await go(intent)).toEqual({ to: "/assinatura?billingPlan=TEAM_MAX&cycle=ANNUAL&extraAgendas=1", cookie: INTENT_COOKIE_CLEARED });
    vi.stubEnv("MERCADOPAGO_BILLING_ENABLED", "false");
    expect(await go(intent)).toEqual({ to: "/#planos", cookie: INTENT_COOKIE_CLEARED });
  });
});
