/** Candidate freeze manifest (28/09/2026): the immutable snapshot a sealed holdout run is tied to (Sierra ADLC: code,
 * prompts, model and knowledge of one release). `.demo/agenda-core/candidates/<versionId>.json` holds the sha256 of every
 * tracked and untracked non-ignored file under src/, packages/, scripts/ and prisma/ (sorted; volatile evaluation state
 * excluded), the SALON_SECRETARY_* flag set intended for the candidate, the model id, the example bank hash, the contract
 * tag and the git HEAD. versionId = first 16 hex of sha256(content): same tree + same inputs = same id, byte for byte.
 * The sealed runner recomputes the manifest from the working tree before running and refuses on any difference
 * (CANDIDATE_DRIFT). Offline: local git plumbing and file reads only. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { secretaryFlagSnapshot } from './agenda-practice-lib';
import { HOLDOUT_REGISTRY_FILE, HOLDOUT_USAGE_ANCHOR_FILE } from './holdout-usage';

export const CANDIDATE_SCHEMA = 'secretary-candidate-v1';
export const CANDIDATE_ROOTS = ['src', 'packages', 'scripts', 'prisma'] as const;
/** Files the evaluation itself rewrites (ledger anchors, the holdout registry that records looks and approved files):
 * hashing them would make every paid or sealed run, or a holdout sealed after the freeze, a drift. */
export const CANDIDATE_VOLATILE: readonly string[] = Object.freeze(['packages/salon-secretary/evaluation/program-spend-anchor.json', HOLDOUT_USAGE_ANCHOR_FILE, HOLDOUT_REGISTRY_FILE]);
export const CANDIDATES_DIR = '.demo/agenda-core/candidates';
export const EXAMPLE_BANK_FILE = 'packages/salon-secretary/src/examples/bank.json';
/** Runtime switches, not candidate behaviour: the runner turns paid calls on and off around each request. */
export const RUNTIME_ONLY_FLAGS: readonly string[] = Object.freeze(['SALON_SECRETARY_ALLOW_PAID_CALLS']);
const PREFIX = 'SALON_SECRETARY_';
const FLAG_NAME = /^SALON_SECRETARY_[A-Z0-9_]{1,64}$/, FLAG_VALUE = /^[A-Za-z0-9._:,-]{0,64}$/, FLAG_DENY = /KEY|SECRET|TOKEN|PASSWORD|PROJECT|ORG|URL|CREDENTIAL|ACCOUNT/i;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/, VERSION = /^[0-9a-f]{16}$/;
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export type CandidateContract = { examplesTag: string | null; examplesRenderVersion: string; bankSha256: string };
export type CandidateContent = { schema: string; git: { head: string | null }; model: string; flags: Record<string, string>;
  exampleBank: { file: string; sha256: string | null }; contract: CandidateContract | null;
  files: { roots: string[]; excluded: string[]; count: number; sha256: string; list: [string, string][] } };
export type CandidateManifest = { versionId: string } & CandidateContent;
export type GitRunner = (root: string, args: string[]) => string;
export const gitRunner: GitRunner = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

/** Validated, sorted SALON_SECRETARY_* switches (same filters as the run reports' flag snapshot; no credential ever). */
export function candidateFlags(input: Record<string, string>) {
  for (const [name, value] of Object.entries(input))
    if (!FLAG_NAME.test(name) || FLAG_DENY.test(name.slice(PREFIX.length)) || RUNTIME_ONLY_FLAGS.includes(name) || typeof value !== 'string' || !FLAG_VALUE.test(value)) throw Error('CANDIDATE_FLAG');
  return Object.fromEntries(Object.keys(input).sort().map(name => [name, input[name]]));
}
/** Tracked + untracked non-ignored regular files under the candidate roots, minus volatile state; code-unit sorted. */
export function candidateSourceFiles(root: string, git: GitRunner = gitRunner) {
  let out: string; try { out = git(root, ['ls-files', '-z', '-c', '-o', '--exclude-standard', '--', ...CANDIDATE_ROOTS]); } catch { throw Error('CANDIDATE_GIT'); }
  const listed = [...new Set(out.split('\0').filter(Boolean).map(file => file.replaceAll('\\', '/')))];
  return listed.filter(file => !CANDIDATE_VOLATILE.includes(file)).filter(file => { try { return lstatSync(join(root, file)).isFile(); } catch { return false; } }).sort();
}
function gitHead(root: string, git: GitRunner) {
  try { const head = git(root, ['rev-parse', '--verify', '-q', 'HEAD']).trim(); return /^[0-9a-f]{40,64}$/.test(head) ? head : null; } catch { return null; } // unborn branch: null
}
export type CandidateInput = { root: string; model: string; flags: Record<string, string>; contract: CandidateContract | null; git?: GitRunner };
/** Builds (does not write) the manifest of the current working tree. The model is also pinned as SALON_SECRETARY_MODEL. */
export function buildCandidate(input: CandidateInput): CandidateManifest {
  const { root, model, contract, git = gitRunner } = input;
  if (typeof model !== 'string' || !MODEL.test(model)) throw Error('CANDIDATE_MODEL');
  if (input.flags.SALON_SECRETARY_MODEL !== undefined && input.flags.SALON_SECRETARY_MODEL !== model) throw Error('CANDIDATE_MODEL');
  const flags = candidateFlags({ ...input.flags, SALON_SECRETARY_MODEL: model });
  const list = candidateSourceFiles(root, git).map(file => [file, sha256(readFileSync(join(root, file)))] as [string, string]);
  const bank = join(root, EXAMPLE_BANK_FILE);
  const content: CandidateContent = { schema: CANDIDATE_SCHEMA, git: { head: gitHead(root, git) }, model, flags,
    exampleBank: { file: EXAMPLE_BANK_FILE, sha256: existsSync(bank) ? sha256(readFileSync(bank)) : null },
    contract: contract ? { examplesTag: contract.examplesTag, examplesRenderVersion: contract.examplesRenderVersion, bankSha256: contract.bankSha256 } : null,
    files: { roots: [...CANDIDATE_ROOTS], excluded: [...CANDIDATE_VOLATILE], count: list.length, sha256: sha256(JSON.stringify(list)), list } };
  return { versionId: candidateVersionId(content), ...content };
}
export const candidateVersionId = (content: CandidateContent) => sha256(JSON.stringify(content)).slice(0, 16);
const contentOf = (m: CandidateManifest): CandidateContent => ({ schema: m.schema, git: m.git, model: m.model, flags: m.flags, exampleBank: m.exampleBank, contract: m.contract, files: m.files });
export const candidateManifestPath = (root: string, versionId: string) => {
  if (typeof versionId !== 'string' || !VERSION.test(versionId)) throw Error('CANDIDATE_ARGUMENT');
  return join(root, CANDIDATES_DIR, `${versionId}.json`);
};
const serialize = (m: CandidateManifest) => JSON.stringify({ versionId: m.versionId, ...contentOf(m) }, null, 2) + '\n';
/** Content-addressed and write-once: an identical existing manifest is kept, a different one under the same id refused. */
export function writeCandidate(root: string, manifest: CandidateManifest) {
  const file = candidateManifestPath(root, manifest.versionId), text = serialize(manifest);
  if (manifest.versionId !== candidateVersionId(contentOf(manifest))) throw Error('CANDIDATE_MANIFEST');
  if (existsSync(file)) { if (readFileSync(file, 'utf8') !== text) throw Error('CANDIDATE_MANIFEST'); return { file, created: false }; }
  mkdirSync(join(root, CANDIDATES_DIR), { recursive: true });
  writeFileSync(file, text, { flag: 'wx' });
  return { file, created: true };
}
/** Reads a manifest and checks its self-hash (a hand-edited manifest is refused). */
export function loadCandidate(root: string, versionId: string): CandidateManifest {
  const file = candidateManifestPath(root, versionId);
  if (!existsSync(file)) throw Error('CANDIDATE_UNKNOWN');
  let m: CandidateManifest; try { m = JSON.parse(readFileSync(file, 'utf8')); } catch { throw Error('CANDIDATE_MANIFEST'); }
  const keys = 'versionId,schema,git,model,flags,exampleBank,contract,files';
  if (!m || typeof m !== 'object' || Object.keys(m).join() !== keys || m.schema !== CANDIDATE_SCHEMA || m.versionId !== versionId || candidateVersionId(contentOf(m)) !== versionId ||
    !Array.isArray(m.files?.list) || typeof m.flags !== 'object' || m.flags === null) throw Error('CANDIDATE_MANIFEST');
  return m;
}
/** What differs between two manifests (paths and part names only). */
export function candidateDrift(frozen: CandidateManifest, current: CandidateManifest) {
  const before = new Map(frozen.files.list), after = new Map(current.files.list), cap = (xs: string[]) => ({ count: xs.length, paths: xs.slice(0, 20) });
  return { head: frozen.git.head !== current.git.head, exampleBank: frozen.exampleBank.sha256 !== current.exampleBank.sha256,
    contract: JSON.stringify(frozen.contract) !== JSON.stringify(current.contract), policy: JSON.stringify([frozen.files.roots, frozen.files.excluded]) !== JSON.stringify([current.files.roots, current.files.excluded]),
    added: cap([...after.keys()].filter(f => !before.has(f))), removed: cap([...before.keys()].filter(f => !after.has(f))),
    changed: cap([...after.keys()].filter(f => before.has(f) && before.get(f) !== after.get(f))) };
}
export type CandidateCheck = { root: string; versionId: string; contract: (flags: Record<string, string>) => CandidateContract | null; git?: GitRunner };
/** The working tree still is the frozen candidate; else CANDIDATE_DRIFT (details: part names and file paths only). */
export function verifyCandidate({ root, versionId, contract, git }: CandidateCheck): CandidateManifest {
  const frozen = loadCandidate(root, versionId);
  let current: CandidateManifest;
  try { current = buildCandidate({ root, model: frozen.model, flags: frozen.flags, contract: contract(frozen.flags), git }); }
  catch (e) { throw Object.assign(Error('CANDIDATE_DRIFT'), { details: { rebuild: e instanceof Error && /^[A-Z][A-Z0-9_]{2,63}$/.test(e.message) ? e.message : 'ERROR' } }); }
  if (current.versionId !== frozen.versionId) throw Object.assign(Error('CANDIDATE_DRIFT'), { details: candidateDrift(frozen, current) });
  return frozen;
}
/** Names of the SALON_SECRETARY_* switches whose effective value differs from the candidate. Compared on the same
 * snapshot the run reports record (credentials and free-text values never enter it; runtime-only switches ignored). */
export function candidateFlagMismatch(manifest: Pick<CandidateManifest, 'flags'>, env: Record<string, string | undefined>) {
  const live: Record<string, string> = { ...secretaryFlagSnapshot(env) };
  for (const name of RUNTIME_ONLY_FLAGS) delete live[name];
  return [...new Set([...Object.keys(live), ...Object.keys(manifest.flags)])].filter(name => live[name] !== manifest.flags[name]).sort();
}
