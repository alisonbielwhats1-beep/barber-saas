import { z } from "zod";

export const CATALOG_VERSION = "2026-09-12";
export const BILLING_PLANS = {
  INDIVIDUAL: { label: "Individual", agendas: 1, monthly: 5990, annual: 59880 },
  TEAM: { label: "Equipe", agendas: 3, monthly: 7990, annual: 77880 },
  TEAM_PLUS: { label: "Equipe Plus", agendas: 5, monthly: 9990, annual: 95880 },
  TEAM_MAX: { label: "Equipe Max", agendas: 10, monthly: 14990, annual: 143880 },
} as const;
export const contractInput = z.object({
  plan: z.enum(["INDIVIDUAL", "TEAM", "TEAM_PLUS", "TEAM_MAX"]),
  cycle: z.enum(["MONTHLY", "ANNUAL"]),
  extraAgendas: z.number().int().min(0).max(100).default(0),
}).strict().refine(v => v.plan === "TEAM_MAX" || v.extraAgendas === 0, "Adicionais exigem Equipe Max.");

export function quoteContract(value: unknown) {
  const input = contractInput.parse(value);
  const plan = BILLING_PLANS[input.plan];
  const annual = input.cycle === "ANNUAL";
  return { ...input, catalogVersion: CATALOG_VERSION, label: plan.label,
    currency: "BRL", amountCents: (annual ? plan.annual : plan.monthly) + input.extraAgendas * (annual ? 14400 : 1500),
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
