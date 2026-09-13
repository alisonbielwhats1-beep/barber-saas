import { contractInput, type BILLING_PLANS } from "./catalog";

export type BillingIntent = { plan: keyof typeof BILLING_PLANS; cycle: "MONTHLY" | "ANNUAL"; extraAgendas: number };
export function resolveBillingIntent(query: { billingPlan?: unknown; cycle?: unknown; extraAgendas?: unknown }): BillingIntent | undefined {
  if (typeof query.billingPlan !== "string") return undefined;
  const parsed = contractInput.safeParse({ plan: query.billingPlan, cycle: query.cycle ?? "MONTHLY",
    extraAgendas: query.extraAgendas === undefined ? 0 : Number(query.extraAgendas) });
  return parsed.success ? parsed.data : undefined;
}
export function billingIntentQuery(intent: BillingIntent) {
  return new URLSearchParams({ billingPlan: intent.plan, cycle: intent.cycle, extraAgendas: String(intent.extraAgendas) }).toString();
}
export const billingIntentHref = (intent: BillingIntent, path = "/contratar") => `${path}?${billingIntentQuery(intent)}`;
export const billingMoney = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
export function safeCheckout(value: string | null) {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "www.mercadopago.com.br" && !url.username && !url.password && !url.port ? url.href : null; }
  catch { return null; }
}
export type SubscriptionView = {
  id: string; plan: string; cycle: string; amountCents: number; agendaLimit: number;
  state: string; paidThrough: string | null; nextPaymentAt: string | null;
  cancelRequestedAt: string | null; cancelledAt: string | null; reviewRequired: boolean;
  checkoutUrl: string | null; providerStatus: string; lastSyncedAt: string | null;
  charges: { id: string; amountCents: number; refundedCents: number; status: string; periodStart: string; periodEnd: string; paidAt: string | null }[];
};
export const billingErrors: Record<string, string> = {
  UNAUTHORIZED: "Sua sessão expirou. Entre novamente para continuar.",
  OWNER_REQUIRED: "Somente o proprietário pode gerenciar a assinatura.",
  SALON_NOT_APPROVED: "O estabelecimento precisa estar com o acesso aprovado para contratar.",
  PLAN_CAPACITY_TOO_SMALL: "Esse plano comporta menos agendas que sua equipe e os convites pendentes. Escolha uma capacidade maior.",
  SUBSCRIPTION_EXISTS: "Já existe uma assinatura. Atualize a página para acompanhá-la.",
  BILLING_DISABLED: "A contratação online ainda não está disponível.",
  CHECKOUT_PAUSED: "Novas contratações estão temporariamente pausadas. Seu histórico e cancelamento continuam disponíveis.",
  PROVIDER_UNAVAILABLE: "O Mercado Pago não respondeu agora. Sua solicitação será conferida antes de qualquer nova tentativa.",
  CREATION_REQUIRES_RECONCILIATION: "Estamos conferindo sua solicitação com o Mercado Pago. Atualize o acompanhamento em instantes.",
  RATE_LIMITED: "Aguarde um instante antes de tentar novamente.",
};
