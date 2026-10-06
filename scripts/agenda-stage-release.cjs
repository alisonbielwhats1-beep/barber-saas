'use strict';
/* Operator command for the Agenda practice stage lease and lock (F1). Local files only: no database, no network, no ledger.
 *   node scripts/agenda-stage-release.cjs --stage <stage> --status
 *   node scripts/agenda-stage-release.cjs --stage <stage> --lease <lease id shown by AGENDA_STAGE_LEASE_STALE | INVALID> [--force]
 *   node scripts/agenda-stage-release.cjs --stage <stage> --lock [--force]
 * The program-wide proof lease of a sealed/validation run (PROGRAM_SPEND_PROOF_BUSY / _STALE; no --stage):
 *   node scripts/agenda-stage-release.cjs --proof-status
 *   node scripts/agenda-stage-release.cjs --proof <proof lease id shown by PROGRAM_SPEND_PROOF_STALE | INVALID> [--force]
 * A lease or lock is released only when its holder is provably gone (this host, dead pid); a holder that may be alive (live
 * pid, another host, a file still being written) needs --force after the operator checked no runner uses it. The runner never
 * takes a stale lease over by itself. Prints codes, pids, host names and ages only. */
const { join } = require('node:path');
require('tsx/cjs');
const lib = require('../packages/salon-secretary/evaluation/agenda-practice-lib.ts');
const RESULTS = 'packages/salon-secretary/evaluation/results/agenda-core';
function main(argv) {
  const args = argv.slice(2), value = flag => { const i = args.indexOf(flag); return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined; };
  if (args.includes('--proof-status') || args.includes('--proof')) {
    const spend = require('../packages/salon-secretary/evaluation/program-spend.ts'), ledger = spend.programSpendLedgerPath();
    if (args.includes('--proof-status')) return { status: 'STATUS', proof: spend.inspectProofLease(ledger) };
    const id = value('--proof');
    if (!id || id.startsWith('--')) throw Error('AGENDA_ARGUMENT');
    return { status: 'RELEASED', ...spend.operatorReleaseProofLease(ledger, { id, force: args.includes('--force') }) };
  }
  const stage = value('--stage');
  if (!stage || !Object.hasOwn(lib.AGENDA_STAGES, stage)) throw Error('AGENDA_STAGE_UNKNOWN');
  const file = lib.stageJournalPath(join(process.cwd(), RESULTS), stage), force = args.includes('--force');
  if (args.includes('--status')) return { status: 'STATUS', stage, lease: lib.inspectStageLease(file, stage), lock: lib.lockDiagnosis(file + '.lock') };
  if (args.includes('--lock')) return { status: 'RELEASED', stage, ...lib.operatorReleaseStageLock(file, stage, { force }) };
  const id = value('--lease');
  if (!id) throw Error('AGENDA_ARGUMENT');
  return { status: 'RELEASED', stage, ...lib.operatorReleaseStageLease(file, stage, { id, force }) };
}
try { console.log(JSON.stringify(main(process.argv))); }
catch (error) {
  const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,63}$/.test(error.message) ? error.message : 'AGENDA_STAGE_RELEASE_ERROR';
  console.error(JSON.stringify({ status: 'BLOCKED', code, ...(error && error.details ? { details: error.details } : {}) }));
  process.exitCode = 1;
}
