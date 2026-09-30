import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// F4: byte-safe identity of the local disposable database. Offline: fake Prisma clients only (no database, no network).
const require = createRequire(import.meta.url);
type Row = { name: string; host: string; port: number; directory_hex: string };
const id = require('../../../scripts/local-db-identity.cjs') as {
  directoryHex(hex: unknown): string; isDisposableDirectoryBytes(b: Buffer): boolean; assertDisposableDirectoryHex(hex: unknown): string; displayDirectory(hex: string): string;
  sameDirectoryHex(a: string, b: string): boolean; assertLocalDbIdentity(row: unknown, o?: { expectedHex?: string }): { directoryHex: string; directory: string; port: number };
  readLocalDbIdentity(db: unknown): Promise<Row>; expectedClusterHex(env: Record<string, string | undefined>): string;
  assertLocalDisposableDatabase(admin: unknown, runtime: unknown, o?: { expectedHex?: string }): Promise<Record<string, unknown>>; RLS_TABLES: readonly string[];
};
const front = require('../../../scripts/run-secretary-front.cjs') as { frontDatabaseIdentity(db: unknown): Promise<{ directoryHex: string; directory: string }> };
const PATH = 'C:/Users/Usuário/AppData/Local/Temp/everflair-service-mvp-7f3a/data';
const hexOf = (text: string, encoding: 'latin1' | 'utf8') => Buffer.from(text, encoding).toString('hex');
const cp1252 = hexOf(PATH, 'latin1'); // 'á' = 0xE1 in both windows-1252 and latin1
const utf8 = hexOf(PATH, 'utf8');
const row = (over: Partial<Row> = {}): Row => ({ name: 'everflair_service_mvp', host: '127.0.0.1', port: 55441, directory_hex: cp1252, ...over });
const admin = (r: Row | Error) => ({ $queryRawUnsafe: async () => { if (r instanceof Error) throw r; return [r]; } });
const runtime = (role: Record<string, unknown>, flags: { relrowsecurity: boolean; relforcerowsecurity: boolean }[] = id.RLS_TABLES.map(() => ({ relrowsecurity: true, relforcerowsecurity: true }))) =>
  ({ $queryRawUnsafe: async (sql: string) => sql.includes('pg_roles') ? [role] : flags.map((f, i) => ({ relname: id.RLS_TABLES[i], ...f })) });
const RUNTIME_OK = { name: 'mvp_service_runtime', super: false, bypass: false };
const refused = async (p: Promise<unknown> | (() => unknown)) => { try { await (typeof p === 'function' ? p() : p); } catch (e) { return (e as Error).message; } return 'ACCEPTED'; };

describe('F4 local database identity on raw bytes', () => {
  it("accepts the 'Usuário' path in windows-1252, latin1 and UTF-8 bytes, and only displays it decoded", () => {
    expect(cp1252).toContain('e1'); expect(utf8).toContain('c3a1');
    for (const hex of [cp1252, utf8, cp1252.toUpperCase()]) {
      expect(id.assertDisposableDirectoryHex(hex)).toBe(hex.toLowerCase());
      expect(id.displayDirectory(hex)).toBe(PATH);
      expect(id.assertLocalDbIdentity(row({ directory_hex: hex }))).toMatchObject({ directoryHex: hex.toLowerCase(), directory: PATH, port: 55441 });
    }
    // Byte equality: the same path in two encodings is two identities (never compared as decoded, lower-cased strings).
    expect(id.sameDirectoryHex(cp1252, cp1252.toUpperCase())).toBe(true); expect(id.sameDirectoryHex(cp1252, utf8)).toBe(false);
  });
  it('refuses a production-like data directory, backslash separators, a missing name and non-ASCII look-alikes', async () => {
    for (const path of ['C:/Program Files/PostgreSQL/16/data', 'C:\\Temp\\everflair-service-mvp-x\\data', 'C:/Temp/everflair-service-mvp-/data', 'C:/Temp/everflair-service-mvp-x/data/',
      'everflair-service-mvp-x/data', 'C:/Temp/everflair-service-mvp-x/data/../other/data', 'C:/Temp/xeverflair-service-mvp-x/data', `C:/Temp/everflair-service-mvp-${'a'.repeat(65)}/data`])
      expect(await refused(() => id.assertDisposableDirectoryHex(hexOf(path, 'utf8'))), path).toBe('LOCAL_DB_DIRECTORY_UNSAFE');
    expect(id.assertDisposableDirectoryHex(hexOf('C:/Temp/EVERFLAIR-SERVICE-MVP-X.1_b/DATA', 'utf8'))).toBeTruthy(); // ASCII case-insensitive, as before
  });
  it('refuses a match that exists only after a lossy decode, a Unicode normalisation or case folding', async () => {
    const legacyRegex = /\/everflair-service-mvp-[^/]+\/data$/i;
    const overlongSlash = Buffer.concat([Buffer.from('C:/Temp/everflair-service-mvp-x'), Buffer.from([0xc0, 0xaf]), Buffer.from('data')]); // overlong UTF-8 '/'
    const cases = [hexOf('C:/Temp/everflair-service-mvp-x/ＤＡＴＡ', 'utf8'), hexOf('C:/Temp/everflair-service-mvp-x／data', 'utf8'), hexOf('C:/Temp/everflair-ſervice-mvp-x/data', 'utf8'),
      hexOf('C:/Temp/everflair-service-mvp-\u212A/data', 'utf8'), overlongSlash.toString('hex')];
    for (const hex of cases) expect(await refused(() => id.assertDisposableDirectoryHex(hex)), hex).toBe('LOCAL_DB_DIRECTORY_UNSAFE');
    // Proof that the refusal is on bytes: a normalising decode would have matched the historical text regex.
    expect(legacyRegex.test(id.displayDirectory(cases[0]).normalize('NFKC'))).toBe(true);
    expect(legacyRegex.test(new TextDecoder('utf-8').decode(Buffer.from(cases[2], 'hex')).normalize('NFKC'))).toBe(true);
  });
  it('refuses non-hex input', async () => {
    for (const bad of ['', 'zz', 'abc', '0x41', ' 41', 12, undefined, null, 'g'.repeat(8)]) expect(await refused(() => id.directoryHex(bad)), String(bad)).toBe('LOCAL_DB_DIRECTORY_HEX');
    expect(await refused(() => id.assertLocalDbIdentity(row({ directory_hex: 'not-hex' })))).toBe('LOCAL_DB_DIRECTORY_HEX');
  });
  it('refuses another cluster with the same suffix (byte mismatch) and an environment without MVP_TEST_CLUSTER_HEX', async () => {
    const other = hexOf('D:/scratch/everflair-service-mvp-7f3a/data', 'utf8');
    expect(await refused(() => id.assertLocalDbIdentity(row(), { expectedHex: other }))).toBe('LOCAL_DB_IDENTITY_MISMATCH');
    expect(await refused(() => id.assertLocalDbIdentity(row(), { expectedHex: utf8 }))).toBe('LOCAL_DB_IDENTITY_MISMATCH'); // same text, other bytes
    expect(id.assertLocalDbIdentity(row(), { expectedHex: cp1252.toUpperCase() }).directoryHex).toBe(cp1252);
    expect(await refused(() => id.expectedClusterHex({ MVP_TEST_CLUSTER: PATH }))).toBe('LOCAL_DB_CLUSTER_HEX_MISSING');
    expect(await refused(() => id.expectedClusterHex({ MVP_TEST_CLUSTER_HEX: hexOf('C:/Program Files/PostgreSQL/16/data', 'utf8') }))).toBe('LOCAL_DB_DIRECTORY_UNSAFE');
    expect(id.expectedClusterHex({ MVP_TEST_CLUSTER_HEX: cp1252 })).toBe(cp1252);
    expect(await refused(id.assertLocalDisposableDatabase(admin(row()), runtime(RUNTIME_OK), {}))).toBe('LOCAL_DB_CLUSTER_HEX_MISSING');
  });
  it('fails closed on a failed text->bytea cast, another host, port or database', async () => {
    expect(await refused(id.readLocalDbIdentity(admin(Error('invalid input syntax for type bytea'))))).toBe('LOCAL_DB_IDENTITY_QUERY');
    expect(await refused(id.readLocalDbIdentity({ $queryRawUnsafe: async () => [] }))).toBe('LOCAL_DB_IDENTITY_QUERY');
    for (const over of [{ host: '10.0.0.5' }, { port: 5432 }, { name: 'postgres' }, { port: '55441' as unknown as number }])
      expect(await refused(() => id.assertLocalDbIdentity(row(over))), JSON.stringify(over)).toBe('LOCAL_DB_TARGET');
  });
  it('the full gate: byte-equal identity, non-superuser non-bypassrls runtime role, every FORCE RLS table', async () => {
    const ok = await id.assertLocalDisposableDatabase(admin(row()), runtime(RUNTIME_OK), { expectedHex: cp1252 });
    expect(ok).toEqual({ host: '127.0.0.1', port: 55441, database: 'everflair_service_mvp', runtime_role: 'mvp_service_runtime', rls_force_tables: 19, directoryVerified: true, directoryTransport: 'ASCII_HEX' });
    expect(await refused(id.assertLocalDisposableDatabase(admin(row()), runtime({ ...RUNTIME_OK, bypass: true }), { expectedHex: cp1252 }))).toBe('LOCAL_DB_RUNTIME_ROLE');
    expect(await refused(id.assertLocalDisposableDatabase(admin(row()), runtime({ ...RUNTIME_OK, super: true }), { expectedHex: cp1252 }))).toBe('LOCAL_DB_RUNTIME_ROLE');
    expect(await refused(id.assertLocalDisposableDatabase(admin(row()), runtime({ ...RUNTIME_OK, name: 'mvp_test_admin' }), { expectedHex: cp1252 }))).toBe('LOCAL_DB_RUNTIME_ROLE');
    const weak = id.RLS_TABLES.map((_, i) => ({ relrowsecurity: true, relforcerowsecurity: i !== 3 }));
    expect(await refused(id.assertLocalDisposableDatabase(admin(row()), runtime(RUNTIME_OK, weak), { expectedHex: cp1252 }))).toBe('LOCAL_DB_RLS_FORCE');
    expect(await refused(id.assertLocalDisposableDatabase(admin(row()), runtime(RUNTIME_OK, weak.slice(1)), { expectedHex: cp1252 }))).toBe('LOCAL_DB_RLS_FORCE');
  });
  it('run-secretary-front.cjs decides on the hex identity (it can no longer fail on a non-UTF-8 path) and exports it', async () => {
    expect(await front.frontDatabaseIdentity(admin(row()))).toMatchObject({ directoryHex: cp1252, directory: PATH });
    expect(await refused(front.frontDatabaseIdentity(admin(row({ directory_hex: hexOf('C:/Program Files/PostgreSQL/16/data', 'utf8') }))))).toBe('LOCAL_DB_DIRECTORY_UNSAFE');
    expect(await refused(front.frontDatabaseIdentity(admin(Error('decode'))))).toBe('LOCAL_DB_IDENTITY_QUERY');
    const source = readFileSync('scripts/run-secretary-front.cjs', 'utf8');
    expect(source).toContain("require('./local-db-identity.cjs')"); expect(source).toMatch(/MVP_TEST_CLUSTER_HEX:identity\.directoryHex/); expect(source).toContain('--preflight-only');
    expect(source).not.toMatch(/current_setting\('data_directory'\)/);
    const fixture = readFileSync('scripts/prepare-secretary-front-fixture.ts', 'utf8');
    expect(fixture).not.toContain('hard-conversations-phase-a-db'); expect(fixture).toMatch(/assertLocalDisposableDatabase\(admin,runtime,\{expectedHex:expectedClusterHex\(process\.env\)\}\)/);
  });
});

describe('F4 repo guard: the data directory GUC is read as bytes', () => {
  /** Historical callers left as they are (frozen evidence or out of this change); each is listed with its reason. */
  const ALLOWLIST: Record<string, string> = {
    'packages/salon-secretary/evaluation/hard-conversations-phase-a-db.ts': 'PRISTINE (pinned by the front, t21 and x94 manifests); the front fixture no longer calls it',
    'scripts/gpt6-luna-v2-fixtures.ts': 'historical GPT-6 Luna v2 fixture tool',
    'scripts/prepare-secretary-codespace.cjs': 'Codespace (Linux, UTF-8 paths) bootstrap',
    'scripts/restore-secretary-front-local-baseline.cjs': 'historical front baseline restore',
    'scripts/secretary-front-final-closure.ts': 'historical front closure record',
  };
  const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (['node_modules', 'results', '.git'].includes(name)) return [];
    return statSync(path).isDirectory() ? walk(path) : /\.(?:ts|tsx|cjs|mjs|js)$/.test(name) ? [relative(process.cwd(), path).replaceAll('\\', '/')] : [];
  });
  it("finds no current_setting('data_directory') without ::bytea outside the allowlist", () => {
    const offenders = [...walk('scripts'), ...walk('packages/salon-secretary/evaluation')].filter(file => {
      const text = readFileSync(file, 'utf8');
      return [...text.matchAll(/current_setting\(\s*\\?['"]data_directory\\?['"]\s*\)(\s*::\s*bytea)?/g)].some(m => !m[1]);
    });
    expect(offenders.filter(f => !Object.hasOwn(ALLOWLIST, f))).toEqual([]);
    expect(offenders.sort()).toEqual(Object.keys(ALLOWLIST).sort()); // a fixed allowlist entry is removed, never left stale
  });
});
