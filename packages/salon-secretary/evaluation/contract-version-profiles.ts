/** C6 (rec 19): the checked-in contract versions. packages/salon-secretary/contract-version.json records, for each flag
 * profile the coordinator validates with batteries, secretaryContractVersion() and the hash of each of its parts. A test
 * fails when the live version differs; the coordinator re-runs Golden pass^k and the practice battery for the changed
 * profiles and then updates the file deliberately (npx tsx scripts/secretary-contract-version.ts --write). Offline only. */
import { secretaryContractDigest, SECRETARY_CONTRACT_ENV, SECRETARY_CONTRACT_SCHEMA } from '../src';
import { backendPresentationDigest } from '../../../src/lib/secretary-presentation-contract';

export const CONTRACT_VERSION_FILE = 'packages/salon-secretary/contract-version.json';
export const CONTRACT_MODEL = 'gpt-6-luna';
const V2 = { SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true' };
/** Every contract variable a profile does not set is unset (off / default output limit). */
export const CONTRACT_PROFILES: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  'v2': V2,
  'v2+components': { ...V2, SALON_SECRETARY_TEMPORAL_COMPONENTS: 'true' },
  'v2+jit': { ...V2, SALON_SECRETARY_JIT_INSTRUCTIONS: 'true' },
  'v2+components+jit': { ...V2, SALON_SECRETARY_TEMPORAL_COMPONENTS: 'true', SALON_SECRETARY_JIT_INSTRUCTIONS: 'true' },
  'v2+components+jit+examples-selected': { ...V2, SALON_SECRETARY_TEMPORAL_COMPONENTS: 'true', SALON_SECRETARY_JIT_INSTRUCTIONS: 'true', SALON_SECRETARY_EXAMPLES: 'selected' },
});
export type ContractProfileEntry = { env: Record<string, string>; version: string; parts: { templates: string; wires: string; runtime: string } };
export type ContractVersionFile = { schema: string; model: string; note: string; profiles: Record<string, ContractProfileEntry> };

/** The digest under exactly `env` for the contract variables (all others of them unset), environment restored after. */
export function contractProfileDigest(env: Readonly<Record<string, string>>, model = CONTRACT_MODEL) {
  const saved = Object.fromEntries(SECRETARY_CONTRACT_ENV.map(name => [name, process.env[name]]));
  try {
    for (const name of SECRETARY_CONTRACT_ENV) delete process.env[name];
    Object.assign(process.env, env);
    return secretaryContractDigest({ modelId: model, presentation: backendPresentationDigest() });
  } finally {
    for (const [name, value] of Object.entries(saved)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
}
export function liveContractVersionFile(): ContractVersionFile {
  return { schema: SECRETARY_CONTRACT_SCHEMA, model: CONTRACT_MODEL,
    note: 'Updated only by the coordinator after the batteries of the changed profiles (Golden pass^k, practice). A mismatch in the contract-version test means the prompt, wire, model, limits or contract flags changed.',
    profiles: Object.fromEntries(Object.entries(CONTRACT_PROFILES).map(([name, env]) => [name, { env: { ...env }, ...contractProfileDigest(env) }])) };
}
/** Profiles whose version differs from the recorded file, with the parts that changed (names only). */
export function contractVersionDrift(recorded: ContractVersionFile, live: ContractVersionFile = liveContractVersionFile()) {
  const names = [...new Set([...Object.keys(recorded.profiles ?? {}), ...Object.keys(live.profiles)])].sort();
  return names.flatMap(name => {
    const before = recorded.profiles?.[name], after = live.profiles[name];
    if (before && after && before.version === after.version && JSON.stringify(before.env) === JSON.stringify(after.env)) return [];
    const parts = before && after ? (Object.keys(after.parts) as (keyof ContractProfileEntry['parts'])[]).filter(part => before.parts?.[part] !== after.parts[part]) : [];
    return [{ profile: name, recorded: before?.version ?? null, live: after?.version ?? null, parts }];
  });
}
