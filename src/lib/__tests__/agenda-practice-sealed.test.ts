import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  OUTSIDE_RUNS, REPO_RESULTS, RUN_MARKERS, SEALED_SHA_ENV, assertNotRegisteredHoldout, assertScenarioFilesInCheckout, failCode, isInside, openSealedHoldout, sealedAgendaPractice,
  sealedErrorCode, sealedErrorPayload, sealedRepoRoots, validationAgendaPractice, type SealedDeps, type SealedOptions,
} from '../../../packages/salon-secretary/evaluation/agenda-sealed';
import { buildCandidate, writeCandidate, type CandidateContract } from '../../../packages/salon-secretary/evaluation/candidate-freeze';
import {
  HOLDOUT_REGISTRY_SCHEMA, HOLDOUT_USAGE_BASENAME, readHoldoutRegistry, readHoldoutUsage, registerApproval, retireHoldout, writeHoldoutRegistry, type HoldoutKind, type HoldoutRegistry,
} from '../../../packages/salon-secretary/evaluation/holdout-usage';
import { agendaStage, type AgendaScenario } from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';

// Offline only: a throwaway git checkout (git init + add, never a commit) with its own holdout registry, holdout and
// validation files and a ledger in the OS temp folder, a fake preflight and a fake runner. No database, no secretary,
// no network, never the real sealed holdouts nor the real validation set.
const directories: string[] = [];
const temp = (prefix: string) => { const d = mkdtempSync(join(tmpdir(), prefix)); directories.push(d); return d; };
const put = (root: string, file: string, text: string) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text); };
const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

const TODAY = '2026-09-28';
/** Every string a sealed console must never show: customer, professional and service names, message, title, free-text family. */
const SECRETS = ['Joana', 'Secreta', 'Tatiana', 'Corte', 'Marca', 'amanhã', 'Título', 'Família', 'Pronto', 'segredo'];
const scenario = (id: string, final: AgendaScenario['final']): AgendaScenario => ({ id, title: `Título secreto ${id}`, capability: ['create', 'Família com texto livre'],
  steps: [{ say: 'Marca a Joana Secreta amanhã às 10h para corte com a Tatiana' }], final } as AgendaScenario);
const JOANA = { customer: 'Joana Secreta', service: 'Corte Completo', day: 1, time: '10:00', professional: 'Tatiana Rocha' };
const LINE = 'Joana Secreta | Corte Completo | 2026-09-29 10:00→11:00 | Tatiana Rocha | CONFIRMED';
const HOLDOUT = [scenario('H01', { appointments: [JOANA] }), scenario('H02', { appointments: [JOANA] }), scenario('H03', { unchanged: true })];
const VALIDATION = [scenario('Q01', { appointments: [JOANA] }), scenario('Q02', { unchanged: true })];
const FINAL_DB: Record<string, string[]> = { H01: [LINE], H02: [], H03: [LINE], Q01: [], Q02: [] }; // PASS, MISSING, write when nothing should change; MISSING, PASS
const EMPTY_REGISTRY: HoldoutRegistry = { schema: HOLDOUT_REGISTRY_SCHEMA, holdouts: [] };

function checkout() {
  const root = temp('sealed-root-'), git = (...args: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q');
  put(root, '.gitignore', 'packages/salon-secretary/evaluation/results/\n.demo/\n');
  put(root, 'src/lib/secretary.ts', 'export const version = 1;\n');
  put(root, 'packages/salon-secretary/src/examples/bank.json', '[]\n');
  git('add', '.gitignore', 'src/lib/secretary.ts', 'packages/salon-secretary/src/examples/bank.json');
  mkdirSync(join(root, 'packages/salon-secretary/evaluation'), { recursive: true });
  writeHoldoutRegistry(root, EMPTY_REGISTRY);
  return root;
}
/** Registers an approved file under a logical id in the checkout's registry (what scripts/secretary-holdout-registry.cjs does). */
function register(root: string, file: { sha256: string; ids: string[] }, id: string, kind: HoldoutKind) {
  writeHoldoutRegistry(root, registerApproval(readHoldoutRegistry(root), { id, kind, sha256: file.sha256, ids: file.ids, source: { name: `${id}-source.txt`, sha256: sha(id) } }));
}
const contract = (flags: Record<string, string>): CandidateContract => ({ examplesTag: flags.SALON_SECRETARY_EXAMPLES ?? null, examplesRenderVersion: 'test-v1', bankSha256: 'c'.repeat(64) });
function freeze(root: string, flags: Record<string, string>) {
  const m = buildCandidate({ root, model: 'gpt-6-luna', flags, contract: contract({ ...flags, SALON_SECRETARY_MODEL: 'gpt-6-luna' }) });
  writeCandidate(root, m); return m.versionId;
}
function holdoutFile(content: unknown = HOLDOUT, prefix = 'sealed-holdout-') {
  const file = join(temp(prefix), 'holdout.json'), text = JSON.stringify(content);
  writeFileSync(file, text); return { file, sha256: sha(text), ids: Array.isArray(content) ? (content as { id: string }[]).map(s => s.id) : [] };
}
type Fixture = ReturnType<typeof setup>;
function setup(flags: Record<string, string> = { SALON_SECRETARY_EXAMPLES: 'selected' }) {
  const root = checkout(), candidate = freeze(root, flags), holdout = holdoutFile(), ledger = join(temp('sealed-ledger-'), HOLDOUT_USAGE_BASENAME);
  register(root, holdout, 'probe-v1', 'test');
  const printed: string[] = [], calls = { preflight: 0, run: 0 };
  const env: Record<string, string | undefined> = { [SEALED_SHA_ENV]: holdout.sha256, AGENDA_PRACTICE_REAL_APPROVED: 'true', SALON_SECRETARY_MODEL: 'gpt-6-luna',
    SALON_SECRETARY_ALLOW_PAID_CALLS: 'false', SALON_SECRETARY_OPENAI_API_KEY: 'synthetic-not-a-key', ...flags };
  let clock = Date.parse('2026-09-28T12:00:00.000Z');
  // Contract migration (F1, 29/09): a real sealed/validation run now takes the stage lease, probes the stage and program-ledger
  // locks, checks the database identity and the reachable-day window before the look. The fake preflight therefore names its
  // (temporary) stage journal, program ledger and day window, and the deps carry a fake identity. Nothing else changed.
  const infra = temp('sealed-infra-');
  const deps: SealedDeps = { root, env, ledger, contract, roots: [root], now: () => new Date(clock += 60_000), print: line => { printed.push(line); },
    identity: async () => ({ database: 'synthetic-disposable' }),
    preflight: (scenarios, opts) => { calls.preflight++; return { stage: { name: 'reliability-20260927' }, today: TODAY, repeat: opts.repeat ?? 1, runnable: scenarios, skipped: [],
      estimate: { ok: true, callsPerPass: 6, maxRequests: 6, requiredMicroUsd: 1_000, remainingMicroUsd: 9_000_000 }, noise: { profile: 'off', levels: ['off'], texts: 0, changed: 0, violations: [] },
      programSpend: undefined, stageFile: join(infra, agendaStage(opts.stage ?? 'reliability-20260927').journal), programLedger: join(infra, 'program-spend-20260927.jsonl'),
      dayWindow: { days: [TODAY], spansMidnight: false, rolloverSkips: [] } } as never; },
    run: async (scenarios, out) => { calls.run++; fakeRun(scenarios, out); } };
  const options: SealedOptions = { holdout: holdout.file, candidate, repeat: 1 };
  return { root, candidate, holdout, ledger, printed, calls, env, deps, options };
}
/** What the real runner leaves on disk: transcripts full of case text, a report; and chatter on the process console. */
function fakeRun(scenarios: AgendaScenario[], out: string) {
  console.log('runtime log: Pronto, Joana Secreta marcada'); process.stdout.write('stdout: Tatiana Rocha segredo\n'); console.error('stderr: Corte Completo');
  const dir = join(out, 'k1'); mkdirSync(dir, { recursive: true });
  for (const s of scenarios) writeFileSync(join(dir, `${s.id}.json`), JSON.stringify({ scenario: s, initial: { appointments: [], blocks: [] }, today: TODAY, attempt: 1, complete: true,
    version: 'e'.repeat(64), transcript: [{ step: 1, action: 'say', input: (s.steps[0] as { say: string }).say, view: { message: 'Pronto, Joana Secreta marcada' },
      db: { appointments: FINAL_DB[s.id], blocks: [] } }] }));
  writeFileSync(join(out, 'report.json'), JSON.stringify({ run: 'synthetic', status: 'COMPLETE', today: TODAY, repeat: 1, ids: scenarios.map(s => s.id), scenarios: scenarios.length, skipped: [] }));
}
async function refusal(f: Fixture, patch: Partial<SealedOptions> = {}) {
  try { await sealedAgendaPractice({ ...f.options, ...patch }, f.deps); } catch (e) { return e; }
  throw Error('expected a refusal');
}
const leaks = (text: string) => SECRETS.filter(s => text.includes(s));
/** A printed summary without its two paths (a temp folder name is random): no scenario id may appear anywhere else. */
const withoutPaths = (text: string) => JSON.stringify({ ...JSON.parse(text), out: null, results: null });
const runsOf = (f: Fixture) => join(dirname(realpathSync(f.holdout.file)), OUTSIDE_RUNS);

describe('sealed holdout: approval, registry and location before anything else', () => {
  it('refuses without the approved sha, with another sha, or with the file inside a checkout: no preflight, run, ledger or output', async () => {
    const f = setup();
    for (const [env, code] of [[{ [SEALED_SHA_ENV]: undefined }, 'HOLDOUT_SHA_NOT_APPROVED'], [{ [SEALED_SHA_ENV]: 'not-a-sha' }, 'HOLDOUT_SHA_NOT_APPROVED'],
      [{ [SEALED_SHA_ENV]: '0'.repeat(64) }, 'HOLDOUT_SHA_MISMATCH']] as const) {
      const e = await refusal({ ...f, deps: { ...f.deps, env: { ...f.env, ...env } } });
      expect((e as Error).message).toBe(code);
    }
    // The same approved bytes, copied inside the checkout (or any checkout root git reports), are refused.
    put(f.root, 'holdout.json', readFileSync(f.holdout.file, 'utf8'));
    expect(((await refusal(f, { holdout: join(f.root, 'holdout.json') })) as Error).message).toBe('HOLDOUT_INSIDE_REPO');
    for (const path of [join(f.root, 'holdout.json'), realpathSync(join(f.root, 'holdout.json'))]) expect(sealedRepoRoots(f.root).some(r => isInside(path, r))).toBe(true);
    expect(sealedRepoRoots(f.root).some(r => isInside(f.holdout.file, r))).toBe(false);
    expect(((await refusal(f, { holdout: join(f.holdout.file, '..', 'missing.json') })) as Error).message).toBe('HOLDOUT_FILE');
    expect(f.calls).toEqual({ preflight: 0, run: 0 });
    expect(existsSync(f.ledger)).toBe(false);
    expect(f.printed).toEqual([]);
    expect(existsSync(join(f.root, REPO_RESULTS))).toBe(false);
    expect(existsSync(runsOf(f))).toBe(false);
  });
  it('the environment variable alone is not an approval: the sha must be an active test holdout of the registry, with its results folder outside every checkout', async () => {
    const f = setup(), other = holdoutFile([...HOLDOUT, scenario('H04', { unchanged: true })]), withSha = (s: string) => ({ ...f, deps: { ...f.deps, env: { ...f.env, [SEALED_SHA_ENV]: s } } });
    expect(((await refusal(withSha(other.sha256), { holdout: other.file })) as Error).message).toBe('HOLDOUT_NOT_REGISTERED');
    register(f.root, other, 'choice-v1', 'validation'); // the validation set is not a test holdout
    expect(((await refusal(withSha(other.sha256), { holdout: other.file })) as Error).message).toBe('HOLDOUT_KIND');
    writeHoldoutRegistry(f.root, retireHoldout(readHoldoutRegistry(f.root), 'probe-v1')); // turned into regression
    expect(((await refusal(f)) as Error).message).toBe('HOLDOUT_RETIRED');
    writeHoldoutRegistry(f.root, { ...readHoldoutRegistry(f.root), holdouts: readHoldoutRegistry(f.root).holdouts.map(h => ({ ...h, retired: false })) });
    // A checkout that contains <folder of the holdout>/runs: the results would land inside it.
    expect(((await refusal({ ...f, deps: { ...f.deps, roots: [f.root, runsOf(f)] } })) as Error).message).toBe('SEALED_RESULTS_INSIDE_REPO');
    // Registered ids that do not match the file are refused (the registry pins which scenarios the file holds).
    writeHoldoutRegistry(f.root, { ...readHoldoutRegistry(f.root), holdouts: readHoldoutRegistry(f.root).holdouts.map(h => h.id === 'probe-v1' ? { ...h, approved: [{ sha256: f.holdout.sha256, ids: ['H01'] }] } : h) });
    expect(((await refusal(f)) as Error).message).toBe('HOLDOUT_REGISTRY_MISMATCH');
    expect(f.calls).toEqual({ preflight: 0, run: 0 });
    expect(existsSync(f.ledger)).toBe(false);
    expect(f.printed).toEqual([]);
  });
  it('a non-sealed run reads scenario files from a checkout only, and never a registered holdout copied into it (by sha or by any shared id)', () => {
    const f = setup(), roots = sealedRepoRoots(f.root), registry = () => readHoldoutRegistry(f.root);
    put(f.root, 'packages/battery.json', JSON.stringify([scenario('V01', { unchanged: true })]));
    expect(() => assertScenarioFilesInCheckout([join(f.root, 'packages/battery.json')], roots)).not.toThrow();
    expect(() => assertScenarioFilesInCheckout([join(f.root, 'packages/battery.json'), f.holdout.file], roots)).toThrow('AGENDA_SCENARIOS_OUTSIDE_REPO');
    expect(() => assertScenarioFilesInCheckout([join(f.root, '..', basename(dirname(f.holdout.file)), 'holdout.json')], roots)).toThrow('AGENDA_SCENARIOS_OUTSIDE_REPO');
    expect(() => assertNotRegisteredHoldout([join(f.root, 'packages/battery.json')], registry())).not.toThrow();
    put(f.root, 'packages/copy.json', readFileSync(f.holdout.file, 'utf8')); // byte copy
    expect(() => assertNotRegisteredHoldout([join(f.root, 'packages/copy.json')], registry())).toThrow('AGENDA_SCENARIOS_REGISTERED_HOLDOUT:probe-v1');
    put(f.root, 'packages/subset.json', JSON.stringify([HOLDOUT[1], scenario('V02', { unchanged: true })], null, 2)); // re-formatted subset among dev cases
    expect(() => assertNotRegisteredHoldout([join(f.root, 'packages/battery.json'), join(f.root, 'packages/subset.json')], registry())).toThrow('AGENDA_SCENARIOS_REGISTERED_HOLDOUT:probe-v1');
    writeHoldoutRegistry(f.root, retireHoldout(registry(), 'probe-v1')); // an exhausted holdout turned into regression may run
    expect(() => assertNotRegisteredHoldout([join(f.root, 'packages/copy.json'), join(f.root, 'packages/subset.json')], registry())).not.toThrow();
  });
  it('parses only approved bytes, and a parse or validation failure prints a code, never the content', async () => {
    const f = setup(), broken = holdoutFile('placeholder'), file = broken.file, text = '[{"id": "H01", "title": Joana Secreta}]';
    writeFileSync(file, text); register(f.root, { sha256: sha(text), ids: ['H09'] }, 'broken-v1', 'test');
    const e = await refusal({ ...f, deps: { ...f.deps, env: { ...f.env, [SEALED_SHA_ENV]: sha(text) } } }, { holdout: file });
    expect((e as Error).message).toBe('HOLDOUT_PARSE');
    const invalid = holdoutFile([{ id: 'H01', title: 'Joana Secreta', capability: [], steps: [{ say: 'Joana', bogus: 1 }] }]);
    register(f.root, invalid, 'invalid-v1', 'test');
    expect(() => openSealedHoldout(invalid.file, { [SEALED_SHA_ENV]: invalid.sha256 }, [f.root], readHoldoutRegistry(f.root))).toThrow('AGENDA_SCENARIO_INVALID:H01:STEP');
    // Messages that quote text (JSON.parse, database drivers) collapse to SEALED_ERROR; details only for candidate diagnostics.
    let parseError: unknown; try { JSON.parse(text); } catch (x) { parseError = x; }
    expect(sealedErrorCode(parseError)).toBe('SEALED_ERROR');
    expect(JSON.stringify(sealedErrorPayload(parseError))).not.toContain('Joana');
    expect(sealedErrorPayload(Object.assign(Error('AGENDA_NOISE_INVARIANT'), { details: [{ id: 'H01', source: 'say:1' }] }))).toEqual({ status: 'BLOCKED', mode: 'SEALED', code: 'AGENDA_NOISE_INVARIANT' });
    expect(sealedErrorPayload(Object.assign(Error('CANDIDATE_DRIFT'), { details: { changed: { count: 1, paths: ['src/lib/a.ts'] } } })))
      .toEqual({ status: 'BLOCKED', mode: 'SEALED', code: 'CANDIDATE_DRIFT', details: { changed: { count: 1, paths: ['src/lib/a.ts'] } } });
    expect(sealedErrorPayload(Error('HOLDOUT_KIND'), 'VALIDATION')).toEqual({ status: 'BLOCKED', mode: 'VALIDATION', code: 'HOLDOUT_KIND' });
    expect(sealedErrorCode(Error('AGENDA_SCENARIO_INVALID:H01:STEP'))).toBe('AGENDA_SCENARIO_INVALID:H01:STEP');
    expect([failCode('MISSING Joana Secreta 10:00'), failCode('UNSAFE DOUBLE_BOOKING Joana'), failCode('INCOMPLETE AGENDA_STAGE_CAP'), failCode('texto livre')])
      .toEqual(['MISSING', 'DOUBLE_BOOKING', 'INCOMPLETE', 'OTHER']);
    expect(f.calls.run).toBe(0);
  });
});

describe('sealed holdout: frozen candidate', () => {
  it('refuses a missing candidate, a drifted working tree, other switches or another model, before the ledger or the run', async () => {
    const f = setup();
    expect(((await refusal(f, { candidate: '' })) as Error).message).toBe('CANDIDATE_REQUIRED');
    expect(((await refusal(f, { candidate: 'ffffffffffffffff' })) as Error).message).toBe('CANDIDATE_UNKNOWN');
    put(f.root, 'src/lib/secretary.ts', 'export const version = 2;\n');
    const drift = await refusal(f);
    expect(sealedErrorPayload(drift)).toMatchObject({ code: 'CANDIDATE_DRIFT', details: { changed: { count: 1, paths: ['src/lib/secretary.ts'] } } });
    put(f.root, 'src/lib/secretary.ts', 'export const version = 1;\n');
    const flags = await refusal({ ...f, deps: { ...f.deps, env: { ...f.env, SALON_SECRETARY_EXAMPLES: 'full', SALON_SECRETARY_TEMPORAL_COMPONENTS: 'true' } } });
    expect(sealedErrorPayload(flags)).toEqual({ status: 'BLOCKED', mode: 'SEALED', code: 'CANDIDATE_FLAGS_MISMATCH', details: { flags: ['SALON_SECRETARY_EXAMPLES', 'SALON_SECRETARY_TEMPORAL_COMPONENTS'] } });
    expect(f.calls).toEqual({ preflight: 0, run: 0 });
    expect(existsSync(f.ledger)).toBe(false);
  });
});

describe('sealed holdout: look budget, out-of-repo results and aggregate-only output', () => {
  it('preflight shows the remaining allowance without approval, ledger row or case content', async () => {
    const f = setup();
    const summary = await sealedAgendaPractice({ ...f.options, preflight: true }, { ...f.deps, env: { ...f.env, AGENDA_PRACTICE_REAL_APPROVED: undefined } });
    expect(summary).toMatchObject({ mode: 'SEALED', status: 'SEALED_PREFLIGHT_OK', holdout: { id: 'probe-v1', sha8: f.holdout.sha256.slice(0, 8) }, candidate: f.candidate, scenarios: 3,
      runnable: 3, skipped: 0, results: runsOf(f),
      allowance: { holdout: 'probe-v1', runs: 0, candidates: [], remainingCandidates: 2, candidateRuns: 0, remainingRunsForCandidate: 1, allowed: true, code: null } });
    expect(f.printed).toHaveLength(1);
    expect(leaks(f.printed[0])).toEqual([]);
    expect(withoutPaths(f.printed[0])).not.toMatch(/H0\d/); // the preflight carries counts only
    expect(existsSync(f.ledger)).toBe(false);
    expect(existsSync(runsOf(f))).toBe(false);
    expect(f.calls.run).toBe(0);
  });
  it('a real run needs the paid-run approval before its look is recorded', async () => {
    const f = setup();
    const e = await refusal({ ...f, deps: { ...f.deps, env: { ...f.env, AGENDA_PRACTICE_REAL_APPROVED: undefined } } });
    expect((e as Error).message).toBe('AGENDA_PRACTICE_NOT_APPROVED');
    expect(existsSync(f.ledger)).toBe(false);
    expect(f.calls.run).toBe(0);
  });
  it('records the look, writes every detail file OUTSIDE the checkout and prints only aggregates (no scenario id, no reason)', async () => {
    const f = setup();
    await sealedAgendaPractice(f.options, f.deps);
    expect(f.calls.run).toBe(1);
    const rows = readHoldoutUsage(f.ledger, f.root);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ seq: 0, holdoutId: 'probe-v1', holdoutSha256: f.holdout.sha256, candidate: f.candidate, scenarios: 3, k: 1 });
    expect(readHoldoutRegistry(f.root).holdouts[0].looks).toEqual([{ seq: 0, candidate: f.candidate, rowHash: rows[0].rowHash }]);
    // Nothing of the run lands in the checkout: the results live next to the holdout, in <folder>/runs.
    expect(existsSync(join(f.root, REPO_RESULTS))).toBe(false);
    const [dir] = readdirSync(runsOf(f)), out = join(runsOf(f), dir);
    expect(dir).toBe(rows[0].run);
    expect(dir).toMatch(new RegExp(`^sealed-probe-v1-${f.holdout.sha256.slice(0, 8)}-2026-09-28T12-01-00-000Z$`));
    expect(sealedRepoRoots(f.root).some(r => isInside(out, r))).toBe(false);
    // Transcripts, the captured process console, the full pass^k and the per-scenario table stay there for the coordinator.
    expect(readFileSync(join(out, 'k1', 'H01.json'), 'utf8')).toContain('Joana Secreta');
    const consoleFile = readFileSync(join(out, 'console.log'), 'utf8');
    expect(consoleFile).toContain('runtime log: Pronto, Joana Secreta marcada'); expect(consoleFile).toContain('stdout: Tatiana Rocha segredo'); expect(consoleFile).toContain('stderr: Corte Completo');
    expect(readFileSync(join(out, 'passk.json'), 'utf8')).toContain('MISSING Joana Secreta');
    expect(JSON.parse(readFileSync(join(out, 'sealed-scenarios.json'), 'utf8'))).toEqual({ scenariosOmitted: 0, scenarios: [
      { id: 'H01', c: 1, n: 1, attempts: ['PASS'], codes: [], safety: [] },
      { id: 'H02', c: 0, n: 1, attempts: ['FAIL'], codes: ['MISSING'], safety: [] },
      { id: 'H03', c: 0, n: 1, attempts: ['FAIL'], codes: ['UNEXPECTED_DB_CHANGE'], safety: ['WRITE_WHEN_NO_CHANGE_EXPECTED'] }] });
    expect(JSON.parse(readFileSync(join(out, RUN_MARKERS.SEALED), 'utf8'))).toMatchObject({ holdoutId: 'probe-v1', holdoutSha256: f.holdout.sha256, candidate: f.candidate, ledger: { seq: 0, id: rows[0].id } });
    // stdout and sealed-report.json: aggregates with intervals, per-family rates, SAFETY histogram and coverage only.
    expect(f.printed).toHaveLength(1);
    const report = readFileSync(join(out, 'sealed-report.json'), 'utf8');
    for (const text of [f.printed[0], report]) { expect(leaks(text)).toEqual([]); expect(withoutPaths(text)).not.toMatch(/H0\d|MISSING|UNEXPECTED_DB_CHANGE/); }
    const summary = JSON.parse(f.printed[0]);
    expect(summary).toEqual(JSON.parse(report));
    expect(summary).not.toHaveProperty('scenarios');
    expect(summary).toMatchObject({ mode: 'SEALED', status: 'COMPLETE', valid: true, failure: null, holdout: { id: 'probe-v1', sha8: f.holdout.sha256.slice(0, 8) }, candidate: f.candidate,
      candidateStillMatches: true, ledger: { seq: 0, id: rows[0].id }, repeat: 1, coverage: { expected: 3, graded: 3, missing: 0, incomplete: 0 },
      aggregate: { n: 3, pass1: 0.3333, passK: { 1: 0.3333 }, majority: { x: 1, n: 3 } }, byCapability: { create: { n: 3, pass1: 0.3333, lowN: true } }, familiesOmitted: 1,
      safety: { attempts: 1, scenarios: 1, codes: { WRITE_WHEN_NO_CHANGE_EXPECTED: 1 } }, versions: ['eeeeeeeeeeee'] });
    expect(summary.aggregate.ci.pass1).toEqual([expect.any(Number), expect.any(Number)]);
    expect(summary.aggregate.ci.pass1[0]).toBeLessThanOrEqual(0.3333); expect(summary.aggregate.ci.pass1[1]).toBeGreaterThanOrEqual(0.3333);
    expect(summary.method).toMatch(/expanded-percentile/);
  });
  it('allows one run per candidate and two candidates per LOGICAL holdout: a re-derived file does not reset it; a new holdout does', async () => {
    const f = setup();
    await sealedAgendaPractice(f.options, f.deps);
    expect(((await refusal(f)) as Error).message).toBe('HOLDOUT_CANDIDATE_USED');
    expect(f.calls.run).toBe(1);
    const again = await sealedAgendaPractice({ ...f.options, preflight: true }, f.deps);
    expect(again).toMatchObject({ status: 'HOLDOUT_CANDIDATE_USED', allowance: { runs: 1, candidates: [f.candidate], remainingCandidates: 1, allowed: false } });
    // Candidate 2: another flag set frozen on the same tree.
    const second = freeze(f.root, { SALON_SECRETARY_EXAMPLES: 'full' }), env2 = { ...f.env, SALON_SECRETARY_EXAMPLES: 'full' };
    await sealedAgendaPractice({ ...f.options, candidate: second }, { ...f.deps, env: env2 });
    expect(f.calls.run).toBe(2);
    // Candidate 3: refused by the ledger before the run, and the preflight says so.
    const third = freeze(f.root, { SALON_SECRETARY_EXAMPLES: 'off' }), env3 = { ...f.env, SALON_SECRETARY_EXAMPLES: 'off' };
    const e = await refusal({ ...f, deps: { ...f.deps, env: env3 } }, { candidate: third });
    expect((e as Error).message).toBe('HOLDOUT_EXHAUSTED');
    expect(await sealedAgendaPractice({ ...f.options, candidate: third, preflight: true }, { ...f.deps, env: env3 }))
      .toMatchObject({ status: 'HOLDOUT_EXHAUSTED', allowance: { runs: 2, remainingCandidates: 0, allowed: false, code: 'HOLDOUT_EXHAUSTED' } });
    // Re-deriving the holdout (other bytes, same logical id) keeps the budget: still exhausted.
    const rederived = holdoutFile([...HOLDOUT].reverse());
    register(f.root, rederived, 'probe-v1', 'test');
    expect(((await refusal({ ...f, deps: { ...f.deps, env: { ...env3, [SEALED_SHA_ENV]: rederived.sha256 } } }, { holdout: rederived.file, candidate: third })) as Error).message).toBe('HOLDOUT_EXHAUSTED');
    expect(f.calls.run).toBe(2);
    expect(readHoldoutUsage(f.ledger, f.root).map(r => r.candidate)).toEqual([f.candidate, second]);
    // A new logical holdout (new cases, registered under a new id) starts its own budget for the same candidate.
    const fresh = holdoutFile([scenario('H05', { unchanged: true }), scenario('H06', { unchanged: true })]);
    register(f.root, fresh, 'probe-v2', 'test');
    await sealedAgendaPractice({ ...f.options, holdout: fresh.file, candidate: third }, { ...f.deps, env: { ...env3, [SEALED_SHA_ENV]: fresh.sha256 } });
    expect(readHoldoutUsage(f.ledger, f.root).map(r => [r.holdoutId, r.scenarios])).toEqual([['probe-v1', 3], ['probe-v1', 3], ['probe-v2', 2]]);
  });
  it('an aborted run still consumes its look and still prints codes only', async () => {
    const f = setup();
    const deps: SealedDeps = { ...f.deps, run: async (scenarios, out) => { f.calls.run++; mkdirSync(out, { recursive: true }); throw Error('Invalid prisma invocation near "Joana Secreta"'); } };
    let thrown: unknown; try { await sealedAgendaPractice(f.options, deps); } catch (e) { thrown = e; }
    expect(sealedErrorPayload(thrown)).toEqual({ status: 'BLOCKED', mode: 'SEALED', code: 'SEALED_ERROR' });
    expect(readHoldoutUsage(f.ledger, f.root)).toHaveLength(1);
    expect(f.printed).toHaveLength(1);
    expect(leaks(f.printed[0])).toEqual([]);
    expect(JSON.parse(f.printed[0])).toMatchObject({ mode: 'SEALED', status: 'ABORTED', valid: false, failure: 'SEALED_ERROR', candidate: f.candidate });
    expect(((await refusal({ ...f, deps })) as Error).message).toBe('HOLDOUT_CANDIDATE_USED');
    expect(basename(readHoldoutUsage(f.ledger, f.root)[0].run)).toMatch(/^sealed-probe-v1-/);
  });
});

describe('validation set (choice drawer): registered, out of the repo, aggregates only, no holdout look', () => {
  function withValidation() {
    const f = setup(), set = holdoutFile(VALIDATION, 'validation-set-');
    register(f.root, set, 'choice-v1', 'validation');
    const { contract: _contract, ledger: _ledger, ...deps } = f.deps; void _contract; void _ledger;
    return { f, set, deps, runs: join(dirname(realpathSync(set.file)), OUTSIDE_RUNS) };
  }
  it('runs a registered validation file repeatedly without a candidate or a ledger row, printing aggregates only', async () => {
    const { f, set, deps, runs } = withValidation();
    const pre = await validationAgendaPractice({ holdout: set.file, repeat: 1, preflight: true }, { ...deps, env: { ...f.env, AGENDA_PRACTICE_REAL_APPROVED: undefined, [SEALED_SHA_ENV]: undefined } });
    expect(pre).toMatchObject({ mode: 'VALIDATION', status: 'VALIDATION_PREFLIGHT_OK', holdout: { id: 'choice-v1', sha8: set.sha256.slice(0, 8) }, scenarios: 2, priorRuns: 0, results: runs });
    expect(pre).not.toHaveProperty('allowance');
    await expect(validationAgendaPractice({ holdout: set.file, repeat: 1 }, { ...deps, env: { ...f.env, AGENDA_PRACTICE_REAL_APPROVED: undefined } })).rejects.toThrow('AGENDA_PRACTICE_NOT_APPROVED');
    for (const label of ['selected', 'off']) await validationAgendaPractice({ holdout: set.file, repeat: 1, label }, deps);
    expect(f.calls.run).toBe(2);
    expect(existsSync(f.ledger)).toBe(false); // no holdout look
    expect(readHoldoutRegistry(f.root).holdouts.find(h => h.id === 'choice-v1')?.looks).toEqual([]);
    expect(existsSync(join(f.root, REPO_RESULTS))).toBe(false);
    const dirs = readdirSync(runs).sort();
    expect(dirs).toEqual([expect.stringMatching(new RegExp(`^validation-choice-v1-${set.sha256.slice(0, 8)}-2026-09-28T12-01-00-000Z-selected$`)), expect.stringMatching(/T12-02-00-000Z-off$/)]);
    const printed = f.printed.slice(1);
    for (const text of printed) { expect(leaks(text)).toEqual([]); expect(withoutPaths(text)).not.toMatch(/Q0\d|MISSING/); expect(JSON.parse(text)).not.toHaveProperty('scenarios'); }
    expect(JSON.parse(printed[0])).toMatchObject({ mode: 'VALIDATION', status: 'COMPLETE', valid: true, candidate: null, ledger: null, aggregate: { n: 2, pass1: 0.5 } });
    expect(JSON.parse(readFileSync(join(runs, dirs[0], RUN_MARKERS.VALIDATION), 'utf8'))).toMatchObject({ holdoutId: 'choice-v1' });
    expect(readFileSync(join(runs, dirs[0], 'validation-scenarios.json'), 'utf8')).toContain('Q02');
    expect(await validationAgendaPractice({ holdout: set.file, repeat: 1, preflight: true }, deps)).toMatchObject({ priorRuns: 2 });
  });
  it('refuses a test holdout, an unregistered file and a file inside a checkout', async () => {
    const { f, set, deps } = withValidation();
    await expect(validationAgendaPractice({ holdout: f.holdout.file, repeat: 1, preflight: true }, deps)).rejects.toThrow('HOLDOUT_KIND');
    await expect(sealedAgendaPractice({ ...f.options, holdout: set.file }, { ...f.deps, env: { ...f.env, [SEALED_SHA_ENV]: set.sha256 } })).rejects.toThrow('HOLDOUT_KIND');
    const loose = holdoutFile([scenario('Q09', { unchanged: true })]);
    await expect(validationAgendaPractice({ holdout: loose.file, repeat: 1, preflight: true }, deps)).rejects.toThrow('HOLDOUT_NOT_REGISTERED');
    put(f.root, 'validation.json', readFileSync(set.file, 'utf8'));
    await expect(validationAgendaPractice({ holdout: join(f.root, 'validation.json'), repeat: 1, preflight: true }, deps)).rejects.toThrow('HOLDOUT_INSIDE_REPO');
    expect(f.calls).toEqual({ preflight: 0, run: 0 });
  });
});

describe('--stage in sealed and validation modes (final battery: final-20260929)', () => {
  /** The fake preflight/run record the stage they were given; the preflight reports it like the real one (default: reliability). */
  function staged() {
    const f = setup(), seen: { preflight: (string | undefined)[]; run: (string | undefined)[] } = { preflight: [], run: [] };
    const deps: SealedDeps = { ...f.deps,
      preflight: (scenarios, opts) => { seen.preflight.push(opts.stage); return { ...(f.deps.preflight(scenarios, opts) as object), stage: { name: opts.stage ?? 'reliability-20260927' } } as never; },
      run: async (scenarios, out, opts) => { seen.run.push(opts.stage); await f.deps.run(scenarios, out, opts); } };
    const set = holdoutFile(VALIDATION, 'validation-set-'); register(f.root, set, 'choice-v1', 'validation');
    return { f, deps, seen, set };
  }
  it('passes the stage to the preflight and to the run, and records it in the preflight summary and the run marker', async () => {
    const { f, deps, seen, set } = staged();
    expect(await sealedAgendaPractice({ ...f.options, stage: 'final-20260929', preflight: true }, deps)).toMatchObject({ status: 'SEALED_PREFLIGHT_OK', stage: 'final-20260929' });
    await sealedAgendaPractice({ ...f.options, stage: 'final-20260929' }, deps);
    const [dir] = readdirSync(runsOf(f));
    expect(JSON.parse(readFileSync(join(runsOf(f), dir, RUN_MARKERS.SEALED), 'utf8'))).toMatchObject({ holdoutId: 'probe-v1', stage: 'final-20260929' });
    const { contract: _contract, ledger: _ledger, ...outside } = deps; void _contract; void _ledger;
    expect(await validationAgendaPractice({ holdout: set.file, repeat: 1, stage: 'final-20260929', preflight: true }, outside)).toMatchObject({ status: 'VALIDATION_PREFLIGHT_OK', stage: 'final-20260929' });
    await validationAgendaPractice({ holdout: set.file, repeat: 1, stage: 'final-20260929' }, outside);
    const runs = join(dirname(realpathSync(set.file)), OUTSIDE_RUNS), [vdir] = readdirSync(runs);
    expect(JSON.parse(readFileSync(join(runs, vdir, RUN_MARKERS.VALIDATION), 'utf8'))).toMatchObject({ holdoutId: 'choice-v1', stage: 'final-20260929' });
    // Without --stage the runner's default applies (the option stays undefined).
    await validationAgendaPractice({ holdout: set.file, repeat: 1, preflight: true }, outside);
    expect(seen).toEqual({ preflight: ['final-20260929', 'final-20260929', 'final-20260929', 'final-20260929', undefined], run: ['final-20260929', 'final-20260929'] });
  });
  it('refuses an unknown stage before the holdout is opened: no preflight, look, run or output', async () => {
    const { f, deps, seen, set } = staged();
    for (const stage of ['final-20260928', 'toString', '']) {
      await expect(sealedAgendaPractice({ ...f.options, stage }, deps)).rejects.toThrow('AGENDA_STAGE_UNKNOWN');
      await expect(sealedAgendaPractice({ ...f.options, stage, holdout: join(f.holdout.file, '..', 'missing.json') }, deps)).rejects.toThrow('AGENDA_STAGE_UNKNOWN');
      await expect(validationAgendaPractice({ holdout: set.file, repeat: 1, stage, preflight: true }, deps)).rejects.toThrow('AGENDA_STAGE_UNKNOWN');
    }
    expect(sealedErrorPayload(Error('AGENDA_STAGE_UNKNOWN'))).toEqual({ status: 'BLOCKED', mode: 'SEALED', code: 'AGENDA_STAGE_UNKNOWN' });
    expect(seen).toEqual({ preflight: [], run: [] });
    expect(existsSync(f.ledger)).toBe(false); expect(existsSync(runsOf(f))).toBe(false); expect(f.printed).toEqual([]);
  });
});

describe('pass^k tool on a sealed run folder', () => {
  const cli = join(process.cwd(), 'packages/salon-secretary/evaluation/agenda-practice-passk.cjs');
  const passk = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: process.cwd() });
  it('refuses the per-scenario table (ids and reasons) unless the coordinator asks; --aggregate prints STATS only and writes nothing', async () => {
    const f = setup();
    await sealedAgendaPractice(f.options, f.deps);
    const [dir] = readdirSync(runsOf(f)), out = join(runsOf(f), dir), before = readdirSync(out).sort();
    const detail = passk(out, '--no-write');
    expect(detail.status).toBe(2);
    expect(detail.stderr).toContain('BLOCKED AGENDA_PASSK_PROTECTED_RUN'); expect(detail.stderr).toContain('SEALED_RUN');
    expect(detail.stdout).toBe('');
    const aggregate = passk(out, '--aggregate');
    expect(aggregate.status).toBe(0);
    expect(aggregate.stdout).toMatch(/^RUN synthetic K=1 valid scenarios=3 coverage=3\/3 noise=off safety attempts=1 \{"WRITE_WHEN_NO_CHANGE_EXPECTED":1\}$/m);
    expect(aggregate.stdout).toMatch(/^STATS 95% expanded-percentile/m);
    expect(aggregate.stdout).toContain('1 capability label(s) that are not plain codes omitted');
    expect(leaks(aggregate.stdout)).toEqual([]); expect(aggregate.stdout).not.toMatch(/H0\d|MISSING/);
    expect(readdirSync(out).sort()).toEqual(before);
    const coordinator = passk(out, '--no-write', '--coordinator');
    expect(coordinator.status).toBe(0);
    expect(coordinator.stdout).toMatch(/^H02 /m);
  }, 90_000);
});
