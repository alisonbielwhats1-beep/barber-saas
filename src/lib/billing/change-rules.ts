import { z } from "zod";
import { BILLING_PLANS, BillingError, quoteContract } from "./catalog";

export const billingTermsSchema = z.object({
  plan: z.enum(["INDIVIDUAL", "TEAM", "TEAM_PLUS", "TEAM_MAX"]),
  cycle: z.enum(["MONTHLY", "ANNUAL"]),
  amountCents: z.number().int().positive().safe(),
  agendaLimit: z.number().int().min(1).max(110),
  intervalMonths: z.union([z.literal(1), z.literal(12)]),
  catalogVersion: z.string().min(1),
}).strict().superRefine((terms, ctx) => {
  if (terms.intervalMonths !== (terms.cycle === "ANNUAL" ? 12 : 1)) ctx.addIssue({ code: "custom", message: "Inconsistent cycle" });
  const base = BILLING_PLANS[terms.plan].agendas;
  if (terms.agendaLimit < base || (terms.plan !== "TEAM_MAX" && terms.agendaLimit !== base)) ctx.addIssue({ code: "custom", message: "Inconsistent capacity" });
});
export type BillingTerms = z.infer<typeof billingTermsSchema>;
export function originalTerms(sub: { planCode: string; cycle: string; amountCents: number; agendaLimit: number; intervalMonths: number; catalogVersion: string }): BillingTerms {
  return billingTermsSchema.parse({ plan: sub.planCode, cycle: sub.cycle, amountCents: sub.amountCents, agendaLimit: sub.agendaLimit, intervalMonths: sub.intervalMonths, catalogVersion: sub.catalogVersion });
}
export function sameTerms(a: BillingTerms, b: BillingTerms) {
  return a.plan === b.plan && a.cycle === b.cycle && a.amountCents === b.amountCents && a.agendaLimit === b.agendaLimit && a.intervalMonths === b.intervalMonths && a.catalogVersion === b.catalogVersion;
}
export function proportionalDifference(oldAmount: number, newAmount: number, start: Date, end: Date, now: Date) {
  const total = end.getTime() - start.getTime();
  const remaining = end.getTime() - now.getTime();
  if (![oldAmount, newAmount, total, remaining].every(Number.isSafeInteger) || oldAmount <= 0 || newAmount <= oldAmount || total <= 0 || remaining <= 0 || remaining > total) throw new BillingError("INVALID_CHANGE_PERIOD");
  // Integer arithmetic: charge at most one rounding cent, never float currency.
  const numerator = BigInt(newAmount - oldAmount) * BigInt(remaining);
  return Number((numerator + BigInt(total) - BigInt(1)) / BigInt(total));
}

export function quotePlanChange(source: BillingTerms, selection: unknown, period: { start: Date; end: Date }, occupiedAgendas: number, now = new Date()) {
  const from = billingTermsSchema.parse(source);
  const quoted = quoteContract(selection);
  const to = billingTermsSchema.parse({ plan: quoted.plan, cycle: quoted.cycle, amountCents: quoted.amountCents, agendaLimit: quoted.agendaLimit, intervalMonths: quoted.intervalMonths, catalogVersion: quoted.catalogVersion });
  if (!Number.isSafeInteger(occupiedAgendas) || occupiedAgendas < 0) throw new BillingError("INVALID_CAPACITY");
  if (occupiedAgendas > to.agendaLimit) throw new BillingError("PLAN_CAPACITY_TOO_SMALL");
  if (from.plan === to.plan && from.cycle === to.cycle && from.agendaLimit === to.agendaLimit) throw new BillingError("PLAN_UNCHANGED");
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(period.start.getTime()) || !Number.isFinite(period.end.getTime()) || period.start > now || period.end <= now || period.start >= period.end) throw new BillingError("INVALID_CHANGE_PERIOD");
  const kind = from.cycle !== to.cycle ? "CYCLE" : to.agendaLimit > from.agendaLimit && to.amountCents > from.amountCents ? "UPGRADE" : "SCHEDULED";
  const amountDueCents = kind === "UPGRADE" ? proportionalDifference(from.amountCents, to.amountCents, period.start, period.end, now) : 0;
  const expiresAt = new Date(Math.min(now.getTime() + 15 * 60_000, period.end.getTime()));
  return { from, to, kind, amountDueCents, quotedAt: now, expiresAt, periodStart: period.start, periodEnd: period.end, effectiveAt: kind === "UPGRADE" ? now : period.end };
}
