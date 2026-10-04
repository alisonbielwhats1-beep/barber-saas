'use strict';
/* Local manual test of the Secretary Agenda. Enables the Secretary ONLY in this process,
 * against the disposable local database. Never production: refuses any other DB target.
 * Paid model calls happen only when you send a message in the UI. Owner decision of 04/10/2026: DeepSeek V4.1 Flash through
 * OpenRouter (SALON_SECRETARY_OPENROUTER_API_KEY in .env.local) in place of GPT-6 Luna; SECRETARY_DEMO_MODEL=gpt-6-luna goes back.
 * Owner decision of 03/10/2026: the demo speaks (microphone + GPT transcription, ~US$0.003 per minute spoken, budget
 * US$2 per month for the newest local test salon only) and never asks for a cancellation reason. Each switch can be turned
 * off from the environment (e.g. SALON_SECRETARY_TRANSCRIBE_ENABLED=false keeps the browser's own dictation). */
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
const on = name => process.env[name] ?? 'true';
// The transcription budget is per listed salon: the newest synthetic salon of scripts/setup-agenda-manual-test.ts (the one in
// LOCAL-LOGIN.txt). None found, transcription answers "unavailable" and the box stays typed.
async function newestTestSalon() {
  if (process.env.SALON_SECRETARY_TRANSCRIBE_SALONS !== undefined) return process.env.SALON_SECRETARY_TRANSCRIBE_SALONS;
  const { PrismaClient } = require('@prisma/client'), admin = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
  try { return (await admin.salon.findFirst({ where: { slug: { startsWith: 'agenda-teste-' } }, orderBy: { createdAt: 'desc' }, select: { id: true } }))?.id ?? ''; }
  catch { return ''; } finally { await admin.$disconnect(); }
}
(async () => {
  const env = { ...process.env, DATABASE_URL: appUrl.toString(), APP_ENV: 'test', VERCEL_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1',
    NEXTAUTH_URL: `http://localhost:${port}`, NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || localSessionSecret(),
    SALON_SECRETARY_ENABLED: 'true', SALON_SECRETARY_FRONT_ENABLED: 'true', SALON_SECRETARY_ALLOW_PAID_CALLS: 'true',
    SALON_SECRETARY_MODEL: process.env.SECRETARY_DEMO_MODEL || 'deepseek/deepseek-v4.1-flash', SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'true', SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED: 'true',
    SALON_SECRETARY_VOICE_ENABLED: on('SALON_SECRETARY_VOICE_ENABLED'), SALON_SECRETARY_VOICE_CORRECTION: on('SALON_SECRETARY_VOICE_CORRECTION'),
    SALON_SECRETARY_TRANSCRIBE_ENABLED: on('SALON_SECRETARY_TRANSCRIBE_ENABLED'), SALON_SECRETARY_TRANSCRIBE_BUDGET_USD: process.env.SALON_SECRETARY_TRANSCRIBE_BUDGET_USD || '2',
    SALON_SECRETARY_TRANSCRIBE_SALONS: await newestTestSalon(), SALON_SECRETARY_CANCEL_REASON_OPTIONAL: on('SALON_SECRETARY_CANCEL_REASON_OPTIONAL'),
    SALON_SECRETARY_JEV_ROUTER_ENABLED: 'false', PLATFORM_BILLING_ENABLED: 'false', MERCADOPAGO_BILLING_ENABLED: 'false', EMAIL_INVITES_ENABLED: 'false' };
  const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '-p', port], { env, stdio: 'inherit' });
  child.on('exit', code => process.exit(code ?? 0));
})();
