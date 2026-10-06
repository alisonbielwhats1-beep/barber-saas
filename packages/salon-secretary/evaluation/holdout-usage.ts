/** Holdout registry and usage ledger ("look budget") of the reliability program (28/09/2026). Codes only: no scenario text ever.
 * REGISTRY (tracked, `holdout-registry.json`): every approved scenario file (sha256) of a sealed test holdout or of the
 * validation set, under a LOGICAL holdout id and its source (e.g. the owner's .txt sha256). Re-deriving, re-formatting
 * or fixing a holdout file gives another sha under the SAME id, so it never resets the budget; an unregistered sha is
 * refused (the approval environment variable alone is not enough). The registry also lists the scenario ids of each
 * approved file (normal runs refuse a registered holdout by sha or by any shared id) and every consumed look (ledger seq,
 * candidate, row hash): a checkout that knows of a look requires the ledger rows and the anchor (fail closed), so a
 * deleted ledger, another worktree or a fresh clone never reads as "no looks yet".
 * LEDGER: every sealed run appends one SEALED_RUN row {logical holdout id, file sha256, candidate version id, ts,
 * scenarios, k} BEFORE any database or network work, so a started run consumes its look even when it aborts.
 * Policy (reusable holdout, Dwork et al.; Scale SEAL), per LOGICAL holdout: at most HOLDOUT_POLICY.runsPerCandidate sealed
 * run per candidate and at most HOLDOUT_POLICY.candidatesPerHoldout distinct candidates; a third candidate needs a new
 * holdout (HOLDOUT_EXHAUSTED). The policy is re-checked on every row read, so a hand-appended row beyond it fails closed.
 * ONE ledger per machine account, outside every checkout and worktree (`~/.everflair-secretary/holdout-usage.jsonl`, the
 * home directory read from the OS account, not from an environment variable). Append-only, fsynced, hash-chained, under an
 * exclusive lock; no reset, refund or path override (the only other path is a unit-test ledger under VITEST). External
 * anchor: the checkout's `holdout-usage-anchor.json` pins the genesis and last rows. Anchor and registry are evaluation
 * state the runner rewrites (excluded from candidate freeze manifests) and must be committed after a sealed run. */
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

export const HOLDOUT_USAGE_LEDGER = 'holdout-usage-v1';
export const HOLDOUT_USAGE_DIR = '.everflair-secretary';
export const HOLDOUT_USAGE_BASENAME = 'holdout-usage.jsonl';
export const HOLDOUT_USAGE_FILE = `~/${HOLDOUT_USAGE_DIR}/${HOLDOUT_USAGE_BASENAME}`;
/** Tracked anchor, relative to the checkout root (volatile evaluation state: excluded from candidate freeze manifests). */
export const HOLDOUT_USAGE_ANCHOR_FILE = 'packages/salon-secretary/evaluation/holdout-usage-anchor.json';
/** Tracked registry, relative to the checkout root (volatile evaluation state: excluded from candidate freeze manifests). */
export const HOLDOUT_REGISTRY_FILE = 'packages/salon-secretary/evaluation/holdout-registry.json';
export const HOLDOUT_REGISTRY_SCHEMA = 'secretary-holdout-registry-v1';
export const HOLDOUT_POLICY = Object.freeze({ runsPerCandidate: 1, candidatesPerHoldout: 2 });
export type HoldoutRefusal = 'HOLDOUT_CANDIDATE_USED' | 'HOLDOUT_EXHAUSTED';
export function holdoutUsageLedgerPath() {
  let home = ''; try { home = userInfo().homedir; } catch { home = ''; }
  if (typeof home !== 'string' || !home || !isAbsolute(home)) throw Error('HOLDOUT_LEDGER_CONFIG');
  return join(home, HOLDOUT_USAGE_DIR, HOLDOUT_USAGE_BASENAME);
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const KEYS = ['ledger', 'kind', 'seq', 'id', 'at', 'holdoutId', 'holdoutSha256', 'candidate', 'scenarios', 'k', 'run', 'previousHash', 'rowHash'].join();
const ANCHOR_KEYS = ['ledger', 'genesisId', 'genesisHash', 'seq', 'rowHash'].join();
const HASH = /^[0-9a-f]{64}$/, CANDIDATE = /^[0-9a-f]{16}$/, RUN = /^[A-Za-z0-9][A-Za-z0-9_.:#+-]{0,159}$/, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const HOLDOUT_ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const SOURCE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/, SCENARIO_ID = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const LOCK_WAIT_MS = 3000;
export type HoldoutUsageRow = { ledger: string; kind: 'SEALED_RUN'; seq: number; id: string; at: string; holdoutId: string; holdoutSha256: string; candidate: string; scenarios: number;
  k: number; run: string; previousHash: string; rowHash: string };
export type SealedRunEntry = { holdoutId: string; holdoutSha256: string; candidate: string; scenarios: number; k: number; run: string };
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const int = (v: unknown, min: number, max: number) => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
const sameKeys = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).sort().join() === [...keys].sort().join();

// ---------------------------------------------------------------- registry
export type HoldoutKind = 'test' | 'validation';
export type RegistryApproval = { sha256: string; ids: string[] | null };
export type RegistryLook = { seq: number; candidate: string; rowHash: string };
export type RegistryEntry = { id: string; kind: HoldoutKind; retired: boolean; source: { name: string; sha256: string }; approved: RegistryApproval[]; looks: RegistryLook[] };
export type HoldoutRegistry = { schema: string; holdouts: RegistryEntry[] };
/** Strict validation: unique logical ids; every approved sha and every source sha belongs to one entry only; scenario
 * ids sorted and unique (null until the coordinator registers the file); looks only on test holdouts, in ledger order. */
export function parseHoldoutRegistry(value: unknown): HoldoutRegistry {
  const bad: () => never = () => { throw Error('HOLDOUT_REGISTRY'); }; // explicitly typed: `if (...) bad();` narrows
  if (!isRecord(value) || !sameKeys(value, ['schema', 'holdouts']) || value.schema !== HOLDOUT_REGISTRY_SCHEMA || !Array.isArray(value.holdouts)) bad();
  const entries = value.holdouts as unknown[], ids = new Set<string>(), shas = new Map<string, string>();
  for (const h of entries) {
    if (!isRecord(h) || !sameKeys(h, ['id', 'kind', 'retired', 'source', 'approved', 'looks'])) bad();
    const e = h as unknown as RegistryEntry;
    if (typeof e.id !== 'string' || !HOLDOUT_ID.test(e.id) || ids.has(e.id) || (e.kind !== 'test' && e.kind !== 'validation') || typeof e.retired !== 'boolean') bad();
    ids.add(e.id);
    const s = e.source as unknown;
    if (!isRecord(s) || !sameKeys(s, ['name', 'sha256']) || typeof s.name !== 'string' || !SOURCE_NAME.test(s.name) || typeof s.sha256 !== 'string' || !HASH.test(s.sha256)) bad();
    if (!Array.isArray(e.approved) || !Array.isArray(e.looks) || (e.kind === 'validation' && e.looks.length)) bad();
    for (const a of e.approved as unknown[]) {
      if (!isRecord(a) || !sameKeys(a, ['sha256', 'ids']) || typeof a.sha256 !== 'string' || !HASH.test(a.sha256) || shas.has(a.sha256)) bad();
      const list = a.ids;
      if (list !== null && (!Array.isArray(list) || !list.length || list.some(x => typeof x !== 'string' || !SCENARIO_ID.test(x)) || [...new Set(list)].sort().join() !== list.join())) bad();
      shas.set(a.sha256 as string, e.id);
    }
    let seq = -1;
    for (const l of e.looks as unknown[]) {
      if (!isRecord(l) || !sameKeys(l, ['seq', 'candidate', 'rowHash']) || !int(l.seq, seq + 1, Number.MAX_SAFE_INTEGER) || typeof l.candidate !== 'string' || !CANDIDATE.test(l.candidate) ||
        typeof l.rowHash !== 'string' || !HASH.test(l.rowHash)) bad();
      seq = l.seq as number;
    }
  }
  const sources = new Set<string>();
  for (const e of entries as RegistryEntry[]) {
    if (sources.has(e.source.sha256) || (shas.has(e.source.sha256) && shas.get(e.source.sha256) !== e.id)) bad(); // one source, one logical holdout
    sources.add(e.source.sha256);
  }
  return value as unknown as HoldoutRegistry;
}
export function readHoldoutRegistry(root: string = process.cwd()): HoldoutRegistry {
  let text: string; try { text = readFileSync(join(root, HOLDOUT_REGISTRY_FILE), 'utf8'); } catch { throw Error('HOLDOUT_REGISTRY_MISSING'); }
  let value: unknown; try { value = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw Error('HOLDOUT_REGISTRY'); }
  return parseHoldoutRegistry(value);
}
/** The logical holdout an approved file sha256 belongs to (null: not approved). */
export const registeredHoldout = (registry: HoldoutRegistry, sha256: string) => registry.holdouts.find(h => h.approved.some(a => a.sha256 === sha256)) ?? null;
/** The registered holdout (still in use) a scenario file matches, by its sha256 (an approved file or a source) or by ANY
 * scenario id of an approved file; null when it matches none. Retired holdouts (turned into regression) are free to run. */
export function registeredHoldoutMatch(registry: HoldoutRegistry, sha256: string | null, ids: readonly string[]) {
  for (const h of registry.holdouts) if (!h.retired) {
    if (sha256 && (h.source.sha256 === sha256 || h.approved.some(a => a.sha256 === sha256))) return h.id;
    const known = new Set(h.approved.flatMap(a => a.ids ?? []));
    if (ids.some(id => known.has(id))) return h.id;
  }
  return null;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
/** Registers an approved scenario file of a logical holdout (pure): a new sha under an existing id shares its look
 * budget. Refused: a sha approved under another id (HOLDOUT_REGISTRY_SHA_TAKEN), a kind change (HOLDOUT_REGISTRY_KIND), a
 * new id without a source (HOLDOUT_REGISTRY_SOURCE), other ids for an already registered sha (HOLDOUT_REGISTRY_MISMATCH).
 * Re-registering an approved sha whose ids are unknown fills them. */
export function registerApproval(registry: HoldoutRegistry, input: { id: string; kind: HoldoutKind; sha256: string; ids: string[]; source?: { name: string; sha256: string } }) {
  const next = clone(registry), ids = [...new Set(input.ids)].sort(), owner = registeredHoldout(next, input.sha256);
  if (owner && owner.id !== input.id) throw Error('HOLDOUT_REGISTRY_SHA_TAKEN');
  let entry = next.holdouts.find(h => h.id === input.id);
  if (entry && entry.kind !== input.kind) throw Error('HOLDOUT_REGISTRY_KIND');
  if (!entry) {
    if (!input.source) throw Error('HOLDOUT_REGISTRY_SOURCE');
    entry = { id: input.id, kind: input.kind, retired: false, source: { name: input.source.name, sha256: input.source.sha256 }, approved: [], looks: [] };
    next.holdouts.push(entry);
  }
  const approval = entry.approved.find(a => a.sha256 === input.sha256);
  if (approval?.ids && approval.ids.join() !== ids.join()) throw Error('HOLDOUT_REGISTRY_MISMATCH');
  if (approval) approval.ids = ids; else entry.approved.push({ sha256: input.sha256, ids });
  return parseHoldoutRegistry(next);
}
/** A holdout turned into regression (exhausted or superseded): normal runs may use it; sealed and validation runs refuse it. */
export function retireHoldout(registry: HoldoutRegistry, id: string) {
  const next = clone(registry), entry = next.holdouts.find(h => h.id === id);
  if (!entry) throw Error('HOLDOUT_NOT_REGISTERED');
  entry.retired = true;
  return parseHoldoutRegistry(next);
}
const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function atomicWrite(target: string, text: string, code: string) {
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    const fd = openSync(tmp, 'w', 0o644);
    try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
    // Windows: a scanner or reader may hold the file for longer than a few tens of ms (29/09); ~6 s backoff, then fail closed.
    for (let attempt = 1; ; attempt++) {
      try { renameSync(tmp, target); break; }
      catch (error) { if (attempt >= 30 || !['EPERM', 'EACCES', 'EBUSY'].includes(String((error as NodeJS.ErrnoException).code))) throw error; pause(Math.min(25 * attempt, 250)); }
    }
  } catch { try { unlinkSync(tmp); } catch { /* already gone */ } throw Error(code); }
}
export function writeHoldoutRegistry(root: string, registry: HoldoutRegistry) {
  const checked = parseHoldoutRegistry(clone(registry));
  atomicWrite(join(root, HOLDOUT_REGISTRY_FILE), JSON.stringify(checked, null, 2) + '\n', 'HOLDOUT_REGISTRY_IO');
}

// ---------------------------------------------------------------- allowance
/** Remaining looks of a LOGICAL holdout (read-only, pure). With a candidate: whether that candidate may run now, else why not. */
export function holdoutAllowance(rows: readonly HoldoutUsageRow[], holdoutId: string, candidate?: string) {
  const runs = rows.filter(r => r.holdoutId === holdoutId), candidates = [...new Set(runs.map(r => r.candidate))];
  const candidateRuns = candidate === undefined ? 0 : runs.filter(r => r.candidate === candidate).length;
  const known = candidate !== undefined && candidates.includes(candidate);
  const code: HoldoutRefusal | null = candidate !== undefined && candidateRuns >= HOLDOUT_POLICY.runsPerCandidate ? 'HOLDOUT_CANDIDATE_USED'
    : !known && candidates.length >= HOLDOUT_POLICY.candidatesPerHoldout ? 'HOLDOUT_EXHAUSTED' : null;
  return { holdout: holdoutId, policy: HOLDOUT_POLICY, runs: runs.length, candidates, remainingCandidates: Math.max(0, HOLDOUT_POLICY.candidatesPerHoldout - candidates.length),
    ...(candidate !== undefined ? { candidate, candidateRuns, remainingRunsForCandidate: code ? 0 : HOLDOUT_POLICY.runsPerCandidate - candidateRuns } : {}), allowed: code === null, code };
}
export type HoldoutAllowance = ReturnType<typeof holdoutAllowance>;

// ---------------------------------------------------------------- ledger
type State = { rows: HoldoutUsageRow[]; prior: string };
function apply(state: State, value: unknown) {
  const bad = (): never => { throw Error('HOLDOUT_LEDGER_JOURNAL'); };
  if (!isRecord(value) || Object.keys(value).join() !== KEYS) bad();
  const row = value as HoldoutUsageRow, { rowHash, ...body } = row;
  if (row.ledger !== HOLDOUT_USAGE_LEDGER || row.kind !== 'SEALED_RUN' || row.seq !== state.rows.length || row.previousHash !== state.prior || typeof rowHash !== 'string' ||
    rowHash !== digest(JSON.stringify(body)) || typeof row.id !== 'string' || !UUID.test(row.id) || state.rows.some(r => r.id === row.id) ||
    typeof row.at !== 'string' || Number.isNaN(Date.parse(row.at)) || typeof row.holdoutId !== 'string' || !HOLDOUT_ID.test(row.holdoutId) ||
    typeof row.holdoutSha256 !== 'string' || !HASH.test(row.holdoutSha256) || typeof row.candidate !== 'string' || !CANDIDATE.test(row.candidate) ||
    !int(row.scenarios, 1, 10_000) || !int(row.k, 1, 8) || typeof row.run !== 'string' || !RUN.test(row.run)) bad();
  // Every row must have been admissible when it was written.
  if (!holdoutAllowance(state.rows, row.holdoutId, row.candidate).allowed) bad();
  state.rows.push(row); state.prior = rowHash;
}
const samePath = (a: string, b: string) => process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
function ledgerFile(file: string) {
  if (typeof file !== 'string' || basename(file) !== HOLDOUT_USAGE_BASENAME) throw Error('HOLDOUT_LEDGER_CONFIG');
  // Outside unit tests the user-level ledger is the only one: no path can start a fresh (empty) ledger.
  if (!process.env.VITEST && !samePath(file, holdoutUsageLedgerPath())) throw Error('HOLDOUT_LEDGER_CONFIG');
  return file;
}

// ---------------------------------------------------------------- external anchor (same scheme as the program-spend ledger)
type Anchor = { ledger: string; genesisId: string; genesisHash: string; seq: number; rowHash: string };
function anchorFile(file: string, root: string) {
  if (!samePath(file, holdoutUsageLedgerPath())) return join(dirname(file), `${HOLDOUT_USAGE_LEDGER}.anchor.json`);
  if (!existsSync(join(root, 'packages', 'salon-secretary', 'evaluation', 'holdout-usage.ts'))) throw Error('HOLDOUT_LEDGER_CONFIG');
  return resolve(root, HOLDOUT_USAGE_ANCHOR_FILE);
}
function readAnchor(file: string): Anchor | null {
  if (!existsSync(file)) return null;
  let a: unknown; try { a = JSON.parse(readFileSync(file, 'utf8')); } catch { throw Error('HOLDOUT_LEDGER_JOURNAL'); }
  if (!isRecord(a) || Object.keys(a).join() !== ANCHOR_KEYS || a.ledger !== HOLDOUT_USAGE_LEDGER || typeof a.genesisId !== 'string' || !UUID.test(a.genesisId) ||
    typeof a.genesisHash !== 'string' || !HASH.test(a.genesisHash) || !int(a.seq, 0, Number.MAX_SAFE_INTEGER) || typeof a.rowHash !== 'string' || !HASH.test(a.rowHash)) throw Error('HOLDOUT_LEDGER_JOURNAL');
  return a as Anchor;
}
function checkAnchor(state: State, anchor: Anchor | null) {
  if (!anchor) return;
  const genesis = state.rows[0], pinned = state.rows[anchor.seq];
  if (!genesis || !pinned || genesis.id !== anchor.genesisId || genesis.rowHash !== anchor.genesisHash || pinned.rowHash !== anchor.rowHash) throw Error('HOLDOUT_LEDGER_JOURNAL');
}
/** Ledger and registry must agree: every row is a look at an approved file of a registered test holdout, and every look
 * the registry knows of is still in the ledger. Once the registry lists a look, the anchor is required too. */
function checkRegistry(state: State, registry: HoldoutRegistry, anchor: Anchor | null) {
  const bad = (): never => { throw Error('HOLDOUT_LEDGER_JOURNAL'); };
  for (const row of state.rows) {
    const h = registry.holdouts.find(x => x.id === row.holdoutId);
    if (!h || h.kind !== 'test' || !h.approved.some(a => a.sha256 === row.holdoutSha256)) bad();
  }
  const looks = registry.holdouts.flatMap(h => h.looks.map(look => ({ id: h.id, look })));
  if (looks.length && !anchor) bad();
  for (const { id, look } of looks) {
    const row = state.rows[look.seq];
    if (!row || row.holdoutId !== id || row.candidate !== look.candidate || row.rowHash !== look.rowHash) bad();
  }
}
function advanceAnchor(file: string, root: string, state: State) {
  const last = state.rows.at(-1);
  if (!last) return;
  const target = anchorFile(file, root), current = readAnchor(target);
  if (current && current.seq >= last.seq) return;
  const anchor: Anchor = { ledger: HOLDOUT_USAGE_LEDGER, genesisId: state.rows[0].id, genesisHash: state.rows[0].rowHash, seq: last.seq, rowHash: last.rowHash };
  atomicWrite(target, JSON.stringify(anchor, null, 2) + '\n', 'HOLDOUT_LEDGER_ANCHOR');
}

function replay(file: string, root: string): State {
  const state: State = { rows: [], prior: 'GENESIS' };
  if (existsSync(ledgerFile(file))) {
    const text = readFileSync(file, 'utf8');
    if (text && !text.endsWith('\n')) throw Error('HOLDOUT_LEDGER_JOURNAL');
    for (const line of text ? text.slice(0, -1).split('\n') : []) {
      let value: unknown; try { value = JSON.parse(line); } catch { throw Error('HOLDOUT_LEDGER_JOURNAL'); }
      apply(state, value);
    }
  }
  const anchor = readAnchor(anchorFile(file, root));
  checkAnchor(state, anchor);
  checkRegistry(state, readHoldoutRegistry(root), anchor);
  return state;
}
/** Validates the whole chain, the policy of every row, the anchor and the agreement with the checkout's registry (read-only). */
export const readHoldoutUsage = (file: string = holdoutUsageLedgerPath(), root: string = process.cwd()) => replay(file, root).rows;
/** Read-only allowance of one logical holdout (and candidate) from the ledger. */
export const holdoutUsageAllowance = (holdoutId: string, candidate?: string, file: string = holdoutUsageLedgerPath(), root: string = process.cwd()) =>
  holdoutAllowance(readHoldoutUsage(file, root), holdoutId, candidate);

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
async function withLock<T>(file: string, root: string, work: (state: State) => T): Promise<T> {
  ledgerFile(file);
  // Fail closed: a unit test can never write (nor lock) the real ledger.
  if (process.env.VITEST && samePath(file, holdoutUsageLedgerPath())) throw Error('HOLDOUT_LEDGER_TEST');
  try { mkdirSync(dirname(file), { recursive: true }); } catch { throw Error('HOLDOUT_LEDGER_IO'); }
  const lock = file + '.lock', deadline = Date.now() + LOCK_WAIT_MS;
  let fd: number | undefined;
  for (let delay = 5; fd === undefined; delay = Math.min(delay * 2, 50)) {
    try { fd = openSync(lock, 'wx', 0o600); }
    catch (error) {
      if (!['EEXIST', 'EPERM', 'EACCES', 'EBUSY'].includes(String((error as NodeJS.ErrnoException).code))) throw Error('HOLDOUT_LEDGER_IO');
      if (Date.now() >= deadline) throw Error('HOLDOUT_LEDGER_LOCKED');
      await sleep(delay);
    }
  }
  let outcome: { value: T } | { error: unknown };
  try { outcome = { value: work(replay(file, root)) }; } catch (error) { outcome = { error }; }
  try { closeSync(fd!); unlinkSync(lock); } catch { throw Error('HOLDOUT_LEDGER_LOCKED'); }
  if ('error' in outcome) throw outcome.error instanceof Error && /^HOLDOUT_[A-Z_]{1,40}$/.test(outcome.error.message) ? outcome.error : Error('HOLDOUT_LEDGER_IO');
  return outcome.value;
}
/** Consumes one look under the lock: the file must be an approved file of a registered, active test holdout
 * (HOLDOUT_NOT_REGISTERED); the policy is re-checked per LOGICAL holdout on the current ledger (HOLDOUT_CANDIDATE_USED /
 * HOLDOUT_EXHAUSTED, nothing written); then one fsynced, hash-chained row, the anchor, and the look in the registry. */
export async function recordSealedRun(file: string, entry: SealedRunEntry, root: string = process.cwd()): Promise<HoldoutUsageRow> {
  return withLock(file, root, state => {
    const registry = readHoldoutRegistry(root), holdout = registry.holdouts.find(h => h.id === entry.holdoutId);
    if (!holdout || holdout.kind !== 'test' || holdout.retired || !holdout.approved.some(a => a.sha256 === entry.holdoutSha256)) throw Error('HOLDOUT_NOT_REGISTERED');
    const verdict = holdoutAllowance(state.rows, entry.holdoutId, entry.candidate);
    if (!verdict.allowed) throw Error(verdict.code!);
    const body = { ledger: HOLDOUT_USAGE_LEDGER, kind: 'SEALED_RUN' as const, seq: state.rows.length, id: randomUUID(), at: new Date().toISOString(), holdoutId: entry.holdoutId,
      holdoutSha256: entry.holdoutSha256, candidate: entry.candidate, scenarios: entry.scenarios, k: entry.k, run: entry.run, previousHash: state.prior };
    const row: HoldoutUsageRow = { ...body, rowHash: digest(JSON.stringify(body)) };
    try { apply(state, clone(row)); } catch { throw Error('HOLDOUT_LEDGER_ROW'); } // same validation as a later read
    const fd = openSync(file, 'a', 0o600);
    try { writeSync(fd, JSON.stringify(row) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
    advanceAnchor(file, root, state);
    holdout.looks.push({ seq: row.seq, candidate: row.candidate, rowHash: row.rowHash });
    writeHoldoutRegistry(root, registry);
    return row;
  });
}
