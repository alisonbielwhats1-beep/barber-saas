'use strict';
/* Byte-safe identity of the local disposable PostgreSQL (F4). One helper for .cjs and .ts callers.
 * - The data directory travels as hex: encode(current_setting('data_directory')::bytea,'hex'). No driver ever decodes the
 *   server bytes (a Windows path such as 'Usuário' in the system code page is not UTF-8). A failed text->bytea cast (a
 *   backslash sequence) makes the query fail: refused, never skipped.
 * - The decision is on RAW BYTES: the path must end with the ASCII suffix /everflair-service-mvp-<name>/data (ASCII letters
 *   case-insensitive, <name> = ASCII [A-Za-z0-9._-]{1,64}). Nothing that matches only after a (lossy) decode, a Unicode
 *   normalisation or case folding is accepted.
 * - An expected identity is compared hex to hex (byte equality), never as decoded, lower-cased strings.
 * - Decoding (UTF-8, then windows-1252, both fatal) is for display only.
 * Target: 127.0.0.1:55441/everflair_service_mvp only; runtime role non-superuser, non-bypassrls; FORCE RLS tables. */
const TARGET = Object.freeze({ database: 'everflair_service_mvp', host: '127.0.0.1', port: 55441 });
const IDENTITY_SQL = "SELECT current_database()::text AS name, host(inet_server_addr()) AS host, inet_server_port() AS port, " +
  "encode(current_setting('data_directory')::bytea,'hex') AS directory_hex";
const ROLE_SQL = 'SELECT current_user::text AS name, rolsuper AS super, rolbypassrls AS bypass FROM pg_roles WHERE rolname=current_user';
const RLS_SQL = "SELECT relname::text AS relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1::text[])";
/** The same FORCE RLS set the historical local gate (phase A) checked. */
const RLS_TABLES = Object.freeze(['Salon', 'Membership', 'ClientProfile', 'Service', 'Professional', 'WorkingHours', 'ProfessionalService', 'Appointment', 'AppointmentService',
  'AppointmentEvent', 'AppointmentProduct', 'Payment', 'Product', 'NotificationOutbox', 'AuditLog', 'SalonClosure', 'TimeOff', 'PhysicalResource', 'ResourceBooking']);
const fail = code => { throw Error(code); };

/** Lower-case hex of an even, non-empty length; anything else (non-hex, odd length, not a string) is refused. */
function directoryHex(hex) {
  if (typeof hex !== 'string' || !/^(?:[0-9a-fA-F]{2}){1,4096}$/.test(hex)) fail('LOCAL_DB_DIRECTORY_HEX');
  return hex.toLowerCase();
}
const asciiLower = b => (b >= 0x41 && b <= 0x5a ? b + 0x20 : b);
const nameByte = b => (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || b === 0x2d || b === 0x2e || b === 0x5f;
const PREFIX = Buffer.from('/everflair-service-mvp-', 'ascii'), SUFFIX = Buffer.from('/data', 'ascii');
const matchesAt = (bytes, at, pattern) => at >= 0 && at + pattern.length <= bytes.length && pattern.every((p, i) => asciiLower(bytes[at + i]) === asciiLower(p));
/** Raw-byte suffix check: .../everflair-service-mvp-<ASCII name>/data at the very end. */
function isDisposableDirectoryBytes(bytes) {
  if (!Buffer.isBuffer(bytes)) return false;
  const end = bytes.length - SUFFIX.length;
  if (!matchesAt(bytes, end, [...SUFFIX])) return false;
  let start = end; while (start > 0 && nameByte(bytes[start - 1])) start--; // the last path segment, ASCII name bytes only
  const segment = start - 1; // must be the '/' of '/everflair-service-mvp-'
  if (segment < 0 || bytes[segment] !== 0x2f || !matchesAt(bytes, segment, [...PREFIX])) return false;
  const name = end - (segment + PREFIX.length);
  return name >= 1 && name <= 64;
}
function assertDisposableDirectoryHex(hex) {
  const normal = directoryHex(hex);
  if (!isDisposableDirectoryBytes(Buffer.from(normal, 'hex'))) fail('LOCAL_DB_DIRECTORY_UNSAFE');
  return normal;
}
/** Display only (never a decision): UTF-8 if valid, else windows-1252; both fatal. */
function displayDirectory(hex) {
  const bytes = Buffer.from(directoryHex(hex), 'hex');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* not UTF-8 */ }
  try { return new TextDecoder('windows-1252', { fatal: true }).decode(bytes); } catch { return fail('LOCAL_DB_DIRECTORY_DECODE'); }
}
/** Byte equality of two hex identities (both validated). */
const sameDirectoryHex = (a, b) => directoryHex(a) === directoryHex(b);
/** Target (database, host, port) and disposable directory of one identity row; `expectedHex` (when given) must be byte-equal. */
function assertLocalDbIdentity(row, options) {
  const o = options || {};
  if (!row || typeof row !== 'object' || row.name !== TARGET.database || row.host !== TARGET.host || row.port !== TARGET.port) fail('LOCAL_DB_TARGET');
  const hex = assertDisposableDirectoryHex(row.directory_hex);
  if (o.expectedHex !== undefined && !sameDirectoryHex(hex, o.expectedHex)) fail('LOCAL_DB_IDENTITY_MISMATCH');
  return { database: row.name, host: row.host, port: row.port, directoryHex: hex, directory: displayDirectory(hex), directoryTransport: 'ASCII_HEX' };
}
/** Reads the identity row (read-only). A failing query (e.g. the text->bytea cast) is LOCAL_DB_IDENTITY_QUERY: fail closed. */
async function readLocalDbIdentity(db) {
  let rows;
  try { rows = await db.$queryRawUnsafe(IDENTITY_SQL); } catch { return fail('LOCAL_DB_IDENTITY_QUERY'); }
  if (!Array.isArray(rows) || rows.length !== 1) fail('LOCAL_DB_IDENTITY_QUERY');
  return rows[0];
}
/** The expected cluster of this process: MVP_TEST_CLUSTER_HEX is required (a decoded MVP_TEST_CLUSTER alone is refused). */
function expectedClusterHex(env) {
  const raw = env && env.MVP_TEST_CLUSTER_HEX;
  if (raw === undefined || raw === '') fail('LOCAL_DB_CLUSTER_HEX_MISSING');
  return assertDisposableDirectoryHex(String(raw).trim());
}
/** Full read-only gate: identity (byte-safe, byte-equal to `expectedHex`), runtime role, FORCE RLS. */
async function assertLocalDisposableDatabase(admin, runtime, options) {
  const o = options || {};
  if (!o.expectedHex) fail('LOCAL_DB_CLUSTER_HEX_MISSING');
  const identity = assertLocalDbIdentity(await readLocalDbIdentity(admin), { expectedHex: o.expectedHex });
  let role, flags;
  try { [role] = await runtime.$queryRawUnsafe(ROLE_SQL); } catch { return fail('LOCAL_DB_RUNTIME_ROLE'); }
  if (!role || role.name !== 'mvp_service_runtime' || role.super !== false || role.bypass !== false) fail('LOCAL_DB_RUNTIME_ROLE');
  try { flags = await runtime.$queryRawUnsafe(RLS_SQL, [...RLS_TABLES]); } catch { return fail('LOCAL_DB_RLS_FORCE'); }
  if (!Array.isArray(flags) || flags.length !== RLS_TABLES.length || flags.some(r => !r.relrowsecurity || !r.relforcerowsecurity)) fail('LOCAL_DB_RLS_FORCE');
  return { host: identity.host, port: identity.port, database: identity.database, runtime_role: role.name, rls_force_tables: flags.length, directoryVerified: true,
    directoryTransport: identity.directoryTransport };
}
module.exports = { TARGET, IDENTITY_SQL, RLS_TABLES, directoryHex, isDisposableDirectoryBytes, assertDisposableDirectoryHex, displayDirectory, sameDirectoryHex, assertLocalDbIdentity,
  readLocalDbIdentity, expectedClusterHex, assertLocalDisposableDatabase };
