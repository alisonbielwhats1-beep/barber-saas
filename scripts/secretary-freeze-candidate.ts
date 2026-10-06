/** CLI: freezes the current working tree as a Secretary candidate (evaluation only; no .env, database or network).
 *   node scripts/secretary-freeze-candidate.cjs --model gpt-6-luna --flag SALON_SECRETARY_EXAMPLES=selected [--flag NAME=value ...]
 *     writes .demo/agenda-core/candidates/<versionId>.json (content-addressed, write-once) and prints the version id.
 *   node scripts/secretary-freeze-candidate.cjs --check <versionId>
 *     recomputes the manifest from the working tree and prints CANDIDATE_MATCHES or CANDIDATE_DRIFT (paths only).
 * --flag lists EVERY SALON_SECRETARY_* switch the sealed run will see (the sealed runner compares the effective set exactly,
 * SALON_SECRETARY_ALLOW_PAID_CALLS excepted), including the ones scripts/run-agenda-practice.cjs forces:
 * SALON_SECRETARY_JEV_ROUTER_ENABLED=false, SALON_SECRETARY_MULTI_ACTION_V2_ENABLED=true and
 * SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED (default true). --model is also pinned as SALON_SECRETARY_MODEL.
 * Credential-like names (KEY, SECRET, TOKEN, PROJECT...) are refused: they never enter a manifest. */
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildCandidate, verifyCandidate, writeCandidate } from '../packages/salon-secretary/evaluation/candidate-freeze';
import { liveCandidateContract } from '../packages/salon-secretary/evaluation/candidate-contract';
function main() {
  const args = process.argv.slice(2), flags: Record<string, string> = {}; let model: string | undefined, check: string | undefined;
  while (args.length) {
    const key = args.shift()!, value = args.shift();
    if (value === undefined) throw Error('CANDIDATE_ARGUMENT');
    if (key === '--flag') {
      const at = value.indexOf('='), name = value.slice(0, at);
      if (at < 1 || name in flags) throw Error('CANDIDATE_ARGUMENT');
      flags[name] = value.slice(at + 1);
    } else if (key === '--model' && model === undefined) model = value;
    else if (key === '--check' && check === undefined) check = value;
    else throw Error('CANDIDATE_ARGUMENT');
  }
  const root = process.cwd();
  if (!existsSync(join(root, 'packages', 'salon-secretary', 'evaluation', 'candidate-freeze.ts'))) throw Error('CANDIDATE_ROOT'); // run from the checkout root
  if (check !== undefined) {
    if (model !== undefined || Object.keys(flags).length) throw Error('CANDIDATE_ARGUMENT');
    const m = verifyCandidate({ root, versionId: check, contract: liveCandidateContract });
    console.log(JSON.stringify({ status: 'CANDIDATE_MATCHES', versionId: m.versionId, head: m.git.head, files: m.files.count, model: m.model, flags: m.flags, contract: m.contract }, null, 2));
    return;
  }
  if (model === undefined) throw Error('CANDIDATE_MODEL');
  const manifest = buildCandidate({ root, model, flags, contract: liveCandidateContract({ ...flags, SALON_SECRETARY_MODEL: model }) });
  const written = writeCandidate(root, manifest);
  console.log(JSON.stringify({ status: written.created ? 'CANDIDATE_FROZEN' : 'CANDIDATE_UNCHANGED', versionId: manifest.versionId, file: relative(root, written.file).replaceAll('\\', '/'),
    head: manifest.git.head, files: manifest.files.count, model: manifest.model, flags: manifest.flags, exampleBank: manifest.exampleBank.sha256, contract: manifest.contract }, null, 2));
}
try { main(); }
catch (error) {
  const details = error && typeof error === 'object' && 'details' in error ? (error as { details: unknown }).details : undefined;
  console.error(JSON.stringify({ status: 'BLOCKED', code: error instanceof Error ? error.message.slice(0, 120) : 'ERROR', ...(details ? { details } : {}) }));
  process.exitCode = 1;
}
