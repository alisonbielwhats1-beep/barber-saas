'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS launcher: it loads the env and tsx before requiring the TypeScript harness */
// A* premise probe launcher (docs/c5-spike/13-sonda-premissa-astar.md §5-§9; Adendo 12). Local only; never prints credentials.
//   node scripts/run-pilot-anchor-probe.cjs --cases <file> --dry-run             no network, no approval, no credential: schema, readings and decision
//                                                                                 under the ideal claim, the evidence self-test, each case's request
//                                                                                 with the worst text (>= 2048 B under the cap), shas, HEAD; codes only
//   node scripts/run-pilot-anchor-probe.cjs --cases <file> [--cap-usd 0.04]       the paid probe (cap at most US$ 0.04): refused unless
//                                                                                 PILOT_ANCHOR_PROBE_APPROVED=true, PILOT_ANCHOR_PROBE_CASES_SHA256 =
//                                                                                 sha256(file), PILOT_ANCHOR_PROBE_CONTRACT_SHA256 = the variant sha the
//                                                                                 dry-run prints, and the tree is clean (the runs folder aside)
// stdout: one JSON line of codes per case and a summary; texts only in <folder of the file>/runs/<timestamp>/ (refused inside a checkout).
const os = require('node:os');
try { os.userInfo(); } catch { os.userInfo = () => ({ username: 'offline-evaluation' }); }
const dryRun = process.argv.includes('--dry-run');
// Credentials are loaded only for a paid run (a dry-run never needs them).
if (!dryRun) require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() { throw Error('PROBE_ENV_LOAD_FAILED'); } });
if (process.env.VERCEL_ENV === 'production' || process.env.APP_ENV === 'production') throw Error('PROBE_PRODUCTION_FORBIDDEN');
process.env.APP_ENV ??= 'test';
process.env.VERCEL_ENV ??= 'development';
process.env.SALON_SECRETARY_MODEL = 'gpt-6-luna';
process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = 'false';
require('tsx/cjs');
const { probeCli } = require('../packages/salon-secretary/evaluation/pilot-anchor-probe.ts');
probeCli(process.argv.slice(2), process.env, line => console.log(line))
  .then(code => { process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = 'false'; process.exitCode = code; })
  .catch(() => { process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = 'false'; console.log(JSON.stringify({ status: 'BLOCKED', code: 'PROBE_ERROR' })); process.exitCode = 1; });
