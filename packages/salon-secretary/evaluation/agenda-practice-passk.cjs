'use strict';
// Offline pass^k report over an Agenda practice run dir (k*/ attempt subdirs; a legacy flat dir counts as k1).
// No network, no database. Usage: node packages/salon-secretary/evaluation/agenda-practice-passk.cjs <run-dir> [--out <passk.json>]
// A/B (C2 examples off | selected | full): pass several run dirs; each gets its passk.json and a side-by-side table is printed.
//   node packages/salon-secretary/evaluation/agenda-practice-passk.cjs <run-dir-off> <run-dir-selected> <run-dir-full>
// Every report carries 95% intervals (STATS: expanded-percentile cluster bootstrap over scenarios, Wilson on the scenario
// majority pass). With several arms, each arm after the first is compared with the first on the SAME scenario ids (PAIRED:
// paired bootstrap, exact sign test, McNemar count; a verdict needs both; 'noninferior' against the pre-declared margin).
// An arm may pool runs: <run-dir-v>+<run-dir-n>. Arms whose recorded scenario definitions differ are refused; arms run
// with another K or noise profile are flagged CONFOUNDED.
// --no-write: do not write passk.json into the run dirs (evidence stays untouched).
// PROTECTED runs (a sealed or validation run folder, a run folder outside the checkout, or a run of a registered
// holdout's scenario ids): the per-scenario table (ids, and failure reasons that quote names, dates and block reasons) is
// refused unless the coordinator asks for it with --coordinator. For everyone else:
//   --aggregate: per arm the coverage, SAFETY counts and STATS, then PAIRED (n, diff, CI, verdict, sign and McNemar
//   counts); capability rows with free-text labels omitted; never writes anything.
// Generalization gap (read-only; aggregates, tertiles and counts only: no scenario id, reason or text is printed or written):
//   node packages/salon-secretary/evaluation/agenda-practice-passk.cjs --gap <dev-run>[+<dev-run>] <held-run>[+<held-run>] [--out <gap.json>] [--dev-corpus <scenarios.json>]...
// --dev-corpus (repeatable): a dev scenario file measured as a similarity corpus of its own; without it, a multi-salon held run
// (scenarios with a salon) is measured against the committed multi-salon dev instances (multi-salon/generated-dev.json).
const path = require('node:path'), fs = require('node:fs');
require('tsx/cjs');
const { buildPasskReport, formatPasskTable, formatPasskComparison, passkArm, heldSimilarity } = require('./agenda-practice-lib.ts');
const { aggregateSimilarity, formatGeneralizationGap, formatPairedComparison, formatRunStats, generalizationGap } = require('./agenda-practice-stats.ts');
const { RUN_MARKERS, isInside, sealedRepoRoots } = require('./agenda-sealed.ts');
const { readHoldoutRegistry, registeredHoldoutMatch } = require('./holdout-usage.ts');
const FLAGS = ['--out', '--gap', '--no-write', '--aggregate', '--coordinator', '--dev-corpus'], VALUE_FLAGS = ['--out', '--dev-corpus'];
const args = process.argv.slice(2), outIndex = args.indexOf('--out'), gap = args.includes('--gap'), noWrite = args.includes('--no-write');
const values = new Set(args.flatMap((arg, index) => VALUE_FLAGS.includes(arg) ? [index + 1] : []));
const devCorpora = args.flatMap((arg, index) => arg === '--dev-corpus' ? [args[index + 1]] : []);
const aggregateOnly = args.includes('--aggregate'), coordinator = args.includes('--coordinator');
const specs = args.filter((arg, index) => !FLAGS.includes(arg) && !values.has(index));
const usage = () => {
  console.error('usage: node agenda-practice-passk.cjs <run-dir> [--out <passk.json>] [--no-write] [--coordinator] | <run-dir>[+<run-dir>] <run-dir>[+<run-dir>] ... [--no-write] [--coordinator]\n' +
    '       node agenda-practice-passk.cjs <run-dir>[+<run-dir>] [<run-dir>[+<run-dir>] ...] --aggregate\n' +
    '       node agenda-practice-passk.cjs --gap <dev-run>[+<dev-run>] <held-run>[+<held-run>] [--out <gap.json>] [--dev-corpus <scenarios.json>]...'); process.exit(2);
};
const blocked = (code, extra = '') => { console.error(`BLOCKED ${code}${extra}`); process.exit(2); };
if (!specs.length || specs.some(s => s.startsWith('--')) || [...values].some(index => !args[index] || args[index].startsWith('--'))) usage();
if (devCorpora.length && (!gap || devCorpora.some(file => !fs.existsSync(file) || !fs.statSync(file).isFile()))) usage();
if ([gap, aggregateOnly, coordinator].filter(Boolean).length > 1 || (aggregateOnly && (outIndex >= 0 || noWrite))) usage();
// A spec is a run dir, or run dirs joined by '+' pooled into one arm.
const dirsOf = spec => (fs.existsSync(spec) ? [spec] : spec.split('+')).map(dir => {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { console.error(`run dir not found: ${dir}`); process.exit(2); }
  return path.resolve(dir);
});
const legacyCheck = path.join(__dirname, 'agenda-practice-check.cjs');
const code = error => error instanceof Error && /^[A-Z][A-Z0-9_]{2,63}(?::[A-Za-z0-9_.-]{1,40})?$/.test(error.message) ? error.message : 'AGENDA_PASSK_ERROR';
const SAFETY = /^[A-Z][A-Z0-9_]{1,63}(?::[a-z][a-z0-9_]{0,40})?$/;
/** Why a run's per-scenario table may not be shown (null: a dev run inside the checkout). */
function protection(report, registry, roots) {
  const dir = report.runDir;
  for (const [mode, marker] of Object.entries(RUN_MARKERS)) if (fs.existsSync(path.join(dir, marker))) return `${mode}_RUN`;
  let real = dir; try { real = fs.realpathSync(dir); } catch { /* checked as given */ }
  if (!roots.some(root => isInside(dir, root)) || !roots.some(root => isInside(real, root))) return 'OUTSIDE_REPO';
  const match = registeredHoldoutMatch(registry, null, report.scenarios.map(s => s.id));
  return match ? `REGISTERED_HOLDOUT:${match}` : null;
}
function runLine(r) {
  const codes = {};
  for (const s of r.safety) for (const c of s.codes) { const k = SAFETY.test(c) ? c : 'OTHER'; codes[k] = (codes[k] || 0) + 1; }
  return `RUN ${String(r.run || path.basename(r.runDir)).slice(0, 60)} K=${r.repeat} ${r.valid ? 'valid' : 'INVALID'} scenarios=${r.scenarios.length} coverage=${r.coverage.graded}/${r.coverage.expected}` +
    ` noise=${r.noiseProfile} safety attempts=${r.safety.length}${Object.keys(codes).length ? ' ' + JSON.stringify(codes) : ''}`;
}
try {
  if (gap) {
    if (specs.length !== 2) usage();
    const [devDirs, heldDirs] = specs.map(dirsOf);
    const dev = passkArm(devDirs.map(dir => buildPasskReport(dir, { legacyCheck })), 'dev');
    const held = passkArm(heldDirs.map(dir => buildPasskReport(dir, { legacyCheck })), 'held');
    const result = generalizationGap(dev, held), similarity = aggregateSimilarity(heldSimilarity(held, heldDirs, process.cwd(), devCorpora.length ? { devCorpora: devCorpora.map(file => path.resolve(file)) } : {}));
    console.log(formatGeneralizationGap(result, similarity));
    if (outIndex >= 0) {
      const out = path.resolve(args[outIndex + 1]);
      fs.writeFileSync(out, JSON.stringify({ ...result, similarity }, null, 2));
      console.log(`written ${out}`);
    }
  } else {
    const arms = specs.map(dirsOf);
    if (outIndex >= 0 && arms.flat().length > 1) usage();
    // Everything is graded in memory first: nothing is printed or written before the protection check.
    const reports = arms.map(dirs => dirs.map(runDir => buildPasskReport(runDir, { legacyCheck })));
    const registry = readHoldoutRegistry(process.cwd()), roots = sealedRepoRoots(process.cwd());
    const guarded = reports.flat().map(r => protection(r, registry, roots)).filter(Boolean);
    if (aggregateOnly) {
      for (const r of reports.flat()) { console.log(runLine(r)); console.log(formatRunStats(r.stats, r.repeat, { safeLabels: true })); }
      if (reports.length > 1) { console.log(''); console.log(formatPairedComparison(reports.map(list => passkArm(list)), { safeLabels: true })); }
    } else {
      if (guarded.length && !coordinator) blocked('AGENDA_PASSK_PROTECTED_RUN', ` (${guarded.length} run dir(s): ${[...new Set(guarded)].join(', ')}): use --aggregate (STATS and PAIRED only) or --gap; the per-scenario table is for the coordinator (--coordinator)`);
      const pairs = reports.length > 1 ? formatPairedComparison(reports.map(list => passkArm(list))) : ''; // may refuse (definitions) before anything is written
      for (const report of reports.flat()) {
        const out = outIndex >= 0 ? path.resolve(args[outIndex + 1]) : noWrite ? null : path.join(report.runDir, 'passk.json');
        if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
        console.log(formatPasskTable(report));
        if (out) console.log(`written ${out}`);
      }
      if (reports.flat().length > 1) { console.log('\nA/B per run'); console.log(formatPasskComparison(reports.flat())); }
      if (pairs) { console.log(''); console.log(pairs); }
    }
  }
} catch (error) {
  const details = error && typeof error === 'object' && error.details && typeof error.details.scenarios === 'number' ? ` (${error.details.scenarios} scenario(s))` : '';
  blocked(code(error), details);
}
