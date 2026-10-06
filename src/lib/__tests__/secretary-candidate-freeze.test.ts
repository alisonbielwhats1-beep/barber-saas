import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CANDIDATES_DIR, CANDIDATE_ROOTS, CANDIDATE_VOLATILE, buildCandidate, candidateFlagMismatch, candidateFlags, candidateManifestPath, candidateSourceFiles, loadCandidate,
  gitRunner, verifyCandidate, writeCandidate, type CandidateContract, type GitRunner,
} from '../../../packages/salon-secretary/evaluation/candidate-freeze';
import { liveCandidateContract } from '../../../packages/salon-secretary/evaluation/candidate-contract';
import { PROGRAM_SPEND_ANCHOR_FILE } from '../../../packages/salon-secretary/evaluation/program-spend';
import { HOLDOUT_REGISTRY_FILE, HOLDOUT_USAGE_ANCHOR_FILE } from '../../../packages/salon-secretary/evaluation/holdout-usage';
import { exampleBank } from '../../../packages/salon-secretary/src/examples/bank';

// Offline only: throwaway git repositories in the OS temp folder (git init + add, never a commit), no network.
const directories: string[] = [];
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const put = (root: string, file: string, text: string) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text); };
function repo() {
  const root = mkdtempSync(join(tmpdir(), 'candidate-freeze-')); directories.push(root);
  git(root, 'init', '-q');
  put(root, '.gitignore', 'packages/salon-secretary/evaluation/results/\n.demo/\n*.log\n');
  put(root, 'src/lib/a.ts', 'export const a = 1;\n');
  put(root, 'packages/salon-secretary/src/examples/bank.json', '[]\n');
  put(root, 'packages/salon-secretary/evaluation/runner.ts', 'export {};\n');
  put(root, 'scripts/run.cjs', "'use strict';\r\n"); // untracked, CRLF bytes as they are
  put(root, 'prisma/schema.prisma', 'model A { id Int @id }\n'); // untracked
  put(root, 'docs/notes.md', 'outside the candidate roots\n');
  put(root, 'src/lib/debug.log', 'ignored\n');
  put(root, 'packages/salon-secretary/evaluation/results/agenda-core/run/report.json', '{}\n'); // ignored results
  for (const file of CANDIDATE_VOLATILE) put(root, file, '{"seq":0}\n'); // ledger anchors: rewritten by the evaluation itself
  git(root, 'add', '.gitignore', 'src/lib/a.ts', 'packages/salon-secretary/src/examples/bank.json', 'packages/salon-secretary/evaluation/runner.ts', 'docs/notes.md');
  return root;
}
const contract = (flags: Record<string, string>): CandidateContract => ({ examplesTag: flags.SALON_SECRETARY_EXAMPLES ? `examples:${flags.SALON_SECRETARY_EXAMPLES}` : null, examplesRenderVersion: 'test-v1', bankSha256: 'c'.repeat(64) });
const FLAGS = { SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true', SALON_SECRETARY_EXAMPLES: 'selected' };
const freeze = (root: string, flags: Record<string, string> = FLAGS) => buildCandidate({ root, model: 'gpt-6-luna', flags, contract: contract({ ...flags }) });
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('candidate freeze manifest', () => {
  it('hashes tracked and untracked non-ignored files under src/, packages/, scripts/ and prisma/ only, sorted, minus the ledger anchors and the holdout registry', () => {
    expect(CANDIDATE_ROOTS).toEqual(['src', 'packages', 'scripts', 'prisma']);
    // The registry records looks and holdouts sealed after the freeze: evaluation state, not candidate behaviour.
    expect(CANDIDATE_VOLATILE).toEqual([PROGRAM_SPEND_ANCHOR_FILE, HOLDOUT_USAGE_ANCHOR_FILE, HOLDOUT_REGISTRY_FILE]);
    const root = repo();
    expect(candidateSourceFiles(root)).toEqual(['packages/salon-secretary/evaluation/runner.ts', 'packages/salon-secretary/src/examples/bank.json', 'prisma/schema.prisma', 'scripts/run.cjs', 'src/lib/a.ts']);
    const m = freeze(root);
    // sha256 of the working-tree bytes as they are (CRLF kept: that is what runs).
    expect(Object.fromEntries(m.files.list)['scripts/run.cjs']).toBe(createHash('sha256').update("'use strict';\r\n").digest('hex'));
    expect(m).toMatchObject({ schema: 'secretary-candidate-v1', git: { head: null }, model: 'gpt-6-luna', exampleBank: { file: 'packages/salon-secretary/src/examples/bank.json' },
      contract: { examplesTag: 'examples:selected' }, files: { count: 5, roots: [...CANDIDATE_ROOTS], excluded: [...CANDIDATE_VOLATILE] } });
    // Flags sorted, the model pinned as a switch too.
    expect(Object.keys(m.flags)).toEqual(['SALON_SECRETARY_EXAMPLES', 'SALON_SECRETARY_MODEL', 'SALON_SECRETARY_MULTI_ACTION_V2_ENABLED']);
    expect(m.versionId).toMatch(/^[0-9a-f]{16}$/);
  });
  it('is deterministic: the same tree and inputs give the same id and the same bytes; any input change gives another id', () => {
    const root = repo(), a = freeze(root), b = freeze(root);
    expect(b.versionId).toBe(a.versionId);
    const first = writeCandidate(root, a), text = readFileSync(first.file, 'utf8');
    expect(first).toEqual({ file: candidateManifestPath(root, a.versionId), created: true });
    expect(first.file).toBe(join(root, CANDIDATES_DIR, `${a.versionId}.json`));
    expect(writeCandidate(root, b)).toEqual({ file: first.file, created: false });
    expect(readFileSync(first.file, 'utf8')).toBe(text);
    expect(loadCandidate(root, a.versionId)).toEqual(a);
    // Flag order in the input does not matter; flag values, model and contract do.
    expect(freeze(root, { SALON_SECRETARY_EXAMPLES: 'selected', SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true' }).versionId).toBe(a.versionId);
    expect(freeze(root, { ...FLAGS, SALON_SECRETARY_EXAMPLES: 'full' }).versionId).not.toBe(a.versionId);
    expect(buildCandidate({ root, model: 'gpt-6-luna', flags: FLAGS, contract: null }).versionId).not.toBe(a.versionId);
    // An ignored file, a file outside the roots and a ledger anchor never change the candidate.
    put(root, 'src/lib/trace.log', 'x'); put(root, 'docs/notes.md', 'edited'); put(root, 'packages/salon-secretary/evaluation/results/agenda-core/run/k1/H01.json', '{}');
    for (const file of CANDIDATE_VOLATILE) put(root, file, '{"seq":9}\n');
    expect(freeze(root).versionId).toBe(a.versionId);
  });
  it('detects drift: a changed, added or removed source file, and a new git HEAD', () => {
    const root = repo(), m = freeze(root); writeCandidate(root, m);
    const check = () => verifyCandidate({ root, versionId: m.versionId, contract });
    expect(check().versionId).toBe(m.versionId);
    const drift = () => { try { check(); } catch (e) { return { code: (e as Error).message, details: (e as { details?: Record<string, unknown> }).details }; } return null; };
    put(root, 'src/lib/a.ts', 'export const a = 2;\n');
    expect(drift()).toMatchObject({ code: 'CANDIDATE_DRIFT', details: { head: false, changed: { count: 1, paths: ['src/lib/a.ts'] }, added: { count: 0 }, removed: { count: 0 } } });
    put(root, 'src/lib/a.ts', 'export const a = 1;\n');
    expect(check().versionId).toBe(m.versionId); // back to the frozen bytes
    put(root, 'packages/salon-secretary/src/new-skill.ts', 'export {};\n'); // untracked, not ignored
    expect(drift()).toMatchObject({ code: 'CANDIDATE_DRIFT', details: { added: { count: 1, paths: ['packages/salon-secretary/src/new-skill.ts'] } } });
    unlinkSync(join(root, 'packages/salon-secretary/src/new-skill.ts')); unlinkSync(join(root, 'prisma/schema.prisma'));
    expect(drift()).toMatchObject({ code: 'CANDIDATE_DRIFT', details: { removed: { count: 1, paths: ['prisma/schema.prisma'] } } });
    put(root, 'prisma/schema.prisma', 'model A { id Int @id }\n');
    put(root, 'packages/salon-secretary/src/examples/bank.json', '[{}]\n');
    expect(drift()).toMatchObject({ code: 'CANDIDATE_DRIFT', details: { exampleBank: true, changed: { paths: ['packages/salon-secretary/src/examples/bank.json'] } } });
    put(root, 'packages/salon-secretary/src/examples/bank.json', '[]\n');
    expect(check().versionId).toBe(m.versionId);
    // A contract the live package derives differently from the same flags is drift too.
    expect(() => verifyCandidate({ root, versionId: m.versionId, contract: flags => ({ ...contract(flags), examplesRenderVersion: 'test-v2' }) })).toThrow('CANDIDATE_DRIFT');
    // Same bytes on disk but another HEAD (simulated: the test never commits): the frozen HEAD no longer matches.
    const moved: GitRunner = (cwd, args) => args[0] === 'rev-parse' ? 'd'.repeat(40) + '\n' : gitRunner(cwd, args);
    let headDrift: unknown; try { verifyCandidate({ root, versionId: m.versionId, contract, git: moved }); } catch (e) { headDrift = (e as { details?: unknown }).details; }
    expect(headDrift).toMatchObject({ head: true, changed: { count: 0 }, added: { count: 0 }, removed: { count: 0 } });
    expect(check().versionId).toBe(m.versionId);
  });
  it('refuses a hand-edited, unknown or path-like manifest id', () => {
    const root = repo(), m = freeze(root), { file } = writeCandidate(root, m);
    expect(() => loadCandidate(root, 'ffffffffffffffff')).toThrow('CANDIDATE_UNKNOWN');
    for (const id of ['../../x', 'ABCDEF0123456789', '123', '']) expect(() => loadCandidate(root, id)).toThrow('CANDIDATE_ARGUMENT');
    const edited = JSON.parse(readFileSync(file, 'utf8')); edited.flags.SALON_SECRETARY_EXAMPLES = 'full';
    writeFileSync(file, JSON.stringify(edited, null, 2) + '\n');
    expect(() => loadCandidate(root, m.versionId)).toThrow('CANDIDATE_MANIFEST');
    expect(() => writeCandidate(root, m)).toThrow('CANDIDATE_MANIFEST'); // write-once: a different file under the same id is never overwritten
    expect(() => candidateSourceFiles(mkdtempSync(join(tmpdir(), 'not-a-repo-')))).toThrow('CANDIDATE_GIT');
  });
  it('accepts only SALON_SECRETARY_* switches with code-like values: no credentials, no runtime-only switch', () => {
    expect(candidateFlags({ SALON_SECRETARY_B: '', SALON_SECRETARY_A: 'x.y:z,1-2' })).toEqual({ SALON_SECRETARY_A: 'x.y:z,1-2', SALON_SECRETARY_B: '' });
    for (const bad of [{ SALON_SECRETARY_OPENAI_API_KEY: 'x' }, { SALON_SECRETARY_OPENAI_PROJECT: 'x' }, { SALON_SECRETARY_WEBHOOK_SECRET: 'x' }, { SALON_SECRETARY_ACCESS_TOKEN: 'x' },
      { SALON_SECRETARY_ALLOW_PAID_CALLS: 'true' }, { OPENAI_API_KEY: 'x' }, { SALON_SECRETARY_EXAMPLES: 'two words' }, { salon_secretary_examples: 'full' }] as Record<string, string>[])
      expect(() => candidateFlags(bad)).toThrow('CANDIDATE_FLAG');
    const root = repo();
    expect(() => buildCandidate({ root, model: 'gpt-6-luna', flags: { SALON_SECRETARY_MODEL: 'other-model' }, contract: null })).toThrow('CANDIDATE_MODEL');
    expect(() => buildCandidate({ root, model: 'bad model', flags: {}, contract: null })).toThrow('CANDIDATE_MODEL');
  });
  it('compares the effective switches exactly, ignoring credentials and the runtime paid-call switch', () => {
    const manifest = { flags: { SALON_SECRETARY_EXAMPLES: 'selected', SALON_SECRETARY_MODEL: 'gpt-6-luna' } };
    const env = { SALON_SECRETARY_EXAMPLES: 'selected', SALON_SECRETARY_MODEL: 'gpt-6-luna', SALON_SECRETARY_ALLOW_PAID_CALLS: 'false', SALON_SECRETARY_OPENAI_API_KEY: 'synthetic', PATH: 'x' };
    expect(candidateFlagMismatch(manifest, env)).toEqual([]);
    expect(candidateFlagMismatch(manifest, { ...env, SALON_SECRETARY_EXAMPLES: 'full', SALON_SECRETARY_TEMPORAL_COMPONENTS: 'true' })).toEqual(['SALON_SECRETARY_EXAMPLES', 'SALON_SECRETARY_TEMPORAL_COMPONENTS']);
    expect(candidateFlagMismatch(manifest, { SALON_SECRETARY_MODEL: 'gpt-6-luna' })).toEqual(['SALON_SECRETARY_EXAMPLES']);
  });
  it('reads the live contract from the package: examples tag of the flags and the bank hash it carries', () => {
    const live = liveCandidateContract({ SALON_SECRETARY_EXAMPLES: 'selected', SALON_SECRETARY_EXAMPLES_K: '4' });
    expect(live.bankSha256).toBe(exampleBank().sha256);
    expect(live.examplesTag).toBe(`examples:selected:k4:${exampleBank().sha256.slice(0, 16)}`);
    expect(liveCandidateContract({}).examplesTag).toBeNull();
  });
});
