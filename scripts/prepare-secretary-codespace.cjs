/** Isolated synthetic fixtures; exact audited Codespace only. Never generic seed. */
const fs = require('node:fs');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const base = '/workspaces/everflair-billing-staging';
const release = base + '/.demo/secretary-release-806223edd36b';
if (process.env.CODESPACE_NAME !== 'glorious-enigma-jjv6v4rvrv49f544r') throw Error('CODESPACE');
const req = createRequire(release + '/package.json');
req('tsx/cjs');
const { PrismaClient } = req('@prisma/client');
const { hash } = req('bcryptjs');
const { localDateTimeToUtc, addCalendarDays, dateKeyInTimeZone } = req(release + '/src/lib/time.ts');
const env = JSON.parse(fs.readFileSync(base + '/.demo/environment.json'));
const url = new URL(env.DATABASE_URL);
if (url.hostname !== '127.0.0.1' || url.port !== '5432' || url.pathname !== '/everflair_billing_staging' || url.username !== 'app_runtime') throw Error('TARGET');
url.username = 'postgres';
url.password = fs.readFileSync('/workspaces/barber-saas/.demo/postgres-password', 'utf8').trim();
const admin = new PrismaClient({ datasources: { db: { url: url.href } } });
const runtime = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
const dir = fs.readFileSync('/tmp/secretary-active-evidence-path', 'utf8');
const reportPath = dir + '/synthetic-fixtures-result.json';
const privatePath = dir + '/synthetic-fixtures-private.json';
const tables = ['Appointment', 'Product', 'Service', 'ClientProfile', 'AuditLog', 'NotificationOutbox'];
async function main() {
  if (fs.existsSync(privatePath) || fs.existsSync(reportPath)) throw Error('ALREADY_PREPARED');
  const backup = JSON.parse(fs.readFileSync(dir + '/backup.json'));
  if (crypto.createHash('sha256').update(fs.readFileSync(dir + '/before.dump.aes')).digest('hex') !== backup.sha256) throw Error('BACKUP');
  if (!JSON.parse(fs.readFileSync(dir + '/post-upgrade.json')).passed) throw Error('POST_UPGRADE');
  const [identity] = await admin.$queryRawUnsafe("SELECT current_database() AS db,current_setting('data_directory') AS directory,(SELECT system_identifier::text FROM pg_control_system()) AS system");
  if (identity.db !== 'everflair_billing_staging' || identity.directory !== '/var/lib/postgresql/data' || identity.system !== '7682424799483236389') throw Error('IDENTITY');
  const [role] = await admin.$queryRawUnsafe("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='app_runtime'");
  if (!role || role.rolsuper || role.rolbypassrls) throw Error('ROLE');
  if (await admin.salon.count()) throw Error('EXPECTED_EMPTY_STAGING');
  const tz = 'America/Sao_Paulo', day = addCalendarDays(dateKeyInTimeZone(new Date(), tz), 1);
  const password = crypto.randomBytes(24).toString('base64url');
  const passwordHash = await hash(password, 10);
  const baseline = {};
  const names = await admin.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  for (const { tablename } of names) baseline[tablename] = await admin.$queryRawUnsafe('SELECT to_jsonb(t)::text AS row FROM public."' + tablename.replaceAll('"', '""') + '" t ORDER BY to_jsonb(t)::text');
  fs.writeFileSync(dir + '/pre-fixtures.json', JSON.stringify(baseline), { mode: 0o600 });
  const fixtures = await admin.$transaction(async tx => {
    const result = [];
    for (const label of ['A', 'B']) {
      const salonId = crypto.randomUUID();
      await tx.$queryRawUnsafe("SELECT set_config('app.current_salon',$1,true)", salonId);
      const owner = await tx.user.create({ data: { name: 'Tatiana ' + label, email: salonId + '@secretary-staging.test', passwordHash, passwordSetAt: new Date() } });
      await tx.salon.create({ data: { id: salonId, slug: 'secretary-staging-' + salonId, name: 'Secretária • Fixture ' + label, accessStatus: 'APPROVED', plan: 'PRO', timezone: tz, currency: 'BRL', minBookingLeadMinutes: 0, bufferMinutes: 0 } });
      await tx.membership.create({ data: { salonId, userId: owner.id, role: 'OWNER' } });
      const other = await tx.user.create({ data: { name: 'Recepção ' + label, email: 'other-' + salonId + '@secretary-staging.test', passwordHash, passwordSetAt: new Date() } });
      await tx.membership.create({ data: { salonId, userId: other.id, role: 'RECEPTIONIST' } });
      const amanda = await tx.clientProfile.create({ data: { salonId, name: 'Amanda Souza', phone: '11900000001' } });
      await tx.clientProfile.create({ data: { salonId, name: 'Fábio Santos', phone: '11900000002' } });
      const service = await tx.service.create({ data: { salonId, name: 'Massagem', priceCents: 10000, durationMin: 30, description: 'Fixture sintética; preservar descrição' } });
      const professional = await tx.professional.create({ data: { salonId, userId: owner.id } });
      await tx.professionalService.create({ data: { professionalId: professional.id, serviceId: service.id } });
      await tx.workingHours.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ salonId, professionalId: professional.id, weekday, startMinutes: 540, endMinutes: 1080 })) });
      const product = await tx.product.create({ data: { salonId, name: 'Shampoo X', stock: 10, minStock: 2, priceCents: 2000 } });
      const startAt = localDateTimeToUtc(day + 'T10:00', tz);
      const appointment = await tx.appointment.create({ data: { salonId, clientId: amanda.id, professionalId: professional.id, serviceId: service.id, startAt, endAt: new Date(+startAt + 1800000), timezone: tz, priceCents: 10000, status: 'CONFIRMED', serviceItems: { create: { serviceId: service.id, position: 0, serviceName: 'Massagem', durationMin: 30, priceCents: 10000 } } } });
      const conflictStart = localDateTimeToUtc(day + 'T12:00', tz);
      await tx.appointment.create({ data: { salonId, clientId: amanda.id, professionalId: professional.id, serviceId: service.id, startAt: conflictStart, endAt: new Date(+conflictStart + 1800000), timezone: tz, priceCents: 10000, status: 'CONFIRMED' } });
      const closureDay = addCalendarDays(day, 1);
      await tx.salonClosure.create({ data: { salonId, startAt: localDateTimeToUtc(closureDay + 'T00:00', tz), endAt: localDateTimeToUtc(addCalendarDays(closureDay, 1) + 'T00:00', tz), reason: 'Fechamento sintético para HARD_BLOCK' } });
      result.push({ label, salonId, userId: owner.id, otherUserId: other.id, email: owner.email, serviceId: service.id, productId: product.id, appointmentId: appointment.id, professionalId: professional.id, day, closureDay });
    }
    // Verify RLS with committed-role semantics before committing any fixture.
    await tx.$executeRawUnsafe('SET LOCAL ROLE app_runtime');
    for (const own of result) {
      await tx.$queryRawUnsafe("SELECT set_config('app.current_salon',$1,true)", own.salonId);
      for (const table of tables) {
        const rows = await tx.$queryRawUnsafe('SELECT "salonId" FROM "' + table + '"');
        if (rows.some(row => row.salonId !== own.salonId)) throw Error('CROSS_TENANT');
        if (!['AuditLog', 'NotificationOutbox'].includes(table) && !rows.length) throw Error('VACUOUS_ISOLATION');
      }
    }
    await tx.$queryRawUnsafe("SELECT set_config('app.current_salon','',true)");
    for (const table of tables) {
      const [row] = await tx.$queryRawUnsafe('SELECT count(*)::int AS visible FROM "' + table + '"');
      if (row.visible !== 0) throw Error('NO_CONTEXT');
    }
    await tx.$executeRawUnsafe('RESET ROLE');
    return result;
  }, { timeout: 30000 });
  // Persist credentials without displaying them or exposing them to the bundle.
  fs.writeFileSync(privatePath, JSON.stringify({ fixtures, password }), { mode: 0o600, flag: 'wx' });
  const noContext = [];
  for (const table of tables) {
    const [row] = await runtime.$queryRawUnsafe('SELECT count(*)::int AS visible FROM "' + table + '"');
    if (row.visible !== 0) throw Error('NO_CONTEXT');
    noContext.push({ table, visible: row.visible });
  }
  const delta = [];
  for (const { tablename } of names) {
    const after = await admin.$queryRawUnsafe('SELECT to_jsonb(t)::text AS row FROM public."' + tablename.replaceAll('"', '""') + '" t ORDER BY to_jsonb(t)::text');
    const set = new Set(after.map(x => x.row));
    if (baseline[tablename].some(x => !set.has(x.row))) throw Error('BASELINE_CHANGED');
    if (after.length !== baseline[tablename].length) delta.push({ table: tablename, inserted: after.length - baseline[tablename].length });
  }
  const allowed = ['User', 'Salon', 'Membership', 'ClientProfile', 'Service', 'Professional', 'ProfessionalService', 'WorkingHours', 'Product', 'Appointment', 'AppointmentService', 'SalonClosure'];
  if (delta.some(x => !allowed.includes(x.table))) throw Error('UNEXPECTED_MUTATION');
  fs.writeFileSync(reportPath, JSON.stringify({ identity, fixtures, delta, noContext, cross_tenant: 'PASS_TWO_DIRECTIONS', baseline_preserved: true, unexpected_mutations: 0, provider_calls: 0, flags: 'OFF' }, null, 2), { mode: 0o600 });
}
main().catch(error => {
  fs.writeFileSync(dir + '/synthetic-fixtures-error.json', JSON.stringify({ failed: true, code: error.code || 'FIXTURE_CHECK_FAILED' }), { mode: 0o600 });
  process.exitCode = 1;
}).finally(() => Promise.all([admin.$disconnect(), runtime.$disconnect()]));
