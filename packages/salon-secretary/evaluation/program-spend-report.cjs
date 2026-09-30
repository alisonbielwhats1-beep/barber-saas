'use strict';
// Program-wide real-spend report (no network, no database). Validates the whole hash chain and its anchor, then moves
// this checkout's tracked anchor (program-spend-anchor.json) to the ledger's last row; the ledger itself is never written.
// Usage: node packages/salon-secretary/evaluation/program-spend-report.cjs [--json]
// The ledger path is fixed (~/.everflair-secretary/program-spend-20260927.jsonl); there is no path argument.
// Exit 1 when the ledger is unreadable or the program is in a hard stop (a call beyond the sealed bound or above the cap).
const path = require('node:path');
process.chdir(path.resolve(__dirname, '..', '..', '..')); // the anchor is resolved from the checkout root
require('tsx/cjs');
const { advanceProgramAnchor, formatProgramSpend, programSpendLedgerPath, programSpendTotals } = require('./program-spend.ts');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--json')) { console.error('usage: node program-spend-report.cjs [--json]'); process.exit(2); }
const codeOf = error => error instanceof Error && /^PROGRAM_SPEND_[A-Z_]+$/.test(error.message) ? error.message : 'PROGRAM_SPEND_ERROR';
(async () => {
  let totals;
  // A row being appended by a running battery can be read half-written: retry briefly before failing closed.
  for (let attempt = 1; ; attempt++) {
    try { totals = programSpendTotals(programSpendLedgerPath()); break; }
    catch (error) {
      const code = codeOf(error);
      if (code === 'PROGRAM_SPEND_JOURNAL' && attempt < 3) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200); continue; }
      console.error(JSON.stringify({ status: 'BLOCKED', code }));
      process.exit(1);
    }
  }
  console.log(args.includes('--json') ? JSON.stringify(totals, null, 2) : formatProgramSpend(totals));
  // Unit tests never touch the real ledger's lock or anchor (PROGRAM_SPEND_TEST_LEDGER): the report stays read-only there.
  if (totals.rows) try { await advanceProgramAnchor(); }
  catch (error) { const code = codeOf(error); if (code !== 'PROGRAM_SPEND_TEST_LEDGER') { console.error(JSON.stringify({ anchor: 'NOT_ADVANCED', code })); process.exitCode = 1; } }
  if (totals.hardStop) process.exitCode = 1;
})();
