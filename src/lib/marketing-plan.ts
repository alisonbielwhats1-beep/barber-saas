import { PLAN_PRICING_ROWS } from "./plan-entitlements";

/** Presentation intent only. Never grants entitlements or changes the stored plan. */
export const MARKETING_PLAN_KEYS = { FREE: "gratis", STARTER: "fundador", PRO: "pro", ENTERPRISE: "equipe" } as const;
export type MarketingPlanKey = typeof MARKETING_PLAN_KEYS[keyof typeof MARKETING_PLAN_KEYS];

export function resolvePlanIntent(value: unknown) {
  if (typeof value !== "string") return undefined;
  return PLAN_PRICING_ROWS.find(row => MARKETING_PLAN_KEYS[row.plan] === value);
}

export function firstAccessHref(value: unknown) {
  const plan = resolvePlanIntent(value);
  return plan ? `/dashboard?welcome=1&plan=${MARKETING_PLAN_KEYS[plan.plan]}` : "/dashboard?welcome=1";
}
