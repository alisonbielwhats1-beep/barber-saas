import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { SEALED_SHA_ENV, sealedAgendaPractice, validationAgendaPractice, type InfrastructureDeps, type SealedDeps } from '../../../packages/salon-secretary/evaluation/agenda-sealed';
import { buildCandidate, writeCandidate, type CandidateContract } from '../../../packages/salon-secretary/evaluation/candidate-freeze';
import { HOLDOUT_REGISTRY_SCHEMA, HOLDOUT_USAGE_BASENAME, readHoldoutRegistry, readHoldoutUsage, registerApproval, writeHoldoutRegistry } from '../../../packages/salon-secretary/evaluation/holdout-usage';
import { acquireStageLease, agendaStage, dayWindowPreflight, releaseStageLease, stageLeasePath, type AgendaScenario } from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';

// F1: everything the infrastructure preflight refuses is refused BEFORE the look (holdout ledger untouched) and before the run.
// Offline: a throwaway git checkout, temp holdout/ledger/stage files, a fake preflight and runner; never the real holdouts.
const dirs: string[] = [];
const temp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };
const put = (root: string, file: string, text: string) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text); };
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const TODAY = '2026-09-28';
const scenario = (id: string): AgendaScenario => ({ id, title: `synthetic ${id}`, capability: ['create'], steps: [{ say: 'Marca a Maria Eduarda amanhã às 9h' }], final: { unchanged: true } });
const HOLDOUT = [scenario('I01'), scenario('I02')];
const contract = (flags: Record<string, string>): CandidateContract => ({ examplesTag: flags.SALON_SECRETARY_EXAMPLES ?? null, examplesRenderVersion: 'test-v1', bankSha256: 'c'.repeat(64) });
function setup() {
  const root = temp('infra-root-'), git = (...a: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q'); put(root, '.gitignore', 'packages/salon-secretary/evaluation/results/\n.demo/\n'); put(root, 'src/lib/secretary.ts', 'export const v = 1;\n');
  put(root, 'packages/salon-secretary/src/examples/bank.json', '[]\n'); git('add', '.gitignore', 'src/lib/secretary.ts', 'packages/salon-secretary/src/examples/bank.json');
  mkdirSync(join(root, 'packages/salon-secretary/evaluation'), { recursive: true });
  writeHoldoutRegistry(root, { schema: HOLDOUT_REGISTRY_SCHEMA, holdouts: [] });
  const flags = { SALON_SECRETARY_EXAMPLES: 'selected' }, m = buildCandidate({ root, model: 'gpt-6-luna', flags, contract: contract({ ...flags, SALON_SECRETARY_MODEL: 'gpt-6-luna' }) });
  writeCandidate(root, m);
  const text = JSON.stringify(HOLDOUT), holdout = join(temp('infra-holdout-'), 'holdout.json'); writeFileSync(holdout, text);
  writeHoldoutRegistry(root, registerApproval(readHoldoutRegistry(root), { id: 'infra-v1', kind: 'test', sha256: sha(text), ids: ['I01', 'I02'], source: { name: 's.txt', sha256: sha('s') } }));
  const validationText = JSON.stringify([scenario('Q01')]), validation = join(temp('infra-validation-'), 'validation.json'); writeFileSync(validation, validationText);
  writeHoldoutRegistry(root, registerApproval(readHoldoutRegistry(root), { id: 'choice-infra', kind: 'validation', sha256: sha(validationText), ids: ['Q01'], source: { name: 'v.txt', sha256: sha('v') } }));
  const ledger = join(temp('infra-ledger-'), HOLDOUT_USAGE_BASENAME), infra = temp('infra-stage-');
  const stageFile = join(infra, agendaStage('reliability-20260927').journal), programLedger = join(infra, 'program-spend-20260927.jsonl');
  const order: string[] = [], runs: { preflight: unknown; lease: unknown; looks: number; leaseHeld: boolean }[] = [];
  let preflight: Record<string, unknown> | undefined;
  const deps: SealedDeps = { root, ledger, contract, roots: [root], now: () => new Date('2026-09-28T12:00:00.000Z'), print: () => {},
    env: { [SEALED_SHA_ENV]: sha(text), AGENDA_PRACTICE_REAL_APPROVED: 'true', SALON_SECRETARY_MODEL: 'gpt-6-luna', ...flags },
    identity: async () => { order.push('identity'); return { database: 'synthetic' }; },
    preflight: (scenarios, opts) => (preflight = { stage: { name: 'reliability-20260927' }, stageFile, programLedger, today: TODAY, repeat: opts.repeat ?? 1, runnable: scenarios, skipped: [],
      estimate: { ok: true, callsPerPass: 4, maxRequests: 4, requiredMicroUsd: 1_000, remainingMicroUsd: 9_000_000 }, noise: { profile: 'off', levels: ['off'], texts: 0, changed: 0, violations: [] },
      programSpend: undefined, dayWindow: { days: [TODAY], spansMidnight: false, rolloverSkips: [] } }) as never,
    run: async (scenarios, out, opts) => {
      // What the run sees when it starts: the looks already recorded and the lease it runs under.
      order.push('run'); runs.push({ preflight: opts.preflight, lease: opts.lease, looks: existsSync(ledger) ? readHoldoutUsage(ledger, root).length : 0, leaseHeld: existsSync(stageLeasePath(stageFile)) });
      mkdirSync(join(out, 'k1'), { recursive: true });
      for (const s of scenarios) writeFileSync(join(out, 'k1', `${s.id}.json`), JSON.stringify({ scenario: s, initial: { appointments: [], blocks: [] }, today: TODAY, attempt: 1, complete: true,
        transcript: [{ step: 1, action: 'say', db: { appointments: [], blocks: [] } }] }));
      writeFileSync(join(out, 'report.json'), JSON.stringify({ run: 'synthetic', status: 'COMPLETE', today: TODAY, repeat: 1, ids: scenarios.map(s => s.id), scenarios: scenarios.length, skipped: [] }));
    } };
  return { root, deps, ledger, stageFile, programLedger, holdout, validation, order, runs, pre: () => preflight, options: { holdout, candidate: m.versionId, repeat: 1 } };
}
type Fixture = ReturnType<typeof setup>;
/** Wraps each default step so the call order is visible (every step still does its real work unless `fail` names it). */
function traced(f: Fixture, fail?: keyof InfrastructureDeps): Partial<InfrastructureDeps> {
  const step = (name: keyof InfrastructureDeps) => { f.order.push(name); if (fail === name) throw Error(`SYNTHETIC_${name.toUpperCase()}_FAILURE`); };
  return {
    lease: (pre, run) => { step('lease'); return acquireStageLease(pre.stageFile, pre.stage.name, run); },
    probes: () => { step('probes'); },
    identity: async () => { step('identity'); return { database: 'synthetic' }; },
    headroom: () => { step('headroom'); }, dayWindow: () => { step('dayWindow'); },
    release: (lease, pre) => { f.order.push('release'); releaseStageLease(lease, pre.stageFile, pre.stage.name); },
  };
}
async function refusal(run: () => Promise<unknown>) { try { await run(); } catch (e) { return e as Error; } throw Error('expected a refusal'); }
const deadPid = () => Number(spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout);

describe('sealed run: infrastructure preflight before the look (F1)', () => {
  it('runs lease -> probes -> identity -> headroom -> day window -> look -> run -> release, and hands the runner the same preflight and lease', async () => {
    const f = setup();
    await sealedAgendaPractice(f.options, { ...f.deps, infrastructure: traced(f) });
    expect(f.order).toEqual(['lease', 'probes', 'identity', 'headroom', 'dayWindow', 'run', 'release']);
    expect(f.runs[0]).toMatchObject({ looks: 1, leaseHeld: true }); // the look is recorded after dayWindow, before the run
    expect(f.runs[0].preflight).toBe(f.pre()); // never recomputed
    expect(f.runs[0].lease).toMatchObject({ stage: 'reliability-20260927', pid: process.pid, host: hostname() });
    expect(existsSync(stageLeasePath(f.stageFile))).toBe(false);
  });
  for (const step of ['lease', 'probes', 'identity', 'headroom', 'dayWindow'] as const) it(`a ${step} failure spends no look: the holdout ledger is never written and nothing runs`, async () => {
    const f = setup();
    const e = await refusal(() => sealedAgendaPractice(f.options, { ...f.deps, infrastructure: traced(f, step) }));
    expect(e.message).toBe(`SYNTHETIC_${step.toUpperCase()}_FAILURE`);
    expect(existsSync(f.ledger)).toBe(false); expect(f.order).not.toContain('run');
    expect(f.order.at(-1)).toBe(step === 'lease' ? 'lease' : 'release'); // a taken lease is always given back
    expect(existsSync(stageLeasePath(f.stageFile))).toBe(false);
  });
  it('default steps: another runner on the stage is AGENDA_STAGE_BUSY and a dead one AGENDA_STAGE_LEASE_STALE, both before the look; the foreign lease is untouched', async () => {
    const f = setup(), other = acquireStageLease(f.stageFile, 'reliability-20260927', 'other-runner');
    expect((await refusal(() => sealedAgendaPractice(f.options, f.deps))).message).toBe('AGENDA_STAGE_BUSY');
    expect(JSON.parse(readFileSync(stageLeasePath(f.stageFile), 'utf8'))).toEqual(other);
    releaseStageLease(other, f.stageFile, 'reliability-20260927');
    writeFileSync(stageLeasePath(f.stageFile), JSON.stringify({ ...other, pid: deadPid() }));
    expect((await refusal(() => sealedAgendaPractice(f.options, f.deps))).message).toBe('AGENDA_STAGE_LEASE_STALE');
    expect(existsSync(f.ledger)).toBe(false); expect(f.order).toEqual([]);
  });
  it('default steps: a stage lock left by a killed process is AGENDA_STAGE_LOCKED at the probe, before identity and the look', async () => {
    const f = setup(); mkdirSync(dirname(f.stageFile), { recursive: true });
    writeFileSync(f.stageFile + '.lock', JSON.stringify({ pid: deadPid(), host: hostname(), run: 'killed', at: new Date().toISOString() }));
    expect((await refusal(() => sealedAgendaPractice(f.options, f.deps))).message).toBe('AGENDA_STAGE_LOCKED');
    expect(f.order).toEqual([]); expect(existsSync(f.ledger)).toBe(false); expect(existsSync(stageLeasePath(f.stageFile))).toBe(false);
    rmSync(f.stageFile + '.lock');
    writeFileSync(f.programLedger + '.lock', ''); // the program ledger's lock is probed too
    expect((await refusal(() => sealedAgendaPractice(f.options, f.deps))).message).toBe('PROGRAM_SPEND_LOCKED');
    expect(f.order).toEqual([]); expect(existsSync(f.ledger)).toBe(false);
  }, 30_000);
  it('without an identity step the run is refused (SEALED_IDENTITY_UNWIRED), and a stale day window or a rollover skip too, before the look', async () => {
    const f = setup(), { identity: _identity, ...unwired } = f.deps; void _identity;
    expect((await refusal(() => sealedAgendaPractice(f.options, unwired))).message).toBe('SEALED_IDENTITY_UNWIRED');
    const stale = { ...f.deps, now: () => new Date('2026-09-29T12:00:00.000Z') }; // the window covers only the 28th
    expect((await refusal(() => sealedAgendaPractice(f.options, stale))).message).toBe('AGENDA_DAY_WINDOW_STALE');
    // A real window computed at Friday 23:45 in São Paulo: "+1" is Saturday today but Sunday (closed) once anchored on Saturday.
    const friday: AgendaScenario = { id: 'I01', title: 'x', capability: ['create'], customers: [{ key: 'lia', name: 'Lia Moura' }], professionals: [{ key: 'nando', name: 'Nando Reis' }],
      appointments: [{ key: 'a1', customer: 'lia', professional: 'nando', service: 'corte', day: 1, time: '10:00' }], steps: [{ say: 'oi' }] };
    const window = dayWindowPreflight([friday], new Date('2026-10-03T02:45:00Z'), 60_000, () => undefined);
    expect(window.rolloverSkips).toHaveLength(1);
    const rollover = { ...f.deps, preflight: (s: AgendaScenario[], o: Parameters<SealedDeps['preflight']>[1]) => ({ ...(f.deps.preflight(s, o) as object), dayWindow: window }) as never };
    expect((await refusal(() => sealedAgendaPractice(f.options, rollover))).message).toBe('AGENDA_CLOSED_DAY');
    const missing = { ...f.deps, preflight: (s: AgendaScenario[], o: Parameters<SealedDeps['preflight']>[1]) => ({ ...(f.deps.preflight(s, o) as object), dayWindow: undefined }) as never };
    expect((await refusal(() => sealedAgendaPractice(f.options, missing))).message).toBe('AGENDA_DAY_WINDOW_UNKNOWN');
    expect(existsSync(f.ledger)).toBe(false); expect(f.order).toEqual(['identity']); // only the first run reached (a later) identity: never the look
    expect(existsSync(stageLeasePath(f.stageFile))).toBe(false);
  });
  it('the headroom is re-checked under the lease: a stage that filled up since the preflight is refused before the look', async () => {
    const f = setup(), big = { ...f.deps, preflight: (s: AgendaScenario[], o: Parameters<SealedDeps['preflight']>[1]) => { const p = f.deps.preflight(s, o) as unknown as { estimate: object };
      return { ...p, estimate: { ...p.estimate, requiredMicroUsd: 15_000_001 } } as never; } };
    expect((await refusal(() => sealedAgendaPractice(f.options, big))).message).toBe('AGENDA_STAGE_HEADROOM');
    expect(existsSync(f.ledger)).toBe(false); expect(existsSync(stageLeasePath(f.stageFile))).toBe(false);
  });
  it('the validation drawer runs the same infrastructure preflight (a busy stage is refused, nothing runs)', async () => {
    const f = setup(), other = acquireStageLease(f.stageFile, 'reliability-20260927', 'other-runner');
    const { contract: _c, ledger: _l, ...outside } = f.deps; void _c; void _l;
    await expect(validationAgendaPractice({ holdout: f.validation, repeat: 1 }, outside)).rejects.toThrow('AGENDA_STAGE_BUSY');
    expect(f.order).toEqual([]);
    releaseStageLease(other, f.stageFile, 'reliability-20260927');
    await validationAgendaPractice({ holdout: f.validation, repeat: 1 }, outside);
    expect(f.order).toEqual(['identity', 'run']); expect(f.runs[0]).toMatchObject({ looks: 0, leaseHeld: true }); // no look for the drawer
    expect(existsSync(stageLeasePath(f.stageFile))).toBe(false);
  });
});
