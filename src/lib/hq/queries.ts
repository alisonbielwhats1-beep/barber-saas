import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/prisma-tenant";
import type { Row } from "./catalog";
import * as repo from "./repository";

export const accountProjection = Prisma.sql`
 SELECT a.*,
 l.id AS "leadId", l.temperature, l.status AS "leadStatus",
 c.id AS "customerId", c.status AS "customerStatus", c.satisfaction,
 (SELECT max("createdAt") FROM hq_activities WHERE "accountId"=a.id AND kind IN ('WhatsApp','Ligação','Reunião','Demonstração','E-mail')) AS "lastContact",
 (SELECT min("dueAt") FROM hq_followups WHERE "accountId"=a.id AND status='Pendente') AS "nextContact",
 (SELECT count(*)::int FROM hq_followups WHERE "accountId"=a.id AND status='Pendente') AS "pendingFollowups",
 (SELECT count(*)::int FROM hq_support_tickets WHERE "customerId"=c.id AND status NOT IN ('Resolvido','Fechado')) AS "tickets",
 (SELECT count(*)::int FROM hq_feature_request_customers WHERE "customerId"=c.id) AS "features",
 (SELECT min("trialEnd") FROM hq_subscriptions WHERE "customerId"=c.id AND status='Teste') AS "trialEnd",
 (SELECT min("nextBillingAt") FROM hq_subscriptions WHERE "customerId"=c.id AND status IN ('Teste','Ativo','Inadimplente')) AS "renewal",
 CASE WHEN c.status='Inadimplente' OR EXISTS (SELECT 1 FROM hq_subscriptions WHERE "customerId"=c.id AND status='Inadimplente') OR EXISTS (SELECT 1 FROM hq_payments p JOIN hq_subscriptions s ON s.id=p."subscriptionId" WHERE s."customerId"=c.id AND p.status='Pendente' AND p."dueDate" < (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date)
 THEN 'Inadimplente' ELSE 'Em dia' END AS "financialStatus",
 (SELECT stage FROM hq_opportunities WHERE "accountId"=a.id ORDER BY "updatedAt" DESC LIMIT 1) AS "stage"
 FROM hq_accounts a LEFT JOIN hq_leads l ON l."accountId"=a.id
 LEFT JOIN hq_customers c ON c."accountId"=a.id
`;

export async function accounts(tx: Tx, params: { kind?: string; q?: string; status?: string; page?: number; city?: string; segment?: string; risk?: string; priority?: string; financial?: string; contact?: string } = {}) {
  const conditions: Prisma.Sql[] = [Prisma.sql`true`];
  if (params.kind === "leads") conditions.push(Prisma.sql`"leadId" IS NOT NULL`);
  if (params.kind === "customers") conditions.push(Prisma.sql`"customerId" IS NOT NULL`);
  if (params.q) conditions.push(Prisma.sql`(name ILIKE ${"%" + params.q.slice(0,200) + "%"} OR business ILIKE ${"%" + params.q.slice(0,200) + "%"} OR email ILIKE ${"%" + params.q.slice(0,200) + "%"})`);
  for (const [param, col] of [["city","city"],["segment","segment"],["risk","risk"],["priority","priority"],["financial","financialStatus"]] as const) if (params[param]) conditions.push(Prisma.sql`${Prisma.raw('"' + col + '"')} = ${params[param]}`);
  if (params.status) conditions.push(Prisma.sql`("customerStatus" = ${params.status} OR "leadStatus" = ${params.status} OR stage = ${params.status} OR temperature = ${params.status})`);
  if (params.contact === "silent") conditions.push(Prisma.sql`("lastContact" IS NULL OR "lastContact" < CURRENT_TIMESTAMP - interval '30 days')`);
  if (params.contact === "recent") conditions.push(Prisma.sql`"lastContact" >= CURRENT_TIMESTAMP - interval '7 days'`);
  if (params.contact === "due") conditions.push(Prisma.sql`"nextContact" < ((CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date + 1) AT TIME ZONE 'America/Sao_Paulo'`);
  if (params.contact === "renewal") conditions.push(Prisma.sql`renewal BETWEEN (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date AND (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date + 7`);
  const where = Prisma.join(conditions, " AND ");
  const page = Math.max(1, Math.min(params.page ?? 1, 100000));
  const rows = await tx.$queryRaw<{data: Row}[]>(Prisma.sql`SELECT to_jsonb(t) data FROM (${accountProjection}) t WHERE ${where} ORDER BY "createdAt" DESC, id LIMIT 51 OFFSET ${(page-1)*50}`);
  return { rows: rows.slice(0,50).map(r=>r.data), hasMore: rows.length > 50 };
}
export async function options(tx: Tx) {
  const [accounts, subscriptions, bugs, features] = await Promise.all([
    tx.$queryRaw<{id:string;label:string;customerId:string|null}[]>`SELECT a.id, a.business || ' · ' || a.name AS label, c.id AS "customerId" FROM hq_accounts a LEFT JOIN hq_customers c ON c."accountId"=a.id ORDER BY a.business`,
    tx.$queryRaw<{id:string;label:string}[]>`SELECT s.id, a.business || ' · ' || s.plan AS label FROM hq_subscriptions s JOIN hq_customers c ON c.id=s."customerId" JOIN hq_accounts a ON a.id=c."accountId" ORDER BY a.business`,
    tx.$queryRaw<{id:string;label:string}[]>`SELECT id, title AS label FROM hq_bugs ORDER BY title`,
    tx.$queryRaw<{id:string;label:string}[]>`SELECT id, title AS label FROM hq_feature_requests ORDER BY title`,
  ]);
  return { accounts, customers: accounts.filter(a=>a.customerId).map(a=>({id:a.customerId!,label:a.label})), subscriptions, bugs, features };
}
export async function pipeline(tx: Tx) {
  const rows = await tx.$queryRaw<{data:Row}[]>(Prisma.sql`SELECT to_jsonb(t) data FROM (
  SELECT o.*, a.business, a.name, l.temperature,
    (SELECT max("createdAt") FROM hq_activities WHERE "accountId"=a.id AND kind IN ('WhatsApp','Ligação','Reunião','Demonstração','E-mail')) AS "lastContact",
    (SELECT min("dueAt") FROM hq_followups WHERE "accountId"=a.id AND status='Pendente') AS "nextContact"
  FROM hq_opportunities o JOIN hq_accounts a ON a.id=o."accountId" LEFT JOIN hq_leads l ON l."accountId"=a.id ORDER BY o."stageChangedAt" DESC) t`);
  return rows.map(r=>r.data);
}
export async function detail(tx: Tx, entity: string, id: string) {
  const record = await repo.find(tx, entity, id);
  const accountId = entity === "accounts" ? id : record.accountId;
  const sections: Record<string,Row[]> = {};
  let account: Row | null = null;
  if (accountId) {
    account = await repo.find(tx,"accounts",String(accountId));
    for (const key of ["leads","customers","activities","followups","opportunities"]) sections[key] = await repo.related(tx,key,"accountId",String(accountId));
    const customer = sections.customers[0];
    if(customer) {
      for(const key of ["subscriptions","tickets","feedbacks","bugCustomers","featureCustomers"]) sections[key]=await repo.related(tx,key,"customerId",customer.id);
      sections.payments = (await Promise.all(sections.subscriptions.map(s=>repo.related(tx,"payments","subscriptionId",s.id)))).flat();
      sections.bugs = await Promise.all(sections.bugCustomers.map(r=>repo.find(tx,"bugs",String(r.bugId))));
      sections.features = await Promise.all(sections.featureCustomers.map(r=>repo.find(tx,"features",String(r.featureId))));
    }
  }
  if(entity==="bugs") sections.bugCustomers=await repo.related(tx,"bugCustomers","bugId",id);
  if(entity==="features") sections.featureCustomers=await repo.related(tx,"featureCustomers","featureId",id);
  if(entity==="subscriptions") sections.payments=await repo.related(tx,"payments","subscriptionId",id);
  return { record, account, sections };
}
export async function dashboard(tx: Tx) {
 const [metrics] = await tx.$queryRaw<Record<string,number>[]>`
 SELECT
 (SELECT count(*)::int FROM hq_leads) AS leads,
 (SELECT count(*)::int FROM hq_leads l WHERE l.status='Aberto' AND EXISTS (SELECT 1 FROM hq_opportunities o WHERE o."accountId"=l."accountId" AND o.stage='Novo Lead')) AS "newLeads",
 (SELECT count(*)::int FROM hq_customers) AS "customersTotal",
 (SELECT count(*)::int FROM hq_leads WHERE temperature='Quente' AND status='Aberto') AS hot,
 (SELECT count(*)::int FROM hq_opportunities WHERE stage NOT IN ('Fechado','Perdido')) AS opportunities,
 (SELECT count(*)::int FROM hq_customers WHERE status='Ativo') AS active,
 (SELECT count(*)::int FROM hq_customers WHERE status='Teste') AS trial,
 (SELECT count(*)::int FROM hq_customers c WHERE status='Inadimplente' OR EXISTS(SELECT 1 FROM hq_subscriptions s JOIN hq_payments p ON p."subscriptionId"=s.id WHERE s."customerId"=c.id AND p.status='Pendente' AND p."dueDate" < (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date)) AS delinquent,
 (SELECT count(*)::int FROM hq_customers WHERE status='Cancelado') AS cancelled,
 (SELECT COALESCE(sum(("amountCents"-"discountCents") / CASE WHEN interval='Anual' THEN 12.0 ELSE 1 END),0)::float8 FROM hq_subscriptions WHERE status IN ('Ativo','Inadimplente')) AS mrr,
 (SELECT COALESCE(sum("amountCents"),0)::float8 FROM hq_payments WHERE status='Pago' AND date_trunc('month',"paidDate")=date_trunc('month',CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')) AS received,
 (SELECT COALESCE(sum("amountCents"),0)::float8 FROM hq_payments WHERE status='Pendente' AND "dueDate" >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date) AS pending,
 (SELECT COALESCE(sum("amountCents"),0)::float8 FROM hq_payments WHERE status='Pendente' AND "dueDate" < (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date) AS overdue,
 (SELECT count(DISTINCT "customerId")::int FROM hq_subscriptions WHERE status IN ('Ativo','Inadimplente') AND "amountCents">"discountCents") AS paying,
 (SELECT count(*)::int FROM hq_followups WHERE status='Pendente' AND ("dueAt" AT TIME ZONE 'America/Sao_Paulo')::date=(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date) AS "followupsToday",
 (SELECT count(*)::int FROM hq_followups WHERE status='Pendente' AND ("dueAt" AT TIME ZONE 'America/Sao_Paulo')::date<(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date) AS "followupsOverdue",
 (SELECT count(*)::int FROM hq_support_tickets WHERE status NOT IN ('Resolvido','Fechado')) AS tickets,
 (SELECT count(*)::int FROM hq_bugs WHERE status NOT IN ('Resolvido','Fechado')) AS bugs,
 (SELECT count(*)::int FROM hq_bugs WHERE priority='Crítica' AND status NOT IN ('Resolvido','Fechado')) AS "criticalBugs",
 (SELECT count(*)::int FROM hq_feature_requests) AS features,
 (SELECT count(*)::int FROM hq_activities WHERE "createdAt" >= CURRENT_TIMESTAMP - interval '7 days') AS activities,
 (SELECT count(*)::int FROM hq_subscriptions WHERE status='Teste' AND "trialEnd"=(CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date + 1) AS "trialsTomorrow"
 `;
 const popular = await tx.$queryRaw<{id:string;title:string;count:number;first:string|null;last:string|null}[]>`SELECT f.id,f.title,count(fc.id)::int AS count,min(fc."createdAt")::text AS first,max(fc."createdAt")::text AS last FROM hq_feature_requests f LEFT JOIN hq_feature_request_customers fc ON fc."featureId"=f.id GROUP BY f.id ORDER BY count(fc.id) DESC,f."createdAt" DESC LIMIT 5`;
 const recent = (await repo.list(tx,"activities")).rows.slice(0,10);
 return {metrics,popular,recent};
}
