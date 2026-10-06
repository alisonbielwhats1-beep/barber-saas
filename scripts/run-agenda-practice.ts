/** CLI: node scripts/run-agenda-practice.cjs --scenarios <a.json[,b.json]> [--only A01,A02] [--repeat K(1..8)]
 *   [--stage reliability-20260927|agenda-core-20260927|final-20260929|c4-dev-20260929|c4-proof-20260930] [--max-requests N (per pass; default = estimate)]
 *   [--closed-day skip|fail] [--noise off|light|heavy|mixed] [--label x] [--preflight] [--run-cap-usd D (this run's own dollar ceiling, every mode)]
 * Requires AGENDA_PRACTICE_REAL_APPROVED=true (paid Luna calls under the selected stage journal; every call is also
 * admitted and charged by the program real-spend ledger, whatever the stage).
 * --noise (default off = texts exactly as written): deterministic, meaning-preserving typing/dictation noise on say/answer
 *   texts; mixed = attempt 1 clean, then light/heavy alternating (use with --repeat).
 * --preflight only prints the headroom/run-day/noise preflight: no database, no network, no approval needed.
 * Sealed holdout (agenda-sealed.ts): --sealed <file outside the repo> --candidate <versionId> [--stage s] [--repeat K] [--preflight]
 *   requires a registered test holdout (holdout-registry.json), AGENDA_HOLDOUT_APPROVED_SHA256 = sha256(file) and a frozen
 *   candidate (scripts/secretary-freeze-candidate.cjs); --scenarios/--only/--label are refused; --closed-day defaults to
 *   fail; results go to <folder of the file>/runs (outside the repo); stdout = aggregates only.
 * Validation set (the choice drawer): --validation <file outside the repo> [--stage s] [--repeat K] [--noise p] [--label x] [--preflight]
 *   requires a registered validation file; no candidate and no holdout look; --scenarios/--only/--candidate are refused;
 *   results go to <folder of the file>/runs; stdout = aggregates only.
 * A normal run refuses scenario files outside the checkout and any registered holdout or validation file (by sha256 or
 * by a shared scenario id). */
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { agendaDatabaseIdentity, preflightAgendaPractice, runAgendaPractice, type AgendaScenario } from '../packages/salon-secretary/evaluation/agenda-practice';
import { NOISE_PROFILES, type NoiseProfile } from '../packages/salon-secretary/evaluation/agenda-practice-noise';
import { programSpendSummary } from '../packages/salon-secretary/evaluation/program-spend';
import { assertNotRegisteredHoldout, assertScenarioFilesInCheckout, sealedAgendaPractice, sealedErrorPayload, sealedRepoRoots, validationAgendaPractice,
  type OutsideMode } from '../packages/salon-secretary/evaluation/agenda-sealed';
import { liveCandidateContract } from '../packages/salon-secretary/evaluation/candidate-contract';
import { readHoldoutRegistry } from '../packages/salon-secretary/evaluation/holdout-usage';
const VALUE_FLAGS = ['--scenarios', '--only', '--max-requests', '--label', '--stage', '--repeat', '--closed-day', '--noise', '--sealed', '--candidate', '--validation', '--run-cap-usd'], BOOLEAN_FLAGS = ['--preflight'];
let sealed: OutsideMode | null = null;
async function main() {
  const args = process.argv.slice(2), values: Record<string, string> = {};
  while (args.length) {
    const key = args.shift()!;
    if (BOOLEAN_FLAGS.includes(key)) { values[key] = 'true'; continue; }
    if (!VALUE_FLAGS.includes(key) || !args.length || key in values) throw Error('AGENDA_ARGUMENT');
    values[key] = args.shift()!;
  }
  if (process.env.VERCEL_ENV === 'production' || process.env.APP_ENV === 'production') throw Error('AGENDA_PRODUCTION_FORBIDDEN');
  const integer = (flag: string, min: number, max: number) => {
    if (values[flag] === undefined) return undefined;
    const n = Number(values[flag]); if (!/^\d+$/.test(values[flag]) || n < min || n > max) throw Error('AGENDA_ARGUMENT'); return n;
  };
  const repeat = integer('--repeat', 1, 8) ?? 1, maxRequests = integer('--max-requests', 1, 5000);
  // Review H2: --run-cap-usd <dollars> (up to 6 decimals, more than 0 and at most the program cap): the run's own ceiling, checked before each paid call.
  const runCap = values['--run-cap-usd'], runCapUsd = runCap === undefined ? undefined : Number(runCap);
  if (runCap !== undefined && (!/^\d+(?:\.\d{1,6})?$/.test(runCap) || !(runCapUsd! > 0) || runCapUsd! > 15)) throw Error('AGENDA_ARGUMENT');
  const closedDay = values['--closed-day'] ?? 'skip';
  if (closedDay !== 'skip' && closedDay !== 'fail') throw Error('AGENDA_ARGUMENT');
  const noise = values['--noise'] ?? 'off';
  if (!(NOISE_PROFILES as readonly string[]).includes(noise)) throw Error('AGENDA_ARGUMENT');
  if (values['--validation'] !== undefined) {
    sealed = 'VALIDATION'; // from here on, errors print codes only
    if (['--scenarios', '--only', '--sealed', '--candidate'].some(flag => values[flag] !== undefined)) throw Error('AGENDA_VALIDATION_ARGUMENT');
    await validationAgendaPractice({ holdout: values['--validation'], preflight: !!values['--preflight'], stage: values['--stage'], repeat, maxRequests, label: values['--label'],
      closedDay: (values['--closed-day'] ?? 'fail') as 'skip' | 'fail', noise: noise as NoiseProfile, ...(runCapUsd !== undefined ? { runCapUsd } : {}) },
    { root: process.cwd(), env: process.env, preflight: preflightAgendaPractice, run: runAgendaPractice, identity: agendaDatabaseIdentity, print: line => console.log(line) });
    return;
  }
  if (values['--sealed'] !== undefined || values['--candidate'] !== undefined) {
    sealed = 'SEALED'; // from here on, errors print codes only
    if (values['--sealed'] === undefined || ['--scenarios', '--only', '--label'].some(flag => values[flag] !== undefined)) throw Error('AGENDA_SEALED_ARGUMENT');
    await sealedAgendaPractice({ holdout: values['--sealed'], candidate: values['--candidate'] ?? '', preflight: !!values['--preflight'], stage: values['--stage'], repeat, maxRequests,
      closedDay: (values['--closed-day'] ?? 'fail') as 'skip' | 'fail', noise: noise as NoiseProfile, ...(runCapUsd !== undefined ? { runCapUsd } : {}) },
    { root: process.cwd(), env: process.env, contract: liveCandidateContract, preflight: preflightAgendaPractice, run: runAgendaPractice, identity: agendaDatabaseIdentity, print: line => console.log(line) });
    return;
  }
  const files = (values['--scenarios'] ?? 'packages/salon-secretary/evaluation/agenda-practice-scenarios.json').split(',');
  assertScenarioFilesInCheckout(files, sealedRepoRoots(process.cwd())); // outside every checkout = sealed holdout or validation set: --sealed / --validation only
  assertNotRegisteredHoldout(files, readHoldoutRegistry(process.cwd())); // a registered holdout copied into the repo (or a subset of it) is refused too
  const all = files.flatMap(file => JSON.parse(readFileSync(resolve(file), 'utf8')) as AgendaScenario[]);
  const only = values['--only']?.split(',');
  if (only?.some(id => !all.some(s => s.id === id))) throw Error('AGENDA_UNKNOWN_SCENARIO');
  const scenarios = only ? all.filter(s => only.includes(s.id)) : all;
  const opts = { stage: values['--stage'], repeat, maxRequests, closedDay, noise: noise as NoiseProfile, ...(runCapUsd !== undefined ? { runCapUsd } : {}) } as const;
  if (values['--preflight']) {
    const pre = preflightAgendaPractice(scenarios, opts);
    const { violations, ...noiseSummary } = pre.noise; // violations abort the preflight; the summary carries codes and counts only
    console.log(JSON.stringify({ status: pre.estimate.ok ? 'PREFLIGHT_OK' : 'AGENDA_STAGE_HEADROOM', stage: pre.stage.name, today: pre.today, repeat,
      noise: { ...noiseSummary, violations: violations.length },
      scenarios: pre.runnable.map(s => s.id), skipped: pre.skipped.map(d => ({ id: d.id, closed: d.closed, invalid: d.invalid })),
      stageTotals: pre.totals, estimate: pre.estimate, maxOutputTokens: pre.maxOutputTokens, legacyOracleSha256: pre.legacyOracleSha256, clock: pre.clock, dayWindow: pre.dayWindow,
      programSpend: programSpendSummary(pre.programSpend) }, null, 2));
    return;
  }
  if (process.env.AGENDA_PRACTICE_REAL_APPROVED !== 'true') throw Error('AGENDA_PRACTICE_NOT_APPROVED');
  const label = (values['--label'] ?? 'run').replace(/[^a-z0-9-]/gi, '');
  const out = join(process.cwd(), 'packages/salon-secretary/evaluation/results/agenda-core', `${new Date().toISOString().replace(/[:.]/g, '-')}-${label}`);
  const report = await runAgendaPractice(scenarios, out, opts);
  console.log(JSON.stringify({ out, ...report }));
}
main().catch(error => {
  process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = 'false';
  if (sealed) { console.error(JSON.stringify(sealedErrorPayload(error, sealed))); process.exitCode = 1; return; }
  const details = error && typeof error === 'object' && 'details' in error ? (error as { details: unknown }).details : undefined;
  console.error(JSON.stringify({ status: 'BLOCKED', code: error instanceof Error ? error.message.slice(0, 200) : 'ERROR', ...(details ? { details } : {}) }));
  process.exitCode = 1;
});
