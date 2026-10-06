import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { refuseUnwiredPaidPath } from '../../../packages/salon-secretary/evaluation/program-spend';
import { executePhaseA, withPhaseAClock } from '../../../packages/salon-secretary/evaluation/hard-conversations-phase-a-execution';
import { executeUltimate10 } from '../../../packages/salon-secretary/evaluation/ultimate-10-execution';
import { executeRealBenchmark as multiActionReal } from '../../../packages/salon-secretary/evaluation/multi-action-benchmark-real';
import { executeRealBenchmark as uxReal } from '../../../packages/salon-secretary/evaluation/conversational-ux-real';
import { executeRealBenchmark as uxFinalReal } from '../../../packages/salon-secretary/evaluation/conversational-ux-final-real';
import { executeRealBenchmark as uxSelfHealingReal } from '../../../packages/salon-secretary/evaluation/conversational-ux-self-healing-real';

// Offline only: a static scan of the launchers and evaluation code, then the refusals with VITEST unset. No database
// (every Prisma access throws), no network, no ledger.
const ROOTS = ['scripts', 'packages/salon-secretary/evaluation'];
const CODE = /\.(?:ts|tsx|cts|mts|cjs|mjs|js)$/;
/** Any code that turns paid Luna calls on: `process.env.X = 'true'`, `X: 'true'` (child env / config object), `['X'] = 'true'`. */
const PAID_WRITE = /SALON_SECRETARY_ALLOW_PAID_CALLS['"]?\]?\s*(?:=|:)\s*['"`]true['"`]/;
const PROCESS_PAID_WRITE = /process\.env(?:\.SALON_SECRETARY_ALLOW_PAID_CALLS|\[['"]SALON_SECRETARY_ALLOW_PAID_CALLS['"]\])\s*=\s*['"`]true['"`]/;
const GUARD_IMPORT = /from\s+['"](?:\.\/|(?:\.\.\/)+packages\/salon-secretary\/evaluation\/)program-spend['"]|require\(['"][^'"]*program-spend(?:\.ts)?['"]\)/;
/** Frozen evidence that cannot import the guard (t21/topic14 PRISTINE, x94 IMMUTABLE): each enables paid calls right
 * before `withPhaseAClock`, which refuses while they stay unwired. */
const FROZEN_COVERED: Record<string, string> = {
  'packages/salon-secretary/evaluation/t21-real.ts': 'PRISTINE',
  'packages/salon-secretary/evaluation/topic14-final-real.ts': 'PRISTINE',
  'packages/salon-secretary/evaluation/x94-original-real.ts': 'IMMUTABLE',
};
/** Writers that are not a paid Luna path of an evaluation process. */
const NOT_PROGRAM_PATHS: Record<string, string> = {
  // createPaidModel over a simulated fetch with a synthetic key; the process paid flag stays "false".
  'packages/salon-secretary/evaluation/multi-action-benchmark-harness.ts': 'OFFLINE_SIMULATED_TRANSPORT',
  // The owner's manual test of the local app UI (runtime cost guard, one call per typed message). NOT charged to the
  // program ledger: an open risk reported to the owner, not an evaluation battery.
  'scripts/dev-agenda-test.cjs': 'OWNER_MANUAL_APP',
  // Fine-tuning-READY export: createPaidModel with a fake key over an offline fetch stub that never forwards (no training, no network).
  'packages/salon-secretary/evaluation/ft-export.ts': 'OFFLINE_FETCH_STUB_EXPORT',
};
function codeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.name === 'node_modules' ? [] : entry.isDirectory()
    ? codeFiles(join(directory, entry.name)) : CODE.test(entry.name) ? [join(directory, entry.name).replaceAll('\\', '/')] : []);
}
const untouchable = new Proxy({}, { get: () => { throw Error('SYNTHETIC_DATABASE_TOUCHED'); } }) as PrismaClient;
afterEach(() => { vi.unstubAllEnvs(); });

describe('program real-spend cap: every paid launcher is wired or refused', () => {
  it('every writer of the paid-calls flag imports the program guard, or is a listed frozen/offline/manual exception', () => {
    const writers = ROOTS.flatMap(codeFiles).filter(file => PAID_WRITE.test(readFileSync(file, 'utf8'))).sort();
    expect(writers.length).toBeGreaterThanOrEqual(10);
    const unguarded = writers.filter(file => !GUARD_IMPORT.test(readFileSync(file, 'utf8')) && !Object.hasOwn(FROZEN_COVERED, file) && !Object.hasOwn(NOT_PROGRAM_PATHS, file));
    expect(unguarded).toEqual([]);
    // No stale exception: each listed file still writes the flag and still does not import the guard.
    for (const file of [...Object.keys(FROZEN_COVERED), ...Object.keys(NOT_PROGRAM_PATHS)]) {
      expect(writers, file).toContain(file); expect(GUARD_IMPORT.test(readFileSync(file, 'utf8')), file).toBe(false);
    }
    // An importer either charges its calls to the ledger or refuses before any work.
    for (const file of writers.filter(f => GUARD_IMPORT.test(readFileSync(f, 'utf8')))) expect(readFileSync(file, 'utf8'), file).toMatch(/guardPaidFetch\(|refuseUnwiredPaidPath\(/);
    for (const file of ['packages/salon-secretary/evaluation/agenda-practice.ts', 'packages/salon-secretary/evaluation/free-use-runner.ts'])
      expect(readFileSync(file, 'utf8'), file).toMatch(/guardPaidFetch\(/);
  });
  it('frozen historical runners enable paid calls only right before the refusing phase-A clock', () => {
    for (const file of Object.keys(FROZEN_COVERED)) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).toMatch(/import \{ withPhaseAClock \} from "\.\/hard-conversations-phase-a-execution";/);
      const lines = text.split(/\r?\n/), writes = lines.flatMap((line, i) => PROCESS_PAID_WRITE.test(line) ? [i] : []);
      expect(writes.length, file).toBeGreaterThan(0);
      for (const i of writes) expect(lines.slice(i + 1).find(line => line.trim()), `${file}:${i + 1}`).toMatch(/^\s*await withPhaseAClock\(/);
    }
  });
  it('the offline and manual exceptions never turn paid calls on for an evaluation process', () => {
    const harness = readFileSync('packages/salon-secretary/evaluation/multi-action-benchmark-harness.ts', 'utf8');
    expect(PROCESS_PAID_WRITE.test(harness)).toBe(false);
    for (const line of harness.split(/\r?\n/).filter(l => PAID_WRITE.test(l))) expect(line).toMatch(/createPaidModel\(\{ SALON_SECRETARY_ALLOW_PAID_CALLS: "true",\s*$|synthetic-offline-key/);
    const manual = readFileSync('scripts/dev-agenda-test.cjs', 'utf8');
    expect(PROCESS_PAID_WRITE.test(manual)).toBe(false); expect(manual).toMatch(/spawn\(process\.execPath, \[require\.resolve\('next\/dist\/bin\/next'\), 'dev'/);
  });
});

describe('program real-spend cap: unwired historical runners refuse outside unit tests', () => {
  it('refuses with PROGRAM_SPEND_UNWIRED before any database, journal or network work', async () => {
    const network = vi.fn(async () => new Response('{}')); vi.stubGlobal('fetch', network);
    expect(() => refuseUnwiredPaidPath()).not.toThrow(); // unit tests keep exercising the orchestration offline
    vi.stubEnv('VITEST', '');
    expect(() => refuseUnwiredPaidPath()).toThrow('PROGRAM_SPEND_UNWIRED');
    for (const run of [multiActionReal, uxReal, uxFinalReal, uxSelfHealingReal]) await expect(run(untouchable, untouchable)).rejects.toThrow('PROGRAM_SPEND_UNWIRED');
    await expect(executePhaseA(untouchable, untouchable)).rejects.toThrow('PROGRAM_SPEND_UNWIRED');
    vi.stubEnv('ULTIMATE10_REAL_EXECUTION_APPROVED', 'true');
    await expect(executeUltimate10(untouchable, untouchable)).rejects.toThrow('PROGRAM_SPEND_UNWIRED');
    vi.stubEnv('ULTIMATE10_REAL_EXECUTION_APPROVED', 'false');
    await expect(executeUltimate10(untouchable, untouchable)).rejects.toThrow('NOT_AUTHORIZED'); // the approval gate still comes first
    // Backstop for the frozen t21/topic14/x94 runners: the phase-A clock refuses while paid calls are on.
    const task = vi.fn(async () => 'ran');
    vi.stubEnv('SALON_SECRETARY_ALLOW_PAID_CALLS', 'true');
    await expect(withPhaseAClock(task)).rejects.toThrow('PROGRAM_SPEND_UNWIRED'); expect(task).not.toHaveBeenCalled();
    vi.stubEnv('SALON_SECRETARY_ALLOW_PAID_CALLS', 'false');
    await expect(withPhaseAClock(task)).resolves.toBe('ran');
    expect(network).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  }, 60_000);
  it('VITEST=1 set in a shell is not a unit test: outside a vitest worker the refusal, the ledger path and the test estimators stay closed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'program-spend-vitest-env-'));
    try {
      const script = join(dir, 'probe.cjs'), modulePath = resolve('packages/salon-secretary/evaluation/program-spend.ts');
      writeFileSync(script, `'use strict';
if (process.argv[4] === 'worker') Object.defineProperty(globalThis, '__vitest_worker__', { value: {}, configurable: true });
const m = require(process.argv[2]);
const code = f => { try { f(); return 'ALLOWED'; } catch (e) { return e.message; } };
const ledger = require('node:path').join(process.argv[3], m.PROGRAM_SPEND_BASENAME);
process.stdout.write(JSON.stringify({ vitest: process.env.VITEST, unwired: code(() => m.refuseUnwiredPaidPath()), estimator: m.programSpendEstimator('test-fixed'),
  ledger: code(() => m.guardPaidFetch('practice', async () => { throw Error('NETWORK_FORBIDDEN'); }, { ledger, run: 'probe' })) }));
`);
      // Offline: the probe only builds the guard (no call, no row); the shell run never reaches a ledger.
      const probe = (mode: 'shell' | 'worker') => {
        const child = spawnSync(process.execPath, ['--require', 'tsx/cjs', script, modulePath, dir, mode], { cwd: process.cwd(), encoding: 'utf8', timeout: 60_000, env: { ...process.env, VITEST: '1' } });
        expect(child.status, child.stderr.slice(0, 400)).toBe(0); return JSON.parse(child.stdout);
      };
      expect(probe('shell')).toEqual({ vitest: '1', unwired: 'PROGRAM_SPEND_UNWIRED', estimator: null, ledger: 'PROGRAM_SPEND_CONFIG' });
      // Control: the same child standing in for a vitest worker is a unit test again.
      expect(probe('worker')).toEqual({ vitest: '1', unwired: 'ALLOWED', estimator: 'TEST', ledger: 'ALLOWED' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);
});
