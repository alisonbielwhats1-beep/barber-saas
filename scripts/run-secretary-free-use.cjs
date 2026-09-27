'use strict';
// Read local credentials only inside this process; environment identity is checked before DB/network.
const os = require('node:os');
try { os.userInfo(); } catch { os.userInfo = () => ({ username: 'offline-evaluation' }); }
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() { throw Error('FREE_USE_ENV_LOAD_FAILED'); } });
// Explicit local-only defaults. Supplied values remain subject to fail-closed guards.
process.env.APP_ENV ??= 'test';
process.env.VERCEL_ENV ??= 'development';
process.env.DATABASE_URL ??= 'postgresql://mvp_service_runtime@127.0.0.1:55441/everflair_service_mvp';
process.env.DIRECT_URL ??= 'postgresql://mvp_test_admin@127.0.0.1:55441/everflair_service_mvp';
process.env.SALON_SECRETARY_MODEL ??= 'gpt-6-luna';
process.env.SALON_SECRETARY_ALLOW_PAID_CALLS = 'false';
process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED ??= 'false';
process.env.SALON_SECRETARY_MULTI_ACTION_V2_ENABLED ??= 'true';
require('tsx/cjs');
require('./run-secretary-free-use.ts');
