'use strict';
/* Local manual test of the Secretary Agenda. Enables the Secretary ONLY in this process,
 * against the disposable local database. Never production: refuses any other DB target.
 * Paid Luna calls happen only when you send a message in the UI (~US$0.0005 per turn). */
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() { throw Error('AGENDA_ENV_LOAD_FAILED'); } });
for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
  const url = new URL(process.env[name] ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55441' || url.pathname !== '/everflair_service_mvp') throw Error('AGENDA_LOCAL_DATABASE_REQUIRED');
}
const port = process.env.PORT ?? '3157';
const env = { ...process.env, APP_ENV: 'test', VERCEL_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1',
  NEXTAUTH_URL: `http://localhost:${port}`, NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || randomBytes(32).toString('hex'),
  SALON_SECRETARY_ENABLED: 'true', SALON_SECRETARY_FRONT_ENABLED: 'true', SALON_SECRETARY_ALLOW_PAID_CALLS: 'true',
  SALON_SECRETARY_MODEL: 'gpt-6-luna', SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true', SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED: 'true',
  SALON_SECRETARY_JEV_ROUTER_ENABLED: 'false', PLATFORM_BILLING_ENABLED: 'false', MERCADOPAGO_BILLING_ENABLED: 'false', EMAIL_INVITES_ENABLED: 'false' };
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '-p', port], { env, stdio: 'inherit' });
child.on('exit', code => process.exit(code ?? 0));
