import { envNumber, type SpendTotals } from "./secretary-spend";

/** Owner decision 06/10/2026: the Secretária will be sold prepaid, per request (pedido), aiming at a 90% margin. Until the price
 * is fixed, the HQ report simulates it over the pilot's real cost: SALON_SECRETARY_PRICE_PER_REQUEST_CENTS (default 6 = R$ 0,06)
 * and a fixed exchange rate SALON_SECRETARY_USD_BRL (default 5.60, reviewed monthly). Numbers only; nothing is charged. */
type Env = Record<string, string | undefined>;
export const TARGET_MARGIN = 0.9;
export const pricePerRequestCents = (env: Env = process.env) => envNumber(env.SALON_SECRETARY_PRICE_PER_REQUEST_CENTS, 6, 100);
export const usdToBrl = (env: Env = process.env) => envNumber(env.SALON_SECRETARY_USD_BRL, 5.6, 20);

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
/** Cost, simulated revenue and margin of one salon's month; null ratios when there was no request yet. */
export function spendReport(month: SpendTotals, env: Env = process.env) {
  const fx = usdToBrl(env), price = pricePerRequestCents(env);
  const costBrl = month.totalMicroUsd / 1e6 * fx, revenueBrl = month.requests * price / 100;
  const perRequestUsd = month.requests ? month.totalMicroUsd / 1e6 / month.requests : null;
  return {
    requests: month.requests, recordings: month.recordings,
    cost_usd: { model: round(month.modelMicroUsd / 1e6, 6), voice: round(month.voiceMicroUsd / 1e6, 6), total: round(month.totalMicroUsd / 1e6, 6) },
    cost_per_request_usd: perRequestUsd === null ? null : round(perRequestUsd, 6),
    cost_brl: round(costBrl, 4), price_per_request_brl: price / 100, usd_brl: fx,
    simulated_revenue_brl: round(revenueBrl, 2),
    simulated_margin: revenueBrl > 0 ? round(1 - costBrl / revenueBrl, 4) : null,
    /** The price per request that would give the 90% margin at this month's average cost. */
    price_for_target_brl: perRequestUsd === null ? null : round(perRequestUsd * fx / (1 - TARGET_MARGIN), 4),
  };
}
