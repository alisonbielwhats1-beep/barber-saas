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
// Stable local-only session secret (git-ignored file) so a restart does not log the tester out.
function localSessionSecret() {
  const fs = require('node:fs'), file = '.demo/agenda-core/.nextauth-secret';
  try { const value = fs.readFileSync(file, 'utf8').trim(); if (value.length >= 64) return value; } catch { /* first run */ }
  const value = randomBytes(32).toString('hex');
  fs.mkdirSync('.demo/agenda-core', { recursive: true }); fs.writeFileSync(file, value, { mode: 0o600 });
  return value;
}
// The admin UI runs as local_app_runtime (production-parity grants, RLS enforced, no BYPASSRLS),
// created by scripts/setup-local-app-role.cjs; mvp_service_runtime only covers the Secretary MVP.
const appUrl = new URL(process.env.DATABASE_URL);
appUrl.username = 'local_app_runtime'; appUrl.password = '';
const env = { ...process.env, DATABASE_URL: appUrl.toString(), APP_ENV: 'test', VERCEL_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1',
  NEXTAUTH_URL: `http://localhost:${port}`, NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || localSessionSecret(),
  SALON_SECRETARY_ENABLED: 'true', SALON_SECRETARY_FRONT_ENABLED: 'true', SALON_SECRETARY_ALLOW_PAID_CALLS: 'true',
  SALON_SECRETARY_MODEL: 'gpt-6-luna', SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true', SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED: 'true',
  SALON_SECRETARY_JEV_ROUTER_ENABLED: 'false', PLATFORM_BILLING_ENABLED: 'false', MERCADOPAGO_BILLING_ENABLED: 'false', EMAIL_INVITES_ENABLED: 'false' };
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '-p', port], { env, stdio: 'inherit' });
child.on('exit', code => process.exit(code ?? 0));
