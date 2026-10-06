import { clarificationContext } from "./secretary-clarification";
import { performance } from "node:perf_hooks";
import { Prisma } from "@prisma/client";
import { financialInterpretation, financialRequirements, runServicesTurn, type FinancialInterpretation, type Model } from "@everflair/salon-secretary";
import { FINANCIAL_ROLES } from "./role-permissions";
import { withTenant, type Tx } from "./prisma-tenant";
import type { ServiceActor } from "./service-catalog";
import { resolveFinanceCalendar } from "./finance-period";
import { addCalendarDays, dateKeyInTimeZone } from "./time";

export async function assertFinancialAccess(tx: Tx, actor: ServiceActor) {
  const salons = await tx.$queryRaw<{accessStatus: string; timezone: string; currency: string}[]>`SELECT "accessStatus",timezone,currency FROM "Salon" WHERE id=${actor.salonId} FOR SHARE`;
  const members = await tx.$queryRaw<{role: string}[]>`SELECT role FROM "Membership" WHERE "salonId"=${actor.salonId} AND "userId"=${actor.userId} FOR SHARE`;
  if (salons[0]?.accessStatus !== "APPROVED" || !(FINANCIAL_ROLES as readonly string[]).includes(members[0]?.role ?? "")) throw Error("FORBIDDEN");
  return salons[0];
}
export function resolveFinancialPeriod(selector: NonNullable<FinancialInterpretation["period"]>, timezone: string, now: Date) {
  const today = dateKeyInTimeZone(now, timezone);
  const date = selector === "yesterday" ? addCalendarDays(today,-1) : selector === "last_week" ? addCalendarDays(today,-7)
    : selector === "last_month" ? addCalendarDays(today.slice(0,7)+"-01",-1) : today;
  const bounds = resolveFinanceCalendar({date,mode:selector.includes("week") ? "week" : selector.includes("month") ? "month" : "day"},timezone);
  return {selector, start_at:bounds.from.toISOString(), end_at:bounds.to.toISOString(), from_date:bounds.fromDate, until_date:bounds.toDate, timezone};
}
type Period = ReturnType<typeof resolveFinancialPeriod>;
/** Backend-only anchors for selectors accepted before deferred execution. */
export type FinancialPeriodReferences = {timezone:string;period?:string;compare_period?:string};
type MetricId = NonNullable<FinancialInterpretation["metrics"]>[number];
const definitions: Record<MetricId,string> = {
  service_revenue: "Faturamento bruto de serviços de atendimentos concluídos, pela data do atendimento (dashboard); antes de ajustes do fechamento.",
  realized_revenue: "Realizado bruto: serviços e produtos dos atendimentos concluídos, pela data do atendimento; antes de ajustes do fechamento.",
  received_revenue: "Recebido registrado em Payment, pela data do pagamento, com ajustes já incluídos no valor; sem dedução de estornos/taxas não registrados.",
  completed_count: "Quantidade de atendimentos COMPLETED pela data do atendimento (não quantidade de serviços).",
  average_ticket: "Ticket médio de serviços: faturamento bruto de serviços / atendimentos concluídos, conforme dashboard.",
  outstanding_receivables: "Saldo atual a receber: serviços e produtos de atendimentos COMPLETED sem Payment, de todas as datas; não é previsão.",
};
type Group = {name:string; quantity:number; value:number};
type Aggregate = { label:string; revenue:bigint; count:bigint; products:bigint; product_invalid:bigint; received:bigint; payment_count:bigint; payment_invalid:bigint; receivable:bigint; unpaid_count:bigint; unpaid_invalid:bigint; snapshot_invalid:bigint; groups: Group[] };
export type FinancialMetricDTO = {id:MetricId; value:number|null; unit:"cents"|"count"; definition:string; coverage:"COMPLETE"|"NO_DATA"|"UNAVAILABLE"; reason:string|null};
export type FinancialSummary = {currency:string; resolved_period:Period|null; as_of:string; metrics:FinancialMetricDTO[]; groups:Group[]; group_by:FinancialInterpretation["group_by"]; comparison:null|{period:Period; metrics:{id:MetricId; current:number|null; previous:number|null; difference:number|null; percent:number|null; reason:string|null}[]}; warnings:string[]; durations_ms:Record<string,number>};
function safeNumber(value:bigint|number) { const n=Number(value);if(!Number.isSafeInteger(n))throw Error("FINANCIAL_RANGE_EXCEEDED");return n; }
export function financialDifference(current:number|null,previous:number|null) {
  return {current,previous,difference:current===null||previous===null?null:current-previous,
    percent:current===null||previous===null||previous===0?null:(current-previous)/previous*100,
    reason:current===null||previous===null?"DATA_UNAVAILABLE":previous===0?"ZERO_BASE":null};
}
function metric(row:Aggregate,id:MetricId):FinancialMetricDTO {
  const count=safeNumber(row.count), revenue=safeNumber(row.revenue);
  const sourceCount=id==="received_revenue"?safeNumber(row.payment_count):id==="outstanding_receivables"?safeNumber(row.unpaid_count):count;
  const invalid=id==="received_revenue"?row.payment_invalid:id==="realized_revenue"?row.product_invalid:id==="outstanding_receivables"?row.unpaid_invalid:0n;
  const raw=id==="service_revenue"?revenue:id==="realized_revenue"?safeNumber(row.revenue+row.products):id==="received_revenue"?safeNumber(row.received):id==="completed_count"?count:id==="outstanding_receivables"?safeNumber(row.receivable):count?revenue/count:null;
  return {id,value:invalid>0n?null:raw,unit:id==="completed_count"?"count":"cents",definition:definitions[id],
    coverage:invalid>0n?"UNAVAILABLE":sourceCount===0?"NO_DATA":"COMPLETE",reason:invalid>0n?"CURRENCY_MISMATCH":sourceCount===0?"NO_MATCHING_RECORDS":null};
}
/** T09: one SQL snapshot; PostgreSQL aggregates. Only four authorized Payment columns are referenced. */
export async function getFinancialSummary(tx:Tx,actor:ServiceActor,input:unknown,now=new Date(),references?:FinancialPeriodReferences):Promise<FinancialSummary> {
  const start=performance.now(), query=financialInterpretation.parse(input), salon=await assertFinancialAccess(tx,actor);
  const ids=[...new Set(query.metrics ?? ["service_revenue" as const])];
  const onlyReceivables=ids.length===1&&ids[0]==="outstanding_receivables";
  if(!query.period&&!onlyReceivables)throw Error("FINANCIAL_PERIOD_REQUIRED");
  if(ids.includes("outstanding_receivables")&&(query.compare_period||query.group_by||query.period))throw Error("RECEIVABLE_IS_CURRENT_BALANCE");
  if(query.group_by&&(ids.length!==1||ids[0]!=="service_revenue"||query.compare_period))throw Error("FINANCIAL_GROUP_UNSUPPORTED");
  if(references && (references.timezone!==salon.timezone || [references.period,references.compare_period].some(value=>value!==undefined&&!Number.isFinite(Date.parse(value)))))throw Error("FINANCIAL_CONTEXT_CHANGED");
  const t=performance.now(), period=resolveFinancialPeriod(query.period ?? "today",salon.timezone,references?.period?new Date(references.period):now);
  const previous=query.compare_period?resolveFinancialPeriod(query.compare_period,salon.timezone,references?.compare_period?new Date(references.compare_period):now):null;
  const ranges=Prisma.join([Prisma.sql`('current',${new Date(period.start_at)}::timestamptz,${new Date(period.end_at)}::timestamptz)`,...(previous?[Prisma.sql`('previous',${new Date(previous.start_at)}::timestamptz,${new Date(previous.end_at)}::timestamptz)`]:[])]);
  const periodMs=performance.now()-t, sqlStart=performance.now();
  const groupSQL=query.group_by==="professional" ? Prisma.sql`
    SELECT p.id AS key, u.name, count(*)::bigint AS quantity, sum(c."priceCents")::bigint AS value
    FROM completed c JOIN "Professional" p ON p.id=c."professionalId" AND p."salonId"=${actor.salonId}
    JOIN "User" u ON u.id=p."userId" WHERE c.label=r.label GROUP BY p.id,u.name`
    : query.group_by==="service" ? Prisma.sql`
    SELECT s.id AS key,s.name,count(*)::bigint AS quantity,sum(x."priceCents")::bigint AS value
    FROM completed c JOIN "AppointmentService" x ON x."appointmentId"=c.id AND x."salonId"=${actor.salonId}
    JOIN "Service" s ON s.id=x."serviceId" AND s."salonId"=${actor.salonId}
    WHERE c.label=r.label GROUP BY s.id,s.name` : Prisma.sql`SELECT '' AS key,'' AS name,0::bigint AS quantity,0::bigint AS value WHERE false`;
  const rows=await tx.$queryRaw<Aggregate[]>(Prisma.sql`
    WITH ranges(label,start_at,end_at) AS (VALUES ${ranges}),
    completed AS (
      SELECT a.id,a."priceCents",a."professionalId",r.label FROM "Appointment" a
      JOIN ranges r ON a."startAt">=r.start_at AND a."startAt"<r.end_at
      WHERE a."salonId"=${actor.salonId} AND a.status='COMPLETED'
    ), products AS (
      SELECT c.label,p.quantity::bigint*p."priceCentsUnit" AS value,p.currency
      FROM completed c JOIN "AppointmentProduct" p ON p."appointmentId"=c.id AND p."salonId"=${actor.salonId}
    ), payments AS (
      SELECT r.label,p."amountCents",p.currency FROM "Payment" p
      JOIN "Appointment" a ON a.id=p."appointmentId" AND a."salonId"=${actor.salonId}
      JOIN ranges r ON p."paidAt">=r.start_at AND p."paidAt"<r.end_at
    ), unpaid AS (
      SELECT a.id,a."priceCents" FROM "Appointment" a WHERE ${onlyReceivables} AND a."salonId"=${actor.salonId}
      AND a.status='COMPLETED' AND NOT EXISTS(SELECT 1 FROM "Payment" p WHERE p."appointmentId"=a.id)
    ), unpaid_products AS (
      SELECT p.quantity::bigint*p."priceCentsUnit" AS value,p.currency FROM unpaid a
      JOIN "AppointmentProduct" p ON p."appointmentId"=a.id AND p."salonId"=${actor.salonId}
    )
    SELECT r.label,
      (SELECT coalesce(sum(c."priceCents"),0)::bigint FROM completed c WHERE c.label=r.label) AS revenue,
      (SELECT count(*) FROM completed c WHERE c.label=r.label) AS count,
      (SELECT coalesce(sum(p.value),0)::bigint FROM products p WHERE p.label=r.label) AS products,
      (SELECT count(*) FROM products p WHERE p.label=r.label AND p.currency<>${salon.currency}) AS product_invalid,
      (SELECT coalesce(sum(p."amountCents"),0)::bigint FROM payments p WHERE p.label=r.label) AS received,
      (SELECT count(*) FROM payments p WHERE p.label=r.label) AS payment_count,
      (SELECT count(*) FROM payments p WHERE p.label=r.label AND p.currency<>${salon.currency}) AS payment_invalid,
      ((SELECT coalesce(sum(a."priceCents"),0) FROM unpaid a)+(SELECT coalesce(sum(p.value),0) FROM unpaid_products p))::bigint AS receivable,
      (SELECT count(*) FROM unpaid) AS unpaid_count,
      (SELECT count(*) FROM unpaid_products p WHERE p.currency<>${salon.currency}) AS unpaid_invalid,
      (SELECT count(*) FROM completed c WHERE c.label=r.label AND ${query.group_by==="service"} AND
        (SELECT sum(x."priceCents") FROM "AppointmentService" x WHERE x."appointmentId"=c.id AND x."salonId"=${actor.salonId}) IS DISTINCT FROM c."priceCents") AS snapshot_invalid,
      coalesce((SELECT jsonb_agg(jsonb_build_object('name',g.name,'quantity',g.quantity,'value',g.value) ORDER BY g.value DESC,g.key)
        FROM (${groupSQL} ORDER BY value DESC,key LIMIT 10) g),'[]'::jsonb) AS groups
    FROM ranges r`);
  const queryMs=performance.now()-sqlStart, aggregateStart=performance.now(), current=rows.find(r=>r.label==="current");
  if(!current)throw Error("FINANCIAL_QUERY_EMPTY"); // An empty aggregate must still return a row; never mask query errors as zero.
  const warnings:string[]=[];
  if(ids.includes("received_revenue"))warnings.push("Estornos e taxas não são modelados nos pagamentos do salão. Recebido registrado não equivale a receita líquida conciliada.");
  if(query.group_by==="service"&&current.snapshot_invalid>0n)warnings.push("Ranking indisponível: snapshots de serviços ausentes ou incompatíveis com o total de atendimentos.");
  const metrics=ids.map(id=>metric(current,id));
  const prior=rows.find(r=>r.label==="previous");
  const comparison=previous&&prior?{period:previous,metrics:metrics.map(m=>({id:m.id,...financialDifference(m.value,metric(prior,m.id).value)}))}:null;
  const groups=current.snapshot_invalid>0n?[]:current.groups.map(g=>({name:g.name,quantity:safeNumber(g.quantity),value:safeNumber(g.value)}));
  if(query.group_by&&current.snapshot_invalid>0n)for(const m of metrics){m.coverage="UNAVAILABLE";m.reason="INCOMPLETE_SERVICE_SNAPSHOTS";m.value=null;}
  return {currency:salon.currency,resolved_period:onlyReceivables?null:period,as_of:now.toISOString(),metrics,group_by:query.group_by??null,groups,comparison,warnings,
    durations_ms:{period:periodMs,query:queryMs,aggregation:performance.now()-aggregateStart,backend:performance.now()-start}};
}
export type FinancialState = {operation:"financial.report"; fields:FinancialInterpretation; status:"NEEDS_INPUT"|"DONE"; missing_fields:string[]; message:string; result?:FinancialSummary; metrics:Record<string,number>};
export const financialState=():FinancialState=>({operation:"financial.report",fields:{},status:"NEEDS_INPUT",missing_fields:["period"],message:"Qual período deseja consultar?",metrics:{}});
export function formatFinancialSummary(r:FinancialSummary) {
  const money=(v:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:r.currency}).format(v/100);
  const format=(value:number|null,unit:string)=>value===null?"indisponível":unit==="count"?String(value):money(value);
  return [r.resolved_period?`Período: ${r.resolved_period.from_date} até ${r.resolved_period.until_date} (fim exclusivo), ${r.resolved_period.timezone}.`:`Saldo atual, todas as datas.`,
    `Consultado em ${r.as_of}.`,...r.metrics.map(m=>`${m.definition}\n${format(m.value,m.unit)}${m.coverage==="NO_DATA"?" — sem registros no recorte":m.reason?` — ${m.reason}`:""}`),
    ...(r.group_by?[`Ranking por faturamento de serviços (até 10; quantidade não define posição):`,...r.groups.map(g=>`${g.name}: ${money(g.value)} · ${g.quantity} ${r.group_by==="service"?"itens de serviço":"atendimentos"}`)]:[]),
    ...(r.comparison?[`Comparação: ${r.comparison.period.from_date} até ${r.comparison.period.until_date} (fim exclusivo).`,...r.comparison.metrics.map(m=>`${m.id}: anterior ${format(m.previous,r.metrics.find(x=>x.id===m.id)!.unit)}; diferença ${format(m.difference,r.metrics.find(x=>x.id===m.id)!.unit)}; variação ${m.percent===null?"não calculável":m.percent.toFixed(2)+"%"}.`)]:[]),...r.warnings].join("\n");
}
export async function applyFinancialInterpretation(actor:ServiceActor,state:FinancialState,input:unknown,now=new Date(),references?:FinancialPeriodReferences) {
  const start=performance.now(),patch=financialInterpretation.parse(input);
  state.fields={...state.fields,...Object.fromEntries(Object.entries(patch).filter(([,v])=>v!=null))};state.result=undefined;
  const onlyReceivables=state.fields.metrics?.length===1&&state.fields.metrics[0]==="outstanding_receivables";
  await withTenant(actor,tx=>assertFinancialAccess(tx,actor));
  if(!state.fields.period&&!onlyReceivables){state.status="NEEDS_INPUT";state.missing_fields=["period"];state.message="Qual período deseja consultar: hoje, ontem, esta semana, semana passada, este mês ou mês passado?";return;}
  state.result=await withTenant(actor,tx=>getFinancialSummary(tx,actor,state.fields,now,references));
  const formatStart=performance.now();state.message=formatFinancialSummary(state.result);state.status="DONE";state.missing_fields=[];
  state.metrics={...state.metrics,...state.result.durations_ms,response:performance.now()-formatStart,message:performance.now()-start+(state.metrics.interpretation??0)};
}
export async function sendFinancialTurn(actor:ServiceActor,state:FinancialState,model:Model,message:string,check:()=>unknown) {
  const t=performance.now();const patch=await runServicesTurn(model,message,clarificationContext({...state,operation:"financial.report"}),financialRequirements(),"financial");
  check();state.metrics.interpretation=performance.now()-t;await applyFinancialInterpretation(actor,state,patch);
}
export async function persistFinancialMetrics(actor:ServiceActor,sessionId:string,state:FinancialState) {
  await withTenant(actor,tx=>tx.auditLog.create({data:{salonId:actor.salonId,userId:actor.userId,actorName:"Secretária — latência",entityType:"SECRETARY_LATENCY",entityId:sessionId,action:"FINANCIAL_READ",metadata:{interpretation_source:"MODEL",durations_ms:state.metrics}}}));
}
