import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { Tx } from "@/lib/prisma-tenant";
import { assertSafeDatabaseOperation } from "@/lib/database-safety";
import { execute, type Command } from "./services";
import { definition } from "./catalog";
import * as repo from "./repository";
import * as queries from "./queries";
vi.mock("server-only",()=>({}));

const pg=process.env.RUN_POSTGRES_INTEGRATION==="1"?describe:describe.skip;
function fields(entity:string,extra:Record<string,unknown>={}) {
 return Object.fromEntries(definition(entity).fields.filter(f=>!f.readonly).map(f=>[f.key,extra[f.key]??f.options?.[0]??f.default??""]));
}
let adminId:string,normalId:string;
async function scope<T>(userId:string|undefined,fn:(tx:Tx)=>Promise<T>,enable=true) {
 return prisma.$transaction(async tx=>{
  await tx.$executeRawUnsafe("SET LOCAL ROLE hq_test_runtime");
  if(userId)await tx.$executeRaw`SELECT set_config('app.current_user_id',${userId},true)`;
  if(enable)await tx.$executeRaw`SELECT set_config('app.hq_access','enabled',true)`;
  return fn(tx);
 },{timeout:15000});
}
const run=(command:Command)=>scope(adminId,tx=>execute(tx,adminId,command));
async function lead() {
 return run({type:"save",entity:"leads",values:fields("leads",{accountId:"00000000-0000-4000-8000-000000000000"}),account:fields("accounts",{name:"Contato CI",business:"Estúdio "+crypto.randomUUID(),email:"hq@example.test"})});
}
pg("HQ 020 — CRUD, relacionamentos e RLS reais",()=>{
 beforeAll(async()=>{
  assertSafeDatabaseOperation(process.env,{operation:"hq-integration"});
  await prisma.$executeRawUnsafe("DO $$ BEGIN CREATE ROLE hq_test_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
  await prisma.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO hq_test_runtime');
  await prisma.$executeRawUnsafe('GRANT SELECT ON "User" TO hq_test_runtime');
  await prisma.$executeRawUnsafe("GRANT EXECUTE ON FUNCTION hq_is_admin() TO hq_test_runtime");
  // Migration 024 policies refer to billing sources; mirror app_runtime's read grants.
  for (const table of ["BillingSubscription", "BillingCharge", "BillingEvent"]) await prisma.$executeRawUnsafe(`DO $$ BEGIN IF to_regclass('public."${table}"') IS NOT NULL THEN GRANT SELECT ON "${table}" TO hq_test_runtime; END IF; END $$`);
  for(const [key,d] of Object.entries((await import("./catalog")).definitions)) {
   await prisma.$executeRawUnsafe('GRANT SELECT, INSERT'+(key==="activities"?"":", UPDATE")+' ON '+d.table+' TO hq_test_runtime');
  }
  const users=await Promise.all(["SUPER_ADMIN","USER"].map((platformRole)=>prisma.user.create({data:{name:"HQ CI",email:crypto.randomUUID()+"@example.test",passwordHash:"synthetic-never-login",platformRole:platformRole as "SUPER_ADMIN"|"USER"}})));
  [adminId,normalId]=users.map(u=>u.id);
 });
 it("nega anônimo, usuário comum e administrador fora do escopo HQ",async()=>{
  const row=await lead();
  for(const [user,enable]of [[undefined,true],[normalId,true],[adminId,false]] as const){
   expect(await scope(user,tx=>repo.list(tx,"leads"),enable)).toEqual({rows:[],hasMore:false});
   await expect(scope(user,tx=>repo.insert(tx,"accounts",{name:"Negado",business:"Negado"}),enable)).rejects.toThrow();
  }
  expect((await scope(adminId,tx=>repo.find(tx,"leads",row.id))).id).toBe(row.id);
  // GUCs são locais; não sobrevivem à devolução da conexão ao pool.
  expect((await scope(undefined,tx=>repo.list(tx,"leads"),false)).rows).toHaveLength(0);
 });
 it("converte uma vez sob concorrência e conserva conta, timeline e vínculos",async()=>{
  const l=await lead();
  await run({type:"save",entity:"activities",values:fields("activities",{accountId:l.accountId,kind:"WhatsApp",description:"Conversa anterior à conversão"})});
  const results=await Promise.all([run({type:"convert",id:l.id}),run({type:"convert",id:l.id})]);
  expect(results[0].id).toBe(results[1].id);
  expect(results[0].accountId).toBe(l.accountId);
  const profile=await scope(adminId,tx=>queries.detail(tx,"customers",results[0].id));
  expect(profile.sections.activities.some(a=>a.description==="Conversa anterior à conversão")).toBe(true);
  expect(profile.sections.leads[0].status).toBe("Convertido");
  expect(profile.sections.opportunities[0].stage).toBe("Fechado");
 });
 it("confirma pagamento uma vez e bloqueia alteração do recebido",async()=>{
  const l=await lead();const customer=await run({type:"convert",id:l.id});
  const subscription=await run({type:"save",entity:"subscriptions",values:fields("subscriptions",{customerId:customer.id,plan:"Pro",amountCents:12000,discountCents:2000,status:"Ativo",startedAt:"2026-01-01",nextBillingAt:"2026-09-15"})});
  const payment=await run({type:"save",entity:"payments",values:fields("payments",{subscriptionId:subscription.id,reference:"2026-09",dueDate:"2026-09-15",amountCents:10000})});
  await Promise.all([run({type:"pay",id:payment.id,paidDate:"2026-09-01",method:"PIX"}),run({type:"pay",id:payment.id,paidDate:"2026-09-01",method:"PIX"})]);
  const profile=await scope(adminId,tx=>queries.detail(tx,"customers",customer.id));
  expect(profile.sections.payments[0].status).toBe("Pago");
  expect(profile.sections.activities.filter(a=>a.kind==="Pagamento")).toHaveLength(1);
  await expect(run({type:"save",entity:"payments",id:payment.id,values:fields("payments",{subscriptionId:subscription.id,reference:"2026-09",dueDate:"2026-09-15",amountCents:100,status:"Pago"})})).rejects.toThrow("imutável");
  await expect(scope(adminId,tx=>repo.insert(tx,"payments",{subscriptionId:subscription.id,reference:"2026-10-01",dueDate:"2026-10-01",amountCents:-1}))).rejects.toThrow();
 });
 it("associa vários clientes, deduplica e converte feedback sem perder a origem",async()=>{
  const customers=await Promise.all([lead(),lead()]).then(ls=>Promise.all(ls.map(l=>run({type:"convert",id:l.id}))));
  const title="Comissão "+crypto.randomUUID();
  const feature=await run({type:"save",entity:"features",values:fields("features",{title,description:"Comissão por profissional"})});
  await expect(run({type:"save",entity:"features",values:fields("features",{title:title.toUpperCase(),description:"Duplicada"})})).rejects.toThrow();
  for(const customer of customers) await run({type:"save",entity:"featureCustomers",values:{featureId:feature.id,customerId:customer.id}});
  const feedback=await run({type:"save",entity:"feedbacks",values:fields("feedbacks",{customerId:customers[0].id,description:"Preciso de comissão"})});
  await run({type:"feedback",id:feedback.id,target:"features",existingId:feature.id});
  const links=await scope(adminId,tx=>repo.related(tx,"featureCustomers","featureId",feature.id));
  expect(links).toHaveLength(2);
  const f=await scope(adminId,tx=>repo.find(tx,"feedbacks",feedback.id));
  expect(f.featureId).toBe(feature.id);expect(f.activityId).toBeTruthy();
 });
 it("reagenda, conclui e cancela follow-ups preservando auditoria",async()=>{
  const l=await lead();
  const values=fields("followups",{accountId:l.accountId,title:"Retornar",dueAt:"2026-09-10T10:00"});
  const followup=await run({type:"save",entity:"followups",values});
  const updated=await run({type:"save",entity:"followups",id:followup.id,values:{...values,dueAt:"2026-09-11T14:00",status:"Concluído"}});
  expect(updated.completedAt).toBeTruthy();
  const cancelled=await run({type:"save",entity:"followups",id:followup.id,values:{...values,status:"Cancelado"}});
  expect(cancelled.completedAt).toBeNull();
  const other=await lead();
  await expect(run({type:"save",entity:"followups",id:followup.id,values:{...values,accountId:other.accountId}})).rejects.toThrow("transferir");
 });
 it("RLS cobre todas as tabelas e timeline não permite UPDATE/DELETE",async()=>{
  for(const entity of Object.keys((await import("./catalog")).definitions))expect((await scope(normalId,tx=>repo.list(tx,entity))).rows).toHaveLength(0);
  await expect(scope(adminId,tx=>tx.$executeRawUnsafe("UPDATE hq_activities SET description='alterado'"))).rejects.toThrow();
  await expect(scope(adminId,tx=>tx.$executeRawUnsafe("DELETE FROM hq_accounts"))).rejects.toThrow();
  expect(await prisma.$queryRaw`SELECT rolbypassrls,rolsuper FROM pg_roles WHERE rolname='hq_test_runtime'`).toEqual([{rolbypassrls:false,rolsuper:false}]);
 });
 it("dashboard e CMM leem as mesmas contas sem duplicação",async()=>{
  const result=await scope(adminId,tx=>queries.dashboard(tx));
  expect(result.metrics.leads).toBeGreaterThan(0);
  expect(result.metrics.mrr).toBeGreaterThanOrEqual(10000);
  const cmm=await scope(adminId,tx=>queries.accounts(tx));
  expect(new Set(cmm.rows.map(r=>r.id)).size).toBe(cmm.rows.length);
 });
 it("mantém suporte, bug compartilhado e feedback no perfil correto",async()=>{
  const l=await lead();const customer=await run({type:"convert",id:l.id});
  const ticketValues=fields("tickets",{customerId:customer.id,title:"Dúvida de agenda",description:"Como organizar a semana?",category:"Dúvida",priority:"Média"});
  const ticket=await run({type:"save",entity:"tickets",values:ticketValues});
  const resolved=await run({type:"save",entity:"tickets",id:ticket.id,values:{...ticketValues,status:"Resolvido",resolution:"Orientação registrada"}});
  expect(resolved.resolution).toBe("Orientação registrada");
  const bugValues=fields("bugs",{title:"Falha sintética "+crypto.randomUUID(),description:"Problema isolado para teste",priority:"Crítica"});
  const bug=await run({type:"save",entity:"bugs",values:bugValues});
  await run({type:"save",entity:"bugCustomers",values:{bugId:bug.id,customerId:customer.id}});
  const feedback=await run({type:"save",entity:"feedbacks",values:fields("feedbacks",{customerId:customer.id,kind:"Reclamação",description:"Relato do mesmo problema"})});
  await run({type:"feedback",id:feedback.id,target:"bugs",existingId:bug.id});
  const generated=await run({type:"feedback",id:feedback.id,target:"tickets"});
  expect(generated.customerId).toBe(customer.id);
  expect((await run({type:"feedback",id:feedback.id,target:"tickets"})).id).toBe(generated.id);
  const closed=await run({type:"save",entity:"bugs",id:bug.id,values:{...bugValues,status:"Resolvido",resolution:"Correção sintética"}});
  expect(closed.resolvedAt).toBeTruthy();
  const profile=await scope(adminId,tx=>queries.detail(tx,"customers",customer.id));
  expect(profile.sections.bugs).toHaveLength(1);
  expect(profile.sections.tickets).toHaveLength(2);
  expect(profile.sections.feedbacks[0].bugId).toBe(bug.id);
  expect(profile.sections.activities.some(a=>a.kind==="Bug"&&String(a.description).includes("Resolvido"))).toBe(true);
 });
 it("busca pelo estabelecimento nas cobranças e separa follow-ups vencidos",async()=>{
  const l=await lead();const account=await scope(adminId,tx=>repo.find(tx,"accounts",String(l.accountId)));
  const f=await run({type:"save",entity:"followups",values:fields("followups",{accountId:l.accountId,title:"Contato pendente",dueAt:"2020-01-01T10:00"})});
  const result=await scope(adminId,tx=>repo.list(tx,"followups",{q:String(account.business),bucket:"overdue"}));
  expect(result.rows.map(r=>r.id)).toContain(f.id);
  expect((await scope(adminId,tx=>repo.list(tx,"followups",{q:String(account.business),bucket:"upcoming"}))).rows).toHaveLength(0);
 });
});
