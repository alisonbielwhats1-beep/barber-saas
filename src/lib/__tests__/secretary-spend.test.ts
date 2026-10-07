import { describe, expect, it, vi } from "vitest";
import { budgetRefusal, callMicroUsd, monthlyBudgetMicroUsd, salonPeriodStarts, salonSpend, SPEND_TRANSCRIBE_ENTITY, SPEND_UNREADABLE_RESERVATION_MICRO_USD,
  spendTotals, voiceMicroUsd } from "../secretary-spend";
import { TRANSCRIBE_AUDIT_ENTITY, TRANSCRIBE_MAX_RESERVATION_MICRO_USD } from "../secretary-transcribe";

/** Owner decision 06/10/2026: one wallet per salon (DeepSeek or its reserve + GPT Transcribe), in the salon's time zone. */
const at = new Date("2026-10-20T13:00:00Z");
const call = (metadata: Record<string, unknown>) => ({ entityId: "c", entityType: "SALON_SECRETARY_USAGE", action: "MODEL_CALL_FINISHED", createdAt: at, metadata });
const reserve = (id: string, worst: unknown, extra: Record<string, unknown> = {}) => ({ entityId: id, entityType: SPEND_TRANSCRIBE_ENTITY, action: "RESERVE", createdAt: at,
  metadata: { worst_case_micro_usd: worst, ...extra } });
const usage = (reservation: string | undefined, actual: number | null) => ({ entityId: "u", entityType: SPEND_TRANSCRIBE_ENTITY, action: "USAGE", createdAt: at,
  metadata: { actual_micro_usd: actual, ...(reservation ? { reservation_id: reservation } : {}) } });

describe("model calls", () => {
  it("prices the requested model from the registry, and an unknown one at the dearest rates", () => {
    expect(callMicroUsd({ model_id_requested: "deepseek/deepseek-v4.1-flash", input_tokens: 1_000_000 })).toBeCloseTo(450_000);
    expect(callMicroUsd({ model_id_requested: "deepseek/deepseek-v4.1-flash", output_tokens: 1_000_000 })).toBeCloseTo(2_400_000);
    expect(callMicroUsd({ model_id_requested: "deepseek/deepseek-v4.1-flash", input_tokens: 1_000_000, cached_input_tokens: 1_000_000 })).toBeCloseTo(48_000);
    expect(callMicroUsd({ model_id_requested: "unknown", input_tokens: 1_000_000 })).toBeCloseTo(450_000);
  });
  it("prices the reserve when it answered, and the requested model when the returned id is not in the registry", () => {
    expect(callMicroUsd({ model_id_requested: "deepseek/deepseek-v4.1-flash", model_id_returned: "gpt-6-luna", output_tokens: 1_000_000 })).toBeCloseTo(500_000);
    expect(callMicroUsd({ model_id_requested: "deepseek/deepseek-v4.1-flash", model_id_returned: "gpt-6-luna-2026-09-01", output_tokens: 1_000_000 })).toBeCloseTo(2_400_000);
  });
});

describe("real cost (owner 06/10: x10 on the real cost)", () => {
  const deepseek = { model_id_requested: "deepseek/deepseek-v4.1-flash", input_tokens: 11_000, cached_input_tokens: 9_900, cache_write_tokens: 0, output_tokens: 220 };
  it("a call that reports its cost is priced at it plus the 5,5% OpenRouter fee, not at the table", () => {
    // Table: 1100 x 0,45 + 9900 x 0,048 + 220 x 2,40 = 1 498,2 micro-USD; reported 600 -> 633.
    expect(callMicroUsd(deepseek)).toBeCloseTo(1_498.2);
    expect(callMicroUsd({ ...deepseek, cost_micro_usd: 600 })).toBeCloseTo(633);
  });
  it("owner 07/10: any reported cost is the real cost, however far below the table (no 20% floor)", () => {
    expect(callMicroUsd({ ...deepseek, cost_micro_usd: 200 })).toBeCloseTo(211);
    expect(callMicroUsd({ ...deepseek, cost_micro_usd: 1 })).toBeCloseTo(1.055);
  });
  it("a missing or zero report falls back to the table: a call is never charged as free", () => {
    expect(callMicroUsd({ ...deepseek, cost_micro_usd: 0 })).toBeCloseTo(1_498.2);
    expect(callMicroUsd({ ...deepseek, cost_micro_usd: null })).toBeCloseTo(1_498.2);
    expect(callMicroUsd(deepseek)).toBeCloseTo(1_498.2);
  });
});

describe("voice", () => {
  it("bounds agree with secretary-transcribe.ts", () => {
    expect(SPEND_TRANSCRIBE_ENTITY).toBe(TRANSCRIBE_AUDIT_ENTITY);
    expect(SPEND_UNREADABLE_RESERVATION_MICRO_USD).toBe(TRANSCRIBE_MAX_RESERVATION_MICRO_USD);
  });
  it("a settled recording counts at its reported cost, an unsettled one at its worst case", () => {
    expect(voiceMicroUsd([reserve("a", 13_334), usage("a", 1_500)])).toBe(1_500);
    expect(voiceMicroUsd([reserve("a", 13_334)])).toBe(13_334);
    expect(voiceMicroUsd([reserve("a", 13_334), usage("a", null)])).toBe(13_334);
    expect(voiceMicroUsd([reserve("a", 13_334), usage(undefined, 1_500)])).toBe(13_334); // older rows without the link
    expect(voiceMicroUsd([reserve("a", "x")])).toBe(SPEND_UNREADABLE_RESERVATION_MICRO_USD);
  });
  it("an overrun is inside the settled cost when linked, and counts as written when not", () => {
    expect(voiceMicroUsd([reserve("a", 1_000), usage("a", 2_500), reserve("o", 1_500, { kind: "OVERRUN", reservation_id: "a" })])).toBe(2_500);
    expect(voiceMicroUsd([reserve("a", 1_000), reserve("o", 1_500, { kind: "OVERRUN" })])).toBe(2_500);
  });
});

describe("wallet", () => {
  it("adds model and voice (the Jev is not part of the Secretária) and counts recordings; requests come from the router count", () => {
    const totals = spendTotals([call({ model_id_requested: "deepseek/deepseek-v4.1-flash", input_tokens: 1_000 }), reserve("a", 13_334), usage("a", 1_500)], 2);
    expect(totals).toEqual({ modelMicroUsd: 450, voiceMicroUsd: 1_500, totalMicroUsd: 1_950, requests: 2, recordings: 1 });
  });
  it("day and month start in the salon's time zone", () => {
    expect(salonPeriodStarts(new Date("2026-11-01T02:00:00Z"), "America/Sao_Paulo"))
      .toEqual({ dayStart: new Date("2026-10-31T03:00:00Z"), monthStart: new Date("2026-10-01T03:00:00Z") });
  });
  it("splits today from the month, counts messages without reading their trace, and a month past the row bound reads as over the month", async () => {
    const earlier = { ...call({ model_id_requested: "deepseek/deepseek-v4.1-flash", output_tokens: 1_000_000 }), createdAt: new Date("2026-10-02T12:00:00Z") };
    const rows = [earlier, call({ model_id_requested: "deepseek/deepseek-v4.1-flash", input_tokens: 1_000 })];
    const tx = { salon: { findUniqueOrThrow: vi.fn(async () => ({ timezone: "America/Sao_Paulo" })) },
      auditLog: { findMany: vi.fn(async () => rows), count: vi.fn(async ({ where }: { where: { createdAt: { gte: Date } } }) => where.createdAt.gte.getUTCDate() === 1 ? 7 : 3) } };
    const spend = await salonSpend(tx as never, "ours", new Date("2026-10-20T15:00:00Z"));
    expect(spend.today.totalMicroUsd).toBe(450);
    expect(spend.month.totalMicroUsd).toBe(2_400_450);
    expect([spend.today.requests, spend.month.requests, spend.overflow]).toEqual([3, 7, false]);
    expect(tx.auditLog.count).toHaveBeenCalledWith({ where: { salonId: "ours", entityType: "SECRETARY_ROUTER", createdAt: { gte: new Date("2026-10-01T03:00:00Z") } } });
    expect(tx.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ salonId: "ours", createdAt: { gte: new Date("2026-10-01T03:00:00Z") } }) }));
    tx.auditLog.findMany.mockResolvedValueOnce(Array.from({ length: 60_001 }, () => rows[1]));
    const full = await salonSpend(tx as never, "ours");
    expect(full.overflow).toBe(true);
    expect(budgetRefusal(full, {})).toBe("SECRETARY_MONTHLY_BUDGET");
  });
  it("the monthly wallet falls back to the older voice budget, then to US$ 5", () => {
    expect(monthlyBudgetMicroUsd({ SALON_SECRETARY_TRANSCRIBE_BUDGET_USD: "2" })).toBe(2_000_000);
    expect(monthlyBudgetMicroUsd({ SALON_SECRETARY_TRANSCRIBE_BUDGET_USD: "2", SALON_SECRETARY_MONTHLY_BUDGET_USD: "8" })).toBe(8_000_000);
  });
  it("the monthly cap defaults to US$ 5 and refuses out-of-range values", () => {
    expect(monthlyBudgetMicroUsd({})).toBe(5_000_000);
    expect(monthlyBudgetMicroUsd({ SALON_SECRETARY_MONTHLY_BUDGET_USD: "12.5" })).toBe(12_500_000);
    for (const bad of ["0", "-1", "201", "x"]) expect(monthlyBudgetMicroUsd({ SALON_SECRETARY_MONTHLY_BUDGET_USD: bad })).toBe(5_000_000);
  });
});
