import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

if (!process.env.CODESPACES && process.env.DEMO_ALLOW_LOCAL !== '1') throw new Error('Use somente o Codespace de demonstração.');
if (existsSync('.demo/ready')) { console.log('Demonstração já preparada; os dados foram preservados.'); process.exit(0); }
const secret = () => randomBytes(24).toString('hex');
const dbPassword = readFileSync('.demo/postgres-password', 'utf8').trim();
if (!/^[a-f0-9]{64}$/.test(dbPassword)) throw new Error('Segredo local inválido.');
const adminUrl = 'postgresql://postgres:' + dbPassword + '@127.0.0.1:5432/everflair_demo';
const credentials = existsSync('.demo/credentials.json') ? JSON.parse(readFileSync('.demo/credentials.json', 'utf8')) : {
  owner: {email:'demo@everflair.example', password:secret()},
  reception: {email:'recepcao@everflair.example', password:secret()},
  professional: {email:'profissional@everflair.example', password:secret()},
  client: {email:'cliente@everflair.example', password:secret()},
  runtimePassword:secret(), authSecret:secret()
};
if (!/^[a-f0-9]{48}$/.test(credentials.runtimePassword)) throw new Error('Credencial runtime inválida.');
writeFileSync('.demo/credentials.json', JSON.stringify(credentials, null, 2), {mode:0o600});
const base = Object.fromEntries(['PATH','HOME','USER','SHELL','LANG','TMPDIR'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
const env = {...base, APP_ENV:'development', DATABASE_URL:adminUrl, DIRECT_URL:adminUrl, TZ:'America/Sao_Paulo', NEXT_TELEMETRY_DISABLED:'1'};
function run(args, input) {
  const r = spawnSync('npx', args, {env, input, stdio:input ? ['pipe','inherit','inherit'] : 'inherit', encoding:'utf8'});
  if (r.status !== 0) throw new Error('Preparação interrompida. Consulte a etapa acima; o banco é exclusivo da demo.');
}
run(['prisma','generate']);
// Existing schema only; no production migrations or credentials are involved.
run(['tsx','scripts/assert-safe-database.ts','--operation=demo:bootstrap']);
run(['prisma','db','push','--skip-generate']);
run(['prisma','db','execute','--stdin'], 'CREATE SCHEMA IF NOT EXISTS demo_meta; CREATE TABLE IF NOT EXISTS demo_meta.identity (id integer primary key CHECK(id=1), name text NOT NULL); INSERT INTO demo_meta.identity VALUES (1, \'everflair-synthetic-only\') ON CONFLICT DO NOTHING;');
const roleSql = "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_runtime') THEN CREATE ROLE app_runtime LOGIN PASSWORD '" + credentials.runtimePassword + "' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; END IF; END $$;";
run(['prisma','db','execute','--stdin'], roleSql);
// These repository SQL files create the same domain constraints and policies on a fresh, local database.
for (const file of [
  'prisma/sql/rls/01_enable_rls.sql',
  'prisma/sql/manual/008_fase2_appointment_reliability.sql',
  'prisma/sql/manual/009_waitlist_reliability.sql',
  'prisma/sql/manual/010_platform_access_approval.sql',
  'prisma/sql/manual/012_appointment_product_tenant_snapshots.sql',
  'prisma/sql/manual/013_operational_query_indexes.sql',
  'prisma/sql/manual/014_client_identity_resolution.sql',
  'prisma/sql/manual/015_client_reviews.sql',
  'prisma/sql/manual/016_booking_experience.sql',
  'prisma/sql/manual/017_password_recovery.sql'
]) {
  const preflight=file.replace(/\.sql$/,'.preflight.sql');
  if(existsSync(preflight)) run(['prisma','db','execute','--file',preflight]);
  run(['prisma','db','execute','--file',file]);
}
run(['prisma','db','execute','--stdin'], 'GRANT CONNECT ON DATABASE everflair_demo TO app_runtime; GRANT USAGE ON SCHEMA public TO app_runtime; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO app_runtime; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime; REVOKE UPDATE,DELETE ON "AuditLog", "AppointmentEvent", "SalonAccessEvent" FROM app_runtime;');
run(['tsx','.devcontainer/seed-demo.ts']);
const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev';
const origin = process.env.CODESPACE_NAME ? 'https://' + process.env.CODESPACE_NAME + '-3000.' + domain : 'http://localhost:3000';
const runtimeUrl = 'postgresql://app_runtime:' + credentials.runtimePassword + '@127.0.0.1:5432/everflair_demo';
writeFileSync('.demo/environment.json', JSON.stringify({DATABASE_URL:runtimeUrl,DIRECT_URL:runtimeUrl,NEXTAUTH_SECRET:credentials.authSecret,
  NEXTAUTH_URL:origin,NEXTAUTH_URL_INTERNAL:'http://127.0.0.1:3000',UPSTASH_REDIS_REST_URL:'http://redis-http:80',
  UPSTASH_REDIS_REST_TOKEN:readFileSync('.demo/redis-token','utf8').trim(),CRON_SECRET:secret()}), {mode:0o600});
const {demoEnvironment} = await import('./environment.mjs');
const build = spawnSync('npm',['run','build'],{env:demoEnvironment(),stdio:'inherit'});
if(build.status !== 0) throw new Error('O build da demonstração falhou.');
writeFileSync('.demo/ready',new Date().toISOString(),{mode:0o600});
console.log('Demonstração preparada em ' + origin + '. Credenciais privadas: .demo/credentials.json.');
