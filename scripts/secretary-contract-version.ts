/** CLI of the checked-in model contract versions (packages/salon-secretary/contract-version.json; see
 * packages/salon-secretary/evaluation/contract-version-profiles.ts):
 *   npx tsx scripts/secretary-contract-version.ts           prints the live versions and the drift against the file
 *   npx tsx scripts/secretary-contract-version.ts --check   exits 1 when any profile drifted
 *   npx tsx scripts/secretary-contract-version.ts --write   (coordinator, after the batteries) records the live versions
 * Offline: no database, no network, no environment file; writes only the contract-version file. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTRACT_VERSION_FILE, contractVersionDrift, liveContractVersionFile, type ContractVersionFile } from '../packages/salon-secretary/evaluation/contract-version-profiles';

const args = process.argv.slice(2);
if (args.some(arg => !['--check', '--write'].includes(arg)) || args.length > 1) throw Error('CONTRACT_VERSION_ARGUMENT');
const file = join(process.cwd(), CONTRACT_VERSION_FILE), live = liveContractVersionFile();
const recorded: ContractVersionFile = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { schema: live.schema, model: live.model, note: '', profiles: {} };
const drift = contractVersionDrift(recorded, live);
if (args[0] === '--write') { writeFileSync(file, JSON.stringify(live, null, 2) + '\n'); console.log(JSON.stringify({ written: CONTRACT_VERSION_FILE, updated: drift.map(d => d.profile) })); }
else {
  console.log(JSON.stringify({ file: CONTRACT_VERSION_FILE, profiles: Object.fromEntries(Object.entries(live.profiles).map(([name, entry]) => [name, entry.version])), drift }, null, 2));
  if (args[0] === '--check' && drift.length) process.exitCode = 1;
}
