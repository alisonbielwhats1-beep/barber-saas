import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/prisma-tenant";
import { definition, type Row } from "./catalog";
import { HqError, uuid } from "./validation";

// Somente identificadores da whitelist interna chegam a Prisma.raw.
// Todos os valores, filtros e UUIDs são parâmetros vinculados.
const table = (entity: string) => Prisma.raw('public."' + definition(entity).table + '"');
const column = (entity: string, key: string) => {
  if (!["id", "createdAt", "updatedAt", ...definition(entity).fields.map(f => f.key)].includes(key)) throw new HqError("Campo inválido.");
  return Prisma.raw('"' + key + '"');
};
const value = (entity: string, key: string, v: unknown) => {
  const field = definition(entity).fields.find(f => f.key === key);
  const cast = key === "id" || field?.type === "relation" ? "uuid" : ["date", "month"].includes(field?.type ?? "") ? "date" : field?.type === "datetime" ? "timestamptz" : field?.type === "json" ? "jsonb" : ["money", "number"].includes(field?.type ?? "") ? "integer" : "text";
  return Prisma.sql`${v}::${Prisma.raw(cast)}`;
};
export async function find(tx: Tx, entity: string, id: string, lock = false): Promise<Row> {
  uuid.parse(id);
  const rows = await tx.$queryRaw<{ data: Row }[]>(Prisma.sql`SELECT to_jsonb(t) data FROM ${table(entity)} t WHERE id = ${id}::uuid ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`);
  if (!rows[0]) throw new HqError("Registro não encontrado.");
  return rows[0].data;
}
export async function insert(tx: Tx, entity: string, values: Record<string, unknown>): Promise<Row> {
  const keys = Object.keys(values);
  const result = await tx.$queryRaw<{ data: Row }[]>(Prisma.sql`INSERT INTO ${table(entity)} AS t (${Prisma.join(keys.map(k => column(entity, k)))}) VALUES (${Prisma.join(keys.map(k => value(entity, k, values[k])))}) RETURNING to_jsonb(t) data`);
  return result[0].data;
}
export async function update(tx: Tx, entity: string, id: string, values: Record<string, unknown>): Promise<Row> {
  if (definition(entity).appendOnly) throw new HqError("O histórico é imutável.");
  uuid.parse(id);
  const result = await tx.$queryRaw<{ data: Row }[]>(Prisma.sql`UPDATE ${table(entity)} AS t SET ${Prisma.join(Object.entries(values).map(([k, v]) => Prisma.sql`${column(entity, k)} = ${value(entity, k, v)}`))}, "updatedAt" = CURRENT_TIMESTAMP WHERE id = ${id}::uuid RETURNING to_jsonb(t) data`);
  if (!result[0]) throw new HqError("Registro não encontrado.");
  return result[0].data;
}
export async function related(tx: Tx, entity: string, key: string, id: string): Promise<Row[]> {
  uuid.parse(id);
  const rows = await tx.$queryRaw<{ data: Row }[]>(Prisma.sql`SELECT to_jsonb(t) data FROM ${table(entity)} t WHERE ${column(entity, key)} = ${id}::uuid ORDER BY "createdAt" DESC`);
  return rows.map(r => r.data);
}
export async function list(tx: Tx, entity: string, params: { q?: string; status?: string; page?: number; bucket?: string } = {}) {
  const { q = "", status = "", page = 1 } = params;
  const def = definition(entity);
  const statusKey = def.fields.find(f => f.key === "status" || f.key === "stage")?.key;
  const texts = def.fields.filter(f => ["text","textarea","email","select"].includes(f.type) && !f.readonly);
  const search = q && texts.length ? Prisma.sql`AND (${Prisma.join(texts.map(f => Prisma.sql`t.${column(entity, f.key)} ILIKE ${"%" + q.slice(0, 200) + "%"}`), " OR ")})` : Prisma.empty;
  const filter = status && statusKey ? Prisma.sql`AND ${column(entity, statusKey)} = ${status}` : Prisma.empty;
  const date = Prisma.sql`(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date`;
  const due = entity === "followups" ? Prisma.sql`("dueAt" AT TIME ZONE 'America/Sao_Paulo')::date` : Prisma.sql`"dueDate"`;
  const bucket = ["followups", "payments"].includes(entity) && params.bucket
    ? params.bucket === "overdue" ? Prisma.sql`AND status = 'Pendente' AND ${due} < ${date}`
    : params.bucket === "today" ? Prisma.sql`AND status = 'Pendente' AND ${due} = ${date}`
    : params.bucket === "upcoming" ? Prisma.sql`AND status = 'Pendente' AND ${due} > ${date}` : Prisma.empty
    : Prisma.empty;
  const rows = await tx.$queryRaw<{ data: Row }[]>(Prisma.sql`SELECT to_jsonb(t) data FROM ${table(entity)} t WHERE true ${search} ${filter} ${bucket} ORDER BY "createdAt" DESC, id LIMIT 51 OFFSET ${(Math.max(1, Math.min(page, 100000)) - 1) * 50}`);
  return { rows: rows.slice(0, 50).map(r => r.data), hasMore: rows.length > 50 };
}
