import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { PROGRAM_HEADROOM_MIN_SETTLED, SEALED_SHA_ENV, assertProgramRunHeadroom, programRunBound, sealedAgendaPractice, validationAgendaPractice, type SealedDeps }
  from '../../../packages/salon-secretary/evaluation/agenda-sealed';
import { buildCandidate, writeCandidate, type CandidateContract } from '../../../packages/salon-secretary/evaluation/candidate-freeze';
import { HOLDOUT_REGISTRY_SCHEMA, HOLDOUT_USAGE_BASENAME, readHoldoutRegistry, readHoldoutUsage, registerApproval, writeHoldoutRegistry } from '../../../packages/salon-secretary/evaluation/holdout-usage';
import { PRICE, acquireStageLease, agendaStage, releaseStageLease, stageLeasePath, type AgendaScenario } from '../../../packages/salon-secretary/evaluation/agenda-practice-lib';
import { PROGRAM_REAL_CAP_MICRO_USD, PROGRAM_SPEND_BASENAME, acquireProofLease, assertProgramHeadroom, guardPaidFetch, inspectProofLease, operatorReleaseProofLease, programSpendLedgerPath,
  programSpendTotals, proofLeasePath, releaseProofLease, reserveProgramSpend, responsesEstimator, responsesUsageMicroUsd, settleProgramSpend, worstCaseMicroUsd, type PaidEstimator }
  from '../../../packages/salon-secretary/evaluation/program-spend';

// F1 review fix: the program real-spend ledger is checked before a sealed look (money left for the run's bound, no hard stop),
// and a program-wide proof lease admits only the proof's own paid calls while it runs (any stage, any runner). Offline: temp
// ledgers, a throwaway git checkout, fake transports; never the real ledger, holdouts or network.
const dirs: string[] = [];
const temp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const ledgerIn = () => join(temp('proof-ledger-'), PROGRAM_SPEND_BASENAME);
const fileState = (f: string) => existsSync(f) ? createHash('sha256').update(readFileSync(f)).digest('hex') : 'ABSENT';
const deadPid = () => Number(spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout);
const url = 'https://api.openai.com/v1/responses';
const payload = () => JSON.stringify({ model: 'gpt-6-luna', instructions: 'synthetic instructions ' + 'x'.repeat(12_000), input: [{ role: 'user', content: 'synthetic message' }],
  tools: [{ type: 'function', name: 'upsert_action_draft', parameters: { type: 'object' }, strict: true }], tool_choice: { type: 'function', name: 'upsert_action_draft' },
  parallel_tool_calls: false, max_output_tokens: 8192, store: false, stream: false, include: [] });
const wire = () => ({ method: 'POST', body: payload() });
const usage = { input: 20_000, cached: 5_000, output: 700, reasoning: 300 };
const fixed = (micro: number): PaidEstimator => ({ name: 'test-fixed', actual: () => null,
  worstCase: () => ({ estimator: 'test-fixed', model: 'synthetic', bodyBytes: 1, maxOutputTokens: 1, worstCaseMicroUsd: micro, pricingSha256: 'synthetic' }) });
/** Moves the ledger total by `micro` (a failed call charged at its declared worst case). */
const spend = (ledger: string, micro: number, opts: { proof?: ReturnType<typeof acquireProofLease> } = {}) =>
  guardPaidFetch('transcribe', async () => new Response('unavailable', { status: 503 }), { ledger, run: 'seed', estimator: fixed(micro), ...opts })('https://example.invalid/x', { method: 'POST', body: 'x' });
/** `n` Luna calls settled from usage (the per-call cost the program bound learns from). */
async function settled(ledger: string, n: number) {
  for (let i = 0; i < n; i++) {
    const r = await reserveProgramSpend(ledger, 'practice', 'practice:unit', `call${i}`, responsesEstimator.worstCase(url, wire()));
    await settleProgramSpend(ledger, r, { outcome: 'USAGE', httpStatus: 200, usage, chargedMicroUsd: responsesUsageMicroUsd(usage) });
  }
}
const worst = worstCaseMicroUsd(PRICE.maxInput - PRICE.framing, 8192);

describe('program bound of a run (before the look)', () => {
  it('maxRequests x the settled mean + one worst case; the worst case per call until enough calls were settled; a hard stop always refuses', () => {
    const settled20 = Array.from({ length: PROGRAM_HEADROOM_MIN_SETTLED }, (_, i) => 1_000 + i); // mean 1009.5 -> 1010
    expect(programRunBound({ remainingMicroUsd: 10 * 1_010 + worst, hardStop: null, settledMicroUsd: settled20 }, 10, worst))
      .toMatchObject({ perCallMicroUsd: 1_010, requiredMicroUsd: 10 * 1_010 + worst, settledCalls: 20 });
    expect(() => programRunBound({ remainingMicroUsd: 10 * 1_010 + worst - 1, hardStop: null, settledMicroUsd: settled20 }, 10, worst)).toThrow('PROGRAM_SPEND_HEADROOM');
    const few = settled20.slice(1);
    expect(programRunBound({ remainingMicroUsd: 1e9, hardStop: null, settledMicroUsd: few }, 10, worst)).toMatchObject({ perCallMicroUsd: worst, requiredMicroUsd: 11 * worst });
    expect(programRunBound({ remainingMicroUsd: 1e9, hardStop: null, settledMicroUsd: Array(20).fill(worst * 3) }, 2, worst).perCallMicroUsd).toBe(worst); // never above the worst case
    for (const code of ['PROGRAM_SPEND_BOUND', 'PROGRAM_SPEND_CAP']) expect(() => programRunBound({ remainingMicroUsd: 1e9, hardStop: code, settledMicroUsd: settled20 }, 1, worst)).toThrow(code);
    for (const [max, w, rem] of [[0, worst, 1e9], [1.5, worst, 1e9], [1, 0, 1e9], [1, worst, Number.NaN]] as const)
      expect(() => programRunBound({ remainingMicroUsd: rem, hardStop: null, settledMicroUsd: [] }, max, w), `${max}/${w}/${rem}`).toThrow('PROGRAM_SPEND_HEADROOM');
  });
  it('reads the ledger itself: settled Luna calls give the mean, spending lowers what is left', async () => {
    const ledger = ledgerIn();
    await settled(ledger, PROGRAM_HEADROOM_MIN_SETTLED);
    const mean = responsesUsageMicroUsd(usage), left = programSpendTotals(ledger).remainingMicroUsd;
    expect(assertProgramRunHeadroom(ledger, 100, undefined)).toMatchObject({ perCallMicroUsd: mean, settledCalls: 20, worstCaseMicroUsd: worst, remainingMicroUsd: left });
    await spend(ledger, left - (100 * mean + worst) + 1); // one micro-dollar short
    expect(() => assertProgramRunHeadroom(ledger, 100, 8192)).toThrow('PROGRAM_SPEND_HEADROOM');
    expect(assertProgramRunHeadroom(ledger, 99, 8192).requiredMicroUsd).toBe(99 * mean + worst);
    // the preflight's earlier snapshot counts too: the smaller remainder, and its hard stop
    expect(() => assertProgramRunHeadroom(ledger, 99, 8192, { remainingMicroUsd: 99 * mean + worst - 1 })).toThrow('PROGRAM_SPEND_HEADROOM');
    expect(() => assertProgramRunHeadroom(ledger, 1, 8192, { hardStop: 'PROGRAM_SPEND_BOUND' })).toThrow('PROGRAM_SPEND_BOUND');
    expect(() => assertProgramRunHeadroom(ledger, 1, 8192, { hardStop: 'something else' })).toThrow('PROGRAM_SPEND_HEADROOM');
    expect(assertProgramRunHeadroom(ledger, 1, 8192, { remainingMicroUsd: 'x', hardStop: null })).toMatchObject({ maxRequests: 1 });
  });
});

describe('program-wide proof lease', () => {
  it('admits only its holder: every other paid call is refused before its reservation, whatever the runner; settlements are never refused', async () => {
    const ledger = ledgerIn();
    const open = await reserveProgramSpend(ledger, 'practice', 'practice:dev', 'in-flight', responsesEstimator.worstCase(url, wire())); // reserved before the proof
    const proof = acquireProofLease(ledger, 'sealed-run');
    expect(inspectProofLease(ledger)).toMatchObject({ state: 'HELD', lease: { id: proof.id, pid: process.pid, host: hostname() }, alive: true });
    expect(() => acquireProofLease(ledger, 'another-proof')).toThrow('PROGRAM_SPEND_PROOF_BUSY');
    const before = fileState(ledger);
    await expect(spend(ledger, 10)).rejects.toThrow('PROGRAM_SPEND_PROOF_BUSY'); // a DEV run, the Golden runner, transcription...
    await expect(assertProgramHeadroom(url, wire(), { ledger })).rejects.toThrow('PROGRAM_SPEND_PROOF_BUSY');
    await expect(spend(ledger, 10, { proof: { ...proof, id: '00000000-0000-4000-8000-000000000000' } })).rejects.toThrow('PROGRAM_SPEND_PROOF_BUSY'); // a forged holder
    expect(fileState(ledger)).toBe(before);
    await settleProgramSpend(ledger, open, { outcome: 'USAGE', httpStatus: 200, usage, chargedMicroUsd: responsesUsageMicroUsd(usage) }); // never refused
    await expect(assertProgramHeadroom(url, wire(), { ledger, proof })).resolves.toMatchObject({ worstCaseMicroUsd: expect.any(Number) });
    await spend(ledger, 10, { proof });
    releaseProofLease(proof, ledger);
    expect(existsSync(proofLeasePath(ledger))).toBe(false);
    await spend(ledger, 10); // free again
  });
  it('a dead holder is PROGRAM_SPEND_PROOF_STALE for everyone (never taken over) until the operator releases it by id', async () => {
    const ledger = ledgerIn(), proof = acquireProofLease(ledger, 'sealed-run');
    writeFileSync(proofLeasePath(ledger), JSON.stringify({ ...proof, pid: deadPid() }));
    await expect(spend(ledger, 10)).rejects.toThrow('PROGRAM_SPEND_PROOF_STALE');
    expect(() => acquireProofLease(ledger, 'next-proof')).toThrow('PROGRAM_SPEND_PROOF_STALE');
    expect(() => operatorReleaseProofLease(ledger, { id: 'wrong' })).toThrow('PROGRAM_SPEND_PROOF_ID_MISMATCH');
    expect(operatorReleaseProofLease(ledger, { id: proof.id })).toMatchObject({ released: 'proof', state: 'STALE', alive: false });
    expect(() => operatorReleaseProofLease(ledger, { id: proof.id })).toThrow('PROGRAM_SPEND_PROOF_FREE');
    const live = acquireProofLease(ledger, 'live');
    expect(() => operatorReleaseProofLease(ledger, { id: live.id })).toThrow('PROGRAM_SPEND_PROOF_BUSY'); // a live holder needs --force
    expect(operatorReleaseProofLease(ledger, { id: live.id, force: true })).toMatchObject({ released: 'proof', state: 'HELD' });
  });
  it('unreadable or foreign lease files refuse too; a unit test never takes a proof lease on the real ledger', async () => {
    const ledger = ledgerIn(); mkdirSync(dirname(ledger), { recursive: true });
    writeFileSync(proofLeasePath(ledger), 'garbage');
    await expect(spend(ledger, 10)).rejects.toThrow('PROGRAM_SPEND_PROOF_BUSY'); // young garbage: being written
    writeFileSync(proofLeasePath(ledger), JSON.stringify({ v: 1, id: '11111111-1111-4111-8111-111111111111', run: 'x', pid: 1, host: 'another-host', startedAt: new Date().toISOString() }));
    await expect(spend(ledger, 10)).rejects.toThrow('PROGRAM_SPEND_PROOF_BUSY'); // another host: never provably gone
    expect(() => acquireProofLease(programSpendLedgerPath(), 'x')).toThrow('PROGRAM_SPEND_TEST_LEDGER');
  });
  it('the operator command refuses a --proof without an id before touching any file', () => {
    const r = spawnSync(process.execPath, [resolve('scripts/agenda-stage-release.cjs'), '--proof'], { encoding: 'utf8', timeout: 60_000 });
    expect(r.status).toBe(1); expect(JSON.parse(r.stderr.trim().split('\n').at(-1)!)).toMatchObject({ status: 'BLOCKED', code: 'AGENDA_ARGUMENT' });
  }, 60_000);
});

// ---------------------------------------------------------------- sealed flow (same offline setup as agenda-sealed-infrastructure.test.ts)
const put = (root: string, file: string, text: string) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text); };
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const TODAY = '2026-09-28';
const scenario = (id: string): AgendaScenario => ({ id, title: `synthetic ${id}`, capability: ['create'], steps: [{ say: 'Marca a Iara Nunes amanhã às 9h' }], final: { unchanged: true } });
const contract = (flags: Record<string, string>): CandidateContract => ({ examplesTag: flags.SALON_SECRETARY_EXAMPLES ?? null, examplesRenderVersion: 'test-v1', bankSha256: 'c'.repeat(64) });
function setup() {
  const root = temp('proof-root-'), git = (...a: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q'); put(root, '.gitignore', 'packages/salon-secretary/evaluation/results/\n.demo/\n'); put(root, 'src/lib/secretary.ts', 'export const v = 1;\n');
  put(root, 'packages/salon-secretary/src/examples/bank.json', '[]\n'); git('add', '.gitignore', 'src/lib/secretary.ts', 'packages/salon-secretary/src/examples/bank.json');
  mkdirSync(join(root, 'packages/salon-secretary/evaluation'), { recursive: true });
  writeHoldoutRegistry(root, { schema: HOLDOUT_REGISTRY_SCHEMA, holdouts: [] });
  const flags = { SALON_SECRETARY_EXAMPLES: 'selected' }, m = buildCandidate({ root, model: 'gpt-6-luna', flags, contract: contract({ ...flags, SALON_SECRETARY_MODEL: 'gpt-6-luna' }) });
  writeCandidate(root, m);
  const text = JSON.stringify([scenario('P01'), scenario('P02')]), holdout = join(temp('proof-holdout-'), 'holdout.json'); writeFileSync(holdout, text);
  writeHoldoutRegistry(root, registerApproval(readHoldoutRegistry(root), { id: 'proof-v1', kind: 'test', sha256: sha(text), ids: ['P01', 'P02'], source: { name: 's.txt', sha256: sha('s') } }));
  const vText = JSON.stringify([scenario('Q01')]), validation = join(temp('proof-validation-'), 'validation.json'); writeFileSync(validation, vText);
  writeHoldoutRegistry(root, registerApproval(readHoldoutRegistry(root), { id: 'choice-proof', kind: 'validation', sha256: sha(vText), ids: ['Q01'], source: { name: 'v.txt', sha256: sha('v') } }));
  const ledger = join(temp('proof-looks-'), HOLDOUT_USAGE_BASENAME), infra = temp('proof-stage-');
  const stageFile = join(infra, agendaStage('final-20260929').journal), programLedger = join(infra, PROGRAM_SPEND_BASENAME);
  const seen: { looks: number; proofHeld: boolean; foreign: string; own: string }[] = [];
  const deps: SealedDeps = { root, ledger, contract, roots: [root], now: () => new Date('2026-09-28T12:00:00.000Z'), print: () => {},
    env: { [SEALED_SHA_ENV]: sha(text), AGENDA_PRACTICE_REAL_APPROVED: 'true', SALON_SECRETARY_MODEL: 'gpt-6-luna', ...flags },
    identity: async () => ({ database: 'synthetic' }),
    preflight: (scenarios, opts) => ({ stage: { name: 'final-20260929' }, stageFile, programLedger, today: TODAY, repeat: opts.repeat ?? 1, runnable: scenarios, skipped: [], maxOutputTokens: 8192,
      estimate: { ok: true, callsPerPass: 4, maxRequests: 4, requiredMicroUsd: 1_000, remainingMicroUsd: 9_000_000 }, noise: { profile: 'off', levels: ['off'], texts: 0, changed: 0, violations: [] },
      programSpend: undefined, dayWindow: { days: [TODAY], spansMidnight: false, rolloverSkips: [] } }) as never,
    run: async (scenarios, out, opts) => {
      // While the proof runs: a run of ANOTHER stage (no proof lease) is refused by the program ledger; the proof's own call is admitted.
      const other = acquireStageLease(join(infra, agendaStage('reliability-20260927').journal), 'reliability-20260927', 'dev-run');
      const foreign = await spend(programLedger, 10).then(() => 'ADMITTED', e => (e as Error).message);
      releaseStageLease(other, join(infra, agendaStage('reliability-20260927').journal), 'reliability-20260927');
      const own = await spend(programLedger, 10, { proof: opts.proofLease }).then(() => 'ADMITTED', e => (e as Error).message);
      seen.push({ looks: existsSync(ledger) ? readHoldoutUsage(ledger, root).length : 0, proofHeld: existsSync(proofLeasePath(programLedger)), foreign, own });
      mkdirSync(join(out, 'k1'), { recursive: true });
      for (const s of scenarios) writeFileSync(join(out, 'k1', `${s.id}.json`), JSON.stringify({ scenario: s, initial: { appointments: [], blocks: [] }, today: TODAY, attempt: 1, complete: true,
        transcript: [{ step: 1, action: 'say', db: { appointments: [], blocks: [] } }] }));
      writeFileSync(join(out, 'report.json'), JSON.stringify({ run: 'synthetic', status: 'COMPLETE', today: TODAY, repeat: 1, ids: scenarios.map(s => s.id), scenarios: scenarios.length, skipped: [] }));
    } };
  return { root, deps, ledger, stageFile, programLedger, validation, seen, options: { holdout, candidate: m.versionId, repeat: 1, stage: 'final-20260929' } };
}

describe('sealed and validation runs: program headroom and proof lease before the look', () => {
  it('the proof lease is held for the whole run (other runs refused, its own calls admitted) and released after it', async () => {
    const f = setup();
    await sealedAgendaPractice(f.options, f.deps);
    expect(f.seen).toEqual([{ looks: 1, proofHeld: true, foreign: 'PROGRAM_SPEND_PROOF_BUSY', own: 'ADMITTED' }]);
    expect(existsSync(proofLeasePath(f.programLedger))).toBe(false); expect(existsSync(stageLeasePath(f.stageFile))).toBe(false);
  });
  it('a program ledger that cannot pay the run is refused before the look (holdout ledger never written, both leases released)', async () => {
    const f = setup();
    await spend(f.programLedger, PROGRAM_REAL_CAP_MICRO_USD - 5 * worst + 1); // the fake run's bound: 4 x worst (no settled history) + 1 worst
    await expect(sealedAgendaPractice(f.options, f.deps)).rejects.toThrow('PROGRAM_SPEND_HEADROOM');
    expect(existsSync(f.ledger)).toBe(false); expect(f.seen).toEqual([]);
    expect(existsSync(proofLeasePath(f.programLedger))).toBe(false); expect(existsSync(stageLeasePath(f.stageFile))).toBe(false);
  });
  it('another proof in progress (any stage) refuses the sealed run and the validation drawer before the look; its lease is untouched', async () => {
    const f = setup(), other = acquireProofLease(f.programLedger, 'another-proof'), bytes = readFileSync(proofLeasePath(f.programLedger), 'utf8');
    await expect(sealedAgendaPractice(f.options, f.deps)).rejects.toThrow('PROGRAM_SPEND_PROOF_BUSY');
    const { contract: _c, ledger: _l, ...outside } = f.deps; void _c; void _l;
    await expect(validationAgendaPractice({ holdout: f.validation, repeat: 1, stage: 'final-20260929' }, outside)).rejects.toThrow('PROGRAM_SPEND_PROOF_BUSY');
    expect(existsSync(f.ledger)).toBe(false); expect(f.seen).toEqual([]); expect(existsSync(stageLeasePath(f.stageFile))).toBe(false);
    expect(readFileSync(proofLeasePath(f.programLedger), 'utf8')).toBe(bytes);
    releaseProofLease(other, f.programLedger);
    await validationAgendaPractice({ holdout: f.validation, repeat: 1, stage: 'final-20260929' }, outside);
    expect(f.seen).toEqual([{ looks: 0, proofHeld: true, foreign: 'PROGRAM_SPEND_PROOF_BUSY', own: 'ADMITTED' }]);
    expect(existsSync(proofLeasePath(f.programLedger))).toBe(false);
  });
  it('the preflight snapshot of the program ledger counts too (the review probe: remaining 0 in the preflight) before the look', async () => {
    const f = setup(), deps = { ...f.deps, preflight: (s: AgendaScenario[], o: Parameters<SealedDeps['preflight']>[1]) =>
      ({ ...(f.deps.preflight(s, o) as object), programSpend: { spentMicroUsd: 15_000_000, remainingMicroUsd: 0, calls: 1, open: 0, hardStop: null } }) as never };
    await expect(sealedAgendaPractice(f.options, deps)).rejects.toThrow('PROGRAM_SPEND_HEADROOM');
    expect(existsSync(f.ledger)).toBe(false); expect(f.seen).toEqual([]); expect(existsSync(proofLeasePath(f.programLedger))).toBe(false);
  });
  it('a program hard stop refuses before the look whatever is left', async () => {
    const f = setup();
    await expect(sealedAgendaPractice(f.options, { ...f.deps, infrastructure: { program: () => { throw Error('PROGRAM_SPEND_BOUND'); } } })).rejects.toThrow('PROGRAM_SPEND_BOUND');
    expect(existsSync(f.ledger)).toBe(false); expect(existsSync(proofLeasePath(f.programLedger))).toBe(false);
  });
});
