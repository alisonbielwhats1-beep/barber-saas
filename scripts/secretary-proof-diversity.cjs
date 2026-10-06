'use strict';
// Offline proof diversity report (Candidate 4, Track H): no network, no database, no model. Counts, ids and codes only.
//   node scripts/secretary-proof-diversity.cjs --set <battery.json> --label <code> [--out <report.json>] [--per-scenario] [--summary]
//   node scripts/secretary-proof-diversity.cjs --dev-baseline [--out <report.json>] [--summary]
// --set: AgendaScenario[] or the Golden format, compared with the DEV union (see packages/salon-secretary/evaluation/proof-diversity.ts).
// Never reads an owner holdout text file nor a derived owner set; never writes into the sealed holdout folder.
if (process.env.VERCEL_ENV === 'production' || process.env.APP_ENV === 'production') throw Error('PROOF_DIVERSITY_PRODUCTION_FORBIDDEN');
require('tsx/cjs');
const { mkdirSync, writeFileSync } = require('node:fs');
const { basename, dirname, resolve } = require('node:path');
const blocked = code => { console.error(JSON.stringify({ status: 'BLOCKED', code })); process.exit(2); };
const args = process.argv.slice(2), values = {}, flags = new Set();
while (args.length) {
  const key = args.shift();
  if (['--per-scenario', '--summary', '--dev-baseline'].includes(key)) { flags.add(key); continue; }
  if (!['--set', '--label', '--out'].includes(key) || !args.length || key in values) blocked('PROOF_DIVERSITY_ARGUMENT');
  values[key] = args.shift();
}
if (flags.has('--dev-baseline') === ('--set' in values)) blocked('PROOF_DIVERSITY_ARGUMENT');
const label = values['--label'] || 'set';
if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(label)) blocked('PROOF_DIVERSITY_LABEL');
const parts = p => resolve(p).split(/[\\/]/).map(x => x.toLowerCase());
if ('--set' in values) {
  const file = resolve(values['--set']), name = basename(file).toLowerCase(), segs = parts(file);
  if (!name.endsWith('.json')) blocked('PROOF_DIVERSITY_INPUT_FORMAT');
  if (/^owner-holdout/.test(name) || /^ov2-/.test(name) || (segs.includes('secretary-holdout-sealed') && segs.includes('derived'))) blocked('PROOF_DIVERSITY_INPUT_FORBIDDEN');
}
if ('--out' in values && parts(values['--out']).includes('secretary-holdout-sealed')) blocked('PROOF_DIVERSITY_OUT_FORBIDDEN');
try {
  const { devBaseline, devUnion, measureSet, readBattery, summarize } = require('../packages/salon-secretary/evaluation/proof-diversity.ts');
  let report;
  if (flags.has('--dev-baseline')) report = devBaseline(process.cwd(), { perScenario: flags.has('--per-scenario') });
  else {
    const u = devUnion(process.cwd());
    report = measureSet(label, readBattery(resolve(values['--set']), label), u.batteries,
      { perScenario: flags.has('--per-scenario'), bank: u.bank, extraNames: u.bankNames, extraServices: u.bankServices });
  }
  const text = JSON.stringify(report, null, 2) + '\n';
  if (values['--out']) { const out = resolve(values['--out']); mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, text); }
  if (flags.has('--summary')) console.log(JSON.stringify(report.summary ?? summarize({ [label]: report }), null, 2));
  else console.log(text);
} catch (error) {
  const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,63}(?::[A-Za-z0-9_.#+-]{1,40})?$/.test(error.message) ? error.message : 'PROOF_DIVERSITY_ERROR';
  console.error(JSON.stringify({ status: 'BLOCKED', code }));
  process.exitCode = 1;
}
