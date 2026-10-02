/** Sealed and validation modes of the Agenda practice runner (28/09/2026; docs/SECRETARY_EVALUATION_METHODOLOGY.md R1-R3):
 *   node scripts/run-agenda-practice.cjs --sealed <file outside the repo> --candidate <versionId> [--stage s] [--repeat K] [--preflight]
 *   node scripts/run-agenda-practice.cjs --validation <file outside the repo> [--stage s] [--repeat K] [--noise p] [--label x] [--preflight]
 * `--stage` picks the reservation journal (final battery: final-20260929); the program real-spend ledger applies anyway.
 * In order, before any database, ledger write or network:
 * 1. the file lives outside every checkout and its sha256 is an approved file of the tracked registry
 *    (holdout-registry.json) of the right kind (sealed: a test holdout, also equal to AGENDA_HOLDOUT_APPROVED_SHA256;
 *    validation: the choice drawer), not retired; checked before the file is parsed. Its results folder
 *    `<folder of the file>/runs` must be outside every checkout too (SEALED_RESULTS_INSIDE_REPO);
 * 2. (sealed) the working tree still is the frozen candidate (CANDIDATE_DRIFT), with the candidate's SALON_SECRETARY_*
 *    switches and model (CANDIDATE_FLAGS_MISMATCH / CANDIDATE_MODEL_MISMATCH);
 * 3. (sealed) the ledger admits the look for the LOGICAL holdout (HOLDOUT_CANDIDATE_USED / HOLDOUT_EXHAUSTED);
 *    `--preflight` stops here and shows the remaining allowance; a real run appends its ledger row, then runs.
 * 4. (F1, sealed and validation, before the look) infrastructure preflight, in order: the per-stage run lease (a second runner
 *    is AGENDA_STAGE_BUSY, a dead holder AGENDA_STAGE_LEASE_STALE until the operator releases it), the program-wide proof lease
 *    (while it is held the program ledger admits no other paid call, any stage or runner: PROGRAM_SPEND_PROOF_BUSY/_STALE),
 *    probes of the stage lock and the program-ledger lock (a lock left by a killed process is reported here), the read-only
 *    database identity (injected), the stage headroom under the lease, the program ledger's money left for the run's bound
 *    (PROGRAM_SPEND_HEADROOM, or its hard stop) and the reachable-day window (F2). Only then is the look recorded; the runner
 *    gets the same preflight and both leases (never recomputed), and the leases are released after the run.
 * Every detail file (transcripts, report, full pass^k, the per-scenario id + code table and the captured process
 * console) goes to `<folder of the file>/runs/<mode>-<holdout id>-<sha8>-<ts>`: never inside a checkout, so no
 * implementer can read it by path and nobody has to move it. stdout and <mode>-report.json carry ONLY aggregates:
 * pass^1/pass^k with intervals, per-family rates (n<5 flagged), the SAFETY histogram, coverage and counts; never a
 * scenario id, message, name, oracle or reason. A validation run spends no holdout look (the choice drawer may be run
 * again to choose between variants); `priorRuns` counts the earlier validation runs of the same file. */
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { format } from 'node:util';
import { DEFAULT_OUTPUT_TOKENS, LEGACY_CHECK_PATH, PRICE, acquireStageLease, agendaStage, assertHeadroom, buildPasskReport, probeExclusiveLock, probeStageLock, releaseStageLease,
  stageTotals, todayInSaoPaulo, validateScenarios, type AgendaScenario, type StageLease } from './agenda-practice-lib';
import { SAFE_LABEL, type Interval, type Proportion } from './agenda-practice-stats';
import { candidateFlagMismatch, gitRunner, verifyCandidate, type CandidateContract, type CandidateManifest, type GitRunner } from './candidate-freeze';
import { holdoutAllowance, holdoutUsageLedgerPath, readHoldoutRegistry, readHoldoutUsage, recordSealedRun, registeredHoldoutMatch, type HoldoutAllowance, type HoldoutRegistry,
  type RegistryEntry } from './holdout-usage';
import { acquireProofLease, programSpendLedgerPath, programSpendSummary, programSpendTotals, readProgramLedger, releaseProofLease, worstCaseMicroUsd,
  type ProofLease } from './program-spend';
import type { AgendaRunInput, AgendaRunOptions, preflightAgendaPractice } from './agenda-practice';

export const SEALED_SHA_ENV = 'AGENDA_HOLDOUT_APPROVED_SHA256';
/** Results folder of normal runs, inside the checkout: sealed and validation runs never write there. */
export const REPO_RESULTS = 'packages/salon-secretary/evaluation/results/agenda-core';
/** Sealed and validation results: `<folder of the holdout file>/runs`, outside every checkout. */
export const OUTSIDE_RUNS = 'runs';
export type OutsideMode = 'SEALED' | 'VALIDATION';
/** Marker file of a sealed or validation run folder: the pass^k tool refuses the per-scenario table there. */
export const RUN_MARKERS: Readonly<Record<OutsideMode, string>> = Object.freeze({ SEALED: 'sealed-run.json', VALIDATION: 'validation-run.json' });
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const fold = (p: string) => process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p);
export function isInside(child: string, parent: string) {
  const rel = relative(fold(parent), fold(child));
  return rel === '' || (!isAbsolute(rel) && rel.split(/[\\/]/)[0] !== '..');
}
/** The worktree, its git top level and the main checkout (parent of the common git dir), as given and as real paths. */
export function sealedRepoRoots(root: string, git: GitRunner = gitRunner) {
  const roots = [root];
  try { roots.push(git(root, ['rev-parse', '--show-toplevel']).trim()); } catch { /* not a git checkout: the root alone */ }
  try { roots.push(dirname(git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim())); } catch { /* idem */ }
  return [...new Set(roots.filter(Boolean).flatMap(r => { try { return [resolve(r), realpathSync(r)]; } catch { return [resolve(r)]; } }))];
}
/** A non-sealed run reads scenario files from a checkout only: a file outside (as given or as its real path, so no link
 * or junction either) is a sealed holdout or the validation set, readable through --sealed / --validation alone. */
export function assertScenarioFilesInCheckout(files: string[], roots: string[]) {
  for (const f of files) {
    const file = resolve(f); let real = file; try { real = realpathSync(file); } catch { /* a missing file fails when read */ }
    if (!roots.some(root => isInside(file, root)) || !roots.some(root => isInside(real, root))) throw Error('AGENDA_SCENARIOS_OUTSIDE_REPO');
  }
}
/** A normal run never runs a registered holdout or validation file (a copy placed in the repo, re-formatted, or a
 * subset): refused by sha256 or by any scenario id an approved file registered, unless that holdout was retired. */
export function assertNotRegisteredHoldout(files: string[], registry: HoldoutRegistry) {
  for (const f of files) {
    const bytes = readFileSync(resolve(f)); let ids: string[] = [];
    try {
      const list = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')) as unknown;
      if (Array.isArray(list)) ids = list.flatMap(s => s && typeof s === 'object' && typeof (s as { id?: unknown }).id === 'string' ? [(s as { id: string }).id] : []);
    } catch { /* not JSON: refused when parsed */ }
    const match = registeredHoldoutMatch(registry, sha256(bytes), ids);
    if (match) throw Error(`AGENDA_SCENARIOS_REGISTERED_HOLDOUT:${match}`);
  }
}
export type SealedHoldout = { sha256: string; sha8: string; scenarios: AgendaScenario[]; holdout: RegistryEntry; results: string };
/** `<folder of the file>/runs`, refused when it (or its real path, once it exists) lies inside a checkout. */
export function outsideResults(realFile: string, roots: string[]) {
  const dir = join(dirname(realFile), OUTSIDE_RUNS); let real = dir; try { real = realpathSync(dir); } catch { /* created by the run */ }
  if (roots.some(root => isInside(dir, root) || isInside(real, root))) throw Error('SEALED_RESULTS_INSIDE_REPO');
  return dir;
}
/** Location, approval and registry first; the bytes are parsed only when their sha256 is an approved file of the right kind. */
export function openSealedHoldout(path: string, env: Record<string, string | undefined>, roots: string[], registry: HoldoutRegistry, mode: OutsideMode = 'SEALED'): SealedHoldout {
  const approved = String(env[SEALED_SHA_ENV] ?? '').trim().toLowerCase();
  if (mode === 'SEALED' && !/^[0-9a-f]{64}$/.test(approved)) throw Error('HOLDOUT_SHA_NOT_APPROVED');
  if (typeof path !== 'string' || !path) throw Error('HOLDOUT_FILE');
  const file = resolve(path); let real: string;
  try { real = realpathSync(file); if (!statSync(real).isFile()) throw Error(); } catch { throw Error('HOLDOUT_FILE'); }
  if (roots.some(root => isInside(file, root) || isInside(real, root))) throw Error('HOLDOUT_INSIDE_REPO');
  const bytes = readFileSync(real), sha = sha256(bytes);
  if (mode === 'SEALED' && sha !== approved) throw Error('HOLDOUT_SHA_MISMATCH');
  const holdout = registry.holdouts.find(h => h.approved.some(a => a.sha256 === sha));
  if (!holdout) throw Error('HOLDOUT_NOT_REGISTERED');
  if (holdout.kind !== (mode === 'SEALED' ? 'test' : 'validation')) throw Error('HOLDOUT_KIND');
  if (holdout.retired) throw Error('HOLDOUT_RETIRED');
  const results = outsideResults(real, roots);
  let parsed: unknown; try { parsed = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); } catch { throw Error('HOLDOUT_PARSE'); }
  const scenarios = validateScenarios(parsed); // AGENDA_SCENARIO_INVALID:<id>:<code> only
  const ids = holdout.approved.find(a => a.sha256 === sha)!.ids;
  if (ids && ids.join() !== [...new Set(scenarios.map(s => s.id))].sort().join()) throw Error('HOLDOUT_REGISTRY_MISMATCH');
  return { sha256: sha, sha8: sha.slice(0, 8), scenarios, holdout, results };
}

// ---------------------------------------------------------------- codes-only output
const ERROR_CODE = /^[A-Z][A-Z0-9_]{2,63}(?::[A-Za-z0-9_.#+*-]{1,40}){0,3}$/;
/** A thrown message is printed only when it is a code (a JSON.parse or database message may quote case text). */
export const sealedErrorCode = (error: unknown) => error instanceof Error && ERROR_CODE.test(error.message) ? error.message : 'SEALED_ERROR';
export function sealedErrorPayload(error: unknown, mode: OutsideMode = 'SEALED') {
  const code = sealedErrorCode(error), details = error && typeof error === 'object' && 'details' in error ? (error as { details: unknown }).details : undefined;
  // Candidate diagnostics carry repository paths and switch names only (never holdout content); nothing else has details.
  return { status: 'BLOCKED', mode, code, ...(code.startsWith('CANDIDATE_') && details ? { details } : {}) };
}
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/, SAFETY = /^[A-Z][A-Z0-9_]{1,63}(?::[a-z][a-z0-9_]{0,40})?$/, ID = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const token = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(v) ? v : v === null || v === undefined ? null : 'OTHER';
/** Leading code of a grader reason ('MISSING <row>' -> MISSING, 'UNSAFE DOUBLE_BOOKING <row>' -> DOUBLE_BOOKING); else OTHER. */
export function failCode(why: string) {
  const [head, next] = String(why).split(' ');
  return head === 'UNSAFE' && next && CODE.test(next) ? next : CODE.test(head) ? head : 'OTHER';
}
type Passk = ReturnType<typeof buildPasskReport>;
const round = (v: number | null | undefined) => v === null || v === undefined ? null : Number(v.toFixed(4));
const range = (i: Pick<Interval | Proportion, 'lower' | 'upper'> | undefined) => i && i.lower !== null && i.upper !== null ? [round(i.lower), round(i.upper)] : null;
const rates = (a: { scenarios: number; pass1: number | null; passK: Record<number, number | null> }) =>
  ({ n: a.scenarios, pass1: round(a.pass1), passK: Object.fromEntries(Object.entries(a.passK).map(([k, v]) => [k, round(v)])) });
export type SealedContext = { mode: OutsideMode; holdout: { id: string; sha8: string }; candidate: string | null; out: string; ledger: { seq: number; id: string } | null;
  candidateStillMatches: boolean | null; failure?: string | null };
/** Aggregates only: pass^1 and pass^k with 95% intervals, the majority Wilson, per-family rates and intervals (n<5 flagged;
 * free-text family labels omitted), the SAFETY histogram, coverage and counts. No scenario id and no reason. */
export function sealedSummary(r: Passk, ctx: SealedContext) {
  const safetyCodes: Record<string, number> = {};
  // A discarded (rollover) attempt's unsafe write is a safety failure of the run too (it also makes the run not valid).
  const unsafe = [...r.safety, ...(r.discardedSafety ?? [])];
  for (const s of unsafe) for (const c of s.codes) { const code = SAFETY.test(c) ? c : 'OTHER'; safetyCodes[code] = (safetyCodes[code] ?? 0) + 1; }
  const families = Object.entries(r.byCapability).filter(([family]) => SAFE_LABEL.test(family));
  // A run that threw, left no report or graded nothing is never a valid measurement.
  const valid = r.valid && !ctx.failure && r.run !== null && r.coverage.expected > 0;
  return { mode: ctx.mode, status: ctx.failure ? 'ABORTED' : token(r.status), valid, abort: token(r.abort) === null ? null : failCode(String(r.abort)), failure: ctx.failure ?? null,
    holdout: ctx.holdout, candidate: ctx.candidate, candidateStillMatches: ctx.candidateStillMatches, ledger: ctx.ledger, out: ctx.out,
    stage: token(r.stage), today: r.today.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)), repeat: r.repeat, versions: r.versions.map(v => /^[0-9a-f]{12,64}$/.test(v) ? v.slice(0, 12) : 'OTHER'),
    coverage: { expected: r.coverage.expected, graded: r.coverage.graded, missing: r.coverage.missing.length, incomplete: r.coverage.incomplete, unknownScenarios: r.coverage.unknownScenarios },
    method: r.stats.method,
    aggregate: { ...rates(r.aggregate), ci: { pass1: range(r.stats.pass1), passK: Object.fromEntries(Object.entries(r.stats.passK).map(([k, i]) => [k, range(i)])) },
      majority: { x: r.stats.majority.x, n: r.stats.majority.n, ci: range(r.stats.majority) } },
    byCapability: Object.fromEntries(families.map(([family, a]) => [family, { ...rates(a), ci: range(r.stats.byCapability[family]?.pass1), ...(a.scenarios < 5 ? { lowN: true } : {}) }])),
    familiesOmitted: Object.keys(r.byCapability).length - families.length,
    byNoise: Object.fromEntries(Object.entries(r.byNoise).filter(([level]) => SAFE_LABEL.test(level)).map(([level, t]) => [level, { attempts: t.attempts, passed: t.passed }])),
    safety: { attempts: unsafe.length, scenarios: new Set(unsafe.map(s => s.id)).size, codes: safetyCodes, discardedAttempts: r.discardedSafety?.length ?? 0 },
    invalid: r.invalid.length, incomplete: r.incomplete.length, flaky: r.flaky.length, skipped: r.skipped.length,
    // F2: graded attempts per run day (a run spanning midnight shows both days), rollover reruns and mixed-day grader errors (counts only).
    byDay: Object.fromEntries(Object.entries(r.byDay ?? {}).filter(([d]) => /^\d{4}-\d{2}-\d{2}$/.test(d)).map(([d, t]) => [d, { attempts: t.attempts, passed: t.passed }])),
    reruns: r.reruns?.length ?? 0, discarded: r.discarded?.length ?? 0, graderErrors: r.graderErrors?.length ?? 0,
    turns: { count: r.turns.count, per100: r.turns.per100 }, latencyMs: r.latencyMs, callLatencyMs: r.callLatencyMs, cost: r.cost, calls: r.usage.calls };
}
/** Per scenario: id, c/n, PASS/FAIL/NOT_GRADED per attempt and grader codes. For the coordinator and the owner: written
 * only to the out-of-repo run folder, never printed. */
export function sealedScenarioTable(r: Passk) {
  const ids = r.scenarios.filter(s => ID.test(s.id));
  return { scenarios: ids.map(s => ({ id: s.id, c: s.c, n: s.n, attempts: s.attempts.map(a => a.ok ? 'PASS' : a.missing ? 'NOT_GRADED' : 'FAIL'),
    codes: [...new Set(s.attempts.flatMap(a => a.why.map(failCode)))].sort(), safety: [...new Set(s.attempts.flatMap(a => a.safety).map(c => SAFETY.test(c) ? c : 'OTHER'))].sort(),
    ...(s.attempts.some(a => a.invalid) ? { invalid: true } : {}) })), scenariosOmitted: r.scenarios.length - ids.length };
}
/** Everything the run process prints (runtime, Prisma, libraries) goes to <out>/console.log while the run is active. */
export function captureProcessOutput(file: string) {
  const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const, saved = methods.map(m => console[m]);
  const stdout = process.stdout.write, stderr = process.stderr.write;
  const sink = (chunk: unknown) => { try { appendFileSync(file, typeof chunk === 'string' || chunk instanceof Uint8Array ? chunk : String(chunk)); } catch { /* never fails the run */ } };
  for (const m of methods) (console as unknown as Record<string, unknown>)[m] = (...args: unknown[]) => sink(format(...args) + '\n');
  const writer = (chunk: unknown, encodingOrDone?: unknown, done?: unknown) => {
    sink(chunk); const callback = typeof encodingOrDone === 'function' ? encodingOrDone : done; if (typeof callback === 'function') callback(); return true;
  };
  process.stdout.write = writer as typeof process.stdout.write; process.stderr.write = writer as typeof process.stderr.write;
  return () => { methods.forEach((m, i) => { (console as unknown as Record<string, unknown>)[m] = saved[i]; }); process.stdout.write = stdout; process.stderr.write = stderr; };
}

// ---------------------------------------------------------------- orchestration
type Preflight = ReturnType<typeof preflightAgendaPractice>;
export type SealedOptions = { holdout: string; candidate: string; preflight?: boolean; stage?: string; repeat?: number; maxRequests?: number; closedDay?: 'skip' | 'fail';
  noise?: AgendaRunOptions['noise']; /** review H2: the run's own dollar ceiling (AgendaRunOptions.runCapUsd) */ runCapUsd?: number };
export type ValidationOptions = Omit<SealedOptions, 'candidate'> & { label?: string };
/** F1 infrastructure preflight steps (each injectable; defaults below). All run before the look; any failure releases the
 * leases and stops with a code, the look and the holdout ledger untouched. `proof`: the program-wide proof lease (no other
 * paid run, whatever its stage or runner, is admitted while it is held); `program`: the program ledger can pay the run. */
export type InfrastructureDeps = {
  lease: (pre: Preflight, run: string) => StageLease; proof: (pre: Preflight, run: string) => ProofLease; probes: (pre: Preflight) => void; identity: () => Promise<unknown>;
  headroom: (pre: Preflight) => void; program: (pre: Preflight) => void; dayWindow: (pre: Preflight, closedDay: 'skip' | 'fail', now: Date) => void;
  release: (lease: StageLease, pre: Preflight) => void; releaseProof: (proof: ProofLease, pre: Preflight) => void };
export type OutsideDeps = { root: string; env: Record<string, string | undefined>; print: (line: string) => void;
  /** preflightAgendaPractice / runAgendaPractice (injected: this module never loads the database or the secretary) */
  preflight: (scenarios: AgendaScenario[], opts: AgendaRunOptions) => Preflight; run: (scenarios: AgendaScenario[], out: string, opts: AgendaRunInput) => Promise<unknown>;
  /** F1/F4: read-only identity of the local disposable database (agendaDatabaseIdentity); required for a real run. */
  identity?: () => Promise<unknown>; infrastructure?: Partial<InfrastructureDeps>;
  roots?: string[]; git?: GitRunner; now?: () => Date; registry?: HoldoutRegistry };
export type SealedDeps = OutsideDeps & { contract: (flags: Record<string, string>) => CandidateContract | null; ledger?: string };
/** A unit test never probes the real program ledger's lock (a vitest worker or the VITEST variable). */
const unitTest = () => !!process.env.VITEST || typeof Reflect.get(globalThis, '__vitest_worker__') === 'object';
const samePath = (a: string, b: string) => fold(a) === fold(b);
/** The program ledger of a preflight (a unit test never uses the real one here). */
function programLedgerOf(pre: Preflight) {
  if (typeof pre.programLedger !== 'string' || !pre.programLedger) throw Error('PROGRAM_SPEND_CONFIG');
  if (unitTest() && samePath(pre.programLedger, programSpendLedgerPath())) throw Error('PROGRAM_SPEND_TEST_LEDGER');
  return pre.programLedger;
}
/** Settled Luna calls needed before their mean charge replaces the worst case in the program bound. */
export const PROGRAM_HEADROOM_MIN_SETTLED = 20;
/** F1 (program ledger, before the look, under the proof lease so no other run spends meanwhile): the run must fit the program's
 * remaining real money. Bound = maxRequests (the run's hard request cap, which already reserves one repair per say: about twice
 * the calls runs make) x the mean charge of the Luna calls the ledger settled from usage, + one worst-case call (the one in
 * flight when the cap is reached). Fewer than PROGRAM_HEADROOM_MIN_SETTLED settled calls: every call at its worst case. A hard
 * stop (a call beyond the sealed bound, spending over the cap) is refused whatever is left. */
export function programRunBound(input: { remainingMicroUsd: number; hardStop: string | null; settledMicroUsd: readonly number[] }, maxRequests: number, worstCaseMicroUsd: number) {
  if (input.hardStop) throw Error(input.hardStop);
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || !Number.isSafeInteger(worstCaseMicroUsd) || worstCaseMicroUsd < 1 || !Number.isFinite(input.remainingMicroUsd) ||
    input.settledMicroUsd.some(x => !Number.isSafeInteger(x) || x < 0)) throw Error('PROGRAM_SPEND_HEADROOM');
  const n = input.settledMicroUsd.length, mean = n >= PROGRAM_HEADROOM_MIN_SETTLED ? Math.ceil(input.settledMicroUsd.reduce((s, x) => s + x, 0) / n) : worstCaseMicroUsd;
  const perCallMicroUsd = Math.min(mean, worstCaseMicroUsd), requiredMicroUsd = maxRequests * perCallMicroUsd + worstCaseMicroUsd;
  if (requiredMicroUsd > input.remainingMicroUsd) throw Object.assign(Error('PROGRAM_SPEND_HEADROOM'), { details: { requiredUsd: requiredMicroUsd / 1e6,
    remainingUsd: input.remainingMicroUsd / 1e6, maxRequests, perCallUsd: perCallMicroUsd / 1e6, settledCalls: n } });
  return { maxRequests, perCallMicroUsd, worstCaseMicroUsd, settledCalls: n, requiredMicroUsd, remainingMicroUsd: input.remainingMicroUsd };
}
/** The program bound of a run from the ledger itself (read-only; the whole chain is validated). The per-call worst case is the
 * largest request the stage admits (PRICE.maxInput) at the run's output cap. `snapshot` (the preflight's earlier totals): its
 * hard stop refuses too, and the smaller of the two remainders counts. */
export function assertProgramRunHeadroom(ledger: string, maxRequests: number, maxOutputTokens: unknown, snapshot?: { remainingMicroUsd?: unknown; hardStop?: unknown } | null) {
  const totals = programSpendTotals(ledger), rows = readProgramLedger(ledger);
  const luna = new Set(rows.flatMap(r => r.kind === 'RESERVE' && r.estimator === 'responses' ? [r.id] : []));
  const settledMicroUsd = rows.flatMap(r => r.kind === 'SETTLE' && r.outcome === 'USAGE' && luna.has(r.id) ? [r.chargedMicroUsd] : []);
  const out = Number.isSafeInteger(maxOutputTokens) && (maxOutputTokens as number) >= 1 ? maxOutputTokens as number : DEFAULT_OUTPUT_TOKENS;
  const left = snapshot?.remainingMicroUsd, stop = snapshot?.hardStop, earlier = typeof left === 'number' ? left : Number.POSITIVE_INFINITY;
  const earlierStop: string | null = stop === 'PROGRAM_SPEND_BOUND' || stop === 'PROGRAM_SPEND_CAP' ? stop : stop ? 'PROGRAM_SPEND_HEADROOM' : null;
  const hardStop: string | null = totals.hardStop ?? earlierStop;
  return programRunBound({ remainingMicroUsd: Math.min(totals.remainingMicroUsd, earlier), hardStop, settledMicroUsd }, maxRequests, worstCaseMicroUsd(PRICE.maxInput - PRICE.framing, out));
}
function defaultInfrastructure(d: OutsideDeps): InfrastructureDeps {
  return {
    lease: (pre, run) => acquireStageLease(pre.stageFile, pre.stage.name, run),
    proof: (pre, run) => acquireProofLease(programLedgerOf(pre), run),
    probes: pre => {
      probeStageLock(pre.stageFile, pre.stage.name);
      probeExclusiveLock(programLedgerOf(pre) + '.lock', 'PROGRAM_SPEND_LOCKED');
    },
    identity: async () => { if (!d.identity) throw Error('SEALED_IDENTITY_UNWIRED'); return d.identity(); },
    // Under the lease no other runner can reserve: the headroom the preflight saw must still be there.
    headroom: pre => { const t = stageTotals(pre.stageFile, pre.stage.name); if (pre.estimate.requiredMicroUsd > t.remainingMicroUsd) throw Error('AGENDA_STAGE_HEADROOM'); },
    program: pre => { assertProgramRunHeadroom(programLedgerOf(pre), pre.estimate.maxRequests, pre.maxOutputTokens, pre.programSpend); },
    dayWindow: (pre, closedDay, now) => assertDayWindow(pre, closedDay, now),
    release: (lease, pre) => releaseStageLease(lease, pre.stageFile, pre.stage.name),
    releaseProof: (proof, pre) => releaseProofLease(proof, programLedgerOf(pre)),
  };
}
/** F2: the run starts on a day the preflight's window covers, and (closed-day fail) no runnable scenario is SKIP on a later
 * reachable day. A preflight without a window is refused (fail closed). */
export function assertDayWindow(pre: Pick<Preflight, 'dayWindow'>, closedDay: 'skip' | 'fail', now: Date) {
  const w = pre.dayWindow;
  if (!w || !Array.isArray(w.days) || !w.days.length || !Array.isArray(w.rolloverSkips)) throw Error('AGENDA_DAY_WINDOW_UNKNOWN');
  if (!w.days.includes(todayInSaoPaulo(now))) throw Error('AGENDA_DAY_WINDOW_STALE');
  if (closedDay === 'fail' && w.rolloverSkips.length) throw Error('AGENDA_CLOSED_DAY');
}
/** stage lease -> proof lease -> probes -> identity -> stage headroom -> program headroom -> day window, all before the look;
 * both leases are released on any failure (and after the run). */
async function infrastructurePreflight(pre: Preflight, run: string, closedDay: 'skip' | 'fail', now: Date, d: OutsideDeps) {
  const infra: InfrastructureDeps = { ...defaultInfrastructure(d), ...d.infrastructure };
  const lease = infra.lease(pre, run);
  let released = false, proof: ProofLease | undefined;
  const release = () => {
    if (released) return; released = true; let failure: unknown;
    if (proof) try { infra.releaseProof(proof, pre); } catch (e) { failure = e; }
    try { infra.release(lease, pre); } catch (e) { failure ??= e; }
    if (failure !== undefined) throw failure;
  };
  try {
    proof = infra.proof(pre, run);
    infra.probes(pre);
    const identity = await infra.identity();
    infra.headroom(pre);
    infra.program(pre);
    infra.dayWindow(pre, closedDay, now);
    return { lease, proof, identity, release };
  } catch (e) { try { release(); } catch { /* the original refusal is the one reported */ } throw e; }
}
/** After the run: a lease that cannot be released stays (the next run is refused, fail closed); only a code is printed. */
const releaseQuietly = (release: () => void) => { try { release(); } catch { process.stderr.write('AGENDA_STAGE_LEASE_RELEASE_FAILED\n'); } };
function assertCandidate(versionId: string, d: SealedDeps): CandidateManifest {
  const manifest = verifyCandidate({ root: d.root, versionId, contract: d.contract, git: d.git });
  const flags = candidateFlagMismatch(manifest, d.env);
  if (flags.length) throw Object.assign(Error('CANDIDATE_FLAGS_MISMATCH'), { details: { flags } });
  if (d.env.SALON_SECRETARY_MODEL !== manifest.model) throw Error('CANDIDATE_MODEL_MISMATCH');
  return manifest;
}
function preflightSummary(mode: OutsideMode, pre: Preflight, h: SealedHoldout, closedDay: 'skip' | 'fail', extra: { candidate?: string; allowance?: HoldoutAllowance; priorRuns?: number }) {
  const e = pre.estimate, closed = closedDay === 'fail' && (pre.skipped.length > 0 || (pre.dayWindow?.rolloverSkips.length ?? 0) > 0);
  return { mode, status: extra.allowance?.code ?? (!pre.runnable.length ? 'AGENDA_SEALED_EMPTY' : closed ? 'AGENDA_CLOSED_DAY' : !e.ok ? 'AGENDA_STAGE_HEADROOM' : `${mode}_PREFLIGHT_OK`),
    holdout: { id: h.holdout.id, sha8: h.sha8 }, ...(extra.candidate ? { candidate: extra.candidate } : {}), stage: pre.stage.name, today: pre.today, repeat: pre.repeat, closedDay,
    scenarios: h.scenarios.length, runnable: pre.runnable.length, skipped: pre.skipped.length,
    noise: { profile: pre.noise.profile, levels: pre.noise.levels, texts: pre.noise.texts, changed: pre.noise.changed, violations: pre.noise.violations.length },
    estimate: { ok: e.ok, callsPerPass: e.callsPerPass, maxRequests: e.maxRequests, requiredUsd: e.requiredMicroUsd / 1e6, remainingUsd: e.remainingMicroUsd / 1e6 },
    ...(extra.allowance ? { allowance: extra.allowance } : {}), ...(extra.priorRuns !== undefined ? { priorRuns: extra.priorRuns } : {}), results: h.results,
    programSpend: pre.programSpend ? programSpendSummary(pre.programSpend) : null,
    // F2: the Intl clock block and the reachable-day window (counts only: no scenario id).
    ...(pre.dayWindow ? { clock: pre.dayWindow.clock, dayWindow: { days: pre.dayWindow.days, rolloverSkips: pre.dayWindow.rolloverSkips.length } } : {}) };
}
function assertRunnable(pre: Preflight, closedDay: 'skip' | 'fail', env: Record<string, string | undefined>) {
  if (!pre.runnable.length) throw Error('AGENDA_SEALED_EMPTY');
  if (pre.skipped.length && closedDay === 'fail') throw Error('AGENDA_CLOSED_DAY');
  if (!pre.dayWindow) throw Error('AGENDA_DAY_WINDOW_UNKNOWN');
  if (pre.dayWindow.rolloverSkips.length && closedDay === 'fail') throw Error('AGENDA_CLOSED_DAY'); // SKIP on a reachable later day
  assertHeadroom(pre.estimate);
  if (env.AGENDA_PRACTICE_REAL_APPROVED !== 'true') throw Error('AGENDA_PRACTICE_NOT_APPROVED');
}
/** Creates `<file folder>/runs` and names the run folder; its real path is checked again (a junction made after the preflight). */
function outsideRunDir(mode: OutsideMode, h: SealedHoldout, roots: string[], started: Date, label = '') {
  mkdirSync(h.results, { recursive: true });
  if (roots.some(root => isInside(realpathSync(h.results), root))) throw Error('SEALED_RESULTS_INSIDE_REPO');
  return join(h.results, `${mode.toLowerCase()}-${h.holdout.id}-${h.sha8}-${started.toISOString().replace(/[:.]/g, '-')}${label ? '-' + label : ''}`);
}
const priorValidationRuns = (h: SealedHoldout) => { try { return readdirSync(h.results).filter(n => n.startsWith(`validation-${h.holdout.id}-${h.sha8}-`)).length; } catch { return 0; } };
async function runOutside(mode: OutsideMode, h: SealedHoldout, out: string, marker: Record<string, unknown>, runOpts: AgendaRunInput, d: OutsideDeps,
  context: (failure: unknown) => SealedContext) {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, RUN_MARKERS[mode]), JSON.stringify(marker, null, 2));
  let failure: unknown;
  const restore = captureProcessOutput(join(out, 'console.log'));
  try { await d.run(h.scenarios, out, runOpts); } catch (e) { failure = e; } finally { restore(); }
  const ctx = context(failure), prefix = mode.toLowerCase();
  let summary: ReturnType<typeof sealedSummary> | Record<string, unknown>;
  try {
    const passk = buildPasskReport(out, { legacyCheck: join(d.root, LEGACY_CHECK_PATH) });
    writeFileSync(join(out, 'passk.json'), JSON.stringify(passk, null, 2)); // full detail: out of the repo, never printed
    writeFileSync(join(out, `${prefix}-scenarios.json`), JSON.stringify(sealedScenarioTable(passk), null, 2));
    summary = sealedSummary(passk, ctx);
  } catch (e) { // e.g. aborted before the runner wrote report.json
    summary = { mode, status: 'ABORTED', valid: false, passk: sealedErrorCode(e), failure: ctx.failure ?? null, holdout: ctx.holdout, candidate: ctx.candidate,
      candidateStillMatches: ctx.candidateStillMatches, ledger: ctx.ledger, out };
  }
  writeFileSync(join(out, `${prefix}-report.json`), JSON.stringify(summary, null, 2));
  d.print(JSON.stringify(summary));
  if (failure !== undefined) throw failure;
  return summary;
}
/** `--stage` (any stage of the allowlist, e.g. final-20260929; default: the runner's default) is checked before the file is
 * opened: an unknown stage is AGENDA_STAGE_UNKNOWN with no look, preflight or output. */
const assertStage = (stage: string | undefined) => { if (stage !== undefined) agendaStage(stage); };
export async function sealedAgendaPractice(o: SealedOptions, d: SealedDeps) {
  if (typeof o.candidate !== 'string' || !o.candidate) throw Error('CANDIDATE_REQUIRED');
  assertStage(o.stage);
  const roots = d.roots ?? sealedRepoRoots(d.root, d.git), holdout = openSealedHoldout(o.holdout, d.env, roots, d.registry ?? readHoldoutRegistry(d.root), 'SEALED');
  const manifest = assertCandidate(o.candidate, d);
  const ledger = d.ledger ?? holdoutUsageLedgerPath(), closedDay = o.closedDay ?? 'fail';
  const allowance = holdoutAllowance(readHoldoutUsage(ledger, d.root), holdout.holdout.id, manifest.versionId);
  const runOpts: AgendaRunOptions = { stage: o.stage, repeat: o.repeat, maxRequests: o.maxRequests, closedDay, noise: o.noise, ...(o.runCapUsd !== undefined ? { runCapUsd: o.runCapUsd } : {}) };
  const pre = d.preflight(holdout.scenarios, runOpts); // pure: stage journal and program ledger read-only, no database, no network
  if (o.preflight) { const summary = preflightSummary('SEALED', pre, holdout, closedDay, { candidate: manifest.versionId, allowance }); d.print(JSON.stringify(summary)); return summary; }
  if (!allowance.allowed) throw Error(allowance.code!);
  assertRunnable(pre, closedDay, d.env);
  const started = (d.now ?? (() => new Date()))(), out = outsideRunDir('SEALED', holdout, roots, started);
  // F1: lease, lock probes, database identity, headroom and day window BEFORE the look: an infrastructure refusal spends nothing.
  const infra = await infrastructurePreflight(pre, basename(out), closedDay, started, d);
  try {
    // The look is consumed here, before the first database write or network access; a run that aborts later still used it.
    const row = await recordSealedRun(ledger, { holdoutId: holdout.holdout.id, holdoutSha256: holdout.sha256, candidate: manifest.versionId, scenarios: pre.runnable.length, k: pre.repeat,
      run: basename(out) }, d.root);
    return await runOutside('SEALED', holdout, out, { holdoutId: holdout.holdout.id, holdoutSha256: holdout.sha256, candidate: manifest.versionId,
      ledger: { seq: row.seq, id: row.id, rowHash: row.rowHash }, startedAt: row.at, stage: pre.stage.name, repeat: pre.repeat, scenarios: pre.runnable.length, closedDay },
    { ...runOpts, preflight: pre, lease: infra.lease, proofLease: infra.proof }, d, failure => {
      let still: boolean | null; try { assertCandidate(manifest.versionId, d); still = true; } catch { still = false; } // edited during the run?
      return { mode: 'SEALED', holdout: { id: holdout.holdout.id, sha8: holdout.sha8 }, candidate: manifest.versionId, out, ledger: { seq: row.seq, id: row.id },
        candidateStillMatches: still, failure: failure === undefined ? null : sealedErrorCode(failure) };
    });
  } finally { releaseQuietly(infra.release); }
}
/** The choice drawer: same isolation as a sealed run (registered sha, out-of-repo results, aggregates only), without a
 * frozen candidate and without the holdout look budget. */
export async function validationAgendaPractice(o: ValidationOptions, d: OutsideDeps) {
  assertStage(o.stage);
  const roots =d.roots ?? sealedRepoRoots(d.root, d.git), set = openSealedHoldout(o.holdout, d.env, roots, d.registry ?? readHoldoutRegistry(d.root), 'VALIDATION');
  const closedDay = o.closedDay ?? 'fail', runOpts: AgendaRunOptions = { stage: o.stage, repeat: o.repeat, maxRequests: o.maxRequests, closedDay, noise: o.noise, ...(o.runCapUsd !== undefined ? { runCapUsd: o.runCapUsd } : {}) };
  const pre = d.preflight(set.scenarios, runOpts), priorRuns = priorValidationRuns(set);
  if (o.preflight) { const summary = preflightSummary('VALIDATION', pre, set, closedDay, { priorRuns }); d.print(JSON.stringify(summary)); return summary; }
  assertRunnable(pre, closedDay, d.env);
  const started = (d.now ?? (() => new Date()))(), label = (o.label ?? '').replace(/[^a-z0-9-]/gi, '').slice(0, 40);
  const out = outsideRunDir('VALIDATION', set, roots, started, label);
  const infra = await infrastructurePreflight(pre, basename(out), closedDay, started, d); // same F1 preflight (no look is spent here)
  try {
    return await runOutside('VALIDATION', set, out, { holdoutId: set.holdout.id, holdoutSha256: set.sha256, startedAt: started.toISOString(), stage: pre.stage.name, repeat: pre.repeat,
      scenarios: pre.runnable.length, closedDay, priorRuns, label: label || null }, { ...runOpts, preflight: pre, lease: infra.lease, proofLease: infra.proof }, d, failure => ({ mode: 'VALIDATION',
      holdout: { id: set.holdout.id, sha8: set.sha8 }, candidate: null, out, ledger: null, candidateStillMatches: null, failure: failure === undefined ? null : sealedErrorCode(failure) }));
  } finally { releaseQuietly(infra.release); }
}
