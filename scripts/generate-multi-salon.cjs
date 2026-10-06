'use strict';
// Offline generator of multi-salon Agenda practice scenarios (evaluation only: no database, no network, no model).
//   node scripts/generate-multi-salon.cjs [--split dev|holdout|both] [--seed s] [--per-type N]
//     [--holdout-out <file outside the repo> [--holdout-seed s] [--per-template N]] [--holdout-phrases <file outside the repo>] [--check]
//   node scripts/generate-multi-salon.cjs --phrases-contract-out <file outside the repo>   (v4: the contract for the phrase author)
// --check writes nothing and adds the runner's pure preflight (K=3, mixed noise, closed day = fail; no database, no network).
// --holdout-phrases (v4, --split holdout|both): the holdout's wording comes from that file, validated first (holdout-phrases.ts).
// Prints codes, hashes and counts only (never a holdout text). See packages/salon-secretary/evaluation/multi-salon/generate.ts.
if (process.env.VERCEL_ENV === 'production' || process.env.APP_ENV === 'production') throw Error('MULTI_SALON_PRODUCTION_FORBIDDEN');
require('tsx/cjs');
const { main } = require('../packages/salon-secretary/evaluation/multi-salon/generate.ts');
const preflight = scenarios => {
  const { preflightAgendaPractice } = require('../packages/salon-secretary/evaluation/agenda-practice.ts');
  const pre = preflightAgendaPractice(scenarios, { repeat: 3, noise: 'mixed', closedDay: 'fail' });
  return { status: pre.estimate.ok ? 'PREFLIGHT_OK' : 'AGENDA_STAGE_HEADROOM', runnable: pre.runnable.length, skipped: pre.skipped.length, noiseTexts: pre.noise.texts,
    noiseViolations: pre.noise.violations.length, callsPerPass: pre.estimate.callsPerPass, requiredUsd: pre.estimate.requiredMicroUsd / 1e6, remainingUsd: pre.estimate.remainingMicroUsd / 1e6 };
};
main(process.argv.slice(2), process.cwd(), { preflight }).catch(error => {
  const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,63}(?::[A-Za-z0-9_.#+-]{1,40})?$/.test(error.message) ? error.message : 'MULTI_SALON_ERROR';
  const details = error && typeof error === 'object' && Array.isArray(error.details) ? error.details.filter(d => typeof d === 'string' && /^[A-Za-z0-9_:+.#-]{1,120}$/.test(d)) : undefined;
  console.error(JSON.stringify({ status: 'BLOCKED', code, ...(details && details.length ? { details } : {}) }));
  process.exitCode = 1;
});
