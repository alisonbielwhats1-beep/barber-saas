'use strict';
// Local-only: loads .env.local inside this process and refuses any non-disposable database.
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() { throw Error('LOCAL_APP_ROLE_ENV_LOAD_FAILED'); } });
require('tsx/cjs');
const { ensureLocalAppRole } = require('./setup-local-app-role.ts');
ensureLocalAppRole(process.env.DIRECT_URL ?? '')
  .then(result => console.log(JSON.stringify({ status: 'READY', ...result })))
  .catch(error => { console.error(JSON.stringify({ status: 'BLOCKED', code: error instanceof Error ? error.message.slice(0, 200) : 'ERROR' })); process.exitCode = 1; });
