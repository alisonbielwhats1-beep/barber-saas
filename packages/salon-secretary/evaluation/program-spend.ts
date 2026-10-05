/** Program-wide REAL-spend hard cap of the reliability program (27/09/2026). Every paid evaluation call (Agenda
 * practice, Golden/holdout free-use, transcription) is admitted here IN ADDITION to its own reservation journal.
 * Before transport: ledger total + worst case of the call must fit PROGRAM_REAL_CAP_USD, recorded as a RESERVE row
 * (fsynced, hash-chained, under an exclusive lock). After the response: a SETTLE row charges the ACTUAL cost from
 * `usage`; a failed call, missing usage or a crash before settling stays charged at the full worst case.
 * ONE ledger per machine account, outside every checkout and worktree (`~/.everflair-secretary/`): a fresh clone, a new
 * worktree or a cleaned results/ folder never start a new cap. Append-only: no reset, refund, CLI/env path override or
 * cross-ledger rows (the only path override is a unit-test ledger inside a vitest worker). External anchor: the tracked
 * `program-spend-anchor.json` pins the genesis row and the last known row, so a deleted or truncated ledger, or a
 * missing anchor, fails closed (PROGRAM_SPEND_JOURNAL) instead of reading as zero. Estimators come from a sealed allowlist.
 * Wallets (04/10/2026, model registry): each payer has its own ledger, anchor, cap history and admitted estimators. The OpenAI
 * wallet is this program's original ledger (its rows, including the DeepSeek Golden runs of 04/10 charged at ceiling prices, stay
 * valid there); the OpenRouter wallet holds every later OpenRouter call, settled at the cost OpenRouter reports. */
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { assertChatOutboundBody, assertOpenRouterOutboundBody, assertSecretaryResponsesPayload, OPENROUTER_CHAT_URL } from '../src/openai-cost-guard';
import { SECRETARY_MODELS } from '../src/model-registry';
import { FREE_USE_DEEPSEEK_PRICING, FREE_USE_DEEPSEEK_PRICING_SHA256, FREE_USE_PRICING, FREE_USE_PRICING_SHA256, digest } from './free-use-budget';

export const PROGRAM_SPEND_LEDGER = 'program-spend-20260927';
export const PROGRAM_SPEND_BASENAME = `${PROGRAM_SPEND_LEDGER}.jsonl`;
/** Directory under the OS account profile (read from the OS, not from an environment variable). */
export const PROGRAM_SPEND_DIR = '.everflair-secretary';
export const PROGRAM_SPEND_FILE = `~/${PROGRAM_SPEND_DIR}/${PROGRAM_SPEND_BASENAME}`;
/** Tracked anchor, relative to the checkout root: commit it with this file, so a checkout without the ledger fails closed
 * (a checkout without the anchor fails closed as well). */
export const PROGRAM_SPEND_ANCHOR_FILE = 'packages/salon-secretary/evaluation/program-spend-anchor.json';
// Owner decision 27/09/2026: ~USD 4.50 of real credit left for the whole program, no extra cost allowed (cap US$ 2.50).
// Owner decision 28/09/2026 (in chat): cap raised to US$ 3.50.
// Owner decision 29/09/2026 (in chat, after the final proof): cap raised to US$ 6.00 for Candidate 4.
// Owner decision 29/09/2026 (in chat, "se precisar pode aumentar o limite para 2 dolares a mais"): cap raised to US$ 8.00 (Candidate 4 proof).
// Owner decision 29/09/2026 (in chat): cap raised to US$ 15.00 (Candidate 4 proof worst-case reservation headroom; expected real spend ~US$ 3.50).
// Owner decision 04/10/2026 (in chat): cap raised to US$ 16.00 (+US$ 1) to certify GPT-6 Luna as the plan B reserve (Golden k=3, ~US$ 0.20).
/** Auditable cap history, fixed in code (no env/CLI override), strictly increasing. Every RESERVE row records the cap it
 * was admitted under: one of these values, never lower than the previous RESERVE's, and its own admission
 * (spentBefore + worst case) must fit that recorded cap. New admissions use the last entry. */
export type ProgramCapEntry = Readonly<{ microUsd: number; approved: string; note: string }>;
export const PROGRAM_CAP_HISTORY: readonly ProgramCapEntry[] = Object.freeze([
  Object.freeze({ microUsd: 2_500_000, approved: '2026-09-27', note: 'initial' }),
  Object.freeze({ microUsd: 3_500_000, approved: '2026-09-28', note: 'owner raise in chat' }),
  Object.freeze({ microUsd: 6_000_000, approved: '2026-09-29', note: 'owner raise in chat (Candidate 4)' }),
  Object.freeze({ microUsd: 8_000_000, approved: '2026-09-29', note: 'owner raise in chat (+US$2, Candidate 4 proof)' }),
  Object.freeze({ microUsd: 15_000_000, approved: '2026-09-29', note: 'owner raise in chat (US$15, Candidate 4 proof headroom)' }),
  Object.freeze({ microUsd: 16_000_000, approved: '2026-10-04', note: 'owner raise in chat (+US$1, certify GPT-6 Luna as the plan B reserve)' }),
]);
if (!PROGRAM_CAP_HISTORY.length || PROGRAM_CAP_HISTORY.some((c, i, all) => !Number.isSafeInteger(c.microUsd) || c.microUsd < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(c.approved) ||
  (i > 0 && (c.microUsd <= all[i - 1].microUsd || c.approved < all[i - 1].approved)))) throw Error('PROGRAM_SPEND_CONFIG');
export const PROGRAM_REAL_CAP_MICRO_USD = PROGRAM_CAP_HISTORY[PROGRAM_CAP_HISTORY.length - 1].microUsd;
export const PROGRAM_REAL_CAP_USD = PROGRAM_REAL_CAP_MICRO_USD / 1e6;
export const PROGRAM_SPEND_SOURCES = ['practice', 'golden', 'transcribe'] as const;
export type ProgramSpendSource = (typeof PROGRAM_SPEND_SOURCES)[number];

// ---------------------------------------------------------------- wallets (one ledger per payer)
export type ProgramSpendWalletId = 'openai' | 'openrouter';
/** `estimators`: every estimator whose rows the ledger holds (history included); `admits`: those a new reservation may use.
 * `genesis`: the real ledger's first row, pinned in code once it exists, so a deleted ledger and anchor never restart a cap. */
export type ProgramSpendWallet = Readonly<{ id: ProgramSpendWalletId; ledger: string; basename: string; anchorFile: string; capHistory: readonly ProgramCapEntry[];
  estimators: readonly string[]; admits: readonly string[]; genesis: Readonly<{ id: string; hash: string }> | null }>;
export const PROGRAM_SPEND_OPENROUTER_LEDGER = 'program-spend-openrouter-20261004';
// Owner decision 04/10/2026 (in chat): US$ 2.00 of REAL OpenRouter spend for the DeepSeek validation; US$ 0.57 was already spent
// before this ledger existed (OpenRouter journal of the demo hook, plus US$ 0.03 of refused calls recorded there), so this ledger
// admits the remaining US$ 1.40. Its calls settle at the cost OpenRouter reports, never at a ceiling price.
export const PROGRAM_OPENROUTER_CAP_HISTORY: readonly ProgramCapEntry[] = Object.freeze([
  Object.freeze({ microUsd: 1_400_000, approved: '2026-10-04', note: 'owner: US$ 2.00 real for OpenRouter, minus US$ 0.60 spent before this ledger' }),
]);
export const PROGRAM_SPEND_WALLETS: Readonly<Record<ProgramSpendWalletId, ProgramSpendWallet>> = Object.freeze({
  openai: Object.freeze({ id: 'openai' as const, ledger: PROGRAM_SPEND_LEDGER, basename: PROGRAM_SPEND_BASENAME, anchorFile: PROGRAM_SPEND_ANCHOR_FILE,
    capHistory: PROGRAM_CAP_HISTORY, estimators: Object.freeze(['responses', 'transcriptions', 'openrouter-chat']), admits: Object.freeze(['responses', 'transcriptions']),
    genesis: Object.freeze({ id: '64d2cfdd-9910-4a35-98ca-f12df4c11f7e', hash: '1e792f7989402d26f081ac1e3c50d096f1025d1c099b147c805d24502a1dd7c0' }) }),
  openrouter: Object.freeze({ id: 'openrouter' as const, ledger: PROGRAM_SPEND_OPENROUTER_LEDGER, basename: `${PROGRAM_SPEND_OPENROUTER_LEDGER}.jsonl`,
    anchorFile: 'packages/salon-secretary/evaluation/program-spend-openrouter-anchor.json', capHistory: PROGRAM_OPENROUTER_CAP_HISTORY,
    estimators: Object.freeze(['openrouter-cost']), admits: Object.freeze(['openrouter-cost']),
    // Its chain started with the certification Golden of the model registry (04/10/2026, 14:50 São Paulo).
    genesis: Object.freeze({ id: '30110659-f486-4140-a379-8a20b20dc25e', hash: 'b6eae2531834435efd3972cf3ebaa188ec7f6782f05d711b6e51de67bff85094' }) }),
});
const WALLET_LIST: readonly ProgramSpendWallet[] = Object.freeze(Object.values(PROGRAM_SPEND_WALLETS));
if (WALLET_LIST.some(w => !w.capHistory.length || w.capHistory.some((c, i, all) => !Number.isSafeInteger(c.microUsd) || c.microUsd < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(c.approved) ||
  (i > 0 && (c.microUsd <= all[i - 1].microUsd || c.approved < all[i - 1].approved))))) throw Error('PROGRAM_SPEND_CONFIG');
export const programSpendWallet = (id: ProgramSpendWalletId) => PROGRAM_SPEND_WALLETS[id] ?? (() => { throw Error('PROGRAM_SPEND_CONFIG'); })();
const walletCap = (wallet: ProgramSpendWallet) => wallet.capHistory[wallet.capHistory.length - 1].microUsd;
/** The wallet of a ledger file, by its basename; any other file is refused. */
function walletOf(file: string): ProgramSpendWallet {
  const wallet = typeof file === 'string' ? WALLET_LIST.find(w => basename(file) === w.basename) : undefined;
  if (!wallet) throw Error('PROGRAM_SPEND_CONFIG');
  return wallet;
}
export function programSpendLedgerPath(wallet: ProgramSpendWalletId = 'openai') {
  let home = ''; try { home = userInfo().homedir; } catch { home = ''; }
  if (typeof home !== 'string' || !home || !isAbsolute(home)) throw Error('PROGRAM_SPEND_CONFIG');
  return join(home, PROGRAM_SPEND_DIR, programSpendWallet(wallet).basename);
}
/** The wallet that pays a model's evaluation calls (model-registry.ts). */
export const programSpendWalletOfModel = (modelId: string): ProgramSpendWalletId => {
  const profile = SECRETARY_MODELS.find(candidate => candidate.id === modelId);
  if (!profile) throw Error('PROGRAM_SPEND_CONFIG');
  return profile.wallet;
};
const RESPONSES_URL = 'https://api.openai.com/v1/responses';
const LOCK_WAIT_MS = 3000;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9_.:#+-]{0,159}$/, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, HASH = /^[0-9a-f]{64}$/;
const RESERVE_KEYS = ['ledger', 'kind', 'seq', 'id', 'at', 'source', 'run', 'item', 'estimator', 'model', 'bodyBytes', 'maxOutputTokens', 'worstCaseMicroUsd',
  'pricingSha256', 'capMicroUsd', 'spentBeforeMicroUsd', 'previousHash', 'rowHash'].join();
const SETTLE_KEYS = ['ledger', 'kind', 'seq', 'id', 'at', 'outcome', 'httpStatus', 'usage', 'chargedMicroUsd', 'previousHash', 'rowHash'].join();
const ANCHOR_KEYS = ['ledger', 'genesisId', 'genesisHash', 'seq', 'rowHash'].join();

export const isProgramSpendError = (error: unknown): error is Error => error instanceof Error && /^PROGRAM_SPEND_[A-Z_]{1,40}$/.test(error.message);
export const programSpendCode = (error: unknown) => isProgramSpendError(error) ? error.message : 'PROGRAM_SPEND_ERROR';
/** Codes-only label (run/item): other characters become '_' (no customer text is ever passed here). */
export function programSpendLabel(raw: string) {
  const s = String(raw).replace(/[^A-Za-z0-9_.:#+-]/g, '_').slice(0, 160);
  return /^[A-Za-z0-9]/.test(s) ? s : ('x' + s).slice(0, 160);
}
/** vitest defines `__vitest_worker__` on the global object of every test worker; a launcher run by node/tsx never has it. */
const vitestWorker = () => { const state: unknown = Reflect.get(globalThis, '__vitest_worker__'); return typeof state === 'object' && state !== null; };
/** Unit-test mode needs the VITEST variable AND a vitest worker: a variable set in a shell alone is no proof. */
const unitTest = () => !!process.env.VITEST && vitestWorker();
/** Historical paid launchers never wired to this ledger (ultimate-10, phase A, multi-action benchmark, conversational
 * UX, t21, topic14, x94) are refused before any database, journal or network work. Unit tests (a vitest worker) keep
 * exercising their orchestration with fake transports only. */
export function refuseUnwiredPaidPath(): void { if (!unitTest()) throw Error('PROGRAM_SPEND_UNWIRED'); }

// ---------------------------------------------------------------- pricing (same constants as the journals)
export type ProgramUsage = Record<string, number>;
export type PaidCallEstimate = { estimator: string; model: string; bodyBytes: number; maxOutputTokens: number; worstCaseMicroUsd: number; pricingSha256: string };
type FetchInput = Parameters<typeof fetch>[0]; type FetchInit = Parameters<typeof fetch>[1];
/** `agent` (C5, SALON_SECRETARY_AGENT): the runner says explicitly that the agent's wire is expected; the estimator never reads the flag. */
/** `pilot` (reschedule pilot, SALON_SECRETARY_PILOT_RESCHEDULE): likewise, the pilot's one-tool wire only when the runner passes {pilot:true}. */
export type PaidWireOptions = { agent?: boolean; pilot?: boolean;
  /** A* premise probe only (docs/c5-spike/13-sonda-premissa-astar.md): its own wire, and nothing else, when the probe harness says so. */ pilotAnchorProbe?: boolean };
/** The guard options a paid wire is judged under: the probe's alone when asked, else exactly the agent/pilot pair as before. */
const wireOptions = (options: PaidWireOptions) => options.pilotAnchorProbe === true ? { pilotAnchorProbe: true } : { agent: options.agent === true, pilot: options.pilot === true };
const probeOption = (options: { pilotAnchorProbe?: boolean }) => options.pilotAnchorProbe === true ? { pilotAnchorProbe: true } : {};
export type PaidEstimator = { name: string; worstCase(input: FetchInput, init?: FetchInit, options?: PaidWireOptions): PaidCallEstimate; actual(json: unknown): { usage: ProgramUsage; chargedMicroUsd: number } | null };
/** Same bound as the stage/mission reservations: (UTF8 bytes + 8192 framing) at the cache-write rate + max_output_tokens at the output rate. */
export const worstCaseMicroUsd = (bodyBytes: number, maxOutputTokens: number) =>
  Math.ceil((bodyBytes + FREE_USE_PRICING.protocolOverheadTokens) * FREE_USE_PRICING.cacheWriteUsdPerMillion + maxOutputTokens * FREE_USE_PRICING.outputUsdPerMillion);
type ResponsesUsage = { input: number; cached: number; output: number; reasoning: number };
/** output_tokens already include reasoning; a provider reporting reasoning above output is charged for both. */
const billedOutput = (usage: ResponsesUsage) => usage.reasoning > usage.output ? usage.output + usage.reasoning : usage.output;
/** Actual cost, conservative: usage does not separate cache writes, so uncached input pays the higher of the input and
 * cache-write rates; cached input pays a cache-read rate only when the pricing object defines one (else the full input rate). */
export function responsesUsageMicroUsd(usage: ResponsesUsage) {
  const pricing = FREE_USE_PRICING as unknown as Record<string, unknown>;
  const cachedRate = typeof pricing.cacheReadUsdPerMillion === 'number' ? pricing.cacheReadUsdPerMillion : FREE_USE_PRICING.inputUsdPerMillion;
  const uncachedRate = Math.max(FREE_USE_PRICING.inputUsdPerMillion, FREE_USE_PRICING.cacheWriteUsdPerMillion);
  return Math.ceil((usage.input - usage.cached) * uncachedRate + usage.cached * cachedRate + billedOutput(usage) * FREE_USE_PRICING.outputUsdPerMillion);
}
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function responsesUsage(value: unknown): ResponsesUsage | null {
  if (!isRecord(value) || Object.keys(value).join() !== 'input,cached,output,reasoning') return null;
  const { input, cached, output, reasoning } = value;
  return count(input) && count(cached) && count(output) && count(reasoning) && cached <= input ? { input, cached, output, reasoning } : null;
}
/** Default estimator: the Luna Responses wire (text-only JSON, gpt-6-luna pricing). Anything else fails closed. */
export const responsesEstimator: PaidEstimator = Object.freeze({
  name: 'responses',
  worstCase(input: FetchInput, init?: FetchInit, options: PaidWireOptions = {}): PaidCallEstimate {
    if (typeof input !== 'string' || input !== RESPONSES_URL || init?.method?.toUpperCase() !== 'POST' || typeof init.body !== 'string') throw Error('PROGRAM_SPEND_WIRE');
    let payload: unknown; try { payload = JSON.parse(init.body); } catch { throw Error('PROGRAM_SPEND_WIRE'); }
    // The sealed bound holds only for the text-only Luna wire: no server state, priority tier, hosted tools, media or background.
    // C5: the agent's wire (same bound: text-only, store:false, ≤ 8192 output) only when the runner passes {agent:true}.
    try { assertSecretaryResponsesPayload(payload, FREE_USE_PRICING.model, wireOptions(options)); } catch { throw Error('PROGRAM_SPEND_WIRE'); }
    const bodyBytes = Buffer.byteLength(init.body, 'utf8'), maxOutputTokens = isRecord(payload) ? payload.max_output_tokens : undefined;
    if (!isRecord(payload) || payload.model !== FREE_USE_PRICING.model || !Number.isInteger(maxOutputTokens) || (maxOutputTokens as number) < 1 ||
      (maxOutputTokens as number) > FREE_USE_PRICING.outputCap || bodyBytes + FREE_USE_PRICING.protocolOverheadTokens > FREE_USE_PRICING.maxInputTokensUpper) throw Error('PROGRAM_SPEND_WIRE');
    return { estimator: 'responses', model: FREE_USE_PRICING.model, bodyBytes, maxOutputTokens: maxOutputTokens as number,
      worstCaseMicroUsd: worstCaseMicroUsd(bodyBytes, maxOutputTokens as number), pricingSha256: FREE_USE_PRICING_SHA256 };
  },
  actual(json: unknown) {
    const u = isRecord(json) && isRecord(json.usage) ? json.usage : undefined;
    const inDetails: Record<string, unknown> = u && isRecord(u.input_tokens_details) ? u.input_tokens_details : {};
    const outDetails: Record<string, unknown> = u && isRecord(u.output_tokens_details) ? u.output_tokens_details : {};
    const usage = responsesUsage(u && { input: u.input_tokens, cached: inDetails.cached_tokens ?? 0, output: u.output_tokens, reasoning: outDetails.reasoning_tokens ?? 0 });
    return usage ? { usage, chargedMicroUsd: responsesUsageMicroUsd(usage) } : null;
  },
});

// ---------------------------------------------------------------- sealed estimator allowlist
/** Everything the ledger needs to re-derive a call from its rows alone: pricing object and its sha, models, minimum
 * worst case, the worst case of a reserved shape, the charge of a usage and the bound that usage must respect. */
export type SealedEstimator = { name: string; pricing: Readonly<Record<string, unknown>>; pricingSha256: string; models: readonly string[]; minWorstCaseMicroUsd: number;
  /** null when the reserved shape is outside the sealed bounds */ worstCase(bodyBytes: number, maxOutputTokens: number): number | null;
  usage(value: unknown): ProgramUsage | null; charge(usage: ProgramUsage): number; withinBound(reserve: { bodyBytes: number; maxOutputTokens: number }, usage: ProgramUsage): boolean };
const RESPONSES_SEALED: SealedEstimator = Object.freeze({
  name: 'responses', pricing: FREE_USE_PRICING, pricingSha256: FREE_USE_PRICING_SHA256, models: Object.freeze([FREE_USE_PRICING.model]),
  minWorstCaseMicroUsd: worstCaseMicroUsd(1, 1),
  worstCase: (bodyBytes: number, maxOutputTokens: number) => bodyBytes >= 1 && bodyBytes + FREE_USE_PRICING.protocolOverheadTokens <= FREE_USE_PRICING.maxInputTokensUpper &&
    maxOutputTokens >= 1 && maxOutputTokens <= FREE_USE_PRICING.outputCap ? worstCaseMicroUsd(bodyBytes, maxOutputTokens) : null,
  usage: (value: unknown) => responsesUsage(value),
  charge: (usage: ProgramUsage) => responsesUsageMicroUsd(usage as ResponsesUsage),
  // The sealed bound: input within the reserved bytes + framing, billed output within max_output_tokens.
  withinBound: (reserve: { bodyBytes: number; maxOutputTokens: number }, usage: ProgramUsage) =>
    usage.input <= reserve.bodyBytes + FREE_USE_PRICING.protocolOverheadTokens && billedOutput(usage as ResponsesUsage) <= reserve.maxOutputTokens,
});
// ---------------------------------------------------------------- transcription (C3: ready but OFF)
/** Owner decision 28/09/2026: GPT transcription of the Secretary's recorder is ready but off (zero cost until enabled).
 * The bound is per call, not per usage: every call is charged at the worst case of the longest admitted recording at an
 * UPPER per-minute price, and never settled from the provider's usage (a USAGE row of this estimator never validates),
 * so a provider duration or token field can neither lower the charge nor break the sealed bound. The upper price and the
 * caps are an owner-review item before enabling. `maxOutputTokens` of the row carries the admitted seconds. */
export const TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';
export const TRANSCRIBE_PRICING = Object.freeze({
  source: 'https://platform.openai.com/docs/pricing', checkedAt: '2026-09-28', models: Object.freeze(['gpt-4o-mini-transcribe', 'gpt-4o-transcribe']),
  upperUsdPerMinute: 0.02, maxAudioSeconds: 60, maxAudioBytes: 1_500_000,
  bound: 'One recording of at most maxAudioSeconds (client-declared, server-checked) and maxAudioBytes, charged at upperUsdPerMinute for maxAudioSeconds; never settled from usage.',
});
export const TRANSCRIBE_PRICING_SHA256 = digest(JSON.stringify(TRANSCRIBE_PRICING));
const transcribeWorstCase = () => Math.ceil(TRANSCRIBE_PRICING.maxAudioSeconds / 60 * TRANSCRIBE_PRICING.upperUsdPerMinute * 1e6);
export const transcriptionsEstimator: PaidEstimator = Object.freeze({
  name: 'transcriptions',
  worstCase(input: FetchInput, init?: FetchInit): PaidCallEstimate {
    if (typeof input !== 'string' || input !== TRANSCRIBE_URL || init?.method?.toUpperCase() !== 'POST' || !(init.body instanceof FormData)) throw Error('PROGRAM_SPEND_WIRE');
    const file = init.body.get('file'), model = init.body.get('model');
    if (!(file instanceof Blob) || file.size < 1 || file.size > TRANSCRIBE_PRICING.maxAudioBytes || typeof model !== 'string' || !TRANSCRIBE_PRICING.models.includes(model)) throw Error('PROGRAM_SPEND_WIRE');
    return { estimator: 'transcriptions', model, bodyBytes: file.size, maxOutputTokens: TRANSCRIBE_PRICING.maxAudioSeconds, worstCaseMicroUsd: transcribeWorstCase(), pricingSha256: TRANSCRIBE_PRICING_SHA256 };
  },
  actual: () => null,
});
const TRANSCRIPTIONS_SEALED: SealedEstimator = Object.freeze({
  name: 'transcriptions', pricing: TRANSCRIBE_PRICING, pricingSha256: TRANSCRIBE_PRICING_SHA256, models: TRANSCRIBE_PRICING.models, minWorstCaseMicroUsd: transcribeWorstCase(),
  worstCase: (bodyBytes: number, seconds: number) => bodyBytes >= 1 && bodyBytes <= TRANSCRIBE_PRICING.maxAudioBytes && seconds === TRANSCRIBE_PRICING.maxAudioSeconds ? transcribeWorstCase() : null,
  usage: () => null, charge: () => 0, withinBound: () => false,
});

// ---------------------------------------------------------------- OpenRouter Chat Completions (DeepSeek V4.1 Flash, 04/10/2026)
/** DeepSeek through OpenRouter in place of Luna (owner decision 04/10/2026): only the C4 wire as it leaves the cost guard, priced
 * at the highest rates of the model's default route (FREE_USE_DEEPSEEK_PRICING). Same bound as Luna's: (UTF8 bytes + 8192 framing)
 * at the input rate + max_tokens at the output rate; the charge is re-derived from the usage tokens, cached input at the full rate. */
const DS = FREE_USE_DEEPSEEK_PRICING;
const deepseekWorstCase = (bodyBytes: number, maxOutputTokens: number) =>
  Math.ceil((bodyBytes + DS.protocolOverheadTokens) * DS.cacheWriteUsdPerMillion + maxOutputTokens * DS.outputUsdPerMillion);
const chatUsageMicroUsd = (usage: ResponsesUsage) => Math.ceil(usage.input * DS.inputUsdPerMillion + billedOutput(usage) * DS.outputUsdPerMillion);
export const openRouterChatEstimator: PaidEstimator = Object.freeze({
  name: 'openrouter-chat',
  worstCase(input: FetchInput, init?: FetchInit, options: PaidWireOptions = {}): PaidCallEstimate {
    if (options.agent || options.pilot || options.pilotAnchorProbe) throw Error('PROGRAM_SPEND_WIRE');
    if (typeof input !== 'string' || input !== OPENROUTER_CHAT_URL || init?.method?.toUpperCase() !== 'POST' || typeof init.body !== 'string') throw Error('PROGRAM_SPEND_WIRE');
    let payload: unknown; try { payload = JSON.parse(init.body); } catch { throw Error('PROGRAM_SPEND_WIRE'); }
    try { assertOpenRouterOutboundBody(payload, DS.model); } catch { throw Error('PROGRAM_SPEND_WIRE'); }
    const bodyBytes = Buffer.byteLength(init.body, 'utf8'), maxOutputTokens = isRecord(payload) ? payload.max_tokens : undefined;
    if (!Number.isInteger(maxOutputTokens) || (maxOutputTokens as number) < 1 || (maxOutputTokens as number) > DS.outputCap ||
      bodyBytes + DS.protocolOverheadTokens > DS.maxInputTokensUpper) throw Error('PROGRAM_SPEND_WIRE');
    return { estimator: 'openrouter-chat', model: DS.model, bodyBytes, maxOutputTokens: maxOutputTokens as number,
      worstCaseMicroUsd: deepseekWorstCase(bodyBytes, maxOutputTokens as number), pricingSha256: FREE_USE_DEEPSEEK_PRICING_SHA256 };
  },
  actual(json: unknown) {
    const u = isRecord(json) && isRecord(json.usage) ? json.usage : undefined;
    const inDetails: Record<string, unknown> = u && isRecord(u.prompt_tokens_details) ? u.prompt_tokens_details : {};
    const outDetails: Record<string, unknown> = u && isRecord(u.completion_tokens_details) ? u.completion_tokens_details : {};
    const usage = responsesUsage(u && { input: u.prompt_tokens, cached: inDetails.cached_tokens ?? 0, output: u.completion_tokens, reasoning: outDetails.reasoning_tokens ?? 0 });
    return usage ? { usage, chargedMicroUsd: chatUsageMicroUsd(usage) } : null;
  },
});
const OPENROUTER_CHAT_SEALED: SealedEstimator = Object.freeze({
  name: 'openrouter-chat', pricing: DS, pricingSha256: FREE_USE_DEEPSEEK_PRICING_SHA256, models: Object.freeze([DS.model]), minWorstCaseMicroUsd: deepseekWorstCase(1, 1),
  worstCase: (bodyBytes: number, maxOutputTokens: number) => bodyBytes >= 1 && bodyBytes + DS.protocolOverheadTokens <= DS.maxInputTokensUpper &&
    maxOutputTokens >= 1 && maxOutputTokens <= DS.outputCap ? deepseekWorstCase(bodyBytes, maxOutputTokens) : null,
  usage: (value: unknown) => responsesUsage(value),
  charge: (usage: ProgramUsage) => chatUsageMicroUsd(usage as ResponsesUsage),
  withinBound: (reserve: { bodyBytes: number; maxOutputTokens: number }, usage: ProgramUsage) =>
    usage.input <= reserve.bodyBytes + DS.protocolOverheadTokens && billedOutput(usage as ResponsesUsage) <= reserve.maxOutputTokens,
});

// ---------------------------------------------------------------- OpenRouter wallet: settled at the reported cost (04/10/2026)
/** The reservation bound of every OpenRouter chat model of the registry (a model priced above it needs a new sealed version):
 * (UTF8 bytes + 8192 framing) at the input ceiling + max_tokens at the output ceiling. The charge is the cost OpenRouter reports
 * for the call (usage.cost), never above that worst case. */
export const OPENROUTER_RESERVATION_PRICING = Object.freeze({
  source: 'model-registry chat models; OpenRouter catalog of 04/10/2026', checkedAt: '2026-10-04', inputUsdPerMillion: .45, outputUsdPerMillion: 2.40,
  maxInputTokensUpper: 64_000, outputCap: 8192, protocolOverheadTokens: 8192,
  bound: 'UTF8 bytes of the entire text-only JSON request plus 8192 framing tokens at the input ceiling, max_tokens at the output ceiling; settled at the reported cost.',
});
export const OPENROUTER_RESERVATION_PRICING_SHA256 = digest(JSON.stringify(OPENROUTER_RESERVATION_PRICING));
const ORP = OPENROUTER_RESERVATION_PRICING;
const openRouterWorstCase = (bodyBytes: number, maxOutputTokens: number) =>
  Math.ceil((bodyBytes + ORP.protocolOverheadTokens) * ORP.inputUsdPerMillion + maxOutputTokens * ORP.outputUsdPerMillion);
type CostUsage = ResponsesUsage & { costMicroUsd: number };
function costUsage(value: unknown): CostUsage | null {
  if (!isRecord(value) || Object.keys(value).join() !== 'input,cached,output,reasoning,costMicroUsd') return null;
  const { input, cached, output, reasoning, costMicroUsd } = value;
  return count(input) && count(cached) && count(output) && count(reasoning) && count(costMicroUsd) && cached <= input ? { input, cached, output, reasoning, costMicroUsd } : null;
}
/** OpenRouter models of the registry, as their evaluation calls name them. */
const openRouterModels = () => SECRETARY_MODELS.filter(profile => profile.wallet === 'openrouter' && profile.wire === 'chat-completions');
export const openRouterCostEstimator: PaidEstimator = Object.freeze({
  name: 'openrouter-cost',
  worstCase(input: FetchInput, init?: FetchInit, options: PaidWireOptions = {}): PaidCallEstimate {
    if (options.agent || options.pilot || options.pilotAnchorProbe) throw Error('PROGRAM_SPEND_WIRE');
    if (typeof input !== 'string' || init?.method?.toUpperCase() !== 'POST' || typeof init.body !== 'string') throw Error('PROGRAM_SPEND_WIRE');
    let payload: unknown; try { payload = JSON.parse(init.body); } catch { throw Error('PROGRAM_SPEND_WIRE'); }
    const model = isRecord(payload) ? payload.model : undefined, profile = openRouterModels().find(candidate => candidate.id === model);
    if (!profile || input !== profile.endpoint) throw Error('PROGRAM_SPEND_WIRE');
    try { assertChatOutboundBody(payload, profile.id); } catch { throw Error('PROGRAM_SPEND_WIRE'); }
    const bodyBytes = Buffer.byteLength(init.body, 'utf8'), maxOutputTokens = isRecord(payload) ? payload.max_tokens : undefined;
    if (!Number.isInteger(maxOutputTokens) || (maxOutputTokens as number) < 1 || (maxOutputTokens as number) > ORP.outputCap ||
      bodyBytes + ORP.protocolOverheadTokens > ORP.maxInputTokensUpper) throw Error('PROGRAM_SPEND_WIRE');
    return { estimator: 'openrouter-cost', model: profile.id, bodyBytes, maxOutputTokens: maxOutputTokens as number,
      worstCaseMicroUsd: openRouterWorstCase(bodyBytes, maxOutputTokens as number), pricingSha256: OPENROUTER_RESERVATION_PRICING_SHA256 };
  },
  actual(json: unknown) {
    const u = isRecord(json) && isRecord(json.usage) ? json.usage : undefined;
    const inDetails: Record<string, unknown> = u && isRecord(u.prompt_tokens_details) ? u.prompt_tokens_details : {};
    const outDetails: Record<string, unknown> = u && isRecord(u.completion_tokens_details) ? u.completion_tokens_details : {};
    const cost = u ? u.cost : undefined;
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) return null;
    const usage = costUsage(u && { input: u.prompt_tokens, cached: inDetails.cached_tokens ?? 0, output: u.completion_tokens, reasoning: outDetails.reasoning_tokens ?? 0,
      costMicroUsd: Math.ceil(cost * 1e6) });
    return usage ? { usage, chargedMicroUsd: usage.costMicroUsd } : null;
  },
});
const OPENROUTER_COST_SEALED: SealedEstimator = Object.freeze({
  name: 'openrouter-cost', pricing: ORP, pricingSha256: OPENROUTER_RESERVATION_PRICING_SHA256, models: Object.freeze(openRouterModels().map(profile => profile.id)),
  minWorstCaseMicroUsd: openRouterWorstCase(1, 1),
  worstCase: (bodyBytes: number, maxOutputTokens: number) => bodyBytes >= 1 && bodyBytes + ORP.protocolOverheadTokens <= ORP.maxInputTokensUpper &&
    maxOutputTokens >= 1 && maxOutputTokens <= ORP.outputCap ? openRouterWorstCase(bodyBytes, maxOutputTokens) : null,
  usage: (value: unknown) => costUsage(value),
  charge: (usage: ProgramUsage) => (usage as CostUsage).costMicroUsd,
  withinBound: (reserve: { bodyBytes: number; maxOutputTokens: number }, usage: ProgramUsage) =>
    usage.input <= reserve.bodyBytes + ORP.protocolOverheadTokens && billedOutput(usage as ResponsesUsage) <= reserve.maxOutputTokens,
});

/** Sealed allowlist. A name not listed here is refused by guardPaidFetch and by the ledger reader. The transcription
 * estimator (source 'transcribe') is charged at its worst case only; see TRANSCRIBE_PRICING. */
export const PROGRAM_SPEND_ESTIMATORS: Readonly<Record<string, SealedEstimator>> = Object.freeze({ responses: RESPONSES_SEALED, transcriptions: TRANSCRIPTIONS_SEALED,
  'openrouter-chat': OPENROUTER_CHAT_SEALED, 'openrouter-cost': OPENROUTER_COST_SEALED });
const SEALED_FETCH_ESTIMATORS: Readonly<Record<string, PaidEstimator>> = Object.freeze({ responses: responsesEstimator, transcriptions: transcriptionsEstimator,
  'openrouter-chat': openRouterChatEstimator, 'openrouter-cost': openRouterCostEstimator });
const TEST_ESTIMATOR = /^test-[a-z0-9-]{1,34}$/;
/** Sealed spec of an estimator name; 'TEST' for a declared-bound unit-test estimator (vitest worker only, always charged at
 * its worst case, never settled from usage); null = refused. */
export function programSpendEstimator(name: unknown): SealedEstimator | 'TEST' | null {
  if (typeof name !== 'string') return null;
  if (Object.hasOwn(PROGRAM_SPEND_ESTIMATORS, name)) return PROGRAM_SPEND_ESTIMATORS[name];
  return unitTest() && TEST_ESTIMATOR.test(name) ? 'TEST' : null;
}
/** A sealed name must come with its own sealed implementation (no look-alike object), and the ledger's wallet must admit it for a
 * new reservation (a unit-test estimator: any wallet, vitest worker only). */
function fetchEstimator(estimator: PaidEstimator | undefined, wallet?: ProgramSpendWallet) {
  const chosen = estimator ?? responsesEstimator, spec = programSpendEstimator(chosen?.name);
  if (!spec || (spec !== 'TEST' && chosen !== SEALED_FETCH_ESTIMATORS[chosen.name]) || typeof chosen.worstCase !== 'function') throw Error('PROGRAM_SPEND_ESTIMATOR');
  if (wallet && spec !== 'TEST' && !wallet.admits.includes(chosen.name)) throw Error('PROGRAM_SPEND_ESTIMATOR');
  return { estimator: chosen, sealed: spec !== 'TEST' };
}

// ---------------------------------------------------------------- ledger rows and validation
type Reserve = { ledger: string; kind: 'RESERVE'; seq: number; id: string; at: string; source: ProgramSpendSource; run: string; item: string; estimator: string; model: string;
  bodyBytes: number; maxOutputTokens: number; worstCaseMicroUsd: number; pricingSha256: string; capMicroUsd: number; spentBeforeMicroUsd: number; previousHash: string; rowHash: string };
export type SettleOutcome = 'USAGE' | 'NO_USAGE' | 'FAILED';
type Settle = { ledger: string; kind: 'SETTLE'; seq: number; id: string; at: string; outcome: SettleOutcome; httpStatus: number | null; usage: ProgramUsage | null;
  chargedMicroUsd: number; previousHash: string; rowHash: string };
export type ProgramSpendRow = Reserve | Settle;
type CallState = { reserve: Reserve; settle?: Settle; beyondBound?: boolean };
/** `breaches`: settled calls whose usage broke the sealed bound (kept for accounting; every later admission is refused).
 * `cap`: the cap recorded by the last RESERVE (0 before the first one); the chain never records a lower one. */
type LedgerState = { rows: ProgramSpendRow[]; calls: Map<string, CallState>; spent: number; prior: string; breaches: number; cap: number };

function apply(state: LedgerState, value: unknown, wallet: ProgramSpendWallet) {
  const bad = (): never => { throw Error('PROGRAM_SPEND_JOURNAL'); };
  if (!isRecord(value)) bad();
  const row = value as ProgramSpendRow, { rowHash, ...body } = row;
  if (row.ledger !== wallet.ledger || row.seq !== state.rows.length || row.previousHash !== state.prior || typeof rowHash !== 'string' ||
    rowHash !== digest(JSON.stringify(body)) || typeof row.id !== 'string' || !UUID.test(row.id) || typeof row.at !== 'string' || Number.isNaN(Date.parse(row.at))) bad();
  if (row.kind === 'RESERVE') {
    const spec = programSpendEstimator(row.estimator);
    // A wallet holds only its own estimators (a unit-test estimator, vitest worker only, in any).
    if (spec && spec !== 'TEST' && !wallet.estimators.includes(row.estimator)) bad();
    if (Object.keys(row).join() !== RESERVE_KEYS || state.calls.has(row.id) || !(PROGRAM_SPEND_SOURCES as readonly string[]).includes(row.source) ||
      typeof row.run !== 'string' || !LABEL.test(row.run) || typeof row.item !== 'string' || !LABEL.test(row.item) || !spec ||
      typeof row.model !== 'string' || !row.model || row.model.length > 64 || typeof row.pricingSha256 !== 'string' || !row.pricingSha256 || row.pricingSha256.length > 128 ||
      !count(row.bodyBytes) || !count(row.maxOutputTokens) || !count(row.worstCaseMicroUsd) || row.worstCaseMicroUsd < 1 ||
      // The recorded cap: a value of the history, monotonic along the chain, and this row's own admission fits it.
      !wallet.capHistory.some(c => c.microUsd === row.capMicroUsd) || row.capMicroUsd < state.cap ||
      row.spentBeforeMicroUsd !== state.spent || state.breaches > 0 || state.spent + row.worstCaseMicroUsd > row.capMicroUsd) bad();
    // A sealed estimator is re-derived from its own pricing; a unit-test estimator (vitest worker only) declares its bound.
    const sealed = spec === 'TEST' ? null : spec!;
    if (sealed && (row.pricingSha256 !== sealed.pricingSha256 || !sealed.models.includes(row.model) || row.worstCaseMicroUsd < sealed.minWorstCaseMicroUsd ||
      row.worstCaseMicroUsd !== sealed.worstCase(row.bodyBytes, row.maxOutputTokens))) bad();
    state.calls.set(row.id, { reserve: row }); state.spent += row.worstCaseMicroUsd; state.cap = row.capMicroUsd;
  } else if (row.kind === 'SETTLE') {
    const call = state.calls.get(row.id), ok2xx = Number.isInteger(row.httpStatus) && (row.httpStatus as number) >= 200 && (row.httpStatus as number) <= 299;
    if (Object.keys(row).join() !== SETTLE_KEYS || !call || call.settle || !count(row.chargedMicroUsd)) bad();
    const reserve = call!.reserve, spec = programSpendEstimator(reserve.estimator);
    if (row.outcome === 'USAGE') {
      // Only a sealed estimator settles from usage, and the charge is re-derived from its pricing.
      if (!spec || spec === 'TEST' || !ok2xx) bad();
      const sealed = spec as SealedEstimator, usage = sealed.usage(row.usage);
      if (!usage || row.chargedMicroUsd !== sealed.charge(usage)) bad();
      // Beyond the sealed bound: still valid for accounting (the money is spent), but a hard stop from here on.
      if (!sealed.withinBound(reserve, usage!) || row.chargedMicroUsd > reserve.worstCaseMicroUsd) { call!.beyondBound = true; state.breaches++; }
    } else if (row.outcome === 'NO_USAGE' || row.outcome === 'FAILED') {
      const statusOk = row.outcome === 'NO_USAGE' ? ok2xx : row.httpStatus === null || (Number.isInteger(row.httpStatus) && (row.httpStatus as number) >= 100 && (row.httpStatus as number) <= 599 && !ok2xx);
      if (!statusOk || row.usage !== null || row.chargedMicroUsd !== reserve.worstCaseMicroUsd) bad();
    } else bad();
    call!.settle = row; state.spent += row.chargedMicroUsd - reserve.worstCaseMicroUsd;
  } else bad();
  state.rows.push(row); state.prior = rowHash;
}
const samePath = (a: string, b: string) => process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
function ledgerFile(file: string) {
  const wallet = walletOf(file);
  // Outside unit tests each wallet's user-level ledger is the only one: no path can start a fresh (empty) ledger.
  if (!unitTest() && !samePath(file, programSpendLedgerPath(wallet.id))) throw Error('PROGRAM_SPEND_CONFIG');
  return file;
}
/** The real (user-level) ledger of its wallet, not a unit-test copy. */
const realLedger = (file: string) => samePath(file, programSpendLedgerPath(walletOf(file).id));

// ---------------------------------------------------------------- external anchor
type Anchor = { ledger: string; genesisId: string; genesisHash: string; seq: number; rowHash: string };
/** The real ledger's anchor is the tracked file of the checkout running the code (cwd = checkout root, as every
 * launcher); a unit-test ledger keeps its own anchor next to it. */
function anchorFile(file: string) {
  const wallet = walletOf(file);
  if (!realLedger(file)) return join(dirname(file), `${wallet.ledger}.anchor.json`);
  const root = process.cwd();
  if (!existsSync(join(root, 'packages', 'salon-secretary', 'evaluation', 'program-spend.ts'))) throw Error('PROGRAM_SPEND_CONFIG');
  return resolve(root, wallet.anchorFile);
}
function readAnchor(file: string, wallet: ProgramSpendWallet = PROGRAM_SPEND_WALLETS.openai): Anchor | null {
  if (!existsSync(file)) return null;
  let a: unknown; try { a = JSON.parse(readFileSync(file, 'utf8')); } catch { throw Error('PROGRAM_SPEND_JOURNAL'); }
  if (!isRecord(a) || Object.keys(a).join() !== ANCHOR_KEYS || a.ledger !== wallet.ledger || typeof a.genesisId !== 'string' || !UUID.test(a.genesisId) ||
    typeof a.genesisHash !== 'string' || !HASH.test(a.genesisHash) || !count(a.seq) || typeof a.rowHash !== 'string' || !HASH.test(a.rowHash)) throw Error('PROGRAM_SPEND_JOURNAL');
  return a as Anchor;
}
/** A missing ledger, a shorter chain or another genesis than the anchored one is corruption, never "zero spent".
 * `required` (the real ledger): its anchor ships with this file, so a missing anchor fails closed too; otherwise a deleted
 * ledger + anchor would read as a fresh chain admitting a whole new cap. No bootstrap path: the real genesis exists
 * (27/09/2026). A unit-test ledger without an anchor next to it is simply new. */
function checkAnchor(state: LedgerState, anchor: Anchor | null, required: boolean, pinnedGenesis: ProgramSpendWallet['genesis'] = null) {
  // A real ledger whose genesis is pinned in code must start with it (a deleted ledger + anchor never restarts the cap).
  if (pinnedGenesis && (state.rows[0]?.id !== pinnedGenesis.id || state.rows[0]?.rowHash !== pinnedGenesis.hash)) throw Error('PROGRAM_SPEND_JOURNAL');
  if (!anchor) { if (required) throw Error('PROGRAM_SPEND_JOURNAL'); return; }
  const genesis = state.rows[0], pinned = state.rows[anchor.seq];
  if (!genesis || !pinned || genesis.id !== anchor.genesisId || genesis.rowHash !== anchor.genesisHash || pinned.rowHash !== anchor.rowHash) throw Error('PROGRAM_SPEND_JOURNAL');
}
const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
/** Windows: a scanner or a reader may hold the target or the fresh temporary file for longer than a few tens of ms
 * (29/09: a sealed run aborted on a 200 ms budget). Transient sharing errors are retried with backoff for ~6 s. */
export const RENAME_RETRY_ATTEMPTS = 30;
export const renameRetryPause = (attempt: number) => Math.min(25 * attempt, 250);
/** Moves the anchor forward to the last row (never backwards); fsynced temporary file + rename. The anchor is a floor:
 * it pins an earlier row so a deleted or truncated ledger never reads as "zero spent"; the cap itself is enforced by
 * the rows, which are already appended and fsynced when this runs. So a move that still cannot land after the retries is
 * DEFERRED to the next append (code on stderr), never turned into a failure of the admission or charge that reached the
 * ledger. `rename` is injectable for tests. */
function advanceAnchor(file: string, state: LedgerState, rename: (from: string, to: string) => void = renameSync) {
  const last = state.rows.at(-1);
  if (!last) return;
  const wallet = walletOf(file), target = anchorFile(file), current = readAnchor(target, wallet);
  if (current && current.seq >= last.seq) return;
  const anchor: Anchor = { ledger: wallet.ledger, genesisId: state.rows[0].id, genesisHash: state.rows[0].rowHash, seq: last.seq, rowHash: last.rowHash };
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    const fd = openSync(tmp, 'w', 0o644);
    try { writeSync(fd, JSON.stringify(anchor, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
    for (let attempt = 1; ; attempt++) {
      try { rename(tmp, target); break; }
      catch (error) { if (attempt >= RENAME_RETRY_ATTEMPTS || !['EPERM', 'EACCES', 'EBUSY'].includes(String((error as NodeJS.ErrnoException).code))) throw error; pause(renameRetryPause(attempt)); }
    }
  } catch {
    try { unlinkSync(tmp); } catch { /* already gone */ }
    process.stderr.write('PROGRAM_SPEND_ANCHOR_DEFERRED\n');
  }
}
/** Test seam (unit ledgers only): the anchor move with an injected rename. */
export function advanceProgramAnchorForTest(file: string, rename: (from: string, to: string) => void) {
  if (!unitTest()) throw Error('PROGRAM_SPEND_TEST_ONLY');
  advanceAnchor(file, replay(file), rename);
}

function replay(file: string): LedgerState {
  const state: LedgerState = { rows: [], calls: new Map(), spent: 0, prior: 'GENESIS', breaches: 0, cap: 0 }, wallet = walletOf(file);
  if (existsSync(ledgerFile(file))) {
    const text = readFileSync(file, 'utf8');
    if (text && !text.endsWith('\n')) throw Error('PROGRAM_SPEND_JOURNAL');
    for (const line of text ? text.slice(0, -1).split('\n') : []) {
      let value: unknown; try { value = JSON.parse(line); } catch { throw Error('PROGRAM_SPEND_JOURNAL'); }
      apply(state, value, wallet);
    }
  }
  // The real ledger's anchor ships with this file: required once the chain exists or its genesis is pinned (a wallet created after
  // 04/10/2026 starts its chain with the first admitted call, then the anchor and the genesis are recorded).
  const real = realLedger(file), anchor = readAnchor(anchorFile(file), wallet);
  checkAnchor(state, anchor, real && (wallet.genesis !== null || state.rows.length > 0), real ? wallet.genesis : null);
  return state;
}
/** Validates the whole chain and its anchor (read-only); throws PROGRAM_SPEND_JOURNAL on any corruption, gap, foreign row,
 * missing or truncated ledger. */
export const readProgramLedger = (file: string) => replay(file).rows;

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
/** Exclusive cross-process lock (O_EXCL lock file), bounded wait. All admission reads, every append and every anchor move happen inside. */
async function withLock<T>(file: string, work: (state: LedgerState) => T): Promise<T> {
  ledgerFile(file);
  // Fail closed: a unit test (the variable OR a vitest worker, even with VITEST unset) can never charge (nor lock) a real ledger.
  if ((process.env.VITEST || vitestWorker()) && realLedger(file)) throw Error('PROGRAM_SPEND_TEST_LEDGER');
  try { mkdirSync(dirname(file), { recursive: true }); } catch { throw Error('PROGRAM_SPEND_LEDGER_IO'); }
  const lock = file + '.lock', deadline = Date.now() + LOCK_WAIT_MS;
  let fd: number | undefined;
  for (let delay = 5; fd === undefined; delay = Math.min(delay * 2, 50)) {
    try { fd = openSync(lock, 'wx', 0o600); }
    catch (error) {
      if (!['EEXIST', 'EPERM', 'EACCES', 'EBUSY'].includes(String((error as NodeJS.ErrnoException).code))) throw Error('PROGRAM_SPEND_LEDGER_IO');
      if (Date.now() >= deadline) throw Error('PROGRAM_SPEND_LOCKED');
      await sleep(delay);
    }
  }
  let outcome: { value: T } | { error: unknown };
  try { const state = replay(file), value = work(state); advanceAnchor(file, state); outcome = { value }; } catch (error) { outcome = { error }; }
  // An unreleasable lock blocks every later admission (fail closed) and fails this call too.
  try { closeSync(fd!); unlinkSync(lock); } catch { throw Error('PROGRAM_SPEND_LOCKED'); }
  if ('error' in outcome) throw isProgramSpendError(outcome.error) ? outcome.error : Error('PROGRAM_SPEND_LEDGER_IO');
  return outcome.value;
}
function append(file: string, state: LedgerState, body: Omit<Reserve, 'rowHash'> | Omit<Settle, 'rowHash'>) {
  const row = { ...body, rowHash: digest(JSON.stringify(body)) };
  apply(state, JSON.parse(JSON.stringify(row)), walletOf(file)); // the row must pass the same validation as a later read
  const fd = openSync(file, 'a', 0o600);
  try { writeSync(fd, JSON.stringify(row) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  return row;
}
/** Hard stop first (a call beyond the sealed bound refuses everything after it), then the cap. */
function admit(state: LedgerState, worstCase: number, wallet: ProgramSpendWallet = PROGRAM_SPEND_WALLETS.openai) {
  if (state.breaches > 0) throw Error('PROGRAM_SPEND_BOUND');
  if (state.spent + worstCase > walletCap(wallet)) throw Error('PROGRAM_SPEND_CAP');
}

// ---------------------------------------------------------------- proof lease (one paid executor while a proof runs)
/** A sealed or validation run holds `<ledger>.proof.lease` from before its look until it ends. While it exists only its holder
 * (this process, the same lease) is admitted: every other paid call (any stage, the Golden/free-use runner, transcription) is
 * refused under the ledger lock before its reservation: PROGRAM_SPEND_PROOF_BUSY, or PROGRAM_SPEND_PROOF_STALE when the holder
 * is provably gone (never taken over: the operator releases it, scripts/agenda-stage-release.cjs --proof <id>). Settlements of
 * calls reserved earlier are never refused. Created exclusively, never rewritten. */
export type ProofLease = { v: 1; id: string; run: string; pid: number; host: string; startedAt: string };
export const proofLeasePath = (ledger: string) => ledger + '.proof.lease';
const PROOF_KEYS = ['v', 'id', 'run', 'pid', 'host', 'startedAt'], PROOF_WRITE_GRACE_MS = 10_000;
const errno = (error: unknown) => String((error as NodeJS.ErrnoException | undefined)?.code ?? '');
function parseProofLease(text: string): ProofLease | null {
  let x: unknown; try { x = JSON.parse(text); } catch { return null; }
  return isRecord(x) && Object.keys(x).join() === PROOF_KEYS.join() && x.v === 1 && typeof x.id === 'string' && UUID.test(x.id) && typeof x.run === 'string' && LABEL.test(x.run) &&
    Number.isSafeInteger(x.pid) && (x.pid as number) > 0 && typeof x.host === 'string' && !!x.host && typeof x.startedAt === 'string' && !Number.isNaN(Date.parse(x.startedAt))
    ? x as ProofLease : null;
}
/** true = alive (or not ours to signal), false = gone, null = another host (never provable). */
function holderAlive(pid: number, host: string): boolean | null {
  if (host !== hostname()) return null;
  try { process.kill(pid, 0); return true; } catch (error) { return errno(error) === 'EPERM'; }
}
export type ProofLeaseState = { state: 'FREE' } | { state: 'HELD' | 'STALE'; lease: ProofLease | null; alive: boolean | null; ageMs: number };
/** FREE; HELD (a live holder, another host, a file still being written); STALE only when provably gone or unreadable for long. */
export function inspectProofLease(ledger: string): ProofLeaseState {
  const path = proofLeasePath(ledgerFile(ledger)); let text: string, mtime: number;
  try { text = readFileSync(path, 'utf8'); mtime = statSync(path).mtimeMs; }
  catch (error) { if (errno(error) === 'ENOENT') return { state: 'FREE' }; throw Error('PROGRAM_SPEND_PROOF_BUSY'); }
  const lease = parseProofLease(text), ageMs = Math.max(0, Date.now() - mtime);
  if (!lease) return { state: ageMs < PROOF_WRITE_GRACE_MS ? 'HELD' : 'STALE', lease: null, alive: null, ageMs };
  const alive = holderAlive(lease.pid, lease.host);
  return { state: alive === false ? 'STALE' : 'HELD', lease, alive, ageMs };
}
const proofDetails = (s: Exclude<ProofLeaseState, { state: 'FREE' }>) => ({ state: s.state, id: s.lease?.id ?? null, run: s.lease?.run ?? null, pid: s.lease?.pid ?? null,
  host: s.lease?.host ?? null, alive: s.alive, ageMs: s.ageMs });
const proofRefusal = (s: Exclude<ProofLeaseState, { state: 'FREE' }>) =>
  Object.assign(Error(s.state === 'STALE' ? 'PROGRAM_SPEND_PROOF_STALE' : 'PROGRAM_SPEND_PROOF_BUSY'), { details: proofDetails(s) });
const sameProof = (a: ProofLease | null, b: ProofLease) => !!a && PROOF_KEYS.every(k => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k]);
/** Any proof lease on disk refuses a caller that is not its holder (this process, same lease); none admits everyone. A proof on
 * one real ledger holds every wallet: one paid executor at a time, whoever pays. */
export function assertProofAdmits(ledger: string, holder?: ProofLease) {
  const ledgers = realLedger(ledger) ? WALLET_LIST.map(wallet => programSpendLedgerPath(wallet.id)) : [ledger];
  for (const file of ledgers) {
    const s = inspectProofLease(file);
    if (s.state === 'FREE') continue;
    if (!holder || holder.pid !== process.pid || holder.host !== hostname() || !sameProof(s.lease, holder)) throw proofRefusal(s);
  }
}
/** Taken before a sealed/validation look (a unit test never takes one on the real ledger). A lease on disk is BUSY or STALE. */
export function acquireProofLease(ledger: string, run: string): ProofLease {
  const file = ledgerFile(ledger);
  if ((process.env.VITEST || vitestWorker()) && realLedger(file)) throw Error('PROGRAM_SPEND_TEST_LEDGER');
  try { mkdirSync(dirname(file), { recursive: true }); } catch { throw Error('PROGRAM_SPEND_LEDGER_IO'); }
  const lease: ProofLease = { v: 1, id: randomUUID(), run: programSpendLabel(run), pid: process.pid, host: hostname(), startedAt: new Date().toISOString() };
  let fd: number;
  try { fd = openSync(proofLeasePath(file), 'wx', 0o600); }
  catch (error) {
    if (!['EEXIST', 'EPERM', 'EACCES', 'EBUSY'].includes(errno(error))) throw Error('PROGRAM_SPEND_LEDGER_IO');
    const s = inspectProofLease(file); throw s.state === 'FREE' ? Error('PROGRAM_SPEND_PROOF_BUSY') : proofRefusal(s);
  }
  try { writeSync(fd, JSON.stringify(lease)); fsyncSync(fd); } finally { closeSync(fd); }
  return lease;
}
/** The holder's own release (end of the run); another lease is never removed here. */
export function releaseProofLease(lease: ProofLease, ledger: string) {
  const path = proofLeasePath(ledgerFile(ledger)); let text: string;
  try { text = readFileSync(path, 'utf8'); } catch (error) { if (errno(error) === 'ENOENT') return; throw Error('PROGRAM_SPEND_LEDGER_IO'); }
  if (!sameProof(parseProofLease(text), lease)) throw Error('PROGRAM_SPEND_PROOF_BUSY');
  for (let attempt = 1; ; attempt++) {
    try { unlinkSync(path); return; }
    catch (error) { if (errno(error) === 'ENOENT') return; if (attempt >= RENAME_RETRY_ATTEMPTS || !['EPERM', 'EACCES', 'EBUSY'].includes(errno(error))) throw Error('PROGRAM_SPEND_LEDGER_IO'); pause(renameRetryPause(attempt)); }
  }
}
/** Operator release of a proof lease left behind: `id` is the one the refusal showed ('INVALID' for an unreadable file); a holder
 * that may be alive (live pid, another host, a file being written) needs `force` (the operator checked no run uses it). */
export function operatorReleaseProofLease(ledger: string, input: { id: string; force?: boolean }) {
  const s = inspectProofLease(ledger);
  if (s.state === 'FREE') throw Error('PROGRAM_SPEND_PROOF_FREE');
  if ((s.lease?.id ?? 'INVALID') !== input.id) throw Object.assign(Error('PROGRAM_SPEND_PROOF_ID_MISMATCH'), { details: proofDetails(s) });
  if (s.state !== 'STALE' && !input.force) throw proofRefusal(s);
  unlinkSync(proofLeasePath(ledgerFile(ledger)));
  return { released: 'proof' as const, ...proofDetails(s) };
}

// ---------------------------------------------------------------- admission, settlement, fetch guard
/** Read-only admission check under the lock (no row): used before a runner's own reservation so a refused call
 * consumes neither that journal nor transport. */
export async function assertProgramHeadroom(input: FetchInput, init: FetchInit, options: { ledger?: string; estimator?: PaidEstimator; proof?: ProofLease; agent?: boolean; pilot?: boolean;
  pilotAnchorProbe?: boolean } = {}) {
  const ledger = ledgerFile(options.ledger ?? programSpendLedgerPath()), wallet = walletOf(ledger);
  const estimate = fetchEstimator(options.estimator, wallet).estimator.worstCase(input, init, { agent: options.agent === true, pilot: options.pilot === true, ...probeOption(options) });
  return withLock(ledger, state => {
    assertProofAdmits(ledger, options.proof);
    admit(state, estimate.worstCaseMicroUsd, wallet);
    return { spentMicroUsd: state.spent, worstCaseMicroUsd: estimate.worstCaseMicroUsd, remainingMicroUsd: walletCap(wallet) - state.spent };
  });
}
/** Review H2: a run's own dollar ceiling, checked before each of its paid calls (inside the run, not after it): what the run charged in the program
 * ledger since `baselineMicroUsd` (open calls counted at their worst case) plus this call's worst case. True when the call would pass `capMicroUsd`
 * (the runner then stops: the run is ABORTED, never half graded). Read only. */
export function runSpendCapReached(input: FetchInput, init: FetchInit, options: { ledger: string; run: string; capMicroUsd: number; baselineMicroUsd?: number;
  estimator?: PaidEstimator; agent?: boolean; pilot?: boolean; pilotAnchorProbe?: boolean }): boolean {
  const worst = fetchEstimator(options.estimator, walletOf(options.ledger)).estimator.worstCase(input, init, { agent: options.agent === true, pilot: options.pilot === true, ...probeOption(options) }).worstCaseMicroUsd;
  const spent = (programSpendTotals(options.ledger).byRun[options.run]?.spentMicroUsd ?? 0) - (options.baselineMicroUsd ?? 0);
  return spent + worst > options.capMicroUsd;
}
export type ProgramReservation = { id: string; source: ProgramSpendSource; run: string; item: string; worstCaseMicroUsd: number; spentBeforeMicroUsd: number };
/** Durable worst-case charge BEFORE transport: throws PROGRAM_SPEND_CAP when ledger total + worst case exceeds the cap
 * (PROGRAM_SPEND_BOUND after any call beyond the sealed bound). */
export async function reserveProgramSpend(ledger: string, source: ProgramSpendSource, run: string, item: string, estimate: PaidCallEstimate,
  options: { proof?: ProofLease } = {}): Promise<ProgramReservation> {
  if (!(PROGRAM_SPEND_SOURCES as readonly string[]).includes(source)) throw Error('PROGRAM_SPEND_SOURCE');
  if (!LABEL.test(run) || !LABEL.test(item)) throw Error('PROGRAM_SPEND_LABEL');
  const wallet = walletOf(ledger), spec = programSpendEstimator(estimate?.estimator);
  if (!spec || (spec !== 'TEST' && !wallet.admits.includes(estimate.estimator))) throw Error('PROGRAM_SPEND_ESTIMATOR');
  return withLock(ledger, state => {
    assertProofAdmits(ledger, options.proof); // a proof in progress admits only its own run
    const spentBefore = state.spent;
    admit(state, estimate.worstCaseMicroUsd, wallet);
    const row = append(ledger, state, { ledger: wallet.ledger, kind: 'RESERVE', seq: state.rows.length, id: randomUUID(), at: new Date().toISOString(), source, run, item,
      estimator: estimate.estimator, model: estimate.model, bodyBytes: estimate.bodyBytes, maxOutputTokens: estimate.maxOutputTokens, worstCaseMicroUsd: estimate.worstCaseMicroUsd,
      pricingSha256: estimate.pricingSha256, capMicroUsd: walletCap(wallet), spentBeforeMicroUsd: spentBefore, previousHash: state.prior });
    return { id: row.id, source, run, item, worstCaseMicroUsd: estimate.worstCaseMicroUsd, spentBeforeMicroUsd: spentBefore };
  });
}
/** AFTER the response: actual usage cost, or the full worst case when the call failed or usage is missing. A usage beyond
 * the sealed bound is recorded as spent (accounting) and reported as `beyondBound` (the caller must stop). */
export async function settleProgramSpend(ledger: string, reservation: Pick<ProgramReservation, 'id'>,
  result: { outcome: 'USAGE'; httpStatus: number; usage: ProgramUsage; chargedMicroUsd: number } | { outcome: 'NO_USAGE' | 'FAILED'; httpStatus: number | null }) {
  return withLock(ledger, state => {
    const call = state.calls.get(reservation.id);
    if (!call || call.settle) throw Error('PROGRAM_SPEND_SETTLE');
    const charged = result.outcome === 'USAGE' ? result.chargedMicroUsd : call.reserve.worstCaseMicroUsd;
    append(ledger, state, { ledger: walletOf(ledger).ledger, kind: 'SETTLE', seq: state.rows.length, id: reservation.id, at: new Date().toISOString(), outcome: result.outcome,
      httpStatus: result.httpStatus, usage: result.outcome === 'USAGE' ? result.usage : null, chargedMicroUsd: charged, previousHash: state.prior });
    return { id: reservation.id, outcome: result.outcome, chargedMicroUsd: charged, spentMicroUsd: state.spent, beyondBound: !!call.beyondBound };
  });
}
export type PaidFetchOptions = { run: string; item?: string; ledger?: string; estimator?: PaidEstimator; /** the proof lease this run holds, if any */ proof?: ProofLease;
  /** C5: the run sends the agent's wire (SALON_SECRETARY_AGENT), read by the runner and passed here explicitly */ agent?: boolean;
  /** Reschedule pilot: the run sends the pilot's wire (SALON_SECRETARY_PILOT_RESCHEDULE), read by the runner and passed here explicitly */ pilot?: boolean;
  /** A* premise probe: the probe harness sends its own wire (pilot-astar-contract.ts) and says so here */ pilotAnchorProbe?: boolean };
/** Generic guard for any paid evaluation fetch (practice, golden, transcribe): reserve worst case under the program
 * cap before transport, settle actual usage after. PROGRAM_SPEND_* errors mean "stop the run" (PROGRAM_SPEND_BOUND:
 * the provider charged beyond the sealed bound, the response is withheld); a transport error is rethrown unchanged
 * after being charged at the worst case. */
export function guardPaidFetch(source: ProgramSpendSource, fetchFn: typeof fetch, options: PaidFetchOptions): typeof fetch {
  if (!(PROGRAM_SPEND_SOURCES as readonly string[]).includes(source)) throw Error('PROGRAM_SPEND_SOURCE');
  const ledger = ledgerFile(options.ledger ?? programSpendLedgerPath()), { estimator, sealed } = fetchEstimator(options.estimator, walletOf(ledger));
  const run = options.run, item = options.item ?? 'call';
  if (typeof run !== 'string' || !LABEL.test(run) || !LABEL.test(item)) throw Error('PROGRAM_SPEND_LABEL');
  return async (input, init) => {
    let estimate: PaidCallEstimate;
    try { estimate = estimator.worstCase(input, init, { agent: options.agent === true, pilot: options.pilot === true, ...probeOption(options) }); } catch (error) { throw isProgramSpendError(error) ? error : Error('PROGRAM_SPEND_WIRE'); }
    if (estimate?.estimator !== estimator.name) throw Error('PROGRAM_SPEND_ESTIMATOR');
    const reservation = await reserveProgramSpend(ledger, source, run, item, estimate, { proof: options.proof });
    let response: Response;
    try { response = await fetchFn(input, init); }
    catch (error) { await settleProgramSpend(ledger, reservation, { outcome: 'FAILED', httpStatus: null }); throw error; }
    const status = Number.isInteger(response?.status) ? response.status : null;
    if (!response?.ok || status === null) { await settleProgramSpend(ledger, reservation, { outcome: 'FAILED', httpStatus: status !== null && status >= 200 && status <= 299 ? null : status }); return response; }
    let actual: ReturnType<PaidEstimator['actual']> = null;
    // A unit-test estimator is always charged at its declared worst case.
    if (sealed) try { actual = estimator.actual(await response.clone().json()); } catch { actual = null; }
    const settled = await settleProgramSpend(ledger, reservation, actual ? { outcome: 'USAGE', httpStatus: status, usage: actual.usage, chargedMicroUsd: actual.chargedMicroUsd } : { outcome: 'NO_USAGE', httpStatus: status });
    if (settled.beyondBound) throw Error('PROGRAM_SPEND_BOUND');
    return response;
  };
}
/** Report CLI: moves the anchor of this checkout to the ledger's last row (under the lock; no row is written). */
export async function advanceProgramAnchor(file: string = programSpendLedgerPath()) {
  if (!existsSync(file) && walletOf(file).genesis === null) return { rows: 0 };
  return withLock(file, state => ({ rows: state.rows.length }));
}

// ---------------------------------------------------------------- report
type Totals = { calls: number; spentMicroUsd: number; spentUsd: number; open: number; worstCaseCharged: number; beyondBound: number };
const usd = (micro: number) => micro / 1e6;
export type ProgramHardStop = 'PROGRAM_SPEND_BOUND' | 'PROGRAM_SPEND_CAP' | null;
/** Read-only totals: settled calls at their charge, open reservations (in flight or crashed) at the worst case.
 * `hardStop`: a call beyond the sealed bound, or spending above the cap (only possible through such a call). */
export function programSpendTotals(file: string) {
  const state = replay(file), calls = [...state.calls.values()];
  const totals = (list: typeof calls): Totals => {
    const spent = list.reduce((n, c) => n + (c.settle ? c.settle.chargedMicroUsd : c.reserve.worstCaseMicroUsd), 0);
    return { calls: list.length, spentMicroUsd: spent, spentUsd: usd(spent), open: list.filter(c => !c.settle).length,
      worstCaseCharged: list.filter(c => c.settle && c.settle.outcome !== 'USAGE').length, beyondBound: list.filter(c => c.beyondBound).length };
  };
  const wallet = walletOf(file), cap = walletCap(wallet);
  const runs = [...new Set(calls.map(c => c.reserve.run))], overCap = state.spent > cap;
  const hardStop: ProgramHardStop = state.breaches > 0 ? 'PROGRAM_SPEND_BOUND' : overCap ? 'PROGRAM_SPEND_CAP' : null;
  return { ledger: wallet.ledger, wallet: wallet.id, file: `~/${PROGRAM_SPEND_DIR}/${wallet.basename}`, capMicroUsd: cap, capUsd: usd(cap), capHistory: wallet.capHistory,
    remainingMicroUsd: cap - state.spent, remainingUsd: usd(cap - state.spent),
    hardStop, overCap, boundBreaches: state.breaches, ...totals(calls), rows: state.rows.length,
    bySource: Object.fromEntries(PROGRAM_SPEND_SOURCES.map(source => [source, totals(calls.filter(c => c.reserve.source === source))])) as Record<ProgramSpendSource, Totals>,
    byRun: Object.fromEntries(runs.map(run => { const list = calls.filter(c => c.reserve.run === run); return [run, { source: list[0].reserve.source, ...totals(list) }]; })) as Record<string, Totals & { source: ProgramSpendSource }> };
}
export type ProgramSpendTotals = ReturnType<typeof programSpendTotals>;
export const programSpendSummary = (t: ProgramSpendTotals, run?: string) => ({ ledger: t.ledger, capUsd: t.capUsd, spentUsd: t.spentUsd, remainingUsd: t.remainingUsd,
  calls: t.calls, open: t.open, hardStop: t.hardStop, ...(run !== undefined ? { run, thisRun: t.byRun[run] ?? null } : {}) });
export function formatProgramSpend(t: ProgramSpendTotals) {
  const money = (micro: number) => `US$ ${usd(micro).toFixed(6)}`, line = (name: string, x: Totals) =>
    `  ${name.padEnd(28)} ${money(x.spentMicroUsd)}  ${x.calls} chamada(s)${x.open ? `, ${x.open} em aberto (pior caso)` : ''}${x.worstCaseCharged ? `, ${x.worstCaseCharged} cobrada(s) no pior caso` : ''}${x.beyondBound ? `, ${x.beyondBound} acima do limite selado` : ''}`;
  const stop = t.hardStop === 'PROGRAM_SPEND_BOUND' ? [`PARADA OBRIGATÓRIA (PROGRAM_SPEND_BOUND): ${t.boundBreaches} chamada(s) custaram acima do pior caso selado${t.overCap ? ' e o gasto passou do teto' : ''}; nenhuma nova chamada paga é admitida.`]
    : t.hardStop === 'PROGRAM_SPEND_CAP' ? ['PARADA OBRIGATÓRIA (PROGRAM_SPEND_CAP): o gasto passou do teto; nenhuma nova chamada paga é admitida.'] : [];
  return [
    ...stop,
    `Gasto real do programa (${t.ledger}): ${money(t.spentMicroUsd)} de ${money(t.capMicroUsd)} | restante ${money(t.remainingMicroUsd)}`,
    `Histórico do teto: ${t.capHistory.map(c => `${money(c.microUsd)} em ${c.approved} (${c.note})`).join('; ')}`,
    `Chamadas: ${t.calls} (em aberto ${t.open}, cobradas no pior caso ${t.worstCaseCharged}); linhas ${t.rows}; cadeia de hash e âncora válidas`,
    'Por origem:', ...PROGRAM_SPEND_SOURCES.map(source => line(source, t.bySource[source])),
    'Por execução:', ...(Object.keys(t.byRun).length ? Object.entries(t.byRun).map(([run, x]) => line(`${run} [${x.source}]`, x)) : ['  (nenhuma)']),
  ].join('\n');
}
