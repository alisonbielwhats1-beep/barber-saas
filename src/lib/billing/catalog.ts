import { z } from "zod";

export const CATALOG_VERSION = "2026-10-02";
/** Owner decision 09/10/2026: Stripe (card, Apple Pay, Google Pay) alongside Mercado Pago. Each contract or purchase keeps
 * the provider it was created with (033 makes it immutable); existing ones are Mercado Pago. */
export const BILLING_PROVIDERS = ["mercadopago", "stripe"] as const;
export type BillingProvider = (typeof BILLING_PROVIDERS)[number];
export const billingProvider = z.enum(BILLING_PROVIDERS);
/** A contract request names its gateway; requests from before Stripe carry none and stay Mercado Pago. */
export const contractProvider = z.object({ provider: billingProvider.default("mercadopago") }).passthrough();
export const BILLING_PLANS = {
  INDIVIDUAL: { label: "Individual", agendas: 1, monthly: 3990, annual: 39900 },
  TEAM: { label: "Essencial", agendas: 3, monthly: 7990, annual: 77900 },
  TEAM_PLUS: { label: "Equipe · 5 agendas", agendas: 5, monthly: 9990, annual: 95900 },
  TEAM_MAX: { label: "Equipe · 10 agendas", agendas: 10, monthly: 14990, annual: 143900 },
} as const;
/** Agenda adicional acima de dez, somente Equipe · 10 agendas. */
export const EXTRA_AGENDA = { monthly: 2000, annual: 19200 } as const;
export const contractInput = z.object({
  plan: z.enum(["INDIVIDUAL", "TEAM", "TEAM_PLUS", "TEAM_MAX"]),
  cycle: z.enum(["MONTHLY", "ANNUAL"]),
  extraAgendas: z.number().int().min(0).max(100).default(0),
}).strict().refine(v => v.plan === "TEAM_MAX" || v.extraAgendas === 0, "Adicionais exigem Equipe com 10 agendas.");

export function quoteContract(value: unknown) {
  const input = contractInput.parse(value);
  const plan = BILLING_PLANS[input.plan];
  const annual = input.cycle === "ANNUAL";
  return { ...input, catalogVersion: CATALOG_VERSION, label: plan.label,
    currency: "BRL", amountCents: (annual ? plan.annual : plan.monthly) + input.extraAgendas * (annual ? EXTRA_AGENDA.annual : EXTRA_AGENDA.monthly),
    agendaLimit: plan.agendas + input.extraAgendas, intervalMonths: annual ? 12 : 1 };
}

export class BillingError extends Error {
  constructor(public code: string, public status = 409) { super(code); this.name = "BillingError"; }
}

/** Each provider's code only ever touches its own contracts and purchases. Rows from before 033 (and test doubles of them)
 * carry no provider: they are Mercado Pago. */
export function assertProvider(record: { provider?: string | null }, provider: BillingProvider) {
  if ((record.provider ?? "mercadopago") !== provider) throw new BillingError("PROVIDER_MISMATCH", 409);
}

/** Calendar months, preserving the original anchor day even after February. */
export function periodEnd(start: Date, months: number) {
  const end = new Date(start);
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + months);
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(start.getUTCDate(), last));
  return end;
}

export function accessState(sub: { paidThrough: Date | null; delinquentSince: Date | null; cancelledAt: Date | null }, now = new Date()) {
  if (!sub.paidThrough) return "UNPAID";
  if (sub.paidThrough > now) return "ACTIVE";
  if (sub.cancelledAt) return "EXPIRED";
  // Technical uncertainty alone never becomes delinquency.
  if (!sub.delinquentSince) return "VERIFYING";
  const graceEnd = new Date(Math.max(sub.paidThrough.getTime(), sub.delinquentSince.getTime()) + 5 * 86400000);
  return now < graceEnd ? "GRACE" : "RESTRICTED";
}

/** Owner decisions 06/10/2026: the Secretária is prepaid CREDIT, in every plan, in packs paid once (Mercado Pago, Pix or card).
 * Credit is in units of R$ 0,0001 (secretary-credits-rules.ts): each request takes its own real cost x 10, so the margin holds
 * on every request; "about N requests" is only an estimate at the average cost. A bigger pack yields more credit per real
 * (gross margin before the payment fee: 90%, 89%, 88% and 87%; at the real cost measured on 06/10 about 120, 220, 390 and
 * 840 requests). The credit never expires. */
export const SECRETARY_CREDIT_PACKS = {
  P15: { amountCents: 1500, units: 150_000 },
  P25: { amountCents: 2500, units: 275_000 },
  P40: { amountCents: 4000, units: 485_000 },
  P80: { amountCents: 8000, units: 1_053_000 },
} as const;
export type SecretaryCreditPack = keyof typeof SECRETARY_CREDIT_PACKS;
export const secretaryCreditPack = z.enum(["P15", "P25", "P40", "P80"]);
