import { PLAN_PRICING_ROWS } from "./plan-entitlements";
import type { BillingIntent } from "./billing/presentation";

/** Presentation intent only. Never grants entitlements or changes the stored plan. */
export const MARKETING_PLAN_KEYS = { FREE: "gratis", STARTER: "fundador", PRO: "pro", ENTERPRISE: "equipe" } as const;
export type MarketingPlanKey = typeof MARKETING_PLAN_KEYS[keyof typeof MARKETING_PLAN_KEYS];

export function resolvePlanIntent(value: unknown) {
  if (typeof value !== "string") return undefined;
  return PLAN_PRICING_ROWS.find(row => MARKETING_PLAN_KEYS[row.plan] === value);
}

/**
 * With online billing, old ?plan= links show today's catalog instead of the
 * retired table. Plans without an equivalent capacity fall back to the plan list.
 */
export function billingIntentForLegacyPlan(value: unknown): BillingIntent | undefined {
  const plan = resolvePlanIntent(value)?.plan;
  return plan === "PRO" ? { plan: "TEAM", cycle: "MONTHLY", extraAgendas: 0 }
    : plan === "ENTERPRISE" ? { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: 0 } : undefined;
}

export function firstAccessHref(value: unknown) {
  const plan = resolvePlanIntent(value);
  return plan ? `/dashboard?welcome=1&plan=${MARKETING_PLAN_KEYS[plan.plan]}` : "/dashboard?welcome=1";
}
