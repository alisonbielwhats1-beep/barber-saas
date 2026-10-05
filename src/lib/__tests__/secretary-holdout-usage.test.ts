import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { tmpdir, userInfo } from 'node:os';
import {
  HOLDOUT_POLICY, HOLDOUT_REGISTRY_FILE, HOLDOUT_REGISTRY_SCHEMA, HOLDOUT_USAGE_ANCHOR_FILE, HOLDOUT_USAGE_BASENAME, HOLDOUT_USAGE_FILE, HOLDOUT_USAGE_LEDGER, holdoutAllowance,
  holdoutUsageAllowance, holdoutUsageLedgerPath, parseHoldoutRegistry, readHoldoutRegistry, readHoldoutUsage, recordSealedRun, registerApproval, registeredHoldoutMatch, retireHoldout,
  writeHoldoutRegistry, type HoldoutRegistry, type SealedRunEntry,
} from '../../../packages/salon-secretary/evaluation/holdout-usage';

// Offline only: temporary ledgers and registries; the real ledger under the OS account is never written.
const directories: string[] = [];
const temp = (prefix: string) => { const directory = mkdtempSync(join(tmpdir(), prefix)); directories.push(directory); return directory; };
const ledgerIn = () => join(temp('holdout-usage-'), HOLDOUT_USAGE_BASENAME);
// H1 and H1B are two approved files (e.g. re-derived) of the SAME logical holdout; H2 is another holdout; V is the validation set.
const H1 = 'a'.repeat(64), H1B = 'd'.repeat(64), H2 = 'b'.repeat(64), V = 'e'.repeat(64), SRC = 'f'.repeat(64), C1 = '1111111111111111', C2 = '2222222222222222', C3 = '3333333333333333';
const REGISTRY: HoldoutRegistry = { schema: HOLDOUT_REGISTRY_SCHEMA, holdouts: [
  { id: 'owner-v1', kind: 'test', retired: false, source: { name: 'owner-holdout-v1.txt', sha256: SRC }, approved: [{ sha256: H1, ids: ['O01', 'O02'] }, { sha256: H1B, ids: null }], looks: [] },
  { id: 'assistant-v1', kind: 'test', retired: false, source: { name: 'assistant-holdout-v1.json', sha256: H2 }, approved: [{ sha256: H2, ids: null }], looks: [] },
  { id: 'validation-v1', kind: 'validation', retired: false, source: { name: 'validation-v1.json', sha256: V }, approved: [{ sha256: V, ids: ['Q01'] }], looks: [] }] };
const HOLDOUT_OF: Record<string, string> = { [H1]: 'owner-v1', [H1B]: 'owner-v1', [H2]: 'assistant-v1', [V]: 'validation-v1' };
/** A checkout root holding only the registry. */
function rootWith(registry: HoldoutRegistry = REGISTRY) {
  const root = temp('holdout-root-'); mkdirSync(dirname(join(root, HOLDOUT_REGISTRY_FILE)), { recursive: true });
  writeHoldoutRegistry(root, registry); return root;
}
const entry = (holdoutSha256: string, candidate: string, k = 5): SealedRunEntry =>
  ({ holdoutId: HOLDOUT_OF[holdoutSha256] ?? 'owner-v1', holdoutSha256, candidate, scenarios: 26, k, run: `sealed-${holdoutSha256.slice(0, 8)}-2026-09-28T12-00-00-000Z` });
const fileState = (file: string) => existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : 'ABSENT';
const lines = (file: string) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
const rehash = (row: Record<string, unknown>) => { const { rowHash: _old, ...body } = row; void _old; return { ...body, rowHash: createHash('sha256').update(JSON.stringify(body)).digest('hex') }; };
const writeRows = (file: string, rows: unknown[]) => writeFileSync(file, rows.map(row => JSON.stringify(row) + '\n').join(''));
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('holdout usage ledger: location and policy', () => {
  it('lives under the OS account, outside every checkout, with a 1-run-per-candidate / 2-candidates-per-holdout policy', () => {
    expect(HOLDOUT_USAGE_FILE).toBe('~/.everflair-secretary/holdout-usage.jsonl');
    expect(holdoutUsageLedgerPath()).toBe(join(userInfo().homedir, '.everflair-secretary', HOLDOUT_USAGE_BASENAME));
    expect(relative(process.cwd(), holdoutUsageLedgerPath())).toMatch(/^\.\.|^[A-Za-z]:/);
    expect(HOLDOUT_USAGE_ANCHOR_FILE).toBe('packages/salon-secretary/evaluation/holdout-usage-anchor.json');
    expect(HOLDOUT_REGISTRY_FILE).toBe('packages/salon-secretary/evaluation/holdout-registry.json');
    expect(HOLDOUT_POLICY).toEqual({ runsPerCandidate: 1, candidatesPerHoldout: 2 });
  });
  it('allowance per LOGICAL holdout: a candidate runs once; a holdout serves two candidates, then is exhausted', () => {
    expect(holdoutAllowance([], 'owner-v1', C1)).toMatchObject({ holdout: 'owner-v1', runs: 0, candidates: [], remainingCandidates: 2, candidateRuns: 0, remainingRunsForCandidate: 1, allowed: true, code: null });
    const row = (holdoutId: string, candidate: string) => ({ holdoutId, candidate }) as never;
    expect(holdoutAllowance([row('owner-v1', C1)], 'owner-v1', C1)).toMatchObject({ allowed: false, code: 'HOLDOUT_CANDIDATE_USED', remainingRunsForCandidate: 0, remainingCandidates: 1 });
    expect(holdoutAllowance([row('owner-v1', C1)], 'owner-v1', C2)).toMatchObject({ allowed: true, code: null, remainingCandidates: 1 });
    expect(holdoutAllowance([row('owner-v1', C1), row('owner-v1', C2)], 'owner-v1', C3)).toMatchObject({ allowed: false, code: 'HOLDOUT_EXHAUSTED', remainingCandidates: 0 });
    expect(holdoutAllowance([row('owner-v1', C1), row('owner-v1', C2)], 'owner-v1')).toMatchObject({ allowed: false, code: 'HOLDOUT_EXHAUSTED' });
    expect(holdoutAllowance([row('owner-v1', C1), row('owner-v1', C2)], 'assistant-v1', C3)).toMatchObject({ allowed: true, runs: 0 });
  });
});

describe('holdout registry', () => {
  // Final-battery migration (29/09; backup .demo/agenda-core/contract-migration/secretary-holdout-usage.test.before-final-battery.ts):
  // looks and the derived owner files are now recorded; the pre-battery 'no look yet' state became 'looks only within policy'.
  it('is tracked in this checkout: the published holdouts and the validation set, looks only on test holdouts and within policy', () => {
    const registry = readHoldoutRegistry(process.cwd());
    // Candidate 4 (29/09): every holdout opened in the final proof of 67c9c297 is retired to regression (owner decision).
    expect(registry.holdouts.map(h => [h.id, h.kind, h.retired])).toEqual([['assistant-v1', 'test', true], ['owner-v1', 'test', true], ['owner-multi-v1', 'test', true],
      ['validation-v1', 'validation', true], ['multi-salon-v2', 'test', true], ['multi-salon-v3', 'test', true],
      // CI migration (05/10; backup .demo/agenda-core/contract-migration/secretary-holdout-usage.test.before-ci.ts): the C4 proof,
      // the C5 agent proof and the pilot gates registered these later in the tracked registry (8162905); none is retired yet.
      ['owner-v2', 'test', false], ['multi-salon-v4', 'test', false], ['agent-v1c-simple', 'test', false], ['agent-v1c-complex', 'test', false],
      ['micro-p0p2-30', 'validation', false], ['pilot-gate-20', 'validation', false], ['pilot-e2-30', 'validation', false], ['pilot-e2b-30', 'validation', false]]);
    // The owner .txt files are sources only: their derived scenario files are registered by the coordinator at the final battery.
    expect(registry.holdouts.find(h => h.id === 'owner-v1')).toMatchObject({ source: { sha256: expect.stringMatching(/^75a3121e/) } });
    for (const id of ['owner-v1', 'owner-multi-v1']) expect(registry.holdouts.find(h => h.id === id)!.approved.length).toBeLessThanOrEqual(1);
    expect(registry.holdouts.find(h => h.id === 'assistant-v1')?.approved.map(a => a.sha256.slice(0, 8))).toEqual(['a7c4d447']);
    expect(registry.holdouts.find(h => h.id === 'assistant-v1')?.source.sha256.slice(0, 8)).toBe('1ea91884'); // v1 (superseded) is a source, never runnable
    for (const h of registry.holdouts) {
      if (h.kind !== 'test') expect(h.looks, h.id).toEqual([]);
      const candidates = new Set(h.looks.map(look => look.candidate));
      expect(candidates.size, h.id).toBeLessThanOrEqual(2);
      for (const candidate of candidates) expect(h.looks.filter(look => look.candidate === candidate), h.id + ' ' + candidate).toHaveLength(1);
    }
  });
  it('validates strictly: unique ids, one owner per sha, sorted ids, looks only on test holdouts', () => {
    expect(() => parseHoldoutRegistry(REGISTRY)).not.toThrow();
    const variants: unknown[] = [
      { ...REGISTRY, schema: 'x' },
      { ...REGISTRY, holdouts: [...REGISTRY.holdouts, { ...REGISTRY.holdouts[1] }] }, // duplicated id
      { ...REGISTRY, holdouts: [REGISTRY.holdouts[0], { ...REGISTRY.holdouts[1], approved: [{ sha256: H1, ids: null }] }] }, // sha of another holdout
      { ...REGISTRY, holdouts: [REGISTRY.holdouts[0], { ...REGISTRY.holdouts[1], source: { name: 'x.json', sha256: SRC } }] }, // source of another holdout
      { ...REGISTRY, holdouts: [{ ...REGISTRY.holdouts[0], approved: [{ sha256: H1, ids: ['O02', 'O01'] }] }] }, // unsorted ids
      { ...REGISTRY, holdouts: [{ ...REGISTRY.holdouts[2], looks: [{ seq: 0, candidate: C1, rowHash: H1 }] }] }, // a look on the validation set
      { ...REGISTRY, holdouts: [{ ...REGISTRY.holdouts[0], id: 'Owner V1' }] },
      { ...REGISTRY, holdouts: [{ ...REGISTRY.holdouts[0], extra: true }] },
    ];
    for (const value of variants) expect(() => parseHoldoutRegistry(value)).toThrow('HOLDOUT_REGISTRY');
    expect(() => readHoldoutRegistry(temp('holdout-empty-'))).toThrow('HOLDOUT_REGISTRY_MISSING');
  });
  it('registers a re-derived file under the same logical id, refuses a taken sha or another kind, and retires', () => {
    const next = registerApproval(REGISTRY, { id: 'owner-v1', kind: 'test', sha256: 'c'.repeat(64), ids: ['O02', 'O01', 'O01'] });
    expect(next.holdouts[0].approved.map(a => [a.sha256[0], a.ids])).toEqual([['a', ['O01', 'O02']], ['d', null], ['c', ['O01', 'O02']]]);
    expect(registerApproval(REGISTRY, { id: 'owner-v1', kind: 'test', sha256: H1B, ids: ['O03'] }).holdouts[0].approved[1].ids).toEqual(['O03']); // fills unknown ids
    expect(() => registerApproval(REGISTRY, { id: 'owner-v1', kind: 'test', sha256: H1, ids: ['O09'] })).toThrow('HOLDOUT_REGISTRY_MISMATCH');
    expect(() => registerApproval(REGISTRY, { id: 'assistant-v1', kind: 'test', sha256: H1, ids: ['H01'] })).toThrow('HOLDOUT_REGISTRY_SHA_TAKEN');
    expect(() => registerApproval(REGISTRY, { id: 'owner-v1', kind: 'validation', sha256: 'c'.repeat(64), ids: ['O01'] })).toThrow('HOLDOUT_REGISTRY_KIND');
    expect(() => registerApproval(REGISTRY, { id: 'owner-v2', kind: 'test', sha256: 'c'.repeat(64), ids: ['P01'] })).toThrow('HOLDOUT_REGISTRY_SOURCE');
    expect(registerApproval(REGISTRY, { id: 'owner-v2', kind: 'test', sha256: 'c'.repeat(64), ids: ['P01'], source: { name: 'owner-holdout-v2.txt', sha256: '9'.repeat(64) } }).holdouts.at(-1))
      .toMatchObject({ id: 'owner-v2', kind: 'test', retired: false, approved: [{ ids: ['P01'] }], looks: [] });
    expect(retireHoldout(REGISTRY, 'assistant-v1').holdouts[1].retired).toBe(true);
    expect(() => retireHoldout(REGISTRY, 'nope')).toThrow('HOLDOUT_NOT_REGISTERED');
  });
  it('matches a scenario file to a holdout in use by sha (approved or source) or by ANY registered scenario id', () => {
    expect(registeredHoldoutMatch(REGISTRY, H1B, [])).toBe('owner-v1');
    expect(registeredHoldoutMatch(REGISTRY, SRC, [])).toBe('owner-v1');
    expect(registeredHoldoutMatch(REGISTRY, '0'.repeat(64), ['V01', 'O02'])).toBe('owner-v1'); // a subset copied into a dev file
    expect(registeredHoldoutMatch(REGISTRY, '0'.repeat(64), ['Q01'])).toBe('validation-v1');
    expect(registeredHoldoutMatch(REGISTRY, '0'.repeat(64), ['V01', 'N01'])).toBeNull();
    expect(registeredHoldoutMatch(retireHoldout(REGISTRY, 'assistant-v1'), H2, [])).toBeNull(); // retired = regression
  });
});

describe('holdout usage ledger: append-only look budget', () => {
  it('records one hash-chained row per sealed run, keyed on the logical holdout, and refuses a repeat run or a third candidate without writing', async () => {
    const file = ledgerIn(), root = rootWith();
    const first = await recordSealedRun(file, entry(H1, C1), root);
    expect(Object.keys(first).join()).toBe('ledger,kind,seq,id,at,holdoutId,holdoutSha256,candidate,scenarios,k,run,previousHash,rowHash');
    expect(first).toMatchObject({ ledger: HOLDOUT_USAGE_LEDGER, kind: 'SEALED_RUN', seq: 0, holdoutId: 'owner-v1', holdoutSha256: H1, candidate: C1, scenarios: 26, k: 5, previousHash: 'GENESIS' });
    const before = fileState(file);
    await expect(recordSealedRun(file, entry(H1, C1, 3), root)).rejects.toThrow('HOLDOUT_CANDIDATE_USED');
    // A re-derived file of the same logical holdout does NOT reset the budget.
    await expect(recordSealedRun(file, entry(H1B, C1), root)).rejects.toThrow('HOLDOUT_CANDIDATE_USED');
    expect(fileState(file)).toBe(before);
    const second = await recordSealedRun(file, entry(H1B, C2), root);
    expect(second.previousHash).toBe(first.rowHash);
    const full = fileState(file);
    await expect(recordSealedRun(file, entry(H1, C3), root)).rejects.toThrow('HOLDOUT_EXHAUSTED');
    await expect(recordSealedRun(file, entry(H1B, C3), root)).rejects.toThrow('HOLDOUT_EXHAUSTED');
    expect(fileState(file)).toBe(full);
    await recordSealedRun(file, entry(H2, C3), root); // another logical holdout starts its own budget
    expect(readHoldoutUsage(file, root).map(r => [r.seq, r.holdoutId, r.candidate.slice(0, 1)])).toEqual([[0, 'owner-v1', '1'], [1, 'owner-v1', '2'], [2, 'assistant-v1', '3']]);
    expect(holdoutUsageAllowance('owner-v1', C3, file, root)).toMatchObject({ runs: 2, candidates: [C1, C2], remainingCandidates: 0, allowed: false, code: 'HOLDOUT_EXHAUSTED' });
    // The anchor next to a test ledger pins genesis and the last row; the registry lists every look.
    expect(JSON.parse(readFileSync(join(file, '..', `${HOLDOUT_USAGE_LEDGER}.anchor.json`), 'utf8'))).toMatchObject({ seq: 2, genesisId: first.id, genesisHash: first.rowHash });
    expect(readHoldoutRegistry(root).holdouts.map(h => h.looks.map(l => [l.seq, l.candidate.slice(0, 1)]))).toEqual([[[0, '1'], [1, '2']], [[2, '3']], []]);
    // Codes only: no text field exists in a row.
    for (const row of lines(file)) for (const value of Object.values(row)) expect(String(value)).toMatch(/^[A-Za-z0-9_.:#+-]{1,160}$/);
  });
  it('refuses a file the registry does not approve for a test holdout, before writing anything', async () => {
    const file = ledgerIn(), root = rootWith();
    for (const bad of [{ holdoutSha256: '0'.repeat(64) }, { holdoutId: 'validation-v1', holdoutSha256: V }, { holdoutId: 'assistant-v1', holdoutSha256: H1 }, { holdoutId: 'nope-v1' }])
      await expect(recordSealedRun(file, { ...entry(H1, C1), ...bad }, root)).rejects.toThrow('HOLDOUT_NOT_REGISTERED');
    await expect(recordSealedRun(file, entry(H2, C1), rootWith(retireHoldout(REGISTRY, 'assistant-v1')))).rejects.toThrow('HOLDOUT_NOT_REGISTERED');
    expect(existsSync(file)).toBe(false);
    await expect(recordSealedRun(file, entry(H1, C1), temp('holdout-no-registry-'))).rejects.toThrow('HOLDOUT_REGISTRY_MISSING');
    expect(existsSync(file)).toBe(false);
  });
  it('validates entries before writing (sha, candidate id, scenarios, k, run label)', async () => {
    const file = ledgerIn(), root = rootWith(registerApproval(REGISTRY, { id: 'owner-v1', kind: 'test', sha256: 'c'.repeat(64), ids: ['O01'] }));
    for (const bad of [{ candidate: 'ABC' }, { scenarios: 0 }, { k: 9 }, { run: 'sealed run with spaces' }])
      await expect(recordSealedRun(file, { ...entry(H1, C1), ...bad }, root)).rejects.toThrow('HOLDOUT_LEDGER_ROW');
    expect(existsSync(file)).toBe(false);
  });
  it('fails closed on tampering, a policy-violating row, truncation or deletion', async () => {
    const file = ledgerIn(), root = rootWith(), anchor = join(file, '..', `${HOLDOUT_USAGE_LEDGER}.anchor.json`);
    await recordSealedRun(file, entry(H1, C1), root); await recordSealedRun(file, entry(H1, C2), root);
    const rows = lines(file), original = readFileSync(file, 'utf8');
    writeRows(file, [rows[0], { ...rows[1], k: 1 }]); // edited value, stale hash
    expect(() => readHoldoutUsage(file, root)).toThrow('HOLDOUT_LEDGER_JOURNAL');
    writeRows(file, [rows[0], rehash({ ...rows[1], previousHash: 'GENESIS' })]); // broken chain
    expect(() => readHoldoutUsage(file, root)).toThrow('HOLDOUT_LEDGER_JOURNAL');
    // A well-formed row beyond the policy (a second look of the same candidate) is corruption too.
    writeRows(file, [rows[0], rows[1], rehash({ ...rows[1], seq: 2, id: '00000000-0000-4000-8000-000000000000', candidate: C1, previousHash: rows[1].rowHash })]);
    expect(() => readHoldoutUsage(file, root)).toThrow('HOLDOUT_LEDGER_JOURNAL');
    writeFileSync(file, original.slice(0, -1)); // no trailing newline
    expect(() => readHoldoutUsage(file, root)).toThrow('HOLDOUT_LEDGER_JOURNAL');
    writeRows(file, [rows[0]]); // truncated below the anchor
    expect(() => readHoldoutUsage(file, root)).toThrow('HOLDOUT_LEDGER_JOURNAL');
    await expect(recordSealedRun(file, entry(H1, C2), root)).rejects.toThrow('HOLDOUT_LEDGER_JOURNAL');
    unlinkSync(file); // deleted: never "no looks yet"
    expect(() => readHoldoutUsage(file, root)).toThrow('HOLDOUT_LEDGER_JOURNAL');
    writeFileSync(file, original);
    expect(readHoldoutUsage(file, root)).toHaveLength(2);
    // Ledger AND anchor deleted: the registry still lists the looks, so it fails closed (another worktree, a fresh
    // clone or a deleted anchor never starts from zero).
    unlinkSync(anchor); unlinkSync(file);
    expect(() => readHoldoutUsage(file, root)).toThrow('HOLDOUT_LEDGER_JOURNAL');
    await expect(recordSealedRun(file, entry(H1, C1), root)).rejects.toThrow('HOLDOUT_LEDGER_JOURNAL');
    writeFileSync(file, original); // the anchor alone missing while the registry lists looks: refused too
    expect(() => readHoldoutUsage(file, root)).toThrow('HOLDOUT_LEDGER_JOURNAL');
    unlinkSync(file);
    expect(readHoldoutUsage(file, rootWith())).toEqual([]); // a genuinely new ledger (no anchor, no look in the registry) starts empty
  });
  it('fails closed when the registry is edited to re-home or forget a looked-at file', async () => {
    const file = ledgerIn(), root = rootWith();
    await recordSealedRun(file, entry(H1B, C1), root);
    const registry = readHoldoutRegistry(root);
    // Moving the looked-at sha to a fresh logical id (to reset its budget) breaks the ledger/registry agreement.
    const moved = registerApproval({ ...registry, holdouts: registry.holdouts.map(h => h.id === 'owner-v1' ? { ...h, approved: h.approved.filter(a => a.sha256 !== H1B), looks: [] } : h) },
      { id: 'owner-v1b', kind: 'test', sha256: H1B, ids: ['O01'], source: { name: 'owner-holdout-v1b.txt', sha256: '8'.repeat(64) } });
    writeHoldoutRegistry(root, moved);
    expect(() => readHoldoutUsage(file, root)).toThrow('HOLDOUT_LEDGER_JOURNAL');
    await expect(recordSealedRun(file, { ...entry(H1B, C2), holdoutId: 'owner-v1b' }, root)).rejects.toThrow('HOLDOUT_LEDGER_JOURNAL');
    // A look the ledger does not have (another candidate, another row hash) is refused as well.
    writeHoldoutRegistry(root, { ...registry, holdouts: registry.holdouts.map(h => h.id === 'owner-v1' ? { ...h, looks: [{ ...h.looks[0], candidate: C2 }] } : h) });
    expect(() => readHoldoutUsage(file, root)).toThrow('HOLDOUT_LEDGER_JOURNAL');
    writeHoldoutRegistry(root, registry);
    expect(readHoldoutUsage(file, root)).toHaveLength(1);
  });
  it('never writes the real ledger from a unit test and accepts no other file name', async () => {
    const real = holdoutUsageLedgerPath(), before = fileState(real), root = rootWith();
    await expect(recordSealedRun(real, entry(H1, C1), root)).rejects.toThrow('HOLDOUT_LEDGER_TEST');
    expect(fileState(real)).toBe(before);
    await expect(recordSealedRun(join(tmpdir(), 'other.jsonl'), entry(H1, C1), root)).rejects.toThrow('HOLDOUT_LEDGER_CONFIG');
    expect(() => readHoldoutUsage(join(tmpdir(), 'other.jsonl'), root)).toThrow('HOLDOUT_LEDGER_CONFIG');
  });
});
