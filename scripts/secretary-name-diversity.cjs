'use strict';
// Offline name / entity diversity report (Candidate 4, backlog section 1): no network, no database, no model.
//   node scripts/secretary-name-diversity.cjs            -> JSON report (names and counts only, never a sentence)
//   node scripts/secretary-name-diversity.cjs --summary  -> one line per corpus plus the target checks
// See packages/salon-secretary/evaluation/name-diversity.ts.
if (process.env.VERCEL_ENV === 'production' || process.env.APP_ENV === 'production') throw Error('NAME_DIVERSITY_PRODUCTION_FORBIDDEN');
require('tsx/cjs');
const { nameDiversityReport, summaryLines } = require('../packages/salon-secretary/evaluation/name-diversity.ts');
const args = process.argv.slice(2);
if (args.some(a => a !== '--summary')) { console.error(JSON.stringify({ status: 'BLOCKED', code: 'NAME_DIVERSITY_ARGUMENT' })); process.exit(2); }
try {
  const report = nameDiversityReport(process.cwd());
  if (args.includes('--summary')) console.log([...summaryLines(report), JSON.stringify(report.checks)].join('\n'));
  else console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,63}(?::[A-Za-z0-9_.#+-]{1,40})?$/.test(error.message) ? error.message : 'NAME_DIVERSITY_ERROR';
  console.error(JSON.stringify({ status: 'BLOCKED', code }));
  process.exitCode = 1;
}
