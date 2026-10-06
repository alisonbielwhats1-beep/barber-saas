'use strict';
// Local-only launcher: loads .env.local inside this process; never prints credentials.
const os = require('node:os');
try { os.userInfo(); } catch { os.userInfo = () => ({ username: 'offline-evaluation' }); }
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() { throw Error('AGENDA_ENV_LOAD_FAILED'); } });
if (process.env.VERCEL_ENV === 'production' || process.env.APP_ENV === 'production') throw Error('AGENDA_PRODUCTION_FORBIDDEN');
process.env.APP_ENV ??= 'test';
process.env.VERCEL_ENV ??= 'development';
process.env.SALON_SECRETARY_MODEL = 'gpt-6-luna';
process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = 'false';
process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED = 'false';
process.env.SALON_SECRETARY_MULTI_ACTION_V2_ENABLED = 'true';
process.env.SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED ??= 'true';
for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
  const url = new URL(process.env[name] ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55441' || url.pathname !== '/everflair_service_mvp') throw Error('AGENDA_LOCAL_DATABASE_REQUIRED');
}
require('tsx/cjs');
require('./run-agenda-practice.ts');
