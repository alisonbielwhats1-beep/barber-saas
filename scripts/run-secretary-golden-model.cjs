'use strict';
/* Golden 30 of any registered model (model registry, 04/10/2026) under the CERTIFICATION flag profile: exactly the flags of
 * Luna's Golden proof of 30/09/2026 (golden-20260930-c4-proof), the model aside. Local disposable database only (the runner's
 * own guards); paid calls only on --run, under the model's evaluation mission and its program wallet.
 *   node scripts/run-secretary-golden-model.cjs --model <id> --prepare [--repeat 3] [--out <dir>] [--cases <suite.json>]
 *   node scripts/run-secretary-golden-model.cjs --model <id> --run <manifest sha256> [--out <dir>]
 * <dir> is a directory name under packages/salon-secretary/evaluation/results/free-use. Then, when the run passed:
 *   npx tsx scripts/secretary-certify-model.ts <dir>                                                                          */
const path = require('node:path'), { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const CERTIFICATION_FLAGS = Object.freeze({ SALON_SECRETARY_ALLOW_PAID_CALLS: 'false', SALON_SECRETARY_ALTER_APPOINTMENT: 'true', SALON_SECRETARY_COPY_V2: 'true',
  SALON_SECRETARY_CUSTOMER_OVERLAP_GUARD: 'true', SALON_SECRETARY_DATE_RULES_V2: 'true', SALON_SECRETARY_DAYPART_BY_HOURS: 'true',
  SALON_SECRETARY_DAYPART_RULES_V2: 'true', SALON_SECRETARY_ENABLED: 'false', SALON_SECRETARY_EXAMPLES: 'selected', SALON_SECRETARY_EXAMPLES_V2: 'true',
  SALON_SECRETARY_EXCEPTION_RULES_V2: 'true', SALON_SECRETARY_JEV_ROUTER_ENABLED: 'false', SALON_SECRETARY_JIT_INSTRUCTIONS: 'true',
  SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true', SALON_SECRETARY_MULTI_SERVICE: 'true', SALON_SECRETARY_NAME_SUGGESTIONS: 'true',
  SALON_SECRETARY_PERSISTED_STATE: 'true', SALON_SECRETARY_READS_V2: 'true', SALON_SECRETARY_RECURRENCE_GUARD: 'true', SALON_SECRETARY_REFERENCES_V2: 'true',
  SALON_SECRETARY_SAME_AS: 'true', SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED: 'true', SALON_SECRETARY_STRUCTURED_CONTEXT: 'true',
  SALON_SECRETARY_TEMPORAL_COMPONENTS: 'true', SALON_SECRETARY_TEMPORAL_POLARITY: 'true' });
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i += 2) {
  const key = args[i], value = args[i + 1];
  if (!['--model', '--prepare', '--run', '--repeat', '--out', '--cases'].includes(key) || key in options) throw Error('usage: see the header of this file');
  if (key === '--prepare') { options[key] = true; i--; continue; }
  if (value === undefined) throw Error('usage: see the header of this file');
  options[key] = value;
}
const prepare = options['--prepare'] === true, run = options['--run'];
if (!options['--model'] || prepare === Boolean(run) || (run && !/^[0-9a-f]{64}$/.test(run))) throw Error('usage: see the header of this file');
require('@next/env').loadEnvConfig(root, true, { info() {}, error() {} });
require('tsx/cjs');
const { secretaryModelProfile } = require('../packages/salon-secretary/src/model-registry.ts');
const { FREE_USE_MISSIONS, freeUseMissionPricing } = require('../packages/salon-secretary/evaluation/free-use-budget.ts');
const profile = secretaryModelProfile(options['--model']);
// The model's evaluation mission: the last one (the current) whose sealed pricing names the model.
const mission = Object.keys(FREE_USE_MISSIONS).filter(id => freeUseMissionPricing(id).pricing.model === profile.id).at(-1);
if (!mission) throw Error(`no evaluation mission prices ${profile.id} (packages/salon-secretary/evaluation/free-use-budget.ts)`);
const out = `packages/salon-secretary/evaluation/results/free-use/${options['--out'] || `golden-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${profile.id.replace(/[^a-z0-9]+/gi, '-')}`}`;
const env = {};
// Every non-Secretary variable, the Secretary credentials and the measurement knobs; the flags are exactly the certification profile.
for (const [name, value] of Object.entries(process.env)) if (!name.startsWith('SALON_SECRETARY_') || /(_API_KEY|_PROJECT)$/.test(name) ||
  /^SALON_SECRETARY_OPENROUTER_(REASONING|PROVIDER)$/.test(name)) env[name] = value;
Object.assign(env, CERTIFICATION_FLAGS, { SALON_SECRETARY_MODEL: profile.id, APP_ENV: 'test', VERCEL_ENV: 'development',
  DATABASE_URL: 'postgresql://mvp_service_runtime@127.0.0.1:55441/everflair_service_mvp', DIRECT_URL: 'postgresql://mvp_test_admin@127.0.0.1:55441/everflair_service_mvp' });
delete env.FREE_USE_MISSION_ID;
if (run) Object.assign(env, { FREE_USE_APPROVED_MANIFEST: run, FREE_USE_REAL_LUNA_APPROVED: 'true' });
const cli = [path.join(root, 'scripts', 'run-secretary-free-use.cjs'), prepare ? '--prepare' : '--run', '--out', out, '--mission', mission,
  ...(prepare && options['--repeat'] ? ['--repeat', options['--repeat']] : []), ...(prepare && options['--cases'] ? ['--cases', options['--cases']] : [])];
const result = spawnSync(process.execPath, cli, { cwd: root, env, stdio: 'inherit' });
process.exit(result.status ?? 1);
