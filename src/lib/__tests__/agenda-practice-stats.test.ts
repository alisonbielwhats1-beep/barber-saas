import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPasskReport, formatPasskTable, heldSimilarity, passkArm, runScenarios, scenarioDefinitionSha256, type AgendaScenario, type DbState } from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';
import {
  RUNTIME_ONLY_FLAGS, STATS, aggregateSimilarity, armDifferences, averageRanks, bootstrapMean, bootstrapMeanDiff, exampleBankCorpus, expandedTail, formatGeneralizationGap, formatPairedComparison,
  formatRunStats, frameMatches, generalizationGap, jaccard, majorityPass, maskedTokens, maxSimilarity, mcnemarExact, nameTokens, normalCdf, pairedComparison, quantile, rankAssociation,
  runStats, signTest, similarityStrata, spearman, statsRandom, t975, tertilesOf, verdictOf, wilson, type ArmProfile, type PasskArm, type ScenarioOutcome,
} from '../../../packages/salon-secretary/evaluation/agenda-practice-stats';
import { RUNTIME_ONLY_FLAGS as CANDIDATE_RUNTIME_ONLY_FLAGS } from '../../../packages/salon-secretary/evaluation/candidate-freeze';

const SUNDAY = '2026-09-27';
const outcome = (id: string, c: number, n: number, capability: string[] = ['create']): ScenarioOutcome => ({ id, capability, c, n });
const many = (prefix: string, count: number, c: number, n: number, capability?: string[]) => Array.from({ length: count }, (_, i) => outcome(`${prefix}${String(i + 1).padStart(2, '0')}`, c, n, capability));
const arm = (label: string, scenarios: ScenarioOutcome[], valid = true): PasskArm => ({ label, runs: [label], valid, repeat: Math.max(1, ...scenarios.map(s => s.n)), safetyAttempts: 0, scenarios });
const tempDir = () => mkdtempSync(join(tmpdir(), 'agenda-stats-'));
const initial: DbState = { appointments: [], blocks: [] };
const written: DbState = { appointments: ['Carla Mendes | Escova | 2026-09-29 10:00→10:45 | Tatiana Rocha | CONFIRMED'], blocks: [] };
/** A run dir whose scenario `id` passes attempt k when outcomes[id][k-1] (final oracle: nothing changes). */
function writeRun(dir: string, outcomes: Record<string, boolean[]>, say: (id: string) => string = () => 'marca a carla amanha as 10', capability: (id: string) => string[] = () => ['create'],
  report: Record<string, unknown> = {}) {
  const K = Math.max(...Object.values(outcomes).map(o => o.length));
  for (const [id, list] of Object.entries(outcomes)) list.forEach((ok, i) => {
    const k = i + 1, scenario: AgendaScenario = { id, title: id, capability: capability(id), steps: [{ say: say(id) }], final: { unchanged: true } };
    mkdirSync(join(dir, `k${k}`), { recursive: true });
    writeFileSync(join(dir, `k${k}`, `${id}.json`), JSON.stringify({ scenario, today: SUNDAY, attempt: k, complete: true, initial,
      transcript: [{ step: 1, action: 'say', pending: [], view: { message: 'ok' }, db: ok ? initial : written }] }));
  });
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ run: basename(dir), status: 'COMPLETE', repeat: K, scenarios: Object.keys(outcomes).length, ids: Object.keys(outcomes), reservedUsd: 0, ...report }));
  return dir;
}
const profile = (patch: Partial<ArmProfile> = {}): ArmProfile => ({ flags: { SALON_SECRETARY_EXAMPLES: 'off', SALON_SECRETARY_ALLOW_PAID_CALLS: 'false' }, examplesTag: null, versions: ['v1'],
  repeats: [3], noise: ['off'], days: ['2026-09-27'], mixed: [], ...patch });

describe('agenda practice stats: deterministic cluster bootstrap', () => {
  const values = [1, 1, 0, 1, 0.5, 0, 1, 1, 0.333, 0.667, 1, 0];
  it('is reproducible, independent of call order, and changes only with the label or the seed', () => {
    const a = bootstrapMean(values, 'pass1'), b = bootstrapMean([0, 1, 1, 0.5], 'other'), again = bootstrapMean(values, 'pass1');
    expect(again).toEqual(a); expect(bootstrapMean([0, 1, 1, 0.5], 'other')).toEqual(b);
    expect(statsRandom('x')()).toBe(statsRandom('x')());
    expect(bootstrapMean(values, 'pass1', { seed: 'another-seed' })).not.toEqual(a);
    expect(bootstrapMean(values, 'another-label')).not.toEqual(a);
    expect(a.n).toBe(values.length); expect(a.estimate).toBeCloseTo(values.reduce((x, y) => x + y) / values.length, 6);
    expect(a.lower!).toBeLessThanOrEqual(a.estimate!); expect(a.upper!).toBeGreaterThanOrEqual(a.estimate!);
    expect(STATS.resamples).toBe(2000);
    expect(() => bootstrapMean(values, 'x', { resamples: 1 })).toThrow('AGENDA_STATS_RESAMPLES');
    expect(() => bootstrapMean(values, 'x', { resamples: 10.5 })).toThrow('AGENDA_STATS_RESAMPLES');
  });
  it('keeps attempts together: a scenario contributes its own pass rate, so constant rates give a zero-width interval', () => {
    expect(bootstrapMean(Array(10).fill(0.5), 'c')).toEqual({ n: 10, estimate: 0.5, lower: 0.5, upper: 0.5, se: 0 });
    expect(bootstrapMean([0.25], 'one')).toEqual({ n: 1, estimate: 0.25, lower: null, upper: null, se: null });
    expect(bootstrapMean([], 'none')).toEqual({ n: 0, estimate: null, lower: null, upper: null, se: null });
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5); expect(quantile([1, 2, 3, 4], 0)).toBe(1); expect(quantile([1, 2, 3, 4], 1)).toBe(4);
  });
  it('matches the normal approximation on a known case (50 of 60 scenarios pass)', () => {
    const i = bootstrapMean([...Array(50).fill(1), ...Array(10).fill(0)], 'known');
    expect(i.estimate).toBeCloseTo(50 / 60, 6);
    expect(i.se!).toBeGreaterThan(0.04); expect(i.se!).toBeLessThan(0.056); // sqrt(p(1-p)/n) = 0.048
    expect(i.lower!).toBeGreaterThan(0.70); expect(i.lower!).toBeLessThan(0.76);
    expect(i.upper!).toBeGreaterThan(0.90); expect(i.upper!).toBeLessThanOrEqual(0.95);
    const d = bootstrapMeanDiff(Array(30).fill(1), Array(30).fill(0), 'diff');
    expect(d).toMatchObject({ estimate: 1, lower: 1, upper: 1, nA: 30, nB: 30 });
    expect(bootstrapMeanDiff([1], [0, 1], 'tiny')).toMatchObject({ estimate: 0.5, lower: null, upper: null, nA: 1, nB: 2 });
  });
  it('widens small samples like a t interval (expanded percentile): the plain percentile is as narrow as the CLT interval', () => {
    for (const [df, t] of [[1, 12.7062], [2, 4.3027], [3, 3.1824], [4, 2.7764], [9, 2.2622], [29, 2.0452], [63, 1.9983]]) expect(t975(df)).toBeCloseTo(t, 2);
    expect(() => t975(0)).toThrow('AGENDA_STATS_DF');
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6); expect(normalCdf(-3)).toBeCloseTo(0.00135, 5);
    expect(expandedTail(5)).toBeCloseTo(0.00096, 4); expect(expandedTail(30)).toBeCloseTo(0.01875, 4); expect(expandedTail(64)).toBeCloseTo(0.022, 3);
    // Five scenarios: the interval is much wider than the plain 2.5%/97.5% percentiles of the same draws.
    const five = [1, 1, 0, 1, 0.5], i = bootstrapMean(five, 'five');
    expect(i.lower!).toBeLessThanOrEqual(0.2); expect(i.upper).toBe(1);
  });
});

describe('agenda practice stats: Wilson and McNemar', () => {
  it('gives the known Wilson intervals and clamps the boundaries', () => {
    const a = wilson(50, 60), b = wilson(20, 26), zero = wilson(0, 10), all = wilson(10, 10);
    expect(a.lower!).toBeCloseTo(0.7197, 3); expect(a.upper!).toBeCloseTo(0.9069, 3);
    expect(b.lower!).toBeCloseTo(0.5795, 3); expect(b.upper!).toBeCloseTo(0.8897, 3);
    expect(zero).toMatchObject({ x: 0, n: 10, estimate: 0, lower: 0 }); expect(zero.upper!).toBeCloseTo(0.2775, 3);
    expect(all).toMatchObject({ estimate: 1, upper: 1 }); expect(all.lower!).toBeCloseTo(0.7225, 3);
    expect(wilson(0, 0)).toEqual({ x: 0, n: 0, estimate: null, lower: null, upper: null });
    expect(() => wilson(3, 2)).toThrow('AGENDA_STATS_PROPORTION'); expect(() => wilson(-1, 2)).toThrow('AGENDA_STATS_PROPORTION');
  });
  it('majority pass needs more than half of the attempts (a 1/2 tie fails)', () => {
    expect([outcome('a', 2, 3), outcome('b', 1, 2), outcome('c', 1, 1), outcome('d', 0, 1), outcome('e', 3, 5)].map(majorityPass)).toEqual([true, false, true, false, true]);
  });
  it('computes the exact McNemar p on the discordant pairs', () => {
    expect(mcnemarExact(0, 0)).toBe(1); expect(mcnemarExact(1, 1)).toBe(1);
    expect(mcnemarExact(0, 5)).toBeCloseTo(0.0625, 6); expect(mcnemarExact(5, 0)).toBeCloseTo(0.0625, 6);
    expect(mcnemarExact(2, 10)).toBeCloseTo(158 / 4096, 6);
  });
});

describe('agenda practice stats: per-run intervals', () => {
  it('reports pass^1, every pass^k, the majority Wilson and per-capability n with intervals', () => {
    const rows = [...many('A', 6, 3, 3, ['cancel']), ...many('B', 3, 0, 3, ['block'])].map(s => ({ ...s, passK: { 1: s.c / s.n, 2: s.c === 3 ? 1 : 0, 3: s.c === 3 ? 1 : 0 } }));
    const s = runStats(rows, 3);
    expect(s.pass1).toEqual(s.passK[1]); expect(s.pass1.estimate).toBeCloseTo(6 / 9, 6);
    expect(Object.keys(s.passK)).toEqual(['1', '2', '3']);
    expect(s.majority).toMatchObject({ x: 6, n: 9 });
    expect(s.byCapability.cancel).toMatchObject({ n: 6, conclusive: true, pass1: { estimate: 1, lower: 1, upper: 1 } });
    expect(s.byCapability.block).toMatchObject({ n: 3, conclusive: false, majority: { x: 0, n: 3 } });
  });
  it('adds the STATS section to the pass^k report and table without touching the existing lines', () => {
    const dir = tempDir();
    try {
      writeRun(dir, Object.fromEntries([...many('V', 6, 0, 0).map((s, i) => [s.id, i < 4 ? [true, true, true] : [true, false, false]]), ['X01', [false, false, false]]]));
      const report = buildPasskReport(dir);
      expect(report.aggregate.pass1).toBeCloseTo((4 + 2 / 3) / 7, 6);
      expect(report.stats.pass1.estimate).toBeCloseTo(report.aggregate.pass1!, 6);
      expect(report.stats.passK[3].estimate).toBeCloseTo(report.aggregate.passK[3]!, 6);
      expect(report.stats.majority).toMatchObject({ x: 4, n: 7 });
      const table = formatPasskTable(report);
      expect(table).toMatch(/^AGG pass\^1=0\.667 .*\(7 scenarios\)$/m);
      expect(table).toMatch(/^STATS 95% expanded-percentile cluster bootstrap over scenarios/m);
      expect(table).toMatch(/^ {2}pass\^1=0\.667 CI95\[\d\.\d{3},\d\.\d{3}\] se=\d\.\d{3} \(7 scenarios\)$/m);
      expect(table).toContain('  majority-pass 4/7=0.571 Wilson[');
      expect(table).toMatch(/^ {2}ci cap create +n=7 pass\^1=0\.667 CI95\[/m);
      expect(runScenarios(dir).get('V01')?.steps).toEqual([{ say: 'marca a carla amanha as 10' }]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('agenda practice stats: paired A/B on the same scenarios', () => {
  it('identical arms are inconclusive with no discordant pair', () => {
    const base = [...many('S', 10, 2, 3), ...many('T', 10, 3, 3)], p = pairedComparison(base, base);
    expect(p).toMatchObject({ n: 20, onlyInBase: 0, onlyInCandidate: 0, verdict: 'inconclusive', diff: { estimate: 0, lower: 0, upper: 0 },
      mcnemar: { bothPass: 20, bothFail: 0, onlyBase: 0, onlyCandidate: 0, p: 1 }, sign: { better: 0, worse: 0, tied: 20 } });
  });
  it('pairs by id, excludes ids graded by one arm only and concludes only when the interval excludes 0 and the exact sign test agrees', () => {
    const base = [...many('S', 20, 1, 3), outcome('ONLY_BASE', 3, 3)], better = [...many('S', 20, 3, 3).map((s, i) => i % 2 ? { ...s, c: 2 } : s), outcome('ONLY_CAND', 0, 3)];
    const p = pairedComparison(base, better);
    expect(p).toMatchObject({ n: 20, onlyInBase: 1, onlyInCandidate: 1, verdict: 'better', mcnemar: { onlyBase: 0, onlyCandidate: 20 }, sign: { better: 20, worse: 0, tied: 0 } });
    expect(p.diff.estimate).toBeCloseTo(0.5, 6); expect(p.mcnemar.p).toBeLessThan(1e-5); expect(p.sign.p).toBeLessThan(1e-5);
    expect(pairedComparison(better, base).verdict).toBe('worse');
    // Two scenarios up, two down, the rest tied: the interval crosses 0 (and its lower bound is below the −0.05 margin).
    const mixed = many('S', 12, 2, 3), moved = mixed.map((s, i) => i < 2 ? { ...s, c: 3 } : i < 4 ? { ...s, c: 1 } : s);
    const m = pairedComparison(mixed, moved);
    expect(m.verdict).toBe('inconclusive'); expect(m.diff.lower!).toBeLessThan(-STATS.nonInferiorityMargin); expect(m.diff.upper!).toBeGreaterThan(0);
    expect(m.sign).toEqual({ better: 2, worse: 2, tied: 8, p: 1 });
  });
  it('a zero-width interval never concludes: every scenario moved by the same amount (the degenerate case the review found)', () => {
    const degenerate = (n: number) => { const b = many('D', n, 3, 5); return pairedComparison(b, b.map(s => ({ ...s, c: 4 }))); };
    for (const n of [5, 6, 8, 20]) expect(degenerate(n)).toMatchObject({ verdict: 'inconclusive', diff: { lower: 0.2, upper: 0.2 }, mcnemar: { onlyBase: 0, onlyCandidate: 0, p: 1 } });
    expect(degenerate(5).sign.p).toBeCloseTo(0.0625, 6);
    const identical = many('S', 20, 2, 3);
    expect(pairedComparison(identical, identical).verdict).toBe('inconclusive');
    expect(verdictOf({ n: 10, estimate: 0.2, lower: 0.2, upper: 0.2, se: 0 })).toBe('inconclusive');
  });
  it('an interval above 0 without a significant sign test is not a win; non-inferiority needs 10 scenarios and a lower bound above −0.05', () => {
    // 4 of 20 scenarios improved, none got worse: the bootstrap interval is above 0 but the sign test (p=0.125) is not.
    const base = many('S', 20, 2, 3), up = base.map((s, i) => i < 4 ? { ...s, c: 3 } : s), p = pairedComparison(base, up);
    expect(p.diff.lower!).toBeGreaterThan(0); expect(p.sign).toEqual({ better: 4, worse: 0, tied: 16, p: 0.125 });
    expect(p.verdict).toBe('noninferior');
    expect(signTest(4, 0)).toBe(0.125); expect(signTest(6, 0)).toBeCloseTo(0.03125, 6);
    const interval = (n: number, lower: number, upper: number) => ({ n, estimate: (lower + upper) / 2, lower, upper, se: 0.05 });
    expect(verdictOf(interval(12, -0.04, 0.2), { margin: 0.05 })).toBe('noninferior');
    expect(verdictOf(interval(12, -0.06, 0.2), { margin: 0.05 })).toBe('inconclusive');
    expect(verdictOf(interval(8, -0.04, 0.2), { margin: 0.05 })).toBe('inconclusive'); // under 10 scenarios
    expect(verdictOf(interval(12, 0.01, 0.2), { margin: 0.05, sign: { better: 3, worse: 1 } })).toBe('noninferior');
    expect(verdictOf(interval(12, 0.01, 0.2), { margin: 0.05, sign: { better: 9, worse: 0 } })).toBe('better');
    expect(verdictOf(interval(12, 0.01, 0.2))).toBe('better'); // no sign given (a single interval)
    const text = formatPairedComparison([arm('base', base), arm('up', up)]);
    expect(text.split('\n').find(l => l.startsWith('up '))).toMatch(/noninferior +4\/0\/16 +0\.125/);
    expect(text).toContain("'noninferior' = no win, lower bound above −0.05");
  });
  it('refuses to pair an id whose recorded definitions differ, and counts pairs it cannot verify or graded with another K', () => {
    const a = many('S', 6, 2, 3).map(s => ({ ...s, definition: 'd-' + s.id })), b = a.map((s, i) => i === 0 ? { ...s, definition: 'edited' } : s);
    try { pairedComparison(a, b); throw Error('expected a refusal'); } catch (e) { expect((e as Error).message).toBe('AGENDA_STATS_DEFINITION_MISMATCH'); expect((e as { details: unknown }).details).toEqual({ scenarios: 1 }); }
    const legacy = a.map((s, i) => i < 2 ? { ...s, definition: null, n: 2, c: 1 } : i === 2 ? { ...s, noise: 'heavy' } : s);
    expect(pairedComparison(a, legacy)).toMatchObject({ n: 6, definitions: { verified: 4, unverified: 2 }, repeatMismatch: 2, noiseMismatch: 1 });
  });
  it('never concludes under 5 scenarios, per capability too, and refuses duplicated ids', () => {
    const base = [...many('A', 4, 0, 3, ['cancel']), ...many('B', 8, 1, 3, ['block'])], cand = [...many('A', 4, 3, 3, ['cancel']), ...many('B', 8, 3, 3, ['block']).map((s, i) => i % 2 ? { ...s, c: 2 } : s)];
    const p = pairedComparison(base, cand);
    expect(p.byCapability.cancel).toMatchObject({ n: 4, verdict: 'n<5 not conclusive' });
    expect(p.byCapability.block).toMatchObject({ n: 8, verdict: 'better' });
    expect(verdictOf(bootstrapMean([1, 1, 1, 1], 'x'))).toBe('n<5 not conclusive');
    expect(() => pairedComparison([outcome('a', 1, 1), outcome('a', 0, 1)], [])).toThrow('AGENDA_STATS_DUPLICATE_ID');
    const text = formatPairedComparison([arm('off', base), arm('selected', cand, false)]);
    expect(text).toMatch(/^PAIRED vs off /);
    expect(text).toMatch(/^ {2}cap cancel +4 .* n<5 not conclusive/m);
    expect(text).toContain('WARN selected: INVALID run');
    expect(text).toContain('WARN groups with <5 scenarios are not conclusive');
    const flat = formatPairedComparison([arm('a', many('S', 12, 2, 3)), arm('b', many('S', 12, 2, 3).map((s, i) => i < 2 ? { ...s, c: 3 } : i < 4 ? { ...s, c: 1 } : s))]);
    expect(flat.split('\n').find(l => l.startsWith('b '))).toContain('inconclusive');
    expect(formatPairedComparison([arm('only', base)])).toBe('');
  });
  it('pools runs into one arm (V+N) and refuses an id graded twice', () => {
    const root = tempDir();
    try {
      const v = buildPasskReport(writeRun(join(root, 'v'), { V01: [true, true], V02: [false, true] }));
      const n = buildPasskReport(writeRun(join(root, 'n'), { N01: [true, false] }));
      const pooled = passkArm([v, n], 'dev');
      expect(pooled).toMatchObject({ label: 'dev', runs: ['v', 'n'], valid: true, repeat: 2 });
      expect(pooled.scenarios.map(s => [s.id, s.c, s.n])).toEqual([['V01', 2, 2], ['V02', 1, 2], ['N01', 1, 2]]);
      expect(passkArm([v]).label).toBe('v');
      expect(() => passkArm([v, v])).toThrow('AGENDA_PASSK_POOL_DUPLICATE_ID');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('records each scenario definition and the run profile; pooled runs that disagree are marked mixed', () => {
    const root = tempDir();
    try {
      const flags = { SALON_SECRETARY_EXAMPLES: 'selected', SALON_SECRETARY_ALLOW_PAID_CALLS: 'false' };
      const a = buildPasskReport(writeRun(join(root, 'a'), { V01: [true, true] }, undefined, undefined, { flags, examples: 'examples:selected', noise: { profile: 'mixed' } }));
      const b = buildPasskReport(writeRun(join(root, 'b'), { N01: [true] }, undefined, undefined, { flags, examples: 'examples:selected' }));
      const scenario = { id: 'V01', title: 'V01', capability: ['create'], steps: [{ say: 'marca a carla amanha as 10' }], final: { unchanged: true } };
      expect(a.scenarios[0].definition).toBe(scenarioDefinitionSha256(scenario));
      expect(scenarioDefinitionSha256({ final: { unchanged: true }, steps: scenario.steps, capability: ['create'], title: 'V01', id: 'V01' })).toBe(a.scenarios[0].definition); // key order never matters
      expect(scenarioDefinitionSha256({ ...scenario, title: 'edited' })).not.toBe(a.scenarios[0].definition);
      expect([a.noiseProfile, b.noiseProfile]).toEqual(['mixed', 'off']);
      const pooled = passkArm([a, b]);
      // K and noise may differ among pooled runs by design (each scenario carries its own); the candidate identity may not.
      expect(pooled.profile).toEqual({ flags, examplesTag: 'examples:selected', versions: [], repeats: [1, 2], noise: ['mixed', 'off'], days: [SUNDAY], mixed: [] });
      expect(pooled.scenarios.map(s => [s.definition, s.noise])).toEqual([[a.scenarios[0].definition, 'mixed'], [b.scenarios[0].definition, 'off']]);
      const c = buildPasskReport(writeRun(join(root, 'c'), { X01: [true] }, undefined, undefined, { flags: { ...flags, SALON_SECRETARY_EXAMPLES: 'full' }, examples: 'examples:full' }));
      expect(passkArm([a, c]).profile?.mixed).toEqual(['flags', 'examples']);
      expect(formatRunStats(a.stats, 2, { safeLabels: true })).not.toContain('omitted');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('agenda practice stats: generalization gap', () => {
  it('flags OVERFIT_SIGNAL when the lower bound of dev − held exceeds 5 points', () => {
    const g = generalizationGap(arm('dev', many('D', 30, 3, 3)), arm('held', [...many('H', 15, 3, 3), ...many('G', 15, 0, 3)]));
    expect(g.gap.estimate).toBeCloseTo(0.5, 6); expect(g.gap.lower!).toBeGreaterThan(0.05);
    expect(g).toMatchObject({ signal: 'OVERFIT_SIGNAL', margin: 0.05, conclusive: true, sharedIds: 0, dev: { scenarios: 30, majority: { x: 30, n: 30 } }, held: { scenarios: 30, majority: { x: 15 } } });
    const text = formatGeneralizationGap(g);
    expect(text).toContain('OVERFIT_SIGNAL (lower bound > 0.05)');
    expect(text).not.toMatch(/\b[DHG]\d{2}\b/); // aggregates only: no scenario id
  });
  it('does not flag equal or slightly different arms, and warns about shared ids and small groups', () => {
    const same = generalizationGap(arm('dev', many('D', 20, 2, 3)), arm('held', many('H', 20, 2, 3)));
    expect(same).toMatchObject({ signal: null, gap: { estimate: 0 } });
    const near = generalizationGap(arm('dev', [...many('D', 16, 3, 3), ...many('E', 4, 0, 3)]), arm('held', [...many('H', 15, 3, 3), ...many('G', 5, 0, 3)]));
    expect(near.gap.estimate).toBeCloseTo(0.05, 6); expect(near.signal).toBeNull();
    const shared = generalizationGap(arm('dev', many('S', 3, 3, 3)), arm('held', many('S', 2, 0, 3)));
    expect(shared).toMatchObject({ sharedIds: 2, conclusive: false });
    const text = formatGeneralizationGap(shared);
    expect(text).toContain('WARN held shares 2 scenario id(s) with dev'); expect(text).toContain('not conclusive');
  });
  it('warns CONFOUNDED when dev and held were not measured the same way (flags, examples, request version, K, noise)', () => {
    const dev = { ...arm('dev', many('D', 20, 3, 3)), profile: profile() }, held = { ...arm('held', many('H', 20, 2, 3)), profile: profile({ repeats: [2], noise: ['mixed'], days: ['2026-09-28'] }) };
    const g = generalizationGap(dev, held);
    expect(g.confounded).toEqual(['K 3≠2', 'noise off≠mixed']); expect(g.differentDays).toBe(true);
    const text = formatGeneralizationGap(g);
    expect(text).toContain('WARN CONFOUNDED: dev and held differ in K 3≠2; noise off≠mixed'); expect(text).toContain('NOTE dev and held ran on different days');
    // The runtime-only paid-calls switch never counts; a real flag, the examples tag or the request version does.
    expect(RUNTIME_ONLY_FLAGS).toEqual(CANDIDATE_RUNTIME_ONLY_FLAGS);
    expect(armDifferences(profile(), profile({ flags: { SALON_SECRETARY_EXAMPLES: 'off', SALON_SECRETARY_ALLOW_PAID_CALLS: 'true' } }))).toEqual({ treatment: [], conditions: [], days: false });
    const other = profile({ flags: { SALON_SECRETARY_EXAMPLES: 'selected', SALON_SECRETARY_ALLOW_PAID_CALLS: 'false' }, examplesTag: 'examples:selected', versions: ['v2'] });
    expect(armDifferences(profile(), other).treatment).toEqual(['flags SALON_SECRETARY_EXAMPLES', 'examples', 'request version']);
    expect(generalizationGap({ ...dev }, { ...held, profile: other }).confounded).toEqual(['flags SALON_SECRETARY_EXAMPLES', 'examples', 'request version']);
    expect(armDifferences(profile(), profile({ mixed: ['request versions'] })).conditions).toEqual(['second arm pools runs with different request versions']);
    expect(armDifferences(undefined, profile()).conditions).toEqual(['run profile unknown']);
    const same = generalizationGap(dev, { ...arm('held', many('H', 20, 3, 3)), profile: profile() });
    expect(same.confounded).toEqual([]); expect(formatGeneralizationGap(same)).not.toContain('CONFOUNDED');
    // An A/B names its treatment and flags per-pair conditions that are not the treatment (the same scenario run with other noise or K).
    const clean = many('S', 6, 2, 3).map(s => ({ ...s, noise: 'off' })), noisy = clean.map((s, i) => ({ ...s, noise: i < 4 ? 'mixed' : 'off', n: i === 5 ? 2 : 3 }));
    const ab = formatPairedComparison([{ ...arm('off', clean), profile: profile() }, { ...arm('selected', noisy), profile: { ...other, noise: ['mixed', 'off'], repeats: [2, 3] } }]);
    expect(ab).toContain('NOTE selected differs from off in: flags SALON_SECRETARY_EXAMPLES; examples; request version (the A/B treatment)');
    expect(ab).toContain('WARN CONFOUNDED selected: 4 paired scenario(s) run with another noise profile');
    expect(ab).toContain('WARN CONFOUNDED selected: 1 paired scenario(s) graded with another number of attempts');
    // Both arms pooling V (noise) and N (clean) the same way is not a confound: every pair matches.
    const pooledAlike = formatPairedComparison([{ ...arm('off', noisy), profile: profile({ noise: ['mixed', 'off'] }) }, { ...arm('selected', noisy), profile: { ...other, noise: ['mixed', 'off'] } }]);
    expect(pooledAlike).not.toContain('CONFOUNDED');
    expect(formatPairedComparison([{ ...arm('a', clean), profile: profile() }, { ...arm('b', clean), profile: profile({ mixed: ['flags'] }) }])).toContain('WARN CONFOUNDED b: second arm pools runs with different flags');
  });
});

describe('agenda practice stats: similarity-stratified accuracy (memorisation check)', () => {
  const names = nameTokens(['Carla Mendes', 'Julia', 'Dona Cida', 'Maria da Silva', 'Corte Completo'], ['Corte Completo']);
  it('masks names, digits, spoken numbers and weekday words; a day template masks like its digits and its dictation', () => {
    expect([...names].sort()).toEqual(['carla', 'cida', 'julia', 'maria', 'mendes', 'silva']);
    expect([...maskedTokens('Marca a Carla na sexta às 10h', names)]).toEqual(['marca', 'a', '<name>', 'na', '<weekday>', 'as', '<num>']);
    expect(maskedTokens('dia {{d:+1|dd}} na {{d:+3|weekday}}, {{d:+2|dw}}', names)).toEqual(maskedTokens('dia 28 na quarta-feira, 29/09', names));
    // {{d:+2|dw}} renders "vinte e oito": the dictated words mask like the template (they did not before).
    expect(maskedTokens('dia {{d:+2|dw}} as dez e meia', names)).toEqual(maskedTokens('dia vinte e oito as 10:30', names));
    expect(maskedTokens('dia vinte e um', names)).toEqual(maskedTokens('dia 21', names));
    expect([...maskedTokens('marca uma escova e um corte', names)]).toEqual(['marca', 'uma', 'escova', 'e', 'um', 'corte']); // articles stay words
    expect(jaccard(maskedTokens('marca a Carla na sexta às 10h', names), maskedTokens('marca a julia na segunda as 15:30', names))).toBe(1);
    expect(jaccard(maskedTokens('marca a Carla', names), maskedTokens('marca a Beatriz', names))).toBeCloseTo(2 / 4, 6); // unknown name stays a word
    expect(jaccard(new Set(), maskedTokens('x', names))).toBe(0);
  });
  it('ranks similarity within the held set (tertiles; ties share one) and ignores short replies when a longer message exists', () => {
    expect(averageRanks([0.5, 0.1, 0.5, 0.9])).toEqual([2.5, 1, 2.5, 4]);
    expect(tertilesOf([0.1, 0.2, 0.3, 0.4, 0.5, 0.6])).toEqual(['low', 'low', 'mid', 'mid', 'high', 'high']);
    expect(tertilesOf([0.5, 0.5, 0.5])).toEqual(['mid', 'mid', 'mid']);
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 9); expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 9);
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull(); expect(rankAssociation([1, 2], [1, 2], 'tiny')).toMatchObject({ rho: null, p: null });
    const corpus = [maskedTokens('sim', names), maskedTokens('cancela a carla hoje de tarde por favor', names)];
    expect(maxSimilarity(['sim', 'desmarca o horario da julia amanha cedo'], corpus, names)).toBeCloseTo(1 / 14, 6); // only <name> shared: 1/(7+8-1)
    expect(maxSimilarity(['sim'], corpus, names)).toBe(1);
    expect(maxSimilarity([], corpus, names)).toBeNull();
  });
  it('flags MEMORISATION_SIGNAL when pass^1 rises with similarity (one-sided permutation test) and counts sentence frames', () => {
    const corpus = ['marca a carla amanha as 10 pra escova com a julia'];
    const held = [...many('H', 6, 3, 3).map(s => ({ ...s, messages: ['marca a maria amanha as 15 pra escova com a cida'] })), // the same frame, other names and time
      ...many('M', 6, 1, 3).map(s => ({ ...s, messages: ['desmarca a carla amanha as 10 pra escova'] })), // a verbatim 5-word sequence
      ...many('L', 6, 0, 3).map(s => ({ ...s, messages: ['o estoque de shampoo acabou quero ver relatorio financeiro'] })), { ...outcome('Z', 3, 3), messages: [] }];
    const strata = similarityStrata(held, { bank: corpus }, names).bank;
    expect(strata.tertiles.map(t => [t.tertile, t.scenarios, t.scoreMin, t.scoreMax])).toEqual([['low', 6, 0, 0], ['mid', 6, 0.7, 0.7], ['high', 6, 1, 1]]);
    expect(strata.tertiles[2].pass1.estimate).toBe(1); expect(strata.tertiles[0].pass1.estimate).toBe(0);
    expect(strata).toMatchObject({ corpusMessages: 1, unscored: 1, scenarios: 18, signal: 'MEMORISATION_SIGNAL', highMinusLow: { estimate: 1, nA: 6, nB: 6 },
      frames: { messages: 18, maskedIdentical: 6, sharedNgram: 6, scenariosMaskedIdentical: 6, scenariosSharedNgram: 6 } });
    expect(strata.association.rho).toBeCloseTo(1, 6); expect(strata.association.p!).toBeLessThan(0.01);
    expect(frameMatches(held, ['nada a ver com isso aqui hoje'], names)).toMatchObject({ maskedIdentical: 0, sharedNgram: 0 });
    expect(strata.scores.find(s => s.id === 'H01')).toMatchObject({ score: 1, tertile: 'high' });
    const flat = aggregateSimilarity({ bank: strata });
    expect(flat.bank).not.toHaveProperty('scores');
    expect(JSON.stringify(flat)).not.toMatch(/"id"|H01|L01|marca|estoque/);
    const g = generalizationGap(arm('dev', many('D', 10, 3, 3)), arm('held', held));
    const text = formatGeneralizationGap(g, flat);
    expect(text).toContain('MEMORISATION_SIGNAL'); expect(text).toContain('high n=6 [1.000-1.000] pass^1=1.000');
    expect(text).toContain('frames: 6/18 held message(s) masked-identical to a bank message (>=5 tokens) in 6 scenario(s); 6 share a verbatim 5-word sequence (6 scenario(s))');
    expect(text).not.toMatch(/H01|L01|marca|estoque|shampoo/);
    // Unrelated similarity and pass rate, or fewer than 10 scored scenarios: no signal.
    const flat2 = held.map((s, i) => ({ ...s, c: i % 2 ? 3 : 0 }));
    expect(similarityStrata(flat2, { bank: corpus }, names).bank.signal).toBeNull();
    const few = similarityStrata([...held.slice(0, 3), ...held.slice(6, 9), ...held.slice(12, 15)], { bank: corpus }, names).bank;
    expect(few).toMatchObject({ scenarios: 9, signal: null });
    expect(formatGeneralizationGap(g, aggregateSimilarity({ bank: few }))).toContain('(<10 scored scenarios: not conclusive)');
  });
  it('scores a held run against the real example bank and dev batteries without exposing text', () => {
    const dir = tempDir();
    try {
      const bankMessage = exampleBankCorpus().messages[0];
      writeRun(dir, { H01: [true, true], H02: [false, false] }, id => id === 'H01' ? bankMessage : 'qwxz plugh frobnicate zyzzy vorpal');
      const held = passkArm([buildPasskReport(dir)], 'held'), s = heldSimilarity(held, [dir]);
      expect(s.bank.scores).toEqual([{ id: 'H01', score: 1, tertile: 'mid' }, { id: 'H02', score: 0, tertile: 'low' }]);
      expect(s.bank.frames).toMatchObject({ messages: 2, maskedIdentical: 1, scenariosMaskedIdentical: 1 });
      expect(s.dev.corpusMessages).toBeGreaterThan(100); expect(s.bank.corpusMessages).toBeGreaterThanOrEqual(200);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('measures a held run against extra dev scenario files, and a multi-salon held run against the multi-salon dev instances', () => {
    const dir = tempDir();
    try {
      writeRun(dir, { H01: [true], H02: [false] });
      const held = passkArm([buildPasskReport(dir)], 'held');
      expect(Object.keys(heldSimilarity(held, [dir]))).toEqual(['bank', 'dev']);
      const file = join(dir, 'extra-dev.json');
      writeFileSync(file, JSON.stringify([{ id: 'E1', title: 'e', capability: ['create'], steps: [{ say: 'marca a carla amanha as 10' }] }]));
      const s = heldSimilarity(held, [dir], process.cwd(), { devCorpora: [file] });
      expect(Object.keys(s)).toEqual(['bank', 'dev', 'extra-extra-dev']);
      expect(s['extra-extra-dev'].scores.map(x => x.score)).toEqual([1, 1]);
      // A held scenario with a salon (multi-salon generator) adds the committed multi-salon dev instances automatically.
      for (const id of ['H01', 'H02']) {
        const path = join(dir, 'k1', id + '.json'), r = JSON.parse(readFileSync(path, 'utf8'));
        r.scenario.salon = { type: 'esmalteria', services: [{ name: 'Mão', durationMin: 40, priceCents: 3500 }], hours: [{ weekday: 1, from: '09:00', to: '18:00' }] };
        writeFileSync(path, JSON.stringify(r));
      }
      const multi = heldSimilarity(held, [dir]);
      expect(Object.keys(multi)).toEqual(['bank', 'dev', 'multisalon']);
      expect(multi.multisalon.corpusMessages).toBeGreaterThan(100);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('agenda practice pass^k CLI (offline)', () => {
  const cli = join(process.cwd(), 'packages/salon-secretary/evaluation/agenda-practice-passk.cjs');
  const passk = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: process.cwd() });
  it('--gap prints aggregates only; a run folder outside the checkout gets STATS and PAIRED only unless the coordinator asks; nothing is written', () => {
    const root = tempDir();
    try {
      const dev = writeRun(join(root, 'dev'), Object.fromEntries(many('D', 6, 0, 0).map(s => [s.id, [true, true]])));
      const held = writeRun(join(root, 'held'), Object.fromEntries(many('HSECRET', 6, 0, 0).map((s, i) => [s.id, [i < 2, false]])), () => 'sentinela-secreta marca a zuleide');
      const gap = execFileSync(process.execPath, [cli, '--gap', dev, held, '--out', join(root, 'gap.json')], { encoding: 'utf8', cwd: process.cwd() });
      expect(gap).toContain('GENERALIZATION GAP dev − held pass^1'); expect(gap).toContain('OVERFIT_SIGNAL'); expect(gap).toContain('SIMILARITY of held scenarios');
      expect(gap).not.toMatch(/HSECRET|sentinela|zuleide|CONFOUNDED/);
      expect(existsSync(join(dev, 'passk.json')) || existsSync(join(held, 'passk.json'))).toBe(false);
      // The per-scenario table (ids, failure reasons) of a run folder outside the checkout is refused before any output.
      const detail = passk(dev, held, '--no-write');
      expect(detail.status).toBe(2); expect(detail.stdout).toBe('');
      expect(detail.stderr).toContain('BLOCKED AGENDA_PASSK_PROTECTED_RUN (2 run dir(s): OUTSIDE_REPO)');
      const aggregate = passk(dev, held, '--aggregate');
      expect(aggregate.status).toBe(0);
      expect(aggregate.stdout).toMatch(/^RUN dev K=2 valid scenarios=6 coverage=12\/12 noise=off safety attempts=0$/m);
      expect(aggregate.stdout).toMatch(/^STATS 95% expanded-percentile/m); expect(aggregate.stdout).toContain('PAIRED vs dev');
      expect(aggregate.stdout).toMatch(/^held +0 /m); // no shared ids between the two arms
      expect(aggregate.stdout).not.toMatch(/HSECRET|D0\d|sentinela|zuleide|A\/B per run/);
      const coordinator = passk(dev, held, '--no-write', '--coordinator');
      expect(coordinator.status).toBe(0);
      expect(coordinator.stdout).toContain('A/B per run'); expect(coordinator.stdout).toMatch(/^HSECRET01/m);
      expect(existsSync(join(dev, 'passk.json')) || existsSync(join(held, 'passk.json'))).toBe(false);
      expect(passk(dev, '--aggregate', '--out', join(root, 'x.json')).status).toBe(2); // the aggregate mode never writes
      expect(existsSync(join(root, 'x.json'))).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 90_000);
  it('--gap --dev-corpus measures the held run against a dev scenario file as a corpus of its own; the flag needs --gap and a file', () => {
    const root = tempDir();
    try {
      const dev = writeRun(join(root, 'dev'), Object.fromEntries(many('D', 6, 0, 0).map(s => [s.id, [true]])));
      const held = writeRun(join(root, 'held'), Object.fromEntries(many('H', 6, 0, 0).map((s, i) => [s.id, [i < 3]])));
      const file = join(root, 'extra.json');
      writeFileSync(file, JSON.stringify([{ id: 'E1', title: 'e', capability: ['create'], steps: [{ say: 'marca a carla amanha as 10' }] }]));
      const out = passk('--gap', dev, held, '--dev-corpus', file);
      expect(out.status).toBe(0); expect(out.stdout).toContain('vs extra-extra (1 messages;');
      expect(passk(dev, '--dev-corpus', file, '--aggregate').status).toBe(2);
      expect(passk('--gap', dev, held, '--dev-corpus', join(root, 'missing.json')).status).toBe(2);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 90_000);
  it('refuses to pair runs whose scenario definitions differ (an edited scenario is another scenario)', () => {
    const root = tempDir();
    try {
      const a = writeRun(join(root, 'a'), { D01: [true], D02: [false] }), b = writeRun(join(root, 'b'), { D01: [true], D02: [true] }, () => 'desmarca a carla amanha as 10');
      const refused = passk(a, b, '--aggregate');
      expect(refused.status).toBe(2); expect(refused.stderr).toContain('BLOCKED AGENDA_STATS_DEFINITION_MISMATCH (2 scenario(s))');
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 60_000);
});

// C5 review (30/09): the runner's answer delivery (AGENDA_ANSWER_DELIVERY, evaluation only) changes outcomes by itself, so the pass^k
// report, the arm profile and every comparison name it; runs recorded before it keep their report and profile shape.
describe('agenda practice stats: answer delivery is part of the run profile', () => {
  it('an item-delivery run says so; pooling or comparing it with a field-delivery run is named as a confound, never the treatment', () => {
    const root = tempDir();
    try {
      const flags = { SALON_SECRETARY_EXAMPLES: 'off', SALON_SECRETARY_ALLOW_PAID_CALLS: 'false' };
      const field = buildPasskReport(writeRun(join(root, 'field'), { V01: [true, false] }, undefined, undefined, { flags }));
      const item = buildPasskReport(writeRun(join(root, 'item'), { V01: [true, true] }, undefined, undefined, { flags, answerDelivery: 'item' }));
      const other = buildPasskReport(writeRun(join(root, 'other'), { V02: [true, true] }, undefined, undefined, { flags, answerDelivery: 'item' }));
      const odd = buildPasskReport(writeRun(join(root, 'odd'), { V03: [true, true] }, undefined, undefined, { flags, answerDelivery: 'ITEM' }));
      expect([field.answerDelivery, item.answerDelivery, odd.answerDelivery]).toEqual(['field', 'item', 'field']);
      expect(formatPasskTable(field)).not.toContain('ANSWER DELIVERY'); expect(formatPasskTable(item)).toContain('ANSWER DELIVERY item');
      expect(passkArm([field]).profile).not.toHaveProperty('delivery'); expect(passkArm([item]).profile?.delivery).toEqual(['item']);
      const pooled = passkArm([field, other]);
      expect(pooled.profile?.mixed).toEqual(['answer delivery']); expect(pooled.profile?.delivery).toEqual(['field', 'item']);
      expect(armDifferences(passkArm([field]).profile, passkArm([item]).profile)).toEqual({ treatment: [], conditions: ['answer delivery field≠item'], days: false });
      expect(armDifferences(passkArm([item]).profile, passkArm([other]).profile)).toEqual({ treatment: [], conditions: [], days: false });
      expect(armDifferences(passkArm([field]).profile, passkArm([odd]).profile)).toEqual({ treatment: [], conditions: [], days: false });
      expect(formatPairedComparison([passkArm([field], 'field'), passkArm([item], 'item')])).toContain('WARN CONFOUNDED item: answer delivery field≠item');
      expect(formatPairedComparison([passkArm([field], 'field'), passkArm([field], 'again')])).not.toContain('answer delivery');
      expect(generalizationGap(passkArm([field]), passkArm([item])).confounded).toEqual(['answer delivery field≠item']);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('flag off (every run field delivery, or recorded before it): the profile, differences and table are exactly as before', () => {
    const root = tempDir();
    try {
      const a = buildPasskReport(writeRun(join(root, 'a'), { V01: [true] })), b = buildPasskReport(writeRun(join(root, 'b'), { V02: [true] }, undefined, undefined, { answerDelivery: 'field' }));
      expect([a.answerDelivery, b.answerDelivery]).toEqual(['field', 'field']);
      expect(passkArm([a, b]).profile).toEqual({ flags: null, examplesTag: null, versions: [], repeats: [1], noise: ['off'], days: [SUNDAY], mixed: [] });
      expect(armDifferences(passkArm([a]).profile, passkArm([b]).profile)).toEqual({ treatment: [], conditions: [], days: false });
      expect(formatPasskTable(a)).not.toContain('ANSWER DELIVERY');
      expect(armDifferences(profile(), profile({ delivery: ['field'] }))).toEqual({ treatment: [], conditions: [], days: false });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
