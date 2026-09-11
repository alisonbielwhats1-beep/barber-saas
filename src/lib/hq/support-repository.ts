import "server-only";
import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/prisma-tenant";
import { HqError, uuid } from "./validation";
import { supportDraftSchema, supportReviewSchema, type SupportRun, type SupportReview } from "./support-contract";
import * as records from "./repository";
import { execute } from "./services";

export async function supportContext(tx:Tx,customerId:string) {
 uuid.parse(customerId);
 const [row]=await tx.$queryRaw<{accountId:string;business:string;status:string;tickets:number;activities:number}[]>`SELECT c."accountId",left(a.business,100) AS business,c.status,(SELECT count(*)::int FROM hq_support_tickets t WHERE t."customerId"=c.id) AS tickets,(SELECT count(*)::int FROM hq_activities ac WHERE ac."accountId"=c."accountId") AS activities FROM hq_customers c JOIN hq_accounts a ON a.id=c."accountId" WHERE c.id=${customerId}::uuid`;
 if(!row)throw new HqError("Cliente não encontrado.");
 return row;
}
export async function supportCustomers(tx:Tx,query="") {
 const rows=await tx.$queryRaw<{id:string;business:string}[]>`SELECT c.id,left(a.business,100) AS business FROM hq_customers c JOIN hq_accounts a ON a.id=c."accountId" WHERE a.business ILIKE ${"%"+query.slice(0,100)+"%"} ORDER BY a.business,c.id LIMIT 51`;
 return {customers:rows.slice(0,50),customersLimited:rows.length>50};
}
export async function supportHistory(tx:Tx,customerId:string,cursor?:string) {
 uuid.parse(customerId);if(cursor)uuid.parse(cursor);
 const rows=await tx.$queryRaw<{data:Omit<SupportRun,"draft">}[]>(Prisma.sql`SELECT to_jsonb(t) AS data FROM (
 SELECT r.id,r."actorId",r.question,r.answer,r.status,r."errorCode",r."createdAt",r."finishedAt",r.model,r."promptVersion",r."chargeMicros",r."inputTokens",r."outputTokens",r.sources,
 (SELECT a.metadata FROM hq_activities a WHERE a."accountId"=(SELECT "accountId" FROM hq_customers WHERE id=${customerId}::uuid) AND a."entityType"='support_review' AND a."entityId"=r.id::text ORDER BY a."createdAt" LIMIT 1) AS review
 FROM hq_agent_runs r WHERE r.snapshot->>'kind'='support' AND r.snapshot->>'customerId'=${customerId}
 ${cursor?Prisma.sql`AND (r."createdAt",r.id)<(SELECT "createdAt",id FROM hq_agent_runs WHERE id=${cursor}::uuid AND snapshot->>'customerId'=${customerId})`:Prisma.empty}
 ORDER BY r."createdAt" DESC,r.id DESC LIMIT 31) t`);
 const runs=rows.slice(0,30).map(({data})=>{let draft=null;try{draft=supportDraftSchema.parse(JSON.parse(data.answer??"null"));}catch{/* Legacy/failed output cannot be approved. */}return {...data,draft};});
 return {runs,nextCursor:rows.length>30?runs[29].id:null};
}

export async function reviewSupport(tx:Tx,actorId:string,raw:unknown):Promise<SupportReview> {
 const input=supportReviewSchema.parse(raw);
 // Run lock serializes both replay and target creation; all writes share this transaction.
 const [run]=await tx.$queryRaw<{status:string;snapshot:{kind?:string;customerId?:string;accountId?:string};answer:string|null}[]>`SELECT status,snapshot,answer FROM hq_agent_runs WHERE id=${input.runId}::uuid FOR UPDATE`;
 if(!run||run.snapshot.kind!=="support"||run.snapshot.customerId!==input.customerId)throw new HqError("Rascunho não pertence ao cliente selecionado.");
 const context=await supportContext(tx,input.customerId);
 if(context.accountId!==run.snapshot.accountId)throw new HqError("O vínculo da conta mudou. Gere outro rascunho.");
 const [existing]=await tx.$queryRaw<{metadata:SupportReview}[]>`SELECT metadata FROM hq_activities WHERE "accountId"=${context.accountId}::uuid AND "entityType"='support_review' AND "entityId"=${input.runId} ORDER BY "createdAt" LIMIT 1`;
 if(existing)return existing.metadata;
 if(run.status!=="completed"||!run.answer)throw new HqError("Aguarde um rascunho concluído.");
 supportDraftSchema.parse(JSON.parse(run.answer));
 let targetId:string|null=null,targetType:string|null=null;
 if(input.decision==="ticket") {
  const ticket=await execute(tx,actorId,{type:"save",entity:"tickets",values:{customerId:input.customerId,title:input.title,description:input.text,category:input.category,priority:input.priority,status:"Aberto",resolution:null,owner:null}});
  targetId=ticket.id;targetType="tickets";
 }else if(input.decision==="bug"||input.decision==="feature") {
  if(!input.existingId)throw new HqError("Escolha um item existente após revisar os similares no Produto.");
  targetType=input.decision==="bug"?"bugs":"features";
  await records.find(tx,targetType,input.existingId);
  await execute(tx,actorId,{type:"save",entity:input.decision==="bug"?"bugCustomers":"featureCustomers",values:{customerId:input.customerId,[input.decision==="bug"?"bugId":"featureId"]:input.existingId}});
  targetId=input.existingId;
 }
 const review={decision:input.decision,text:input.text,targetId,targetType};
 await records.insert(tx,"activities",{accountId:context.accountId,kind:"Suporte",description:(input.decision==="discard"?"Rascunho de suporte descartado após revisão.":"Suporte revisado pelo administrador. Nenhuma mensagem enviada.")+"\n"+input.text,actorId,entityType:"support_review",entityId:input.runId,metadata:JSON.stringify({...review,title:input.title,category:input.category,priority:input.priority})});
 return review;
}
