/* Local-only launcher. Deliberately never loads .env files or model credentials. */
const { spawnSync } = require('node:child_process');
const { mkdirSync, writeFileSync, readFileSync, existsSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { resolve } = require('node:path');
const { PrismaClient } = require('@prisma/client');
const root = resolve(__dirname, '..');
const pg = 'C:/Program Files/PostgreSQL/16/bin/';
const runtime = 'postgresql://mvp_service_runtime@127.0.0.1:55441/everflair_service_mvp';
const adminUrl = 'postgresql://mvp_test_admin@127.0.0.1:55441/everflair_service_mvp';
async function main() {
  if (process.argv.length !== 2) throw Error('NO_ARGUMENTS_ALLOWED');
  const stopFile = resolve(root, 'packages/salon-secretary/evaluation/results/execution-e2e/STOP.json');
  if (existsSync(stopFile)) throw Error('EXECUTION_STOP_REQUIRES_EXPLICIT_RELEASE');
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  let directory;
  try {
    const [db] = await admin.$queryRaw`SELECT current_database() AS name, host(inet_server_addr()) AS host,
      inet_server_port() AS port, encode(current_setting('data_directory')::bytea,'hex') AS directory_hex`;
    db.directory=decodeDirectory(db.directory_hex);
    if (db.name !== 'everflair_service_mvp' || db.host !== '127.0.0.1' || db.port !== 55441 ||
        !/\/everflair-service-mvp-[^/]+\/data$/i.test(db.directory.replaceAll('\\', '/'))) throw Error('UNSAFE_DATABASE');
    directory = db.directory;
  } finally { await admin.$disconnect(); }
  const output = resolve(root, 'packages/salon-secretary/evaluation/results/execution-e2e', new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(output, { recursive: true });
  const dump = resolve(output, 'before-fixtures.dump');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/SECRET|TOKEN|API_KEY|SUPABASE|MERCADOPAGO|RESEND|OPENAI|DATABASE_URL|DIRECT_URL|SALON_SECRETARY|VERCEL|NODE_OPTIONS/i.test(key)));
  Object.assign(env, { APP_ENV: 'test', VERCEL_ENV: 'development', DATABASE_URL: runtime, DIRECT_URL: adminUrl,
    MVP_TEST_ADMIN_URL: adminUrl, MVP_TEST_CLUSTER: directory, RUN_SECRETARY_EXECUTION_E2E: '1',
    EXECUTION_E2E_OUTPUT: output, SALON_SECRETARY_ALLOW_PAID_CALLS: 'false', SALON_SECRETARY_JEV_ROUTER_ENABLED: 'false',
    SALON_SECRETARY_MULTI_ACTION_V2_ENABLED: 'false', SALON_SECRETARY_SCHEDULING_OVERLAP_ENABLED: 'false',
    PLATFORM_BILLING_ENABLED: 'false', MERCADOPAGO_BILLING_ENABLED: 'false', EMAIL_INVITES_ENABLED: 'false' });
  const backup = spawnSync(pg + 'pg_dump.exe', ['-h','127.0.0.1','-p','55441','-U','mvp_test_admin','-d','everflair_service_mvp','-Fc','-f',dump], { env, windowsHide: true });
  if (backup.status !== 0) throw Error('BACKUP_FAILED');
  if (spawnSync(pg + 'pg_restore.exe', ['-l', dump], { env, windowsHide: true }).status !== 0) throw Error('BACKUP_INVALID');
  writeFileSync(resolve(output, 'preflight.json'), JSON.stringify({ directory, host: '127.0.0.1', port: 55441,
    database: 'everflair_service_mvp', dump, sha256: createHash('sha256').update(readFileSync(dump)).digest('hex'),
    external_network: 'FORBIDDEN', fixture_only: true }, null, 2));
  const run = spawnSync(process.execPath, [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run',
    'src/lib/__tests__/secretary-execution-e2e.integration.test.ts', '--maxWorkers=1', '--bail=1', '--testTimeout=30000', '--hookTimeout=60000', '--reporter=verbose', '--reporter=json', `--outputFile=${resolve(output, 'vitest.json')}`],
  { cwd: root, env, windowsHide: true, encoding: 'utf8' });
  writeFileSync(resolve(output, 'test.log'), (run.stdout || '') + (run.stderr || ''));
  const finalDump = resolve(output, 'after-battery.dump');
  const finalBackup = spawnSync(pg + 'pg_dump.exe', ['-h','127.0.0.1','-p','55441','-U','mvp_test_admin','-d','everflair_service_mvp','-Fc','-f',finalDump], { env, windowsHide: true });
  if (finalBackup.status === 0 && spawnSync(pg + 'pg_restore.exe', ['-l', finalDump], { env, windowsHide: true }).status === 0)
    writeFileSync(resolve(output, 'after-backup.json'), JSON.stringify({ dump: finalDump, sha256: createHash('sha256').update(readFileSync(finalDump)).digest('hex') }, null, 2));
  if (run.status !== 0) writeFileSync(stopFile, JSON.stringify({ status: 'STOPPED', evidence: output,
    reason: 'Failed execution battery. Preserve fixtures and investigate before any new mutations.',
    release: 'Explicit review of the stop is required; launcher has no bypass flag.' }, null, 2));
  process.stdout.write((run.stdout || '') + (run.stderr || ''));
  console.log('EXECUTION_E2E_EVIDENCE', output);
  process.exitCode = run.status === 0 && finalBackup.status === 0 ? 0 : 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

function decodeDirectory(hex) {
  if(!/^(?:[a-f0-9]{2})+$/i.test(hex))throw Error('INVALID_DIRECTORY_BYTES');
  const bytes=Buffer.from(hex,'hex');
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  catch{return new TextDecoder('windows-1252',{fatal:true}).decode(bytes);}
}
