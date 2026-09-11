import "server-only";
import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/prisma-tenant";
import { CHIEF_MODEL, CHIEF_VERSION, CHIEF_RESERVATION_MICROS } from "@everflare/agents/chief";
import { HqError } from "./validation";
import type { ChiefRun, ChiefSource } from "./chief-contract";
const monthStart = Prisma.sql`date_trunc('month',CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;
const projection = Prisma.sql`id,"actorId",question,answer,status,"errorCode","createdAt","finishedAt",model,"promptVersion","chargeMicros","inputTokens","outputTokens",sources`;
export async function chiefReady(tx: Tx) {
 const [r] = await tx.$queryRaw<{ready:boolean}[]>`SELECT to_regclass('public.hq_agent_runs') IS NOT NULL AS ready`;
 return r.ready;
}
export async function committed(tx: Tx) {
 const [row] = await tx.$queryRaw<{amount:number}[]>(Prisma.sql`SELECT COALESCE(sum("chargeMicros"),0)::float8 AS amount FROM hq_agent_runs WHERE "createdAt">=${monthStart}`);
 return row.amount;
}
export async function chiefHistory(tx: Tx, cursor?: string) {
 const rows = await tx.$queryRaw<{data:ChiefRun}[]>(Prisma.sql`SELECT to_jsonb(t) AS data FROM (SELECT ${projection} FROM hq_agent_runs WHERE COALESCE(snapshot->>'kind','chief')='chief' ${cursor ? Prisma.sql`AND ("createdAt",id)<(SELECT "createdAt",id FROM hq_agent_runs WHERE id=${cursor}::uuid)` : Prisma.empty} ORDER BY "createdAt" DESC,id DESC LIMIT 31) t`);
 return {runs:rows.slice(0,30).map(r=>r.data),nextCursor:rows.length>30?rows[29].data.id:null};
}
export async function reserveChief(tx: Tx, input: { id:string; actorId:string; question:string; snapshot:unknown; sources:ChiefSource[]; budgetMicros:number; contextKey?:string; promptVersion?:string }) {
 // Global, incluindo todas as instâncias serverless e administradores.
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(872223,1)`;
 await tx.$executeRaw`UPDATE hq_agent_runs SET status='failed',"errorCode"='interrupted',"finishedAt"=CURRENT_TIMESTAMP WHERE status='running' AND "createdAt"<CURRENT_TIMESTAMP-interval '90 seconds'`;
 const existing = await tx.$queryRaw<{data:ChiefRun;contextKey:string}[]>(Prisma.sql`SELECT to_jsonb(t)-'snapshot' AS data,COALESCE(snapshot->>'requestContext','chief') AS "contextKey" FROM (SELECT ${projection},snapshot FROM hq_agent_runs WHERE id=${input.id}::uuid) t`);
 if (existing[0]) {
  if (existing[0].data.actorId!==input.actorId || existing[0].data.question!==input.question || existing[0].contextKey!==(input.contextKey??"chief")) throw new HqError("Identificador já utilizado em outra solicitação.");
  return {created:false,run:existing[0].data};
 }
 const [limits] = await tx.$queryRaw<{daily:number;active:number}[]>`SELECT (SELECT count(*)::int FROM hq_agent_runs WHERE "createdAt">=date_trunc('day',CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS daily,(SELECT count(*)::int FROM hq_agent_runs WHERE status='running') AS active`;
 if (limits.active) throw new HqError("Já existe uma consulta em andamento. Aguarde e atualize o histórico.");
 if (limits.daily>=20) throw new HqError("Limite de 20 consultas por dia UTC atingido.");
 if (await committed(tx)+CHIEF_RESERVATION_MICROS>input.budgetMicros) throw new HqError("O orçamento mensal não comporta uma nova consulta.");
 const rows = await tx.$queryRaw<{data:ChiefRun}[]>(Prisma.sql`WITH inserted AS (
 INSERT INTO hq_agent_runs (id,"actorId",question,snapshot,sources,status,model,"promptVersion","chargeMicros") VALUES
 (${input.id}::uuid,${input.actorId},${input.question},${JSON.stringify(input.snapshot)}::jsonb,${JSON.stringify(input.sources)}::jsonb,'running',${CHIEF_MODEL},${input.promptVersion??CHIEF_VERSION},${CHIEF_RESERVATION_MICROS}) RETURNING ${projection}) SELECT to_jsonb(t) AS data FROM inserted t`);
 return {created:true,run:rows[0].data};
}
export async function finishChief(tx: Tx,id:string,actorId:string,result: {answer:string;inputTokens:number;outputTokens:number;chargeMicros:number}|null) {
 // Mesma trava da reserva: a reconciliação e a próxima autorização são serializadas.
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(872223,1)`;
 const rows = await tx.$queryRaw<{data:ChiefRun}[]>(Prisma.sql`WITH updated AS (
 UPDATE hq_agent_runs SET status=${result?"completed":"failed"},"finishedAt"=CURRENT_TIMESTAMP,
 answer=${result?.answer??null},"errorCode"=${result?null:"provider_unavailable"},
 "inputTokens"=${result?.inputTokens??null}::int,"outputTokens"=${result?.outputTokens??null}::int,
 "chargeMicros"=${result?.chargeMicros??CHIEF_RESERVATION_MICROS}
 WHERE id=${id}::uuid AND "actorId"=${actorId} AND status='running' RETURNING ${projection}) SELECT to_jsonb(t) AS data FROM updated t`);
 if(!rows[0]) throw new HqError("A execução não pôde ser finalizada. Atualize o histórico; a reserva foi preservada.");
 return rows[0].data;
}
