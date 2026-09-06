import { readFileSync } from 'node:fs';

export function demoEnvironment() {
  const saved = JSON.parse(readFileSync('.demo/environment.json', 'utf8'));
  const db = new URL(saved.DATABASE_URL);
  if (db.hostname !== '127.0.0.1' || db.pathname !== '/everflair_demo' || db.username !== 'app_runtime') {
    throw new Error('A demonstração aceita somente seu PostgreSQL local dedicado.');
  }
  // Never inherit provider credentials from the host/Codespaces secrets.
  const inherited = Object.fromEntries(
    ['PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'TERM', 'TMPDIR'].filter(k => process.env[k]).map(k => [k, process.env[k]])
  );
  return {...inherited, ...saved, EVERFLAIR_CODESPACE_DEMO: '1', APP_ENV: 'development', NODE_ENV: 'production', TZ: 'America/Sao_Paulo',
    NEXT_TELEMETRY_DISABLED: '1', PLATFORM_BILLING_ENABLED: 'false', EMAIL_INVITES_ENABLED: 'false',
    PLATFORM_SIGNUP_NOTIFICATIONS_ENABLED: 'false'};
}
