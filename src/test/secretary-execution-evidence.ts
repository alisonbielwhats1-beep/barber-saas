import { createHash } from 'node:crypto';
import { writeFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma, type PrismaClient } from '@prisma/client';

type Row = Record<string, unknown>;
export type Snapshot = Record<string, Row[]>;
export const digest = (data: unknown) => createHash('sha256').update(JSON.stringify(data)).digest('hex');
export function saveEvidence(name: string, data: unknown) {
  const directory = process.env.EXECUTION_E2E_OUTPUT;
  if (!directory) throw Error('EVIDENCE_DIRECTORY_REQUIRED');
  const descriptor = openSync(join(directory, `${name}.json`), 'w');
  try { writeFileSync(descriptor, JSON.stringify(data, null, 2)); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
}
/** Full independent observer. Never exports legacy rows or credentials, only their hashes. */
export async function snapshotDatabase(admin: PrismaClient): Promise<Snapshot> {
  return admin.$transaction(async tx => {
    const tables = await tx.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
    const result: Snapshot = {};
    for (const { tablename } of tables) {
      // Identifiers originate exclusively in pg_catalog; quote even unexpected names.
      const table = Prisma.raw(`"public"."${tablename.replaceAll('"', '""')}"`);
      const rows = await tx.$queryRaw<{ row: Row }[]>(Prisma.sql`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`);
      result[tablename] = rows.map(item => item.row);
    }
    return result;
  }, { isolationLevel: 'RepeatableRead', timeout: 30000 });
}
export function hashes(snapshot: Snapshot) {
  return Object.fromEntries(Object.entries(snapshot).map(([table, rows]) => [table, { count: rows.length, sha256: digest(rows) }]));
}
type Permission = { updates?: Record<string, Record<string, readonly string[]>>; inserts?: Record<string, number>; deletes?: Record<string, readonly string[]> };
/** Exact row/column allowlist. Any unexpected effect aborts the battery (--bail=1). */
export function assertEffects(before: Snapshot, after: Snapshot, salonId: string, permission: Permission = {}) {
  const effects: { table: string; kind: string; before?: Row; after?: Row; fields?: string[] }[] = [];
  for (const table of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const oldRows = before[table] ?? [], newRows = after[table] ?? [];
    const old = new Map(oldRows.map(row => [digest(row), row]));
    const next = new Map(newRows.map(row => [digest(row), row]));
    const removed = [...old].filter(([key]) => !next.has(key)).map(([,row]) => row);
    const added = [...next].filter(([key]) => !old.has(key)).map(([,row]) => row);
    for (const row of removed) {
      const index = added.findIndex(item => row.id !== undefined && item.id === row.id);
      const updated = index < 0 ? undefined : added.splice(index, 1)[0];
      if (!updated && row.salonId === salonId && permission.deletes?.[table]?.includes(String(row.id))) {
        effects.push({ table, kind: 'DELETE', before: row }); continue;
      }
      const allowed = permission.updates?.[table]?.[String(row.id)];
      if (!updated || !allowed || row.salonId !== salonId || updated.salonId !== salonId) throw Error(`UNEXPECTED_MUTATION:${table}:${row.id}`);
      const fields = [...new Set([...Object.keys(row), ...Object.keys(updated)])].filter(key => JSON.stringify(row[key]) !== JSON.stringify(updated[key]));
      if (fields.some(field => !allowed.includes(field))) throw Error(`UNEXPECTED_FIELDS:${table}:${fields.join(',')}`);
      effects.push({ table, kind: 'UPDATE', before: row, after: updated, fields });
    }
    for (const row of added) {
      if (row.salonId !== salonId || (table !== 'AuditLog' && permission.inserts?.[table] === undefined)) throw Error(`UNEXPECTED_INSERT:${table}`);
      effects.push({ table, kind: 'INSERT', after: row });
    }
    if (table !== 'AuditLog' && added.length !== (permission.inserts?.[table] ?? 0)) throw Error(`UNEXPECTED_INSERT_COUNT:${table}:${added.length}`);
  }
  return effects;
}
