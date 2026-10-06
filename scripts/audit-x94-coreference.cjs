// Read-only investigation. No runner, model factory, draft preparation or mutation is invoked.
const os = require('node:os');
try { os.userInfo(); } catch { os.userInfo = () => ({ username: 'offline-evaluation' }); }
require('@next/env').loadEnvConfig(process.cwd(), true);
require('tsx/cjs');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const db = require('../packages/salon-secretary/evaluation/hard-conversations-phase-a-db.ts');
const { t21Cases, t21Fixture } = require('../packages/salon-secretary/evaluation/t21-cases.ts');
const { protectExisting } = require('../packages/salon-secretary/evaluation/topic14-final-target.ts');
const { withTenant } = require('../src/lib/prisma-tenant.ts');
const { searchSalonCustomer } = require('../src/lib/customer-catalog.ts');
const { groundSchedulingException } = require('../src/lib/scheduling-conflict-contract.ts');
const { persistBenchmark } = require('../packages/salon-secretary/evaluation/multi-action-benchmark-harness.ts');
const flags = ['SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED', 'SALON_SECRETARY_MULTI_ACTION_V2_ENABLED',
  'SALON_SECRETARY_ALLOW_PAID_CALLS', 'SALON_SECRETARY_JEV_ROUTER_ENABLED'];
const hash = path => createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const previousPath = 'packages/salon-secretary/evaluation/results/topic14-final/final-independent-snapshot.json';
const resultPath = 'packages/salon-secretary/evaluation/results/topic14-final/real-result-1790311762668.json';
const output = 'packages/salon-secretary/evaluation/results/x94-coreference-audit/audit.json';
const read = path => JSON.parse(fs.readFileSync(path, 'utf8'));
global.fetch = async () => { throw Error('AUDIT_NETWORK_FORBIDDEN'); };
async function main() {
  if (flags.some(key => process.env[key] === 'true')) throw Error('AUDIT_FLAGS_NOT_OFF');
  db.assertPhaseAEnvironment();
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
  const runtime = require('../src/lib/prisma.ts').prisma;
  const previous = read(previousPath), fixture = t21Fixture(t21Cases.find(c => c.id === 'x94'));
  const unchanged = ['.env.local', resultPath, previousPath, 'src/lib/scheduling-conflict-contract.ts',
    'packages/salon-secretary/evaluation/t21-cases.ts', 'packages/salon-secretary/evaluation/evaluator-text.ts'];
  const hashes = Object.fromEntries(unchanged.map(path => [path, hash(path)]));
  try {
    const identity = await db.assertPhaseADatabase(admin, runtime);
    await protectExisting(admin);
    const before = await db.snapshotPhaseACase(admin, fixture);
    if (JSON.stringify(before) !== JSON.stringify(previous.snapshot)) throw Error('AUDIT_BASELINE_DRIFT');
    await db.precheckPhaseACase(admin, runtime, fixture, { kind: 'APPROVED_RESUME_HISTORY',
      case_id: 'x94', count: before.technical_audits, technical_audit_hash: before.technical_audit_hash }, { financialYesterday: true });
    const actor = { salonId: fixture.tenant, userId: fixture.actor };
    const resolution = await withTenant(actor, async tx => {
      const rows = [];
      for (const query of ['Amanda Souza', 'Fábio Santos']) rows.push({ query,
        matches: (await searchSalonCustomer(tx, actor, query)).map(({ id, name }) => ({ id, name })) });
      return rows;
    });
    // Inspect existing optional data using the diagnostic role. Do not expand runtime grants.
    const linguisticData = await admin.clientProfile.findMany({ where: { salonId: fixture.tenant,
      id: { in: resolution.flatMap(row => row.matches.map(match => match.id)) } },
      select: { id: true, name: true, gender: true }, orderBy: { id: 'asc' } });
    const historical = read(resultPath).rows[0];
    const message = historical.user;
    if (message !== t21Cases.find(c => c.id === 'x94').messages[0]) throw Error('AUDIT_MESSAGE_DRIFT');
    const reason = historical.observed_view.action_plan.actions.find(action => action.operation === 'appointment.create').fields.override_reason;
    let rejection;
    try { groundSchedulingException({ override_requested: true, override_reason: reason }, {}, message); }
    catch (error) { rejection = error.message; }
    if (rejection !== 'OVERRIDE_REASON_NOT_GROUNDED') throw Error('AUDIT_REPRODUCTION_DRIFT');
    const after = await db.snapshotPhaseACase(admin, fixture);
    await protectExisting(admin);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('AUDIT_EFFECT_DETECTED');
    for (const [path, expected] of Object.entries(hashes)) if (hash(path) !== expected) throw Error('AUDIT_FILE_DRIFT');
    fs.mkdirSync(require('node:path').dirname(output), { recursive: true });
    persistBenchmark(output, { timestamp: new Date().toISOString(), identity, fixture: 'x94',
      source_hashes: hashes, entity_resolution: resolution, existing_linguistic_data: linguisticData,
      reason: { original_text: 'ele já está aguardando', observed_text: reason,
        original_start: message.indexOf('ele já está aguardando'), resolution: 'NOT_PROVABLE_FROM_EXISTING_PROVENANCE' },
      rejection, snapshot: after, baseline_unchanged: true, previous_cases_unchanged: true,
      flags: Object.fromEntries(flags.map(key => [key, process.env[key] === 'true'])),
      new_inferences: 0, operational_writes: 0, confirmations: 0, outbox: after.counts.outbox,
      implementation_changed: false });
    console.log(JSON.stringify({ output, identity, resolution, linguisticData, rejection,
      snapshot_unchanged: true, new_inferences: 0 }));
  } finally {
    for (const key of flags) process.env[key] = 'false';
    await Promise.all([admin.$disconnect(), runtime.$disconnect()]);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
