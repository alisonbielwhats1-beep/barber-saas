import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { orchestratorKnowledge } from "./orchestrator-knowledge";
import { PLAN_ENTITLEMENTS, PLAN_PRICING_ROWS } from "@/lib/plan-entitlements";
it("uses the same current public prices and limits as the landing without asserting offer availability", () => {
  const catalog = orchestratorKnowledge();
  expect(catalog.plans).toHaveLength(PLAN_PRICING_ROWS.length);
  for (const plan of catalog.plans) {
    expect(plan.priceCents).toBe(PLAN_ENTITLEMENTS[plan.plan].priceCents);
    expect(plan.price).toBe(PLAN_PRICING_ROWS.find(row => row.plan === plan.plan)?.price);
  }
  expect(catalog.founderAvailability).toBe("not_checked");
  expect(catalog.plans.find(plan => plan.plan === "PRO")?.monthlyAppointmentsDescription).toBe("Agendamentos ilimitados por mês");
  expect(catalog.plans.find(plan => plan.plan === "FREE")?.monthlyAppointmentsDescription).toBe("30 agendamentos por mês");
  expect(catalog.limits).toContain("Não contém catálogo de serviços");
});
