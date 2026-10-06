/* One explicit release of the historical incident, authorized by the user on
 * 2026-09-25. New failures remain latched. Historical PASS cases are excluded. */
const { existsSync, readFileSync, writeFileSync, renameSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const root = resolve(__dirname, '..');
const evidence = resolve(root, 'packages/salon-secretary/evaluation/results/execution-e2e');
const stop = resolve(evidence, 'STOP.json');
const release = resolve(evidence, 'revalidation-release-20260925.json');
function save(data) { writeFileSync(release, JSON.stringify(data, null, 2)); }
if (process.argv.length !== 2 || existsSync(release)) throw Error('REVALIDATION_ALREADY_STARTED_OR_INVALID_ARGUMENTS');
const incident = JSON.parse(readFileSync(stop, 'utf8'));
if (incident.trigger !== 'STALE_CONFIRMATION_EXECUTED' || incident.case !== 3 || incident.evidence !== '2026-09-25T10-28-23-287Z')
  throw Error('NOT_THE_AUTHORIZED_HISTORICAL_INCIDENT');
const record = { authorization: 'User: REVALIDATION + AUTOMATIC CONTINUATION; new isolated fixtures; stop on any failed prerequisite.',
  started: new Date().toISOString(), preserved_pass: [1, 2], historical_incident: incident,
  prerequisites: [3, 18], continuation: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20], status: 'STARTED' };
save(record);
renameSync(stop, resolve(evidence, 'STOP-historical-20260925.json'));
for (const [phase, ids] of [['revalidation', record.prerequisites], ['continuation', record.continuation]]) {
  const run = spawnSync(process.execPath, [resolve(__dirname, 'run-secretary-execution-e2e.cjs')], {
    cwd: root, windowsHide: true, stdio: 'inherit', env: { ...process.env, EXECUTION_E2E_CASES: ids.join(',') },
  });
  if (run.status !== 0) { record.status = `STOPPED_${phase.toUpperCase()}`; save(record); process.exit(1); }
  if (phase === 'revalidation') {
    record.stale_confirmation_fix = 'VALIDATED'; record.status = 'CONTINUING'; save(record);
    console.log('STALE_CONFIRMATION_FIX = VALIDATED; continuing remaining cases automatically.');
  }
}
record.status = 'BATTERY_PASSED'; record.finished = new Date().toISOString(); save(record);
