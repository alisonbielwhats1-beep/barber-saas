/** CLI of the holdout registry (packages/salon-secretary/evaluation/holdout-registry.json; see holdout-usage.ts):
 *   node scripts/secretary-holdout-registry.cjs --list
 *   node scripts/secretary-holdout-registry.cjs --register <file outside the repo> --id <logical id> --kind test|validation [--source-name <name> --source-sha256 <sha256>]
 *   node scripts/secretary-holdout-registry.cjs --retire <logical id>
 * --register (coordinator only: the file is a sealed holdout or the validation set) computes the sha256, validates the
 * scenarios and records the approved file and its sorted scenario ids under the LOGICAL id. A new file of an existing id
 * (re-derived, re-formatted, an oracle fixed) shares its look budget; a derived owner holdout names the owner's .txt as
 * its source. --retire turns a holdout into regression (normal runs may use it; sealed and validation runs refuse it).
 * Offline: no database, no network; writes only the registry. Prints codes and counts only, never a scenario text. */
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { validateScenarios } from '../packages/salon-secretary/evaluation/agenda-practice-lib';
import { isInside, sealedErrorCode, sealedRepoRoots } from '../packages/salon-secretary/evaluation/agenda-sealed';
import { readHoldoutRegistry, registerApproval, retireHoldout, writeHoldoutRegistry, type HoldoutKind } from '../packages/salon-secretary/evaluation/holdout-usage';

const VALUE_FLAGS = ['--register', '--id', '--kind', '--source-name', '--source-sha256', '--retire'], BOOLEAN_FLAGS = ['--list'];
function main() {
  const args = process.argv.slice(2), values: Record<string, string> = {};
  while (args.length) {
    const key = args.shift()!;
    if (BOOLEAN_FLAGS.includes(key)) { values[key] = 'true'; continue; }
    if (!VALUE_FLAGS.includes(key) || !args.length || key in values) throw Error('REGISTRY_ARGUMENT');
    values[key] = args.shift()!;
  }
  const root = process.cwd(), registry = readHoldoutRegistry(root), modes = ['--list', '--register', '--retire'].filter(flag => values[flag] !== undefined);
  if (modes.length !== 1) throw Error('REGISTRY_ARGUMENT');
  if (values['--list']) {
    console.log(JSON.stringify({ holdouts: registry.holdouts.map(h => ({ id: h.id, kind: h.kind, retired: h.retired, source: h.source.sha256.slice(0, 8),
      approved: h.approved.map(a => ({ sha8: a.sha256.slice(0, 8), scenarios: a.ids?.length ?? null })), looks: h.looks.length })) }, null, 2));
    return;
  }
  if (values['--retire']) { writeHoldoutRegistry(root, retireHoldout(registry, values['--retire'])); console.log(JSON.stringify({ status: 'RETIRED', id: values['--retire'] })); return; }
  const kind = values['--kind'] as HoldoutKind;
  if (!values['--id'] || (kind !== 'test' && kind !== 'validation') || (values['--source-name'] === undefined) !== (values['--source-sha256'] === undefined)) throw Error('REGISTRY_ARGUMENT');
  const file = resolve(values['--register']); let real: string;
  try { real = realpathSync(file); if (!statSync(real).isFile()) throw Error(); } catch { throw Error('HOLDOUT_FILE'); }
  if (sealedRepoRoots(root).some(r => isInside(file, r) || isInside(real, r))) throw Error('HOLDOUT_INSIDE_REPO');
  const bytes = readFileSync(real), sha = createHash('sha256').update(bytes).digest('hex');
  let parsed: unknown; try { parsed = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); } catch { throw Error('HOLDOUT_PARSE'); }
  const scenarios = validateScenarios(parsed); // AGENDA_SCENARIO_INVALID:<id>:<code> only
  const source = values['--source-sha256'] ? { name: values['--source-name'], sha256: values['--source-sha256'].toLowerCase() } : { name: basename(real), sha256: sha };
  writeHoldoutRegistry(root, registerApproval(registry, { id: values['--id'], kind, sha256: sha, ids: scenarios.map(s => s.id), source }));
  console.log(JSON.stringify({ status: 'REGISTERED', id: values['--id'], kind, sha8: sha.slice(0, 8), scenarios: scenarios.length }));
}
try { main(); } catch (error) { console.error(JSON.stringify({ status: 'BLOCKED', code: sealedErrorCode(error) })); process.exitCode = 1; }
