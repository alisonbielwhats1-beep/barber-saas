'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Direct Node CommonJS launcher, without a transpiler. */

// Launch only through the positive allowlist environment and after DB preflight.
// The app, compiled actions and all business authority remain in the same build.
const fs = require('node:fs');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { adaptCodespaceOrigin } = require('./secretary-codespace-origin.cjs');
const RELEASE = '/workspaces/everflair-billing-staging/.demo/secretary-release-806223edd36b';
const EVIDENCE = '/workspaces/everflair-billing-staging/.demo/secretary-readiness-2026-09-25T14-59-20-361Z';

async function main() {
  const { isSecretaryCodespaceTarget } = await import(pathToFileURL(`${RELEASE}/src/lib/secretary-staging-target.mjs`).href);
  if (!isSecretaryCodespaceTarget(process.env) || process.cwd() !== RELEASE) throw Error('STAGING_TARGET_REJECTED');
  if (fs.readFileSync(`${RELEASE}/.next/BUILD_ID`, 'utf8').trim() !== 'XYqNZnD8YqIYPSOKdaUWB') throw Error('BUILD_REJECTED');
  const next = require(`${RELEASE}/node_modules/next`);
  const app = next({ dev: false, dir: RELEASE, hostname: '127.0.0.1', port: 3001 });
  await app.prepare();
  const handle = app.getRequestHandler();
  const server = http.createServer((request, response) => {
    const adaptation = adaptCodespaceOrigin(request);
    if (adaptation !== 'UNCHANGED') fs.appendFileSync(`${EVIDENCE}/origin-adapter.jsonl`,
      JSON.stringify({ at: new Date().toISOString(), adaptation, method: request.method }) + '\n', { mode: 0o600 });
    if (adaptation === 'REJECTED') {
      response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      response.end('Origem da requisição não validada.');
      return;
    }
    Promise.resolve(handle(request, response)).catch(() => {
      if (!response.headersSent) response.writeHead(500, { 'cache-control': 'no-store' });
      response.end();
    });
  });
  server.listen(3001, '127.0.0.1');
  // No restart loop: shutdown/ambiguous requests require reconciliation.
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}

if (require.main === module) main().catch(() => { console.error('STAGING_LAUNCH_FAILED'); process.exitCode = 1; });
