import { z } from "zod";

export const CATALOG_VERSION = "2026-10-02";
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

/** Owner decision 06/10/2026: the Secretária is prepaid, in every plan, in packs paid once (Mercado Pago, Pix or card). The
 * customer buys requests (pedidos: each message sent to the Secretária), never money: a later price change does not touch
 * what was bought, and requests never expire. Priced from the average cost per request so the margin stays near 90%
 * (about R$ 0,08 per request; each pack rounds in the customer's favor). */
export const SECRETARY_CREDIT_PACKS = {
  P15: { amountCents: 1500, requests: 185 },
  P25: { amountCents: 2500, requests: 310 },
  P40: { amountCents: 4000, requests: 500 },
} as const;
export type SecretaryCreditPack = keyof typeof SECRETARY_CREDIT_PACKS;
export const secretaryCreditPack = z.enum(["P15", "P25", "P40"]);
