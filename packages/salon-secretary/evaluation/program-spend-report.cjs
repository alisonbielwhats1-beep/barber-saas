'use strict';
// Program-wide real-spend report (no network, no database), one section per wallet (OpenAI; OpenRouter since 04/10/2026).
// Validates each wallet's hash chain and anchor, then moves this checkout's tracked anchors (program-spend-anchor.json,
// program-spend-openrouter-anchor.json) to each ledger's last row; the ledgers themselves are never written.
// Usage: node packages/salon-secretary/evaluation/program-spend-report.cjs [--json]
// The ledger paths are fixed (~/.everflair-secretary/program-spend-20260927.jsonl and program-spend-openrouter-20261004.jsonl).
// Exit 1 when a ledger is unreadable or a wallet is in a hard stop (a call beyond the sealed bound or above the cap).
const path = require('node:path');
process.chdir(path.resolve(__dirname, '..', '..', '..')); // the anchors are resolved from the checkout root
require('tsx/cjs');
const { advanceProgramAnchor, formatProgramSpend, programSpendLedgerPath, programSpendTotals, PROGRAM_SPEND_WALLETS } = require('./program-spend.ts');
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--json')) { console.error('usage: node program-spend-report.cjs [--json]'); process.exit(2); }
const codeOf = error => error instanceof Error && /^PROGRAM_SPEND_[A-Z_]+$/.test(error.message) ? error.message : 'PROGRAM_SPEND_ERROR';
(async () => {
  const report = {};
  for (const wallet of Object.keys(PROGRAM_SPEND_WALLETS)) {
    const file = programSpendLedgerPath(wallet);
    let totals;
    // A row being appended by a running battery can be read half-written: retry briefly before failing closed.
    for (let attempt = 1; ; attempt++) {
      try { totals = programSpendTotals(file); break; }
      catch (error) {
        const code = codeOf(error);
        if (code === 'PROGRAM_SPEND_JOURNAL' && attempt < 3) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200); continue; }
        console.error(JSON.stringify({ status: 'BLOCKED', wallet, code }));
        process.exit(1);
      }
    }
    report[wallet] = totals;
    // Unit tests never touch a real ledger's lock or anchor (PROGRAM_SPEND_TEST_LEDGER): the report stays read-only there.
    if (totals.rows) try { await advanceProgramAnchor(file); }
    catch (error) { const code = codeOf(error); if (code !== 'PROGRAM_SPEND_TEST_LEDGER') { console.error(JSON.stringify({ anchor: 'NOT_ADVANCED', wallet, code })); process.exitCode = 1; } }
    if (totals.hardStop) process.exitCode = 1;
  }
  console.log(args.includes('--json') ? JSON.stringify(report, null, 2)
    : Object.entries(report).map(([wallet, totals]) => `== Carteira ${wallet}\n${formatProgramSpend(totals)}`).join('\n\n'));
})();
