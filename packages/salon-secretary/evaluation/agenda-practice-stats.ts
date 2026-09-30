/** Statistics of the Agenda practice pass^k report (evaluation only, offline, deterministic):
 * - scenario-clustered bootstrap intervals (scenarios are resampled, their attempts stay together; fixed seed) with
 *   Hesterberg's EXPANDED percentile: the plain percentile bootstrap is as narrow as the CLT interval and under-covers
 *   below ~30 scenarios (77% at n=5), so its tails get the small-sample width of a t interval;
 * - Wilson intervals on the scenario-level majority pass;
 * - paired A/B differences on the SAME scenario ids (their recorded definitions must match), with a McNemar count and an
 *   exact sign test the verdict must agree with; a zero-width interval never concludes; a non-inferiority verdict against
 *   a pre-declared margin;
 * - the dev → held generalization gap (OVERFIT_SIGNAL), with a CONFOUNDED warning when the arms differ in flags,
 *   examples, request version, K or noise;
 * - the memorisation check of a held run: similarity tertiles, a Spearman permutation test and sentence-frame counts
 *   (names, digits, spoken numbers and weekday words masked before a token Jaccard).
 * Output is ids, buckets and counts only: never the text of a scenario. No network, no model call; the corpus
 * loaders only read repository files. Imports types only from the lib (the lib imports this module). */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgendaScenario } from './agenda-practice-lib';
import { bankExample } from '../src/examples/bank';
import { exampleFillNames, exampleFills, fillExample, CANONICAL_FILL_SEED, PLACEHOLDER } from '../src/examples/fill';

export const STATS = { resamples: 2000, seed: 'agenda-practice-stats-v1', level: 0.95, minConclusive: 5, overfitMargin: 0.05, nonInferiorityMargin: 0.05, alpha: 0.05,
  permutations: 2000, frameMinTokens: 5, ngram: 5 } as const;
const Z95 = 1.959963984540054;

// ---------------------------------------------------------------- deterministic resampling
function hash32(value: string) {
  let h = 0x811c9dc5;
  for (const byte of Buffer.from(value, 'utf8')) { h ^= byte; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** One independent stream per statistic label: an interval never depends on the order of the calls. */
export const statsRandom = (label: string, seed: string = STATS.seed) => mulberry32(hash32(`${seed}|${label}`));
export type BootstrapOptions = { resamples?: number; seed?: string; permutations?: number };
export type Interval = { n: number; estimate: number | null; lower: number | null; upper: number | null; se: number | null };
export type Proportion = { x: number; n: number; estimate: number | null; lower: number | null; upper: number | null };
const r6 = (v: number) => { const x = Math.round(v * 1e6) / 1e6; return x === 0 ? 0 : x; };
const mean = (xs: ArrayLike<number>) => { let s = 0; for (let i = 0; i < xs.length; i++) s += xs[i]; return s / xs.length; };
const EMPTY: Interval = { n: 0, estimate: null, lower: null, upper: null, se: null };
/** Linear interpolation between order statistics (type 7). */
export function quantile(sorted: ArrayLike<number>, q: number) {
  if (!sorted.length) return NaN;
  const h = (sorted.length - 1) * q, lo = Math.floor(h), hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}
function resamplesOf(opts: BootstrapOptions) {
  const b = opts.resamples ?? STATS.resamples;
  if (!Number.isSafeInteger(b) || b < 2) throw Error('AGENDA_STATS_RESAMPLES');
  return b;
}
/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf, |error| < 1.5e-7). */
export function normalCdf(x: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}
const T975_SMALL = [NaN, 12.706205, 4.302653, 3.182446];
/** Student t quantile t(0.975, df): exact for df ≤ 3, Cornish–Fisher expansion (A&S 26.7.5; error < 1e-3) above. */
export function t975(df: number) {
  if (!Number.isSafeInteger(df) || df < 1) throw Error('AGENDA_STATS_DF');
  if (df < 4) return T975_SMALL[df];
  const z = Z95, z2 = z * z;
  const g = [(z2 + 1) * z / 4, ((5 * z2 + 16) * z2 + 3) * z / 96, (((3 * z2 + 19) * z2 + 17) * z2 - 15) * z / 384, ((((79 * z2 + 776) * z2 + 1482) * z2 - 1920) * z2 - 945) * z / 92160];
  return g.reduce((t, gi, i) => t + gi / df ** (i + 1), z);
}
/** Tail of Hesterberg's expanded percentile interval (2015): Φ(−√(n/(n−1))·t(0.975, n−1)) replaces 0.025, so the
 * bootstrap percentiles get the small-sample width of a t interval (n=5 → 0.001, n=10 → 0.009, n=30 → 0.019, n→∞ → 0.025). */
export const expandedTail = (n: number) => normalCdf(-Math.sqrt(n / (n - 1)) * t975(n - 1));
function summarizeDraws(draws: Float64Array, estimate: number, n: number): Interval {
  draws.sort();
  const m = mean(draws), tail = expandedTail(n); let v = 0;
  for (const d of draws) v += (d - m) ** 2;
  return { n, estimate: r6(estimate), lower: r6(quantile(draws, tail)), upper: r6(quantile(draws, 1 - tail)), se: r6(Math.sqrt(v / (draws.length - 1))) };
}
/** Expanded-percentile bootstrap of a mean over clusters: `values` holds one number per scenario (its pass rate, its
 * pass^k or a paired difference), so resampling scenarios keeps each scenario's attempts together. One scenario has no interval. */
export function bootstrapMean(values: readonly number[], label: string, opts: BootstrapOptions = {}): Interval {
  const n = values.length, B = resamplesOf(opts);
  if (n < 2) return n ? { ...EMPTY, n, estimate: r6(values[0]) } : { ...EMPTY };
  const random = statsRandom(label, opts.seed), draws = new Float64Array(B);
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < n; i++) s += values[Math.floor(random() * n)]; draws[b] = s / n; }
  return summarizeDraws(draws, mean(values), n);
}
/** mean(a) − mean(b) for two independent groups of scenarios, each resampled on its own; the expansion uses the smaller
 * group (no interval under 2 per group). */
export function bootstrapMeanDiff(a: readonly number[], b: readonly number[], label: string, opts: BootstrapOptions = {}): Interval & { nA: number; nB: number } {
  const B = resamplesOf(opts);
  if (a.length < 2 || b.length < 2) return { ...EMPTY, n: Math.min(a.length, b.length), estimate: a.length && b.length ? r6(mean(a) - mean(b)) : null, nA: a.length, nB: b.length };
  const random = statsRandom(label, opts.seed), draws = new Float64Array(B);
  for (let k = 0; k < B; k++) {
    let x = 0, y = 0;
    for (let i = 0; i < a.length; i++) x += a[Math.floor(random() * a.length)];
    for (let i = 0; i < b.length; i++) y += b[Math.floor(random() * b.length)];
    draws[k] = x / a.length - y / b.length;
  }
  return { ...summarizeDraws(draws, mean(a) - mean(b), Math.min(a.length, b.length)), nA: a.length, nB: b.length };
}
/** Wilson score interval (95%) of x successes in n. */
export function wilson(x: number, n: number, z = Z95): Proportion {
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(n) || x < 0 || x > n) throw Error('AGENDA_STATS_PROPORTION');
  if (!n) return { x, n, estimate: null, lower: null, upper: null };
  const p = x / n, z2 = z * z, d = 1 + z2 / n, center = (p + z2 / (2 * n)) / d, half = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / d;
  return { x, n, estimate: r6(p), lower: x === 0 ? 0 : r6(Math.max(0, center - half)), upper: x === n ? 1 : r6(Math.min(1, center + half)) };
}
/** Exact two-sided binomial test of b against c (X ~ Bin(b+c, ½)): p = min(1, 2·P[X ≤ min(b, c)]). On the discordant
 * pairs it is the McNemar exact test; on the scenarios better/worse (ties dropped) it is the exact sign test. */
export function mcnemarExact(b: number, c: number) {
  const m = b + c; if (!m) return 1;
  let pmf = 0.5 ** m, tail = 0;
  for (let i = 0; i <= Math.min(b, c); i++) { tail += pmf; pmf = pmf * (m - i) / (i + 1); }
  return r6(Math.min(1, 2 * tail));
}
export const signTest = mcnemarExact;

// ---------------------------------------------------------------- per run
/** One graded scenario of a run: `c` passed attempts of `n` (missing/incomplete attempts already count as failures);
 * `definition` = sha256 of the scenario definition the run recorded (null/absent: not recorded, not verifiable);
 * `noise` = the --noise profile of its run. */
export type ScenarioOutcome = { id: string; capability: string[]; c: number; n: number; definition?: string | null; noise?: string };
export type RunRow = ScenarioOutcome & { passK: Record<number, number | null> };
export const passRate = (s: ScenarioOutcome) => s.n > 0 ? s.c / s.n : 0;
/** Scenario-level outcome: passed in more than half of its attempts (a 1/2 tie does not pass). */
export const majorityPass = (s: ScenarioOutcome) => 2 * s.c > s.n;
export const conclusive = (n: number) => n >= STATS.minConclusive;
export const STATS_METHOD = `95% expanded-percentile cluster bootstrap over scenarios (attempts kept together; small-sample t correction; ${STATS.resamples} resamples, seed ${STATS.seed}); Wilson on the scenario majority pass`;
/** Intervals of one run: pass^1 and every pass^k (bootstrap over scenarios), majority pass (Wilson), per capability. */
export function runStats(rows: readonly RunRow[], K: number, opts: BootstrapOptions = {}) {
  const passK = Object.fromEntries(Array.from({ length: Math.max(1, K) }, (_, i) => [i + 1,
    bootstrapMean(rows.filter(r => r.n >= i + 1).map(r => r.passK[i + 1] ?? 0), 'passK:' + (i + 1), opts)])) as Record<number, Interval>;
  const capabilities = [...new Set(rows.flatMap(r => r.capability))].sort();
  return { method: STATS_METHOD, resamples: opts.resamples ?? STATS.resamples, seed: opts.seed ?? STATS.seed, level: STATS.level,
    pass1: passK[1], passK, majority: wilson(rows.filter(majorityPass).length, rows.length),
    byCapability: Object.fromEntries(capabilities.map(cap => {
      const list = rows.filter(r => r.capability.includes(cap));
      return [cap, { n: list.length, pass1: bootstrapMean(list.map(passRate), 'cap:' + cap, opts), majority: wilson(list.filter(majorityPass).length, list.length), conclusive: conclusive(list.length) }];
    })) };
}
export type RunStats = ReturnType<typeof runStats>;

// ---------------------------------------------------------------- arms: comparability, paired A/B and generalization gap
/** What makes two arms comparable, from their run reports: the SALON_SECRETARY_* snapshot, the examples contract tag, the
 * request versions, K, the noise profile and the run days. `mixed` names what already differs among the runs pooled into the arm.
 * `delivery`: the runner's answer delivery of the pooled runs (evaluation only); absent = all used the legacy 'field'. */
export type ArmProfile = { flags: Record<string, string> | null; examplesTag: string | null; versions: string[]; repeats: number[]; noise: string[]; days: string[]; mixed: string[];
  delivery?: string[] };
/** A run or several pooled runs (e.g. V+N) seen as one set of scenario outcomes. */
export type PasskArm = { label: string; runs: string[]; valid: boolean; repeat: number; safetyAttempts: number; scenarios: ScenarioOutcome[]; profile?: ArmProfile };
/** Switches the runner flips around each request, never a difference between arms (= candidate-freeze RUNTIME_ONLY_FLAGS;
 * a test pins the equality: this module cannot import candidate-freeze, which imports the lib). */
export const RUNTIME_ONLY_FLAGS: readonly string[] = Object.freeze(['SALON_SECRETARY_ALLOW_PAID_CALLS']);
const sameList = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);
export const armFlags = (flags: Record<string, string> | null) => flags && Object.fromEntries(Object.entries(flags).filter(([k]) => !RUNTIME_ONLY_FLAGS.includes(k)));
/** Differences between two arm profiles. `treatment`: flags, examples and request version (what an A/B varies on purpose;
 * a dev/held gap of ONE candidate must not differ there). `conditions`: K, noise and pools that already disagree (never
 * the treatment). `days`: the arms ran on different days (templates render other dates; informational). */
export function armDifferences(a?: ArmProfile, b?: ArmProfile) {
  if (!a || !b) return { treatment: [] as string[], conditions: ['run profile unknown'], days: false };
  const fa = armFlags(a.flags), fb = armFlags(b.flags), treatment: string[] = [], conditions: string[] = [];
  if (!fa || !fb) { if (fa !== fb) treatment.push('flags (one arm has no snapshot)'); }
  else { const names = [...new Set([...Object.keys(fa), ...Object.keys(fb)])].sort().filter(k => fa[k] !== fb[k]); if (names.length) treatment.push(`flags ${names.join(',')}`); }
  if (a.examplesTag !== b.examplesTag) treatment.push('examples');
  if (!sameList(a.versions, b.versions)) treatment.push('request version');
  if (!sameList(a.repeats, b.repeats)) conditions.push(`K ${a.repeats.join('/') || '?'}≠${b.repeats.join('/') || '?'}`);
  if (!sameList(a.noise, b.noise)) conditions.push(`noise ${a.noise.join('/') || '?'}≠${b.noise.join('/') || '?'}`);
  // The runner's answer delivery changes outcomes by itself (harness, not product): never the treatment, always a confound.
  const da = a.delivery ?? ['field'], db = b.delivery ?? ['field'];
  if (!sameList(da, db)) conditions.push(`answer delivery ${da.join('/')}≠${db.join('/')}`);
  conditions.push(...a.mixed.map(m => `first arm pools runs with different ${m}`), ...b.mixed.map(m => `second arm pools runs with different ${m}`));
  return { treatment, conditions, days: !sameList(a.days, b.days) };
}
export type Verdict = 'better' | 'worse' | 'noninferior' | 'inconclusive' | 'n<5 not conclusive';
export type VerdictOptions = { sign?: { better: number; worse: number }; margin?: number };
/** Groups under 5 scenarios never conclude; a zero-width interval (every scenario moved by the same amount: no variance
 * to measure) is inconclusive. 'better'/'worse': the interval excludes 0 AND, when `sign` is given, the exact sign test
 * agrees (p < 0.05, same direction). 'noninferior' (only with a pre-declared `margin` δ, and from 10 scenarios: at 5 a
 * true 10-point loss still passed 9% of the time in the offline simulation): not better, lower bound > −δ. */
export function verdictOf(i: Interval, o: VerdictOptions = {}): Verdict {
  if (!conclusive(i.n) || i.lower === null || i.upper === null) return 'n<5 not conclusive';
  if (!(i.upper > i.lower)) return 'inconclusive';
  const agrees = (up: boolean) => !o.sign || (signTest(o.sign.better, o.sign.worse) < STATS.alpha && (up ? o.sign.better > o.sign.worse : o.sign.worse > o.sign.better));
  if (i.lower > 0 && agrees(true)) return 'better';
  if (i.upper < 0 && agrees(false)) return 'worse';
  return o.margin !== undefined && i.n >= 2 * STATS.minConclusive && i.lower > -o.margin ? 'noninferior' : 'inconclusive';
}
function assertUniqueIds(list: readonly ScenarioOutcome[]) {
  if (new Set(list.map(s => s.id)).size !== list.length) throw Error('AGENDA_STATS_DUPLICATE_ID');
}
type Pair = { id: string; capability: string[]; base: number; candidate: number; basePass: boolean; candidatePass: boolean };
function pairedGroup(pairs: readonly Pair[], label: string, opts: BootstrapOptions) {
  const diff = bootstrapMean(pairs.map(p => p.candidate - p.base), label, opts);
  const onlyBase = pairs.filter(p => p.basePass && !p.candidatePass).length, onlyCandidate = pairs.filter(p => !p.basePass && p.candidatePass).length;
  const sign = { better: pairs.filter(p => p.candidate > p.base).length, worse: pairs.filter(p => p.candidate < p.base).length, tied: pairs.filter(p => p.candidate === p.base).length };
  return { n: pairs.length, base: pairs.length ? r6(mean(pairs.map(p => p.base))) : null, candidate: pairs.length ? r6(mean(pairs.map(p => p.candidate))) : null, diff,
    verdict: verdictOf(diff, { sign, margin: STATS.nonInferiorityMargin }),
    mcnemar: { bothPass: pairs.filter(p => p.basePass && p.candidatePass).length, bothFail: pairs.filter(p => !p.basePass && !p.candidatePass).length, onlyBase, onlyCandidate,
      p: mcnemarExact(onlyBase, onlyCandidate) },
    sign: { ...sign, p: signTest(sign.better, sign.worse) } };
}
/** Candidate − baseline per-scenario pass rate on the scenario ids both arms graded (paired cluster bootstrap), the exact
 * sign test, the McNemar count on the majority outcome and the same per capability. Ids graded by only one arm are
 * excluded and counted. A paired id whose recorded definitions differ is refused (AGENDA_STATS_DEFINITION_MISMATCH):
 * an edited scenario is another scenario. Pairs without a recorded definition, or run with another K or noise profile,
 * are counted (the measurement conditions of one scenario must match; the treatment is what the arms differ in). */
export function pairedComparison(base: readonly ScenarioOutcome[], candidate: readonly ScenarioOutcome[], opts: BootstrapOptions = {}) {
  assertUniqueIds(base); assertUniqueIds(candidate);
  const byId = new Map(base.map(s => [s.id, s])), candidateIds = new Set(candidate.map(s => s.id));
  const matched = candidate.filter(s => byId.has(s.id)).sort((a, b) => a.id.localeCompare(b.id)).map(s => ({ a: byId.get(s.id)!, s }));
  const mismatch = matched.filter(({ a, s }) => !!a.definition && !!s.definition && a.definition !== s.definition).length;
  if (mismatch) throw Object.assign(Error('AGENDA_STATS_DEFINITION_MISMATCH'), { details: { scenarios: mismatch } });
  const pairs: Pair[] = matched.map(({ a, s }) => ({ id: s.id, capability: [...new Set([...a.capability, ...s.capability])].sort(), base: passRate(a), candidate: passRate(s),
    basePass: majorityPass(a), candidatePass: majorityPass(s) }));
  const capabilities = [...new Set(pairs.flatMap(p => p.capability))].sort(), verified = matched.filter(({ a, s }) => !!a.definition && !!s.definition).length;
  return { ...pairedGroup(pairs, 'paired', opts), onlyInBase: base.filter(s => !candidateIds.has(s.id)).length, onlyInCandidate: candidate.filter(s => !byId.has(s.id)).length,
    definitions: { verified, unverified: matched.length - verified }, repeatMismatch: matched.filter(({ a, s }) => a.n !== s.n).length,
    noiseMismatch: matched.filter(({ a, s }) => (a.noise ?? 'off') !== (s.noise ?? 'off')).length,
    byCapability: Object.fromEntries(capabilities.map(cap => [cap, pairedGroup(pairs.filter(p => p.capability.includes(cap)), 'paired:cap:' + cap, opts)])) };
}
function armSummary(arm: PasskArm, opts: BootstrapOptions) {
  return { label: arm.label, runs: arm.runs, valid: arm.valid, repeat: arm.repeat, scenarios: arm.scenarios.length, safetyAttempts: arm.safetyAttempts,
    pass1: bootstrapMean(arm.scenarios.map(passRate), 'passK:1', opts), majority: wilson(arm.scenarios.filter(majorityPass).length, arm.scenarios.length) };
}
/** Dev (scenarios that drove fixes) vs held (scenarios that did not): gap = dev − held pass^1 with an independent-groups
 * cluster bootstrap. OVERFIT_SIGNAL when the gap's lower bound exceeds 0 by more than 5 points. `confounded` lists every
 * difference between the two arms' runs (flags, examples, request version, K, noise): a gap is an overfitting signal
 * only for ONE candidate measured the same way. */
export function generalizationGap(dev: PasskArm, held: PasskArm, opts: BootstrapOptions = {}) {
  assertUniqueIds(dev.scenarios); assertUniqueIds(held.scenarios);
  const gap = bootstrapMeanDiff(dev.scenarios.map(passRate), held.scenarios.map(passRate), 'gap', opts), devIds = new Set(dev.scenarios.map(s => s.id));
  const signal = gap.lower !== null && gap.lower > STATS.overfitMargin ? 'OVERFIT_SIGNAL' as const : null, d = armDifferences(dev.profile, held.profile);
  return { method: STATS_METHOD, dev: armSummary(dev, opts), held: armSummary(held, opts), gap, margin: STATS.overfitMargin, signal,
    conclusive: conclusive(dev.scenarios.length) && conclusive(held.scenarios.length), sharedIds: held.scenarios.filter(s => devIds.has(s.id)).length,
    confounded: [...d.treatment, ...d.conditions], differentDays: d.days };
}
export type GeneralizationGap = ReturnType<typeof generalizationGap>;

// ---------------------------------------------------------------- similarity (memorisation check)
const WEEKDAY_WORDS = new Set(['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'feira']);
/** Spoken numbers (dictated days and clock times: "vinte e oito", "dez e meia"). "um", "uma" and "meia" are numbers only
 * after "e" inside a number, since they are also articles and words. */
const NUMBER_WORDS = new Set(['dois', 'duas', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'catorze', 'quinze',
  'dezesseis', 'dezessete', 'dezoito', 'dezenove', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'primeiro']);
const NUMBER_TAIL = new Set(['um', 'uma', 'meia']);
/** Particles and honorifics inside person names that are ordinary words in a message. */
const NAME_STOP = new Set(['a', 'o', 'e', 'de', 'da', 'do', 'das', 'dos', 'di', 'du', 'seu', 'sua', 'dona', 'dom', 'sr', 'sra', 'senhor', 'senhora']);
const TEMPLATE = /\{\{\s*d:\s*[^|{}]+?\s*\|\s*([a-z]+)\s*\}\}/gi;
export const MASK = { name: '<name>', number: '<num>', weekday: '<weekday>' } as const;
export const foldWords = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** Folded words of person names (surnames included) to mask, minus particles, weekday words, spoken numbers and `exclude` words (service names). */
export function nameTokens(names: Iterable<string>, exclude: Iterable<string> = []) {
  const skip = new Set([...NAME_STOP, ...WEEKDAY_WORDS, ...NUMBER_WORDS, ...NUMBER_TAIL, ...[...exclude].flatMap(foldWords)]);
  return new Set([...names].flatMap(foldWords).filter(w => !skip.has(w) && !/\d/.test(w)));
}
/** Normalized token set with names, digits (any token holding one: 10h, 29/09), spoken numbers and weekday words masked.
 * A day template masks like what it renders to ({{d:+1|dd}} and {{d:+1|dw}} → <num>), so a template, its digits and its
 * dictated words ("vinte e oito") compare equal. */
export function maskedTokens(text: string, names: ReadonlySet<string>) {
  const words = foldWords(text.replace(TEMPLATE, (_, format: string) => /^weekday/i.test(format) ? ' segunda ' : ' 0 '));
  const out = words.map(w => /\d/.test(w) || NUMBER_WORDS.has(w) ? MASK.number : WEEKDAY_WORDS.has(w) ? MASK.weekday : names.has(w) ? MASK.name : w);
  for (let i = 1; i + 1 < out.length; i++) // "vinte e oito", "dez e meia": one number
    if (out[i] === 'e' && out[i - 1] === MASK.number && (out[i + 1] === MASK.number || NUMBER_TAIL.has(words[i + 1]))) { out[i] = MASK.number; out[i + 1] = MASK.number; }
  return new Set(out);
}
/** Jaccard of two token sets; 0 when either is empty (no evidence of similarity). */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  if (!a.size || !b.size) return 0;
  let common = 0; for (const t of a) if (b.has(t)) common++;
  return common / (a.size + b.size - common);
}
/** Messages of fewer masked tokens ("sim", "10h") match almost anything; they count only when a scenario has nothing longer. */
export const SIMILARITY_MIN_TOKENS = 3;
/** Max masked-token Jaccard of a scenario's messages against a pre-masked corpus (null when it has no message). */
export function maxSimilarity(messages: readonly string[], corpus: readonly ReadonlySet<string>[], names: ReadonlySet<string>) {
  const sets = messages.map(m => maskedTokens(m, names)).filter(t => t.size), long = sets.filter(t => t.size >= SIMILARITY_MIN_TOKENS);
  if (!sets.length) return null;
  let best = 0; for (const t of long.length ? long : sets) for (const c of corpus) { const j = jaccard(t, c); if (j > best) best = j; }
  return best;
}
/** Similarity tertiles are relative to the held set (fixed thresholds left the low bucket empty on every measured set). */
export const SIMILARITY_TERTILES = ['low', 'mid', 'high'] as const;
export type SimilarityTertile = (typeof SIMILARITY_TERTILES)[number];
/** Average ranks, 1-based (ties share their mean rank). */
export function averageRanks(xs: readonly number[]) {
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]), out = new Array<number>(xs.length);
  for (let i = 0; i < order.length;) {
    let j = i; while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) out[order[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}
/** Tertile of each score within its own set, by average rank (tied scores share a tertile). */
export const tertilesOf = (scores: readonly number[]): SimilarityTertile[] => averageRanks(scores).map(r => SIMILARITY_TERTILES[Math.min(2, Math.floor(3 * (r - 1) / scores.length))]);
function pearson(a: readonly number[], b: readonly number[]) {
  const ma = mean(a), mb = mean(b); let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; ab += x * y; aa += x * x; bb += y * y; }
  return aa > 1e-12 && bb > 1e-12 ? ab / Math.sqrt(aa * bb) : null;
}
/** Spearman rank correlation (null under 3 values or without variance). */
export const spearman = (x: readonly number[], y: readonly number[]) => x.length < 3 ? null : pearson(averageRanks(x), averageRanks(y));
/** Spearman(x, y) with a percentile bootstrap interval over scenarios (resamples without variance are skipped; no
 * interval when more than half are) and a ONE-SIDED permutation p for a positive association (the memorisation direction). */
export function rankAssociation(x: readonly number[], y: readonly number[], label: string, opts: BootstrapOptions = {}) {
  const n = x.length, rho = spearman(x, y), B = resamplesOf(opts), P = opts.permutations ?? STATS.permutations;
  if (rho === null) return { n, rho: null, lower: null, upper: null, p: null };
  const random = statsRandom(`${label}:bootstrap`, opts.seed), draws: number[] = [];
  for (let b = 0; b < B; b++) {
    const xi: number[] = [], yi: number[] = [];
    for (let i = 0; i < n; i++) { const j = Math.floor(random() * n); xi.push(x[j]); yi.push(y[j]); }
    const r = spearman(xi, yi); if (r !== null) draws.push(r);
  }
  draws.sort((a, b) => a - b);
  const shuffle = statsRandom(`${label}:permutation`, opts.seed), perm = [...y], tail = (1 - STATS.level) / 2, enough = draws.length >= B / 2; let hits = 0;
  for (let b = 0; b < P; b++) {
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(shuffle() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    const r = spearman(x, perm); if (r !== null && r >= rho - 1e-12) hits++;
  }
  return { n, rho: r6(rho), lower: enough ? r6(quantile(draws, tail)) : null, upper: enough ? r6(quantile(draws, 1 - tail)) : null, p: r6((hits + 1) / (P + 1)) };
}
export type HeldScenario = ScenarioOutcome & { messages: string[] };
const wordGrams = (text: string) => {
  const w = foldWords(text.replace(TEMPLATE, ' dtemplate '));
  return w.length < STATS.ngram ? [] : Array.from({ length: w.length - STATS.ngram + 1 }, (_, i) => w.slice(i, i + STATS.ngram).join(' '));
};
/** Sentence-frame leakage a Jaccard maximum hides: held say messages whose masked token set (≥5 tokens) EQUALS a corpus
 * message's (the same frame with other names, numbers or days), and messages sharing a verbatim 5-word sequence (folded
 * words) with a corpus message. Counts only. */
export function frameMatches(held: readonly HeldScenario[], corpus: readonly string[], names: ReadonlySet<string>) {
  const frame = (text: string) => { const t = maskedTokens(text, names); return t.size >= STATS.frameMinTokens ? [...t].sort().join(' ') : null; };
  const frames = new Set(corpus.map(frame).filter((f): f is string => f !== null)), grams = new Set(corpus.flatMap(wordGrams));
  let messages = 0, maskedIdentical = 0, sharedNgram = 0; const identicalIn = new Set<string>(), sharedIn = new Set<string>();
  for (const s of held) for (const m of s.messages) {
    messages++;
    const f = frame(m); if (f !== null && frames.has(f)) { maskedIdentical++; identicalIn.add(s.id); }
    if (wordGrams(m).some(g => grams.has(g))) { sharedNgram++; sharedIn.add(s.id); }
  }
  return { messages, maskedIdentical, sharedNgram, scenariosMaskedIdentical: identicalIn.size, scenariosSharedNgram: sharedIn.size };
}
export type FrameMatches = ReturnType<typeof frameMatches>;
type TertileRow = { tertile: SimilarityTertile; scenarios: number; scoreMin: number | null; scoreMax: number | null; pass1: Interval; majority: Proportion; conclusive: boolean };
export type SimilarityCorpusStrata = { corpusMessages: number; unscored: number; scenarios: number; medianScore: number | null; tertiles: TertileRow[];
  association: ReturnType<typeof rankAssociation>; highMinusLow: Interval & { nA: number; nB: number }; signal: 'MEMORISATION_SIGNAL' | null; frames: FrameMatches;
  scores: { id: string; score: number; tertile: SimilarityTertile }[] };
/** Memorisation check of a held run against each corpus: accuracy per similarity tertile (within the held set), the
 * Spearman association of similarity and pass^1 (MEMORISATION_SIGNAL: positive rho with a one-sided permutation p < 0.05
 * on at least 10 scored scenarios) and the frame counts. `scores` (ids only) stays in memory: formatters and the --gap
 * output print tertiles and counts only. */
export function similarityStrata(held: readonly HeldScenario[], corpora: Readonly<Record<string, readonly string[]>>, names: ReadonlySet<string>, opts: BootstrapOptions = {}) {
  return Object.fromEntries(Object.entries(corpora).map(([corpusName, messages]) => {
    const corpus = messages.map(m => maskedTokens(m, names)).filter(t => t.size);
    const rated = held.map(s => ({ s, score: maxSimilarity(s.messages, corpus, names) })).filter((x): x is { s: HeldScenario; score: number } => x.score !== null);
    const tiers = tertilesOf(rated.map(x => x.score)), inTier = (t: SimilarityTertile) => rated.filter((_, i) => tiers[i] === t);
    const tertiles = SIMILARITY_TERTILES.map((tertile): TertileRow => {
      const list = inTier(tertile), scores = list.map(x => x.score);
      return { tertile, scenarios: list.length, scoreMin: scores.length ? r6(Math.min(...scores)) : null, scoreMax: scores.length ? r6(Math.max(...scores)) : null,
        pass1: bootstrapMean(list.map(x => passRate(x.s)), `similarity:${corpusName}:${tertile}`, opts), majority: wilson(list.filter(x => majorityPass(x.s)).length, list.length),
        conclusive: conclusive(list.length) };
    });
    const highMinusLow = bootstrapMeanDiff(inTier('high').map(x => passRate(x.s)), inTier('low').map(x => passRate(x.s)), `similarity:${corpusName}:high-low`, opts);
    const association = rankAssociation(rated.map(x => x.score), rated.map(x => passRate(x.s)), `similarity:${corpusName}:spearman`, opts);
    const signal = rated.length >= 2 * STATS.minConclusive && association.rho !== null && association.rho > 0 && association.p !== null && association.p < STATS.alpha ? 'MEMORISATION_SIGNAL' as const : null;
    const sorted = rated.map(x => x.score).sort((x, y) => x - y);
    const strata: SimilarityCorpusStrata = { corpusMessages: corpus.length, unscored: held.length - rated.length, scenarios: rated.length, medianScore: sorted.length ? r6(quantile(sorted, 0.5)) : null,
      tertiles, association, highMinusLow, signal, frames: frameMatches(held, messages, names), scores: rated.map((x, i) => ({ id: x.s.id, score: r6(x.score), tertile: tiers[i] })) };
    return [corpusName, strata];
  })) as Record<string, SimilarityCorpusStrata>;
}
export type SimilarityStrata = ReturnType<typeof similarityStrata>;
/** The strata without per-scenario ids (what a sealed/held report may carry). */
export const aggregateSimilarity = (strata: SimilarityStrata) =>
  Object.fromEntries(Object.entries(strata).map(([name, { scores: _scores, ...rest }]) => [name, rest]));

// ---------------------------------------------------------------- corpora (repository files; text never printed)
/** Dev batteries only (train split). A validation or regression file must never join this list. */
export const DEV_BATTERY_FILE = /^agenda-practice-(?:variations|natural|scenarios(?:-r\d+)?)\.json$/;
export function devBatteryScenarios(root: string = process.cwd()): AgendaScenario[] {
  const dir = join(root, 'packages/salon-secretary/evaluation');
  return readdirSync(dir).filter(f => DEV_BATTERY_FILE.test(f)).sort().flatMap(f => {
    const list = JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown;
    return Array.isArray(list) ? list as AgendaScenario[] : [];
  });
}
const strings = (value: unknown): string[] => typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(strings)
  : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
/** What the owner says in a scenario (say steps); scripted answers are replies to the Secretary's questions. */
export const scenarioMessages = (s: Pick<AgendaScenario, 'steps'>) => (s.steps ?? []).flatMap(step => 'say' in step && typeof step.say === 'string' ? [step.say] : []);
/** Every message of the dev batteries: say steps and every scripted answer variant. */
export const devBatteryMessages = (scenarios: readonly AgendaScenario[]) => scenarios.flatMap(s => [...scenarioMessages(s), ...strings(s.answers)]);
/** Person names a scenario declares (its customers and professionals, and the ones its final oracle names). */
export const scenarioNames = (s: AgendaScenario) => [...(s.customers ?? []).map(c => c.name), ...(s.professionals ?? []).map(p => p.name),
  ...(s.final?.appointments ?? []).flatMap(a => [a.customer, a.professional ?? '']), ...(s.final?.blocks ?? []).map(b => b.professional)].filter(n => typeof n === 'string' && n.length > 0);
type BankEntry = { message?: unknown; expected?: { operations?: Record<string, unknown>[] } };
/** Few-shot bank messages and every person name an example can show (read only). G1 (28/09/2026): entries carry
 * placeholders filled at render time, so `messages` are rendered with the canonical fill, `names` are the fill list's names
 * plus the fixed names the bank showed before G1 (example-bank-names-pre-g1.json: earlier runs saw them, so they stay out
 * of held measurements) and any literal person value left, and `services` are the generic services a fill may show. */
const readBank = (root: string) => JSON.parse(readFileSync(join(root, 'packages/salon-secretary/src/examples/bank.json'), 'utf8')) as (BankEntry & { id?: unknown })[];
/** Bank messages as the model reads them (G1: filled with the canonical fill), with their ids (read only). */
export function renderedBankMessages(root: string = process.cwd()) {
  return readBank(root).flatMap((entry, index) => {
    const id = typeof entry.id === 'string' ? entry.id : `#${index}`, parsed = bankExample.safeParse(entry);
    if (!parsed.success) return typeof entry.message === 'string' ? [{ id, text: entry.message }] : [];
    const fills = exampleFills(parsed.data, CANONICAL_FILL_SEED);
    return [{ id, text: fills ? fillExample(parsed.data, fills).message : parsed.data.message }];
  });
}
export function exampleBankCorpus(root: string = process.cwd()) {
  const literal = readBank(root).flatMap(e => (e.expected?.operations ?? []).flatMap(op => ['customer_name', 'professional_name'].flatMap(k => {
    const v = (op as Record<string, { value?: unknown; literal?: unknown } | null>)[k];
    return v ? [v.value, v.literal].filter((x): x is string => typeof x === 'string' && !new RegExp(PLACEHOLDER.source).test(x)) : [];
  })));
  const before = (JSON.parse(readFileSync(join(root, 'packages/salon-secretary/evaluation/example-bank-names-pre-g1.json'), 'utf8')) as { names: string[] }).names;
  const fill = exampleFillNames();
  return { messages: renderedBankMessages(root).map(item => item.text), names: [...before, ...fill.people, ...literal], services: fill.services };
}

// ---------------------------------------------------------------- formatting (ids, buckets and counts only)
const f3 = (v: number | null | undefined) => v === null || v === undefined ? '-' : v.toFixed(3);
const s3 = (v: number | null | undefined) => v === null || v === undefined ? '-' : (v >= 0 ? '+' : '') + v.toFixed(3);
export const ci = (i: Interval, signed = false) => i.lower === null ? 'CI95[-]' : `CI95[${(signed ? s3 : f3)(i.lower)},${(signed ? s3 : f3)(i.upper)}]`;
export const wilsonText = (p: Proportion) => p.n ? `${p.x}/${p.n}=${f3(p.estimate)} Wilson[${f3(p.lower)},${f3(p.upper)}]` : '0/0';
const nNote = (n: number) => conclusive(n) ? '' : ' (n<5: not conclusive)';
/** A capability label a report of a sealed or validation run may print (a free-text family would carry case text). */
export const SAFE_LABEL = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export type FormatOptions = { safeLabels?: boolean };
const omitted = (count: number) => count ? [`  ${count} capability label(s) that are not plain codes omitted`] : [];
export function formatRunStats(s: RunStats, K: number, o: FormatOptions = {}) {
  const lines = [`STATS ${s.method}`,
    `  pass^1=${f3(s.pass1.estimate)} ${ci(s.pass1)} se=${f3(s.pass1.se)} (${s.pass1.n} scenarios)${nNote(s.pass1.n)}`,
    ...(K > 1 ? [`  ${Object.entries(s.passK).filter(([k]) => Number(k) > 1).map(([k, i]) => `pass^${k}=${f3(i.estimate)} ${ci(i)} n=${i.n}`).join('  ')}`] : []),
    `  majority-pass ${wilsonText(s.majority)}`];
  const caps = Object.entries(s.byCapability), shown = o.safeLabels ? caps.filter(([cap]) => SAFE_LABEL.test(cap)) : caps;
  for (const [cap, c] of shown) lines.push(`  ci cap ${cap.padEnd(16)} n=${c.n} pass^1=${f3(c.pass1.estimate)} ${ci(c.pass1)} majority ${c.majority.x}/${c.majority.n}${nNote(c.n)}`);
  return [...lines, ...omitted(caps.length - shown.length)].join('\n');
}
/** Every arm after the first against the first, on the same scenario ids. `safeLabels`: capability rows with free-text labels are omitted. */
export function formatPairedComparison(arms: readonly PasskArm[], opts: BootstrapOptions & FormatOptions = {}) {
  if (arms.length < 2) return '';
  const [base, ...rest] = arms;
  const lines = [`PAIRED vs ${base.label} (candidate − baseline pass^1 per scenario on the same ids; 95% paired expanded-percentile cluster bootstrap, ${opts.resamples ?? STATS.resamples} resamples;`,
    `  sign = scenarios better/worse/tied with the exact sign test p; McNemar on the majority outcome: b = baseline-only passes, c = candidate-only passes, exact p)`];
  const head = ['arm', 'n', 'base', 'cand', 'diff', 'CI95', 'verdict', 'sign +/-/=', 'sign p', 'McNemar b/c', 'p'];
  const rows: string[][] = [], notes: string[] = []; let hidden = 0;
  const row = (label: string, g: ReturnType<typeof pairedGroup>) => [label, String(g.n), f3(g.base), f3(g.candidate), s3(g.diff.estimate), ci(g.diff, true).slice(4), g.verdict,
    `${g.sign.better}/${g.sign.worse}/${g.sign.tied}`, f3(g.sign.p), `${g.mcnemar.onlyBase}/${g.mcnemar.onlyCandidate}`, f3(g.mcnemar.p)];
  for (const arm of rest) {
    const p = pairedComparison(base.scenarios, arm.scenarios, opts), d = armDifferences(base.profile, arm.profile);
    rows.push(row(arm.label, p));
    for (const [cap, g] of Object.entries(p.byCapability)) if (!opts.safeLabels || SAFE_LABEL.test(cap)) rows.push(row(`  cap ${cap}`, g)); else hidden++;
    // K and noise are compared per pair below (arms may pool V with noise and N clean by design); a pool of two candidates is not.
    const pooled = d.conditions.filter(c => !/^(K|noise) /.test(c) && c !== 'run profile unknown');
    if (d.treatment.length) notes.push(`NOTE ${arm.label} differs from ${base.label} in: ${d.treatment.join('; ')} (the A/B treatment)`);
    if (pooled.length) notes.push(`WARN CONFOUNDED ${arm.label}: ${pooled.join('; ')}: the difference may come from these, not from the treatment`);
    if (p.repeatMismatch) notes.push(`WARN CONFOUNDED ${arm.label}: ${p.repeatMismatch} paired scenario(s) graded with another number of attempts`);
    if (p.noiseMismatch) notes.push(`WARN CONFOUNDED ${arm.label}: ${p.noiseMismatch} paired scenario(s) run with another noise profile`);
    if (p.onlyInBase || p.onlyInCandidate) notes.push(`NOTE ${arm.label}: excluded ${p.onlyInBase} id(s) graded only by the baseline and ${p.onlyInCandidate} only by the candidate`);
    if (p.definitions.unverified) notes.push(`NOTE ${arm.label}: ${p.definitions.unverified} paired scenario(s) without a recorded definition in one arm (identity not verified)`);
    if (!conclusive(p.n)) notes.push(`WARN ${arm.label}: only ${p.n} paired scenarios: not conclusive`);
    if (!arm.valid) notes.push(`WARN ${arm.label}: INVALID run (missing/incomplete attempts counted as failures)`);
  }
  if (!base.valid) notes.push(`WARN ${base.label}: INVALID run (missing/incomplete attempts counted as failures)`);
  if (hidden) notes.push(`NOTE ${hidden} capability row(s) with labels that are not plain codes omitted`);
  const width = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
  lines.push(...[head, ...rows].map(r => r.map((cell, i) => cell.padEnd(width[i])).join('  ').trimEnd()));
  lines.push(...notes, `WARN groups with <5 scenarios are not conclusive. 'better'/'worse' = the interval excludes 0 AND the exact sign test agrees (p<${STATS.alpha}); 'inconclusive' = otherwise, or a zero-width interval;`,
    `  'noninferior' = no win, lower bound above −${STATS.nonInferiorityMargin} (pre-declared margin). With ~30 scenarios, only differences of ~15-20 points are distinguishable; with ~60, ~10.`,
    `WARN cap rows are exploratory (many comparisons at once): one 'better'/'worse' cap row is not evidence by itself. An arm chosen on these same scenarios is optimistic by construction.`);
  return lines.join('\n');
}
/** Aggregates only: pass^1 of each arm, the gap, the confounds and the similarity tertiles and counts; no scenario id and no text. */
export function formatGeneralizationGap(g: GeneralizationGap, similarity?: SimilarityStrata | ReturnType<typeof aggregateSimilarity>) {
  const arm = (name: string, a: GeneralizationGap['dev']) => `  ${name.padEnd(4)} pass^1=${f3(a.pass1.estimate)} ${ci(a.pass1)} majority ${wilsonText(a.majority)} (${a.scenarios} scenarios, K=${a.repeat}, runs=${a.runs.length}, safety attempts=${a.safetyAttempts}${a.valid ? '' : ', INVALID'})${nNote(a.scenarios)}`;
  const outcome = g.signal ? `OVERFIT_SIGNAL (lower bound > ${g.margin})` : g.gap.lower === null ? 'no data' : g.gap.lower > 0 ? `positive gap within the ${g.margin} margin: no overfit signal` : 'no overfit signal (interval contains 0 or is negative)';
  const lines = [`GENERALIZATION GAP dev − held pass^1 (${g.method}; the two groups resampled independently)`, arm('dev', g.dev), arm('held', g.held),
    `  gap=${s3(g.gap.estimate)} ${ci(g.gap, true)} se=${f3(g.gap.se)} → ${outcome}${g.conclusive ? '' : ' (a group has <5 scenarios: not conclusive)'}`];
  if (g.confounded.length) lines.push(`  WARN CONFOUNDED: dev and held differ in ${g.confounded.join('; ')}: the gap may come from these, not from overfitting (measure ONE candidate with the same K and noise)`);
  if (g.differentDays) lines.push(`  NOTE dev and held ran on different days (relative dates render differently)`);
  if (g.sharedIds) lines.push(`  WARN held shares ${g.sharedIds} scenario id(s) with dev: it is not a holdout`);
  if (similarity) {
    lines.push(`SIMILARITY of held scenarios (max masked-token Jaccard of each scenario's say messages; names, digits, spoken numbers and weekday words masked; tertiles within the held set; Spearman(similarity, pass^1) with a one-sided permutation p)`);
    for (const [name, s] of Object.entries(similarity)) {
      lines.push(`  vs ${name} (${s.corpusMessages} messages; ${s.scenarios} held scenarios scored, median ${f3(s.medianScore)})${s.unscored ? ` unscored=${s.unscored}` : ''}: ` +
        s.tertiles.map(t => `${t.tertile} n=${t.scenarios} [${t.scoreMin === null ? '-' : `${f3(t.scoreMin)}-${f3(t.scoreMax)}`}] pass^1=${f3(t.pass1.estimate)} ${ci(t.pass1)}${t.conclusive ? '' : ' (n<5)'}`).join(' | '));
      const a = s.association, few = s.scenarios < 2 * STATS.minConclusive;
      lines.push(`    spearman rho=${s3(a.rho)} ${a.lower === null ? 'CI95[-]' : `CI95[${s3(a.lower)},${s3(a.upper)}]`} p=${f3(a.p)}; high−low pass^1=${s3(s.highMinusLow.estimate)} ${ci(s.highMinusLow, true)} → ${s.signal ?? 'no memorisation signal'}${few ? ` (<${2 * STATS.minConclusive} scored scenarios: not conclusive)` : ''}`);
      const f = s.frames;
      lines.push(`    frames: ${f.maskedIdentical}/${f.messages} held message(s) masked-identical to a ${name} message (>=${STATS.frameMinTokens} tokens) in ${f.scenariosMaskedIdentical} scenario(s); ${f.sharedNgram} share a verbatim ${STATS.ngram}-word sequence (${f.scenariosSharedNgram} scenario(s))`);
    }
  }
  return lines.join('\n');
}
