'use strict';
// Local-only: loads .env.local inside this process and refuses any non-disposable database.
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() { throw Error('AGENDA_ENV_LOAD_FAILED'); } });
process.env.APP_ENV ??= 'test';
for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
  const url = new URL(process.env[name] ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55441' || url.pathname !== '/everflair_service_mvp') throw Error('AGENDA_LOCAL_DATABASE_REQUIRED');
}
require('tsx/cjs');
require('./setup-agenda-manual-test.ts');
