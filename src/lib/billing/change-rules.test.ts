import { describe, expect, it } from "vitest";
import { BILLING_PLANS, quoteContract } from "./catalog";
import { originalTerms, proportionalDifference, quotePlanChange, type BillingTerms } from "./change-rules";

const plans = Object.keys(BILLING_PLANS) as (keyof typeof BILLING_PLANS)[];
const cycles = ["MONTHLY", "ANNUAL"] as const;
function terms(plan: typeof plans[number], cycle: typeof cycles[number], extraAgendas = 0): BillingTerms {
  const quote = quoteContract({ plan, cycle, extraAgendas });
  return originalTerms({ ...quote, planCode: plan });
}
const start = new Date("2028-02-01T12:00:00Z"), end = new Date("2028-03-01T12:00:00Z"), now = new Date("2028-02-15T12:00:00Z");
describe("complete plan/cycle matrix", () => {
  for (const fromPlan of plans) for (const toPlan of plans) for (const fromCycle of cycles) for (const toCycle of cycles) {
    it(`${fromPlan} ${fromCycle} → ${toPlan} ${toCycle}`, () => {
      const source = terms(fromPlan, fromCycle);
      const run = () => quotePlanChange(source, { plan: toPlan, cycle: toCycle }, { start, end }, 0, now);
      if (fromPlan === toPlan && fromCycle === toCycle) { expect(run).toThrow("PLAN_UNCHANGED"); return; }
      const result = run();
      const expectedKind = fromCycle !== toCycle ? "CYCLE" : BILLING_PLANS[toPlan].agendas > source.agendaLimit ? "UPGRADE" : "SCHEDULED";
      expect(result.kind).toBe(expectedKind);
      expect(result.to).toEqual(terms(toPlan, toCycle));
      expect(result.periodEnd).toEqual(end);
      expect(result.amountDueCents).toBe(expectedKind === "UPGRADE" ? Math.ceil((result.to.amountCents - source.amountCents) * 15 / 29) : 0);
      expect(result.effectiveAt).toEqual(expectedKind === "UPGRADE" ? now : end);
    });
  }
});
it.each(cycles)("validates every extra-agenda quantity in %s", cycle => {
  for (let extraAgendas = 1; extraAgendas <= 100; extraAgendas++) {
    const result = quotePlanChange(terms("TEAM_MAX", cycle), { plan: "TEAM_MAX", cycle, extraAgendas }, { start, end }, 10, now);
    expect(result.to.agendaLimit).toBe(10 + extraAgendas);
    expect(result.kind).toBe("UPGRADE");
    expect(Number.isSafeInteger(result.amountDueCents)).toBe(true);
  }
  expect(() => quotePlanChange(terms("TEAM_MAX", cycle), { plan: "TEAM_MAX", cycle, extraAgendas: 101 }, { start, end }, 10, now)).toThrow();
});
it("uses the actual persisted old price, including the previous annual catalog", () => {
  const source = { ...terms("TEAM_PLUS", "ANNUAL"), amountCents: 95880, catalogVersion: "2026-09-12" };
  const result = quotePlanChange(source, { plan: "TEAM_MAX", cycle: "ANNUAL" }, { start, end }, 5, now);
  expect(result.amountDueCents).toBe(Math.ceil((143900 - 95880) * 15 / 29));
  expect(result.from.amountCents).toBe(95880);
});
it("schedules a lower price even if a legacy customer's target capacity is higher", () => {
  const result = quotePlanChange({ ...terms("INDIVIDUAL", "MONTHLY"), amountCents: 20000 }, { plan: "TEAM_MAX", cycle: "MONTHLY" }, { start, end }, 1, now);
  expect(result.kind).toBe("SCHEDULED"); expect(result.amountDueCents).toBe(0);
});
it("rejects invalid periods, nonfinite dates, injected amounts and incompatible capacity", () => {
  const source = terms("TEAM_MAX", "MONTHLY");
  for (const date of [new Date(NaN), new Date(start.getTime() - 1), end]) expect(() => quotePlanChange(source, { plan: "TEAM_PLUS", cycle: "MONTHLY" }, { start, end }, 0, date)).toThrow("INVALID_CHANGE_PERIOD");
  expect(() => quotePlanChange(source, { plan: "TEAM_PLUS", cycle: "MONTHLY" }, { start, end }, 6, now)).toThrow("PLAN_CAPACITY_TOO_SMALL");
  for (const extra of [-1, 1.5, Infinity, "2"]) expect(() => quotePlanChange(source, { plan: "TEAM_MAX", cycle: "MONTHLY", extraAgendas: extra }, { start, end }, 1, now)).toThrow();
  expect(() => quotePlanChange(source, { plan: "TEAM_PLUS", cycle: "MONTHLY", amountCents: 1 }, { start, end }, 1, now)).toThrow();
});
it.each([28, 29, 30, 31, 365, 366])("keeps cent arithmetic bounded across %i-day periods", days => {
  const a = new Date("2028-01-31T23:59:59.999Z"), b = new Date(a.getTime() + days * 86400000);
  expect(proportionalDifference(5990, 14990, a, b, a)).toBe(9000);
  expect(proportionalDifference(5990, 14990, a, b, new Date(b.getTime() - 1))).toBe(1);
  expect(proportionalDifference(5990, 14990, a, b, new Date(a.getTime() + days * 43200000))).toBe(4500);
});
