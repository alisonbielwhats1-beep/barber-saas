import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertFreeUseDatabase, disposableDirectoryFromHex } from '../../../packages/salon-secretary/evaluation/free-use-database';

// F4 review fix: the agenda/sealed/free-use identity gate (assertFreeUseDatabase -> disposableDirectoryFromHex) makes the SAME
// raw-byte decision as the shared helper of the Front path (scripts/local-db-identity.cjs). Offline: fake query clients only.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS helper shared with the .cjs launchers
const helper = require('../../../scripts/local-db-identity.cjs') as { assertDisposableDirectoryHex(hex: string): string };
const hex = (text: string, encoding: BufferEncoding = 'utf8') => Buffer.from(text, encoding).toString('hex');
const decide = (f: () => unknown) => { try { f(); return 'ACCEPT'; } catch (e) { return (e as Error).message; } };
const accepted = [
  hex('C:/Users/Usuário/AppData/Local/Temp/everflair-service-mvp-762536beeefa4a74b9c2ab5f1dfc3406/data'),
  hex('C:/Users/Usuário/AppData/Local/Temp/everflair-service-mvp-762536beeefa4a74b9c2ab5f1dfc3406/data', 'latin1'), // cp1252/latin1 bytes of 'á'
  hex('C:/Users/USURIO~2/AppData/Local/Temp/everflair-service-mvp-dumpcheck-20260924-uxbaseline/data'),
  hex('/tmp/EVERFLAIR-SERVICE-MVP-x/DATA'),
];
const refused = [
  hex('C:/pg/everflair-service-mvp-produção/data'), // non-ASCII name
  hex('C:/pg/everflair-service-mvp-old copy/data'), // space
  hex('C:/pg/everflair-service-mvp-' + 'a'.repeat(65) + '/data'), // name over 64 bytes
  hex('C:/Program Files/PostgreSQL/16/data'), hex('C:/pg/everflair-service-mvp-x/data/other'), hex('C:/pg/everflair-service-mvp-/data'),
  hex('C:/pg/everflair-service-mvp-x\uFF0Fdata'), hex('C:\\pg\\everflair-service-mvp-x\\data'), 'not hex', 'abc', '',
];

describe('agenda/sealed identity gate = the F4 byte-strict helper', () => {
  it('accepts exactly what the helper accepts (the real cluster names, UTF-8 or cp1252 bytes of the Windows profile)', () => {
    for (const h of accepted) { expect(decide(() => helper.assertDisposableDirectoryHex(h)), h).toBe('ACCEPT'); expect(decide(() => disposableDirectoryFromHex(h)), h).toBe('ACCEPT'); }
    expect(disposableDirectoryFromHex(accepted[1])).toBe('C:/Users/Usuário/AppData/Local/Temp/everflair-service-mvp-762536beeefa4a74b9c2ab5f1dfc3406/data'); // display only
  });
  it('refuses what the helper refuses: non-ASCII, spaced or over-long names, other suffixes, backslashes, look-alike solidus, non-hex', () => {
    for (const h of refused) { expect(decide(() => helper.assertDisposableDirectoryHex(h)), h).not.toBe('ACCEPT'); expect(decide(() => disposableDirectoryFromHex(h)), h).toBe('FREE_USE_DATABASE_DIRECTORY'); }
  });
  it('the pre-look identity (assertFreeUseDatabase) refuses such a cluster before the role and RLS queries', async () => {
    let runtimeQueries = 0;
    const admin = (directory_hex: string) => ({ $queryRaw: async () => [{ name: 'everflair_service_mvp', host: '127.0.0.1', port: 55441, directory_hex }] }) as never;
    const runtime = { $queryRaw: async (_s: TemplateStringsArray, tables?: string[]) => { runtimeQueries++;
      return tables ? tables.map(relname => ({ relname, relrowsecurity: true, relforcerowsecurity: true })) : [{ name: 'mvp_service_runtime', super: false, bypass: false }]; } } as never;
    for (const h of refused.slice(0, 3)) await expect(assertFreeUseDatabase(admin(h), runtime)).rejects.toThrow('FREE_USE_DATABASE_DIRECTORY');
    expect(runtimeQueries).toBe(0);
    await expect(assertFreeUseDatabase(admin(accepted[1]), runtime)).resolves.toMatchObject({ database: 'everflair_service_mvp', directoryVerified: true, directoryTransport: 'ASCII_HEX' });
  });
  it('the Golden drift check (implementationHashes) covers the helper that now decides the identity', () => {
    const source = readFileSync(join(process.cwd(), 'packages/salon-secretary/evaluation/free-use-runner.ts'), 'utf8');
    const pattern = /if \((\/\^\(\?:run-secretary-free-use[^\n]*?\/)\.test\(name\)/.exec(source)?.[1];
    expect(pattern).toBeDefined();
    const re = new RegExp(pattern!.slice(1, -1));
    for (const name of ['local-db-identity.cjs', 'free-use-database.ts', 'program-spend.ts']) expect(re.test(name), name).toBe(true);
  });
});
