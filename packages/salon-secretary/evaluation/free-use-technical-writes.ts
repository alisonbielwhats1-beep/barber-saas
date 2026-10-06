/** D1 × Golden write-guard (documented allowlist). The Golden never confirms and forbids every operational write. With
 * SALON_SECRETARY_PERSISTED_STATE on, the Secretary itself writes its conversation state (027_secretary_state) through raw
 * SQL on every call: ONLY those technical tables are allowed, and every other raw write is refused like an operational
 * model write. They never enter the operational-effects snapshot (snapshotPhaseACase hashes a fixed list of business tables)
 * and are reported apart (`technicalStateWrites`). With the flag off nothing changes: raw SQL is not inspected, exactly as
 * before. SecretaryNameAlias is NOT allowlisted: aliases are written only on the owner's click, which the Golden never does.
 * Pure (no I/O). */
import { persistedStateEnabled } from '../../../src/lib/secretary-session-store';
import { nameAliasesEnabled } from '../../../src/lib/secretary-name-aliases';

export const PERSISTED_STATE_TABLES = ['SecretaryConversation', 'SecretaryConversationEvent'] as const;
/** Tables the runners' DB gate must find with FORCE RLS in addition to the historical list, per flag. */
export function flaggedRlsTables(env: Record<string, string | undefined> = process.env): string[] {
  return [...(persistedStateEnabled(env) ? PERSISTED_STATE_TABLES : []), ...(nameAliasesEnabled(env) ? ['SecretaryNameAlias'] : [])];
}
/** The raw-query allowlist of the Golden write-guard: empty (raw SQL not inspected) with the flag off. */
export function technicalWriteTables(env: Record<string, string | undefined> = process.env): readonly string[] {
  return persistedStateEnabled(env) ? PERSISTED_STATE_TABLES : [];
}

/** The SQL text of a raw query as Prisma middleware sees it: a tagged template ([strings, ...values]), a Prisma.Sql object
 * or an unsafe string. Undefined when it cannot be read (the guard then refuses it). */
export function rawSqlText(args: unknown): string | undefined {
  const first = Array.isArray(args) ? args[0] : args;
  if (typeof first === 'string') return first;
  if (Array.isArray(first) && first.every(part => typeof part === 'string')) return first.join(' $ ');
  if (first && typeof first === 'object') {
    const sql = first as { strings?: unknown; sql?: unknown; text?: unknown };
    if (Array.isArray(sql.strings) && sql.strings.every(part => typeof part === 'string')) return sql.strings.join(' $ ');
    if (typeof sql.sql === 'string') return sql.sql;
    if (typeof sql.text === 'string') return sql.text;
  }
  return undefined;
}
const strip = (sql: string) => sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/'(?:[^']|'')*'/g, "''");
const table = String.raw`(?:"?public"?\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?`;
/** Tables a raw statement writes: [] for a read. 'UNKNOWN' when it writes something this reader cannot name (DDL, grants,
 * TRUNCATE, COPY, MERGE, or a write verb whose target is not a plain table name). "FOR UPDATE" locks and "ON CONFLICT … DO
 * UPDATE" (the INSERT's own table) are not separate writes. */
export function rawWriteTargets(sql: string): string[] | 'UNKNOWN' {
  const text = strip(sql);
  // Statements other than SELECT/WITH/INSERT/UPDATE/DELETE (DDL, grants, DO blocks, procedures…) are never "technical".
  if (/(?:^|[;(])\s*(?:CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|COPY|MERGE|VACUUM|REINDEX|CLUSTER|COMMENT|SECURITY|LOCK|REFRESH|DO|CALL|EXECUTE)\b/i.test(text) ||
    /\b(?:TRUNCATE|MERGE\s+INTO)\b/i.test(text)) return 'UNKNOWN';
  const targets: string[] = [];
  let verbs = 0;
  for (const [pattern, verb] of [[String.raw`\bINSERT\s+INTO\s+${table}`, /\bINSERT\b/gi], [String.raw`\bDELETE\s+FROM\s+${table}`, /\bDELETE\b/gi],
    [String.raw`\bUPDATE\s+${table}\s+(?:AS\s+\w+\s+|\w+\s+)?SET\b`, /(?<!\bFOR\s+(?:NO\s+KEY\s+)?)(?<!\bDO\s+)\bUPDATE\b/gi]] as const) {
    const found = [...text.matchAll(new RegExp(pattern, 'gi'))].map(match => match[1]);
    const count = (text.match(verb) ?? []).length;
    if (found.length !== count) return 'UNKNOWN';
    verbs += count; targets.push(...found);
  }
  return verbs ? [...new Set(targets)] : [];
}
/** READ: no write; TECHNICAL: writes only allowlisted tables; FORBIDDEN: anything else (unreadable SQL included). */
export function rawWriteVerdict(args: unknown, allowed: readonly string[]): 'READ' | 'TECHNICAL' | 'FORBIDDEN' {
  const sql = rawSqlText(args);
  if (sql === undefined) return 'FORBIDDEN';
  const targets = rawWriteTargets(sql);
  if (targets === 'UNKNOWN') return 'FORBIDDEN';
  if (!targets.length) return 'READ';
  return targets.every(name => allowed.includes(name)) ? 'TECHNICAL' : 'FORBIDDEN';
}
