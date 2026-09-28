import { contractInput, BILLING_PLANS, quoteContract } from "./catalog";
import type { BillingTerms } from "./change-rules";

export type BillingIntent = { plan: keyof typeof BILLING_PLANS; cycle: "MONTHLY" | "ANNUAL"; extraAgendas: number };
export function billingCapacityLabel(plan: BillingIntent["plan"], agendas: number) {
  const label = plan === "TEAM_PLUS" || plan === "TEAM_MAX" ? "Equipe" : BILLING_PLANS[plan].label;
  return `${label} · ${agendas} ${agendas === 1 ? "agenda" : "agendas"}`;
}
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
export const billingMoney = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(cents / 100);
export function safeCheckout(value: string | null) {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "www.mercadopago.com.br" && !url.username && !url.password && !url.port ? url.href : null; }
  catch { return null; }
}
export type SubscriptionView = {
  id: string; plan: string; cycle: string; amountCents: number; agendaLimit: number;
  state: string; paidThrough: string | null; nextPaymentAt: string | null;
  cancelRequestedAt: string | null; cancelledAt: string | null; reviewRequired: boolean;
  renewalCancellationStatus?: "AVAILABLE" | "PENDING" | "CANCELLED";
  checkoutUrl: string | null; providerStatus: string; lastSyncedAt: string | null;
  changesAvailable?: boolean; changePending?: boolean; change?: PlanChangeView | null;
  charges: { id: string; amountCents: number; refundedCents: number; status: string; periodStart: string; periodEnd: string; paidAt: string | null }[];
};
export type PlanChangeView = { id: string; kind: string; state: string; from: BillingTerms; to: BillingTerms; amountDueCents: number; effectiveAt: string; periodEnd: string; expiresAt: string; paidAt: string | null; activatedAt: string | null; checkoutUrl: string | null; lastError: string | null };
export type BillingTone = "ok" | "warn" | "danger" | "neutral";
export type RenewalStatus = "AVAILABLE" | "PENDING" | "CANCELLED";
export const renewalStatusOf = (sub: Pick<SubscriptionView, "renewalCancellationStatus" | "cancelledAt" | "cancelRequestedAt">): RenewalStatus =>
  sub.renewalCancellationStatus ?? (sub.cancelledAt ? "CANCELLED" : sub.cancelRequestedAt ? "PENDING" : "AVAILABLE");

type TermsLike = { plan: string; cycle: string; agendaLimit: number };
/** A reactivated renewal is stored as a cycle change with unchanged terms (the DB accepts no other kind). */
export const isRenewalReactivation = (change: { kind: string; from: TermsLike; to: TermsLike }) =>
  change.kind === "CYCLE" && sameBillingTerms(change.from, change.to);

/** One status vocabulary for the header shortcut and the subscription page. */
export function subscriptionStatus(sub: { state: string; renewal: RenewalStatus; reviewRequired: boolean; changePending?: boolean; reactivation?: "pending" | "scheduled" | null }): { label: string; tone: BillingTone } {
  if (sub.reviewRequired) return { label: "Em revisão", tone: "warn" };
  if (sub.state === "UNPAID") return sub.renewal === "AVAILABLE" ? { label: "Aguardando pagamento", tone: "warn" }
    : sub.renewal === "PENDING" ? { label: "Cancelando contratação", tone: "neutral" } : { label: "Contratação cancelada", tone: "neutral" };
  if (sub.state === "ACTIVE") return sub.renewal === "CANCELLED" ? { label: "Renovação cancelada", tone: "neutral" }
    : sub.renewal === "PENDING" ? { label: "Cancelando renovação", tone: "neutral" }
    : sub.reactivation === "pending" ? { label: "Reativação pendente", tone: "warn" }
    : sub.changePending && sub.reactivation !== "scheduled" ? { label: "Troca em andamento", tone: "neutral" } : { label: "Ativo", tone: "ok" };
  if (sub.state === "VERIFYING") return { label: "Confirmando renovação", tone: "warn" };
  if (sub.state === "GRACE") return { label: "Pagamento em atraso", tone: "warn" };
  if (sub.state === "RESTRICTED") return { label: "Regularizar pagamento", tone: "danger" };
  if (sub.state === "EXPIRED") return { label: "Plano encerrado", tone: "danger" };
  return { label: "Em conferência", tone: "neutral" };
}

export type PlanBadge = { plan: string | null; status: string | null; tone: BillingTone };
/**
 * Header shortcut. A pending or failed contract is shown with its situation,
 * never as an active plan; an abandoned attempt falls back to the plan in use.
 */
export function planBadgeFor(legacyLabel: string | null, sub: { plan: BillingIntent["plan"]; agendaLimit: number; state: string; renewal: RenewalStatus; reviewRequired: boolean; changePending?: boolean; reactivation?: "pending" | "scheduled" | null } | null): PlanBadge {
  if (!sub || (sub.state === "UNPAID" && sub.renewal === "CANCELLED")) return { plan: legacyLabel, status: null, tone: "neutral" };
  const status = subscriptionStatus(sub);
  return { plan: billingCapacityLabel(sub.plan, sub.agendaLimit), status: status.label, tone: status.tone };
}

/** Situation of a reactivation still in progress, for status labels. */
export function reactivationState(change: { kind: string; state: string; from: TermsLike; to: TermsLike } | null | undefined, pending: boolean | undefined): "pending" | "scheduled" | null {
  if (!change || !pending || !isRenewalReactivation(change)) return null;
  return change.state === "SCHEDULED" ? "scheduled" : ["PREPARING", "AWAITING_PAYMENT"].includes(change.state) ? "pending" : null;
}

/** Savings of one annual payment versus twelve monthly payments of the same capacity. */
export const annualSavingsCents = (intent: BillingIntent) =>
  quoteContract({ ...intent, cycle: "MONTHLY" }).amountCents * 12 - quoteContract({ ...intent, cycle: "ANNUAL" }).amountCents;
export const sameBillingTerms = (a: { plan: string; cycle: string; agendaLimit: number }, b: { plan: string; cycle: string; agendaLimit: number }) =>
  a.plan === b.plan && a.cycle === b.cycle && a.agendaLimit === b.agendaLimit;

export const billingErrors: Record<string, string> = {
  PROVIDER_REJECTED: "O Mercado Pago não aceitou a solicitação. Confira os dados no checkout e se a conta compradora é diferente da conta recebedora. Atualize a situação antes de tentar novamente.",
  SELLER_ACCOUNT_MISMATCH: "A conta recebedora precisa ser conferida pela plataforma. Entre em contato com o suporte.",
  PLAN_CHANGES_DISABLED: "A troca de planos ainda não está disponível.",
  PLAN_UNCHANGED: "Este já é seu plano e sua capacidade atuais.",
  PLAN_CHANGE_PENDING: "Já existe uma troca em andamento. Acompanhe a confirmação antes de solicitar outra.",
  CHANGE_REQUIRES_ACTIVE_SUBSCRIPTION: "A troca exige assinatura ativa, com pagamento confirmado e sem cancelamento ou pendência financeira.",
  CHANGE_QUOTE_EXPIRED: "A cotação expirou. Escolha o plano novamente para calcular o valor atualizado.",
  CHANGE_QUOTE_STALE: "Sua assinatura mudou desde a cotação. Atualize a situação e escolha o plano novamente.",
  CHANGE_CANNOT_CANCEL: "Esta troca já recebeu pagamento ou está em revisão. Acompanhe a situação ou entre em contato.",
  CHANGE_RENEWAL_IN_PROGRESS: "Há uma renovação em processamento. Aguarde a confirmação para trocar de plano.",
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
  INVALID_ORIGIN: "Por segurança, pagamentos e trocas só podem ser feitos pelo endereço oficial do Everflair. Abra esta página pelo endereço oficial e tente novamente.",
  IDEMPOTENCY_MISMATCH: "Esta solicitação já foi registrada com outros dados. Atualize a situação antes de tentar novamente.",
  INVALID_CHANGE_PERIOD: "Não encontramos o período pago atual para calcular a troca. Atualize a situação ou fale com a plataforma.",
  BILLING_NOT_CONFIGURED: "A contratação online está temporariamente indisponível. Seu acesso atual permanece preservado.",
  BILLING_ENVIRONMENT_MISMATCH: "A contratação online está temporariamente indisponível. Seu acesso atual permanece preservado.",
  CANCELLATION_NOT_CONFIRMED: "O Mercado Pago ainda não confirmou o cancelamento. Continuaremos tentando automaticamente.",
  NOT_FOUND: "Não encontramos esta solicitação. Atualize a situação e tente novamente.",
  RENEWAL_REACTIVATION_UNAVAILABLE: "Não é possível reativar agora: o período pago termina em menos de uma hora ou há uma pendência financeira. Depois do vencimento, escolha um plano novamente.",
  RENEWAL_NOT_CANCELLED: "A renovação já está ativa ou o cancelamento ainda está em confirmação. Atualize a situação.",
};
