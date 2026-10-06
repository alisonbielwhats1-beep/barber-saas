import { describe, expect, it } from "vitest";
import { spendReport } from "../secretary-spend-report";

describe("prepaid price simulation (owner 06/10: per request, 90% margin)", () => {
  it("reports cost, simulated revenue, margin and the price that gives 90%", () => {
    // 100 requests costing US$ 0.10 in all: R$ 0.56 at 5.60; R$ 6.00 at R$ 0.06 each.
    const report = spendReport({ modelMicroUsd: 60_000, voiceMicroUsd: 40_000, totalMicroUsd: 100_000, requests: 100, recordings: 40 }, {});
    expect(report).toMatchObject({ requests: 100, recordings: 40, cost_usd: { model: 0.06, voice: 0.04, total: 0.1 }, cost_per_request_usd: 0.001,
      cost_brl: 0.56, simulated_revenue_brl: 6, simulated_margin: 0.9067, price_for_target_brl: 0.056 });
  });
  it("uses the configured price and exchange rate, and has no ratio before the first request", () => {
    const report = spendReport({ modelMicroUsd: 0, voiceMicroUsd: 0, totalMicroUsd: 0, requests: 0, recordings: 0 }, { SALON_SECRETARY_PRICE_PER_REQUEST_CENTS: "8", SALON_SECRETARY_USD_BRL: "6" });
    expect(report).toMatchObject({ price_per_request_brl: 0.08, usd_brl: 6, simulated_margin: null, cost_per_request_usd: null, price_for_target_brl: null });
  });
});
