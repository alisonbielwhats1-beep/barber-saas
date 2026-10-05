/** CLI (coordinator, after a Golden run): records the quality certificate of a model for the exact contract the run measured.
 *   npx tsx scripts/secretary-certify-model.ts <run directory under packages/salon-secretary/evaluation/results/free-use> [--reserve]
 * --reserve (owner decision 05/10/2026): a plan B reserve certificate under MODEL_RESERVE_POLICY (no safety failure, >= 98% right,
 * everything executed); it never admits the model as the main one.
 * Refuses a run below MODEL_CERTIFICATION_POLICY (the Golden suite, repeated >= 3 times, every case passing in every attempt,
 * no safety failure, nothing blocked or unexecuted) and a run whose recorded contract the code in this checkout no longer
 * produces. Offline: reads the run's manifest, results and turns (numbers only); writes packages/salon-secretary/model-certificates.json. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODEL_CERTIFICATES_FILE, MODEL_CERTIFICATION_POLICY, SECRETARY_CONTRACT_ENV, certificateMeetsPolicy, parseModelCertificates, secretaryModelProfile,
  type ModelCertificate } from '../packages/salon-secretary/src';
import { contractProfileDigest } from '../packages/salon-secretary/evaluation/contract-version-profiles';

const name = process.argv[2] ?? '', reserve = process.argv[3] === '--reserve';
if (process.argv.length !== (reserve ? 4 : 3) || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}$/.test(name)) throw Error('CERTIFY_ARGUMENT');
const dir = join(process.cwd(), 'packages/salon-secretary/evaluation/results/free-use', name);
const manifestBytes = readFileSync(join(dir, 'manifest.json')), manifest = JSON.parse(manifestBytes.toString('utf8'));
const results = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
const binding = createHash('sha256').update(manifestBytes).digest('hex');
const refuse = (code: string): never => { console.error(JSON.stringify({ status: 'REFUSED', code })); process.exit(1); };
if (results.binding !== binding) refuse('CERTIFY_BINDING');
const model = String(results.model ?? '');
try { secretaryModelProfile(model); } catch { refuse('CERTIFY_MODEL_UNKNOWN'); }
const summary = results.summary ?? {}, cases = Array.isArray(manifest.suite?.cases) ? manifest.suite.cases.length : 0;
if (manifest.suite?.suiteId !== MODEL_CERTIFICATION_POLICY.suite) refuse('CERTIFY_SUITE');
// A reserve may miss a case (its policy counts them); nothing may be stopped, blocked or left unexecuted.
if (results.stopped || (!reserve && summary.fail) || summary.blocked || summary.notExecuted || results.passKComplete !== true && results.passK?.complete !== true) refuse('CERTIFY_INCOMPLETE');
// The contract variables of the run (its prepared flag snapshot), all others unset: the code of this checkout must still produce
// the version the run recorded, or the certificate would vouch for a contract nobody measured.
const contractEnv: Record<string, string> = Object.fromEntries(Object.entries(manifest.flags ?? {})
  .filter(([flag, value]) => (SECRETARY_CONTRACT_ENV as readonly string[]).includes(flag) && flag !== 'SALON_SECRETARY_MODEL' && typeof value === 'string')
  .sort(([a], [b]) => a < b ? -1 : 1)) as Record<string, string>;
if (contractProfileDigest(contractEnv, model).version !== results.contractVersion) refuse('CERTIFY_CONTRACT_DRIFT');
const latencies = readdirSync(dir).filter(entry => /^k\d+$/.test(entry)).flatMap(k => existsSync(join(dir, k, 'turns.jsonl'))
  ? readFileSync(join(dir, k, 'turns.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line).latencyMs).filter(Number.isFinite) : []).sort((a, b) => a - b);
const quantile = (p: number) => latencies.length ? Math.round(latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))]) : null;
const certificate: ModelCertificate = { model, contractVersion: results.contractVersion, contractEnv, certifiedAt: new Date().toISOString(),
  evidence: { suite: manifest.suite.suiteId, run: name, binding, repeat: results.repeat, cases, passed: summary.pass, total: summary.total,
    safetyFailures: summary.metrics?.safetyFailures ?? 1, p50Ms: quantile(0.5), p90Ms: quantile(0.9) }, ...(reserve ? { role: 'reserve' as const } : {}) };
if (!certificateMeetsPolicy(certificate)) refuse('CERTIFY_POLICY');
const file = join(process.cwd(), MODEL_CERTIFICATES_FILE), current = parseModelCertificates(JSON.parse(readFileSync(file, 'utf8')));
const certificates = [...current.certificates.filter(c => !(c.model === model && c.contractVersion === certificate.contractVersion && (c.role ?? 'main') === (certificate.role ?? 'main'))), certificate]
  .sort((a, b) => a.model < b.model ? -1 : a.model > b.model ? 1 : a.certifiedAt < b.certifiedAt ? -1 : 1);
const next = parseModelCertificates({ schema: current.schema, note: current.note, certificates });
writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
console.log(JSON.stringify({ written: MODEL_CERTIFICATES_FILE, model, contractVersion: certificate.contractVersion, evidence: certificate.evidence }));
