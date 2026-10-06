import { secretaryModelProfile } from "@everflair/salon-secretary";
import type { Tx } from "./prisma-tenant";
import { SECRETARY_USAGE_ENTITY } from "./salon-secretary-usage";
import { dateKeyInTimeZone, startOfDateInTimeZone } from "./time";

/** Owner decision 06/10/2026: one wallet per salon. The Secretária's paid sources are the chat model (DeepSeek V4.1 Flash, or the
 * reserve after a provider failure) and the voice transcription (GPT Transcribe); the Jev router is not part of the Secretária.
 * Both are added in the salon's own time zone; one router row per message counts the requests (pedidos). Read-only over the salon's append-only AuditLog; numbers and codes only. A daily cap (safety) and a monthly cap (the wallet)
 * stop new turns and recordings once reached. */
type Env = Record<string, string | undefined>;
export const SECRETARY_ROUTER_ENTITY = "SECRETARY_ROUTER";
/** Same value as secretary-transcribe.ts (which imports this module); a test keeps them equal. */
export const SPEND_TRANSCRIBE_ENTITY = "SECRETARY_TRANSCRIBE";
/** An unreadable voice reservation counts at the largest one (TRANSCRIBE_MAX_RESERVATION_MICRO_USD; a test keeps them equal). */
export const SPEND_UNREADABLE_RESERVATION_MICRO_USD = 213_334;

export const DEFAULT_DAILY_BUDGET_USD = 1;
export const DEFAULT_MONTHLY_BUDGET_USD = 5;
/** A positive number from the environment, at most `max`; the fallback when unset, malformed or out of range. */
export const envNumber = (raw: string | undefined, fallback: number, max: number) => {
  const value = Number(raw ?? fallback);
  return Number.isFinite(value) && value > 0 && value <= max ? value : fallback;
};
/** SALON_SECRETARY_DAILY_BUDGET_USD: default US$ 1, admitted above 0 up to 20. */
export const dailyBudgetMicroUsd = (env: Env = process.env) => Math.round(envNumber(env.SALON_SECRETARY_DAILY_BUDGET_USD, DEFAULT_DAILY_BUDGET_USD, 20) * 1e6);
/** The monthly wallet, shared by the model and the voice: SALON_SECRETARY_MONTHLY_BUDGET_USD (above 0 up to 200); without it, the
 * older voice budget SALON_SECRETARY_TRANSCRIBE_BUDGET_USD becomes the wallet; without either, US$ 5. */
export const monthlyBudgetMicroUsd = (env: Env = process.env) =>
  Math.round(envNumber(env.SALON_SECRETARY_MONTHLY_BUDGET_USD || env.SALON_SECRETARY_TRANSCRIBE_BUDGET_USD || undefined, DEFAULT_MONTHLY_BUDGET_USD, 200) * 1e6);

type Pricing = { inputUsdPerMillion: number; cachedUsdPerMillion: number; cacheWriteUsdPerMillion: number | null; outputUsdPerMillion: number };
const DEAREST: Pricing = { inputUsdPerMillion: 0.45, cachedUsdPerMillion: 0.45, cacheWriteUsdPerMillion: 0.45, outputUsdPerMillion: 2.40 };
const pricingOf = (modelId: unknown) => { try { return secretaryModelProfile(String(modelId ?? "")).pricing; } catch { return null; } };
const counter = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
const record = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;

/** OpenRouter's platform fee on the credit it sells (about 5,5%): part of the real cost of a call it reports. */
export const OPENROUTER_FEE_MULTIPLIER = 1.055;
/** A reported cost below this share of the table price is not trusted (the table price is used instead). */
export const REPORTED_COST_FLOOR_SHARE = 0.2;
/** Owner 06/10/2026: the real cost of one finished model call, in micro-USD. The provider-reported cost (OpenRouter `usage.cost`)
 * plus the platform fee when the call carries one; otherwise (OpenAI, or no report) the price from its recorded tokens at the
 * registry's rates (the model that answered, else the requested one, else the dearest registered rates). A reported cost far
 * below the token price is never trusted. */
export function callMicroUsd(metadata: unknown) {
  const tabled = tableMicroUsd(metadata), reported = record(metadata).cost_micro_usd;
  if (typeof reported === "number" && Number.isFinite(reported) && reported >= 0) {
    const real = reported * OPENROUTER_FEE_MULTIPLIER;
    if (real >= tabled * REPORTED_COST_FLOOR_SHARE) return real;
  }
  return tabled;
}
/** The price of a call from its recorded tokens at the registry's (highest provider) rates. */
export function tableMicroUsd(metadata: unknown) {
  const m = record(metadata);
  const p = pricingOf(m.model_id_returned) ?? pricingOf(m.model_id_requested) ?? DEAREST;
  const cached = counter(m.cached_input_tokens), input = Math.max(0, counter(m.input_tokens) - cached);
  return input * p.inputUsdPerMillion + cached * p.cachedUsdPerMillion + counter(m.cache_write_tokens) * (p.cacheWriteUsdPerMillion ?? p.inputUsdPerMillion)
    + counter(m.output_tokens) * p.outputUsdPerMillion;
}
type VoiceRow = { entityId: string; action: string; metadata: unknown };
/** Voice in micro-USD: a settled recording at its reported cost; one not settled yet (in flight, failed, or without reported
 * usage) at its worst-case reservation. An overrun row is already inside its settled cost when it names its reservation;
 * an older one without that link counts as it was written. */
export function voiceMicroUsd(rows: readonly VoiceRow[]) {
  const settled = new Map<string, number | null>();
  for (const row of rows) {
    const m = record(row.metadata);
    if (row.action === "USAGE" && typeof m.reservation_id === "string")
      settled.set(m.reservation_id, typeof m.actual_micro_usd === "number" && Number.isFinite(m.actual_micro_usd) && m.actual_micro_usd >= 0 ? m.actual_micro_usd : null);
  }
  return rows.reduce((total, row) => {
    if (row.action !== "RESERVE") return total;
    const m = record(row.metadata), worst = m.worst_case_micro_usd;
    const reserved = typeof worst === "number" && Number.isSafeInteger(worst) && worst > 0 ? worst : SPEND_UNREADABLE_RESERVATION_MICRO_USD;
    if (m.kind === "OVERRUN") return total + (typeof m.reservation_id === "string" && settled.has(m.reservation_id) ? 0 : reserved);
    const actual = settled.get(row.entityId);
    return total + (typeof actual === "number" ? actual : reserved);
  }, 0);
}

export type SpendTotals = { modelMicroUsd: number; voiceMicroUsd: number; totalMicroUsd: number; requests: number; recordings: number };
/** `overflow`: the month has more rows than SPEND_ROW_LIMIT; its total reads as over any cap (fail closed). */
export type SalonSpend = { today: SpendTotals; month: SpendTotals; dayStart: Date; monthStart: Date; timezone: string; overflow: boolean };
/** The salon's day and month starts, in its own time zone. */
export function salonPeriodStarts(now: Date, timezone: string) {
  const day = dateKeyInTimeZone(now, timezone);
  return { dayStart: startOfDateInTimeZone(day, timezone), monthStart: startOfDateInTimeZone(`${day.slice(0, 8)}01`, timezone) };
}
type Row = { entityId: string; entityType: string; action: string; metadata: unknown };
/** `rows`: model and voice rows (with metadata); `requests`: how many messages (router rows) the same period had. */
export function spendTotals(rows: readonly Row[], requests = 0): SpendTotals {
  const of = (type: string, action?: string) => rows.filter(row => row.entityType === type && (!action || row.action === action));
  const model = Math.ceil(of(SECRETARY_USAGE_ENTITY, "MODEL_CALL_FINISHED").reduce((sum, row) => sum + callMicroUsd(row.metadata), 0));
  const voiceRows = of(SPEND_TRANSCRIBE_ENTITY), voice = Math.ceil(voiceMicroUsd(voiceRows));
  return { modelMicroUsd: model, voiceMicroUsd: voice, totalMicroUsd: model + voice, requests,
    recordings: voiceRows.filter(row => row.action === "RESERVE" && record(row.metadata).kind !== "OVERRUN").length };
}
/** Today's and this month's spend of the tenant in context (tx must be a withTenant/withSalon transaction of that salon). A month
 * with more rows than the bound fails closed: it reads as over any cap. */
export const SPEND_ROW_LIMIT = 60_000;
export async function salonSpend(tx: Tx, salonId: string, now = new Date()): Promise<SalonSpend> {
  const salon = await tx.salon.findUniqueOrThrow({ where: { id: salonId }, select: { timezone: true } });
  const { dayStart, monthStart } = salonPeriodStarts(now, salon.timezone);
  const rows = await tx.auditLog.findMany({ where: { salonId, createdAt: { gte: monthStart }, OR: [
    { entityType: SECRETARY_USAGE_ENTITY, action: "MODEL_CALL_FINISHED" }, { entityType: SPEND_TRANSCRIBE_ENTITY, action: { in: ["RESERVE", "USAGE"] } }] },
    select: { entityId: true, entityType: true, action: true, metadata: true, createdAt: true }, take: SPEND_ROW_LIMIT + 1 });
  // Messages are only counted: their router rows carry a large trace that the caps never need.
  const router = { salonId, entityType: SECRETARY_ROUTER_ENTITY };
  const [monthRequests, todayRequests] = await Promise.all([tx.auditLog.count({ where: { ...router, createdAt: { gte: monthStart } } }),
    tx.auditLog.count({ where: { ...router, createdAt: { gte: dayStart } } })]);
  const base = { dayStart, monthStart, timezone: salon.timezone };
  if (rows.length > SPEND_ROW_LIMIT) return { ...base, overflow: true, today: spendTotals([], todayRequests),
    month: { ...spendTotals([], monthRequests), totalMicroUsd: Number.MAX_SAFE_INTEGER } };
  return { ...base, overflow: false, today: spendTotals(rows.filter(row => row.createdAt >= dayStart), todayRequests), month: spendTotals(rows, monthRequests) };
}
/** The cap a spend has reached, if any: the day first (it resets sooner), then the month. */
export function budgetRefusal(spend: Pick<SalonSpend, "today" | "month">, env: Env = process.env) {
  if (spend.today.totalMicroUsd >= dailyBudgetMicroUsd(env)) return "SECRETARY_DAILY_BUDGET" as const;
  if (spend.month.totalMicroUsd >= monthlyBudgetMicroUsd(env)) return "SECRETARY_MONTHLY_BUDGET" as const;
  return null;
}
