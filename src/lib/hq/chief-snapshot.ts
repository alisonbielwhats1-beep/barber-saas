import "server-only";
import type { Tx } from "@/lib/prisma-tenant";
import { dashboardMetrics } from "./queries";
import type { ChiefSource } from "./chief-contract";

export const chiefSources: ChiefSource[] = [
 {label:"CMM",href:"/hq/cmm"}, {label:"Follow-ups",href:"/hq/followups"},
 {label:"Suporte",href:"/hq/support"}, {label:"Financeiro",href:"/hq/finance"},
];
export async function chiefSnapshot(tx: Tx) {
 const metrics = await dashboardMetrics(tx);
 const attention = await tx.$queryRaw<{data:Record<string,unknown>}[]>`
 WITH accounts AS (
 SELECT c.id, left(a.business,100) AS business,c.status,a.risk,a.priority,
 (SELECT count(*)::int FROM hq_followups f WHERE f."accountId"=a.id AND f.status='Pendente' AND f."dueAt"<CURRENT_TIMESTAMP) AS "pendingContacts",
 (SELECT count(*)::int FROM hq_support_tickets t WHERE t."customerId"=c.id AND t.status NOT IN ('Resolvido','Fechado')) AS tickets,
 EXISTS(SELECT 1 FROM hq_subscriptions s JOIN hq_payments p ON p."subscriptionId"=s.id WHERE s."customerId"=c.id AND p.status='Pendente' AND p."dueDate"<(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date) AS "overduePayment",
 EXISTS(SELECT 1 FROM hq_subscriptions s WHERE s."customerId"=c.id AND s.status='Inadimplente') AS "delinquentSubscription",
 EXISTS(SELECT 1 FROM hq_subscriptions s WHERE s."customerId"=c.id AND s.status='Teste' AND s."trialEnd"<=(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date+1) AS "trialEnding"
 FROM hq_customers c JOIN hq_accounts a ON a.id=c."accountId")
 SELECT to_jsonb(t) AS data FROM (SELECT *,count(*) OVER()::int AS total FROM accounts WHERE status='Inadimplente' OR risk='Alto' OR "pendingContacts">0 OR tickets>0 OR "overduePayment" OR "delinquentSubscription" OR "trialEnding" ORDER BY "overduePayment" DESC,tickets DESC,id LIMIT 10) t`;
 const followups = await tx.$queryRaw<{data:Record<string,unknown>}[]>`
 SELECT to_jsonb(t) AS data FROM (SELECT f.id,left(a.business,100) AS business,f."dueAt",count(*) OVER()::int AS total FROM hq_followups f JOIN hq_accounts a ON a.id=f."accountId" WHERE f.status='Pendente' AND (f."dueAt" AT TIME ZONE 'America/Sao_Paulo')::date<(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date ORDER BY f."dueAt",f.id LIMIT 10) t`;
 const tickets = await tx.$queryRaw<{data:Record<string,unknown>}[]>`
 SELECT to_jsonb(t) AS data FROM (SELECT t.id,left(a.business,100) AS business,t.category,t.priority,t.status,t."createdAt",count(*) OVER()::int AS total FROM hq_support_tickets t JOIN hq_customers c ON c.id=t."customerId" JOIN hq_accounts a ON a.id=c."accountId" WHERE t.status NOT IN ('Resolvido','Fechado') ORDER BY CASE t.priority WHEN 'Crítica' THEN 0 WHEN 'Alta' THEN 1 ELSE 2 END,t."createdAt",t.id LIMIT 10) t`;
 const [coverage] = await tx.$queryRaw<{subscriptions:number;payments:number}[]>`SELECT (SELECT count(*)::int FROM hq_subscriptions) AS subscriptions,(SELECT count(*)::int FROM hq_payments) AS payments`;
 const list = (rows: {data:Record<string,unknown>}[]) => ({total:Number(rows[0]?.data.total??0),items:rows.map(({data})=>{const {total: _total,...item}=data;return item;}),limited:Number(rows[0]?.data.total??0)>10});
 return {
  generatedAt: new Date().toISOString(), timezone:"America/Sao_Paulo", currency:"BRL",
  caveats:["Somente cadastros do HQ; sem telemetria de uso do produto.","Listas de até 10 registros. Não são listas completas se limited=true.","Financeiro reflete somente assinaturas e pagamentos registrados; valores em centavos."],
  metrics, attention:list(attention), overdueFollowups:list(followups), openTickets:list(tickets), financialCoverage:coverage,
 };
}

