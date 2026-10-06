import { randomUUID } from "node:crypto";
import { PrismaClient, type AppointmentStatus } from "@prisma/client";
import { beforeAll,afterAll,describe,it,expect,vi } from "vitest";
import { assertMvpTestDatabase } from "../../../scripts/service-mvp-test-safety";
import { prisma } from "../prisma";
import { withTenant } from "../prisma-tenant";
import { getFinancialSummary } from "../secretary-financial";
import { SalonSecretary } from "../salon-secretary";
import { ScriptedServicesModel,call } from "../../test/scripted-services-model";
import { intent,plan } from "../../test/secretary-capability-plan";
const suite=process.env.RUN_SERVICE_MVP_INTEGRATION==="1"?describe:describe.skip;
// Administrator is exclusively for synthetic setup/cleanup (explicit authorization), never a functional query.
const admin=new PrismaClient({datasources:{db:{url:process.env.MVP_TEST_ADMIN_URL??process.env.DATABASE_URL}}});
const now=new Date("2026-09-23T15:00:00Z");
async function fixture(suffix:string,empty=false) {
  const salonId=randomUUID();
  return admin.$transaction(async tx=>{
    await tx.$executeRaw`SELECT set_config('app.current_salon',${salonId},true)`;
    const owner=await tx.user.create({data:{name:`Ana ${suffix}`,email:`financial-${salonId}@local.test`,passwordHash:"not-a-login-hash"}});
    const staff=await tx.user.create({data:{name:`Bia ${suffix}`,email:`financial-staff-${salonId}@local.test`,passwordHash:"not-a-login-hash"}});
    await tx.salon.create({data:{id:salonId,slug:`financial-${salonId}`,name:`Synthetic Financial ${suffix}`,accessStatus:"APPROVED",timezone:"America/Sao_Paulo",currency:"BRL"}});
    await tx.membership.createMany({data:[{salonId,userId:owner.id,role:"OWNER"},{salonId,userId:staff.id,role:"RECEPTIONIST"}]});
    const a=await tx.professional.create({data:{salonId,userId:owner.id}}),b=await tx.professional.create({data:{salonId,userId:staff.id}});
    const client=await tx.clientProfile.create({data:{salonId,name:"Synthetic Financial Client",passwordHash:"must-never-leak"}});
    const expensive=await tx.service.create({data:{salonId,name:"Premium",priceCents:10000,durationMin:30}});
    const cheap=await tx.service.create({data:{salonId,name:"Corte",priceCents:2000,durationMin:30}});
    const service=await tx.service.create({data:{salonId,name:"Massagem",priceCents:5000,durationMin:60}});
    const product=await tx.product.create({data:{salonId,name:"Synthetic product",priceCents:1500}});
    const appointments:string[]=[];
    async function add(at:string,price:number,professionalId:string,serviceId:string,status:AppointmentStatus="COMPLETED",payment?:{at:string;amount:number;currency?:string},products=0) {
      const ap=await tx.appointment.create({data:{salonId,clientId:client.id,professionalId,serviceId,startAt:new Date(at),endAt:new Date(new Date(at).getTime()+60_000),priceCents:price,status}});
      appointments.push(ap.id);
      await tx.appointmentService.create({data:{appointmentId:ap.id,salonId,serviceId,position:0,serviceName:"Historical",durationMin:1,priceCents:price}});
      if(payment)await tx.payment.create({data:{appointmentId:ap.id,amountCents:payment.amount,discountCents:Math.max(0,price-payment.amount),method:"CASH",currency:payment.currency??"BRL",paidAt:new Date(payment.at)}});
      if(products)await tx.appointmentProduct.create({data:{salonId,appointmentId:ap.id,productId:product.id,productName:product.name,quantity:products,priceCentsUnit:1500,currency:"BRL"}});
      return ap.id;
    }
    if(!empty){
      await add("2026-09-22T13:00Z",10000,a.id,expensive.id,"COMPLETED",{at:"2026-09-22T14:00Z",amount:8000},2);
      await add("2026-09-22T14:00Z",2000,b.id,cheap.id,"COMPLETED",{at:"2026-09-22T15:00Z",amount:2000});
      await add("2026-09-22T15:00Z",2000,b.id,cheap.id,"COMPLETED",undefined,1);
      await add("2026-09-22T16:00Z",9000,a.id,expensive.id,"CANCELLED",{at:"2026-09-22T17:00Z",amount:500});
      await add("2026-09-22T17:00Z",9000,a.id,expensive.id,"NO_SHOW");
      await add("2026-09-22T18:00Z",9000,a.id,expensive.id,"PENDING");
      await add("2026-09-23T13:00Z",5000,a.id,service.id);
      await add("2026-09-20T02:59Z",3000,a.id,service.id,"COMPLETED",{at:"2026-09-20T02:59Z",amount:3000});
      await add("2026-09-23T02:59Z",7000,a.id,service.id,"COMPLETED",{at:"2026-09-23T04:00Z",amount:7000});
      await add("2026-09-23T03:00Z",1000,a.id,service.id);
    }
    return {actor:{salonId,userId:owner.id},staff:{salonId,userId:staff.id},userIds:[owner.id,staff.id],service,appointments};
  });
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
suite("Financial Core PostgreSQL — only runtime for functional queries",()=>{
  let a:Fixture,b:Fixture,empty:Fixture;
  const network=vi.fn(()=>{throw Error("NETWORK_FORBIDDEN");});
  const summary=(f:Fixture,input:unknown)=>withTenant(f.actor,tx=>getFinancialSummary(tx,f.actor,input,now));
  beforeAll(async()=>{
    expect(process.env.SALON_SECRETARY_ALLOW_PAID_CALLS).toBe("false");
    expect(new URL(process.env.DATABASE_URL!).username).toBe("mvp_service_runtime");
    console.log("FINANCIAL_PREFLIGHT",await assertMvpTestDatabase(admin));
    vi.stubGlobal("fetch",network);a=await fixture("A");b=await fixture("B");empty=await fixture("Empty",true);
  });
  afterAll(async()=>{
    expect(network).not.toHaveBeenCalled();
    for(const f of [a,b,empty].filter(Boolean))await admin.$transaction(async tx=>{
      await tx.$executeRaw`SELECT set_config('app.current_salon',${f.actor.salonId},true)`;
      // Only IDs created by this suite. No operational cleanup outside its synthetic tenants.
      await tx.appointmentProduct.deleteMany({where:{salonId:f.actor.salonId}});
      await tx.appointmentService.deleteMany({where:{salonId:f.actor.salonId}});
      await tx.payment.deleteMany({where:{appointmentId:{in:f.appointments}}});
      await tx.appointment.deleteMany({where:{salonId:f.actor.salonId}});
      await tx.salon.delete({where:{id:f.actor.salonId}});
      await tx.user.deleteMany({where:{id:{in:f.userIds}}});
    });
    vi.unstubAllGlobals();await admin.$disconnect();await prisma.$disconnect();
  });
  it("runtime identity, exact four column grant, RLS/FORCE/policy and no privileged bypass",async()=>{
    const identity=await prisma.$queryRaw<{current_user:string;rolsuper:boolean;rolbypassrls:boolean}[]>`SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
    expect(identity).toEqual([{current_user:"mvp_service_runtime",rolsuper:false,rolbypassrls:false}]);
    const rls=await prisma.$queryRaw`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='"Payment"'::regclass`;
    expect(rls).toEqual([{relrowsecurity:true,relforcerowsecurity:true}]);
    const grants=await prisma.$queryRaw`SELECT column_name,privilege_type FROM information_schema.column_privileges WHERE grantee=current_user AND table_name='Payment' ORDER BY column_name`;
    expect(grants).toEqual(["amountCents","appointmentId","currency","paidAt"].map(column_name=>({column_name,privilege_type:"SELECT"})));
    const policy=await prisma.$queryRaw<{policyname:string;qual:string}[]>`SELECT policyname,qual FROM pg_policies WHERE tablename='Payment'`;
    expect(policy).toHaveLength(1);expect(policy[0].policyname).toBe("tenant_isolation");expect(policy[0].qual).toContain("app_current_salon()");
    await expect(withTenant(a.actor,tx=>tx.$queryRaw`SELECT id FROM "Payment" LIMIT 1`)).rejects.toThrow(/permission denied/);
  });
  it("positive Payment A/B isolation, foreign explicit IDs, absent and invalid contexts",async()=>{
    const read=(f:Fixture)=>withTenant(f.actor,tx=>tx.$queryRaw<{appointmentId:string;amountCents:number}[]>`SELECT "appointmentId","amountCents" FROM "Payment"`);
    const ar=await read(a),br=await read(b);expect(ar).toHaveLength(5);expect(br).toHaveLength(5);
    expect(ar.every(r=>a.appointments.includes(r.appointmentId))).toBe(true);expect(br.every(r=>b.appointments.includes(r.appointmentId))).toBe(true);
    expect(await withTenant(a.actor,tx=>tx.$queryRaw`SELECT "appointmentId" FROM "Payment" WHERE "appointmentId"=${b.appointments[0]}`)).toEqual([]);
    expect(await withTenant(b.actor,tx=>tx.$queryRaw`SELECT "appointmentId" FROM "Payment" WHERE "appointmentId"=${a.appointments[0]}`)).toEqual([]);
    expect(await prisma.$queryRaw`SELECT "appointmentId" FROM "Payment"`).toEqual([]);
    expect(await withTenant({salonId:randomUUID(),userId:a.actor.userId},tx=>tx.$queryRaw`SELECT "appointmentId" FROM "Payment"`)).toEqual([]);
    expect(await withTenant({salonId:"invalid-context",userId:a.actor.userId},tx=>tx.$queryRaw`SELECT "appointmentId" FROM "Payment"`)).toEqual([]);
    await expect(withTenant({...a.actor,salonId:b.actor.salonId},tx=>getFinancialSummary(tx,{...a.actor,salonId:b.actor.salonId},{period:"today"},now))).rejects.toThrow("FORBIDDEN");
  });
  it.each([["yesterday",21000,4],["today",6000,2],["this_week",27000,6],["last_week",3000,1],["this_month",30000,7],["last_month",0,0]] as const)("A/B/C: %s uses local calendar and excludes canceled/no-show/pending",async(period,revenue,count)=>{
    const r=await summary(a,{period,metrics:["service_revenue","completed_count"]});expect(r.metrics.map(m=>m.value)).toEqual([revenue,count]);
  });
  it("D/E: comparison backend math, zero base percent undefined",async()=>{
    const r=await summary(a,{period:"this_week",compare_period:"last_week"});expect(r.comparison?.metrics[0]).toMatchObject({current:27000,previous:3000,difference:24000,percent:800});
    const zero=await summary(a,{period:"this_month",compare_period:"last_month"});expect(zero.comparison?.metrics[0]).toMatchObject({previous:0,percent:null,reason:"ZERO_BASE"});
  });
  it("F/G/H: ranking by revenue differs from quantity; minimal aggregate DTO",async()=>{
    const pro=await summary(a,{period:"yesterday",group_by:"professional"});expect(pro.groups[0]).toMatchObject({name:"Ana A",value:17000,quantity:2});
    const service=await summary(a,{period:"yesterday",group_by:"service"});expect(service.groups[0]).toEqual({name:"Premium",value:10000,quantity:1});expect(service.groups.find(g=>g.name==="Corte")?.quantity).toBe(2);
    const text=JSON.stringify(service);for(const forbidden of ["passwordHash","clientId","appointmentId","paidAt","must-never-leak","Synthetic Financial Client"])expect(text).not.toContain(forbidden);
  });
  it("I/J/K/L: ticket, products, recorded receipts with discounts, current receivables and explicit refund limitation",async()=>{
    const r=await summary(a,{period:"yesterday",metrics:["average_ticket","realized_revenue","received_revenue"]});expect(r.metrics.map(m=>m.value)).toEqual([5250,25500,10500]);
    expect(r.warnings.join()).toContain("Estornos");expect((await summary(a,{period:"today",metrics:["received_revenue"]})).metrics[0].value).toBe(7000);
    expect((await summary(a,{metrics:["outstanding_receivables"]})).metrics[0].value).toBe(9500);
    await expect(summary(a,{period:"today",metrics:["outstanding_receivables"]})).rejects.toThrow("RECEIVABLE_IS_CURRENT_BALANCE");
  });
  it("N/O: role denied, known empty aggregate zero but ticket absent, no errors masked",async()=>{
    await expect(withTenant(a.staff,tx=>getFinancialSummary(tx,a.staff,{period:"today"},now))).rejects.toThrow("FORBIDDEN");
    const r=await summary(empty,{period:"today",metrics:["service_revenue","average_ticket","completed_count"]});expect(r.metrics.map(m=>m.value)).toEqual([0,null,0]);expect(r.metrics.every(m=>m.coverage==="NO_DATA")).toBe(true);
  });
  it("Q/S: fake Agent compound read+service proposal, separate refs, no writes and no Financial confirm",async()=>{
    const before=await withTenant(a.actor,tx=>tx.service.findFirst({where:{id:a.service.id}}));
    const fake=new ScriptedServicesModel([call("select_capabilities",plan([intent("financial.report",{financial:{period:"yesterday"}}),intent("service.change",{target_name:"Massagem",priceCents:8000})]))]);
    const secretary=new SalonSecretary(async()=>fake,()=>"fake-financial"),session=await secretary.start(a.actor,"auto");
    const view=await secretary.send(a.actor,{sessionId:session.sessionId,message:"Quanto faturei ontem e altere a massagem para R$80."});
    expect(view.loaded?.map(x=>x.skill_id)).toEqual(["financial","services"]);expect(fake.requests).toHaveLength(1);
    const [fin,service]=view.operations!;expect(fin.state.financial?.status).toBe("DONE");expect(fin.state.proposal).toBeUndefined();expect(service.state.proposal).toBeDefined();expect(fin.operation_ref).not.toBe(service.operation_ref);
    await expect(secretary.confirmAutomatic(a.actor,session.sessionId,fin.operation_ref,{})).rejects.toThrow("FINANCIAL_READ_ONLY");
    expect(await withTenant(a.actor,tx=>tx.service.findFirst({where:{id:a.service.id}}))).toEqual(before);
    process.stdout.write(`FINANCIAL_MOCK_LATENCY ${JSON.stringify(fin.state.financial?.metrics)}\n`);
  });
  it("missing period continues same Financial operation, authorized queries only, two faked requests",async()=>{
    const fake=new ScriptedServicesModel([call("select_capabilities",plan([intent("financial.report",{financial:{metrics:["received_revenue"]}})])),call("upsert_action_draft",{period:"yesterday"})]);
    const secretary=new SalonSecretary(async()=>fake,()=>"fake-financial"),session=await secretary.start(a.actor,"auto");
    const first=await secretary.send(a.actor,{sessionId:session.sessionId,message:"Quanto recebi?"});expect(first.operations![0].state.financial?.missing_fields).toEqual(["period"]);
    const next=await secretary.send(a.actor,{sessionId:session.sessionId,message:"Ontem."});expect(next.operations![0].operation_ref).toBe(first.operations![0].operation_ref);expect(next.operations![0].state.financial?.fields.metrics).toEqual(["received_revenue"]);expect(fake.requests).toHaveLength(2);
    expect(next.loaded?.map(x=>x.skill_id)).toEqual(["financial"]);
  });
  it("currency mismatch and incomplete multi-service snapshots become unavailable, never invented allocation",async()=>{
    // Mutations are isolated synthetic setup; all assertions below query via runtime.
    await admin.$transaction(async tx=>{
      await tx.$executeRaw`SELECT set_config('app.current_salon',${b.actor.salonId},true)`;
      await tx.payment.updateMany({where:{appointmentId:b.appointments[0]},data:{currency:"USD"}});
      await tx.appointmentService.deleteMany({where:{salonId:b.actor.salonId,appointmentId:b.appointments[0]}});
    });
    expect((await summary(b,{period:"yesterday",metrics:["received_revenue"]})).metrics[0]).toMatchObject({value:null,coverage:"UNAVAILABLE",reason:"CURRENCY_MISMATCH"});
    const groups=await summary(b,{period:"yesterday",group_by:"service"});expect(groups.groups).toEqual([]);expect(groups.metrics[0]).toMatchObject({value:null,reason:"INCOMPLETE_SERVICE_SNAPSHOTS"});
  });
  it("queries have no operational effects and telemetry carries no financial rows/values",async()=>{
    const snapshot=()=>withTenant(a.actor,async tx=>({
      appointments:await tx.appointment.findMany({where:{salonId:a.actor.salonId},select:{id:true,status:true,priceCents:true,version:true},orderBy:{id:"asc"}}),
      payments:await tx.$queryRaw`SELECT "appointmentId","amountCents",currency,"paidAt" FROM "Payment" ORDER BY "appointmentId"`,
      events:await tx.appointmentEvent.count({where:{salonId:a.actor.salonId}}),
      notifications:await tx.notificationOutbox.count({where:{salonId:a.actor.salonId}}),
    }));
    const before=await snapshot();await summary(a,{period:"this_month",metrics:["service_revenue","received_revenue","average_ticket"]});expect(await snapshot()).toEqual(before);
    const logs=await withTenant(a.actor,tx=>tx.auditLog.findMany({where:{salonId:a.actor.salonId,action:"FINANCIAL_READ"},select:{metadata:true}}));
    expect(logs.length).toBeGreaterThan(0);for(const row of logs)for(const forbidden of ["amountCents","priceCents","passwordHash","received_revenue","Synthetic Financial Client"])
      expect(JSON.stringify(row.metadata)).not.toContain(forbidden);
  });
  it("multi-service ranking allocates snapshots instead of crediting the primary service with the whole appointment",async()=>{
    await admin.$transaction(async tx=>{
      await tx.$executeRaw`SELECT set_config('app.current_salon',${b.actor.salonId},true)`;
      const services=await tx.service.findMany({where:{salonId:b.actor.salonId,name:{in:["Premium","Corte"]}}});
      for(const [position,service] of services.entries())await tx.appointmentService.create({data:{appointmentId:b.appointments[0],salonId:b.actor.salonId,serviceId:service.id,position,serviceName:service.name,durationMin:1,priceCents:5000}});
    });
    const r=await summary(b,{period:"yesterday",group_by:"service"});
    expect(r.groups[0]).toEqual({name:"Corte",quantity:3,value:9000});
    expect(r.groups.find(g=>g.name==="Premium")?.value).toBe(5000);expect(r.metrics[0].coverage).toBe("COMPLETE");
  });
  it("revoked financial role cannot redisplay a cached report through the parent session",async()=>{
    const fake=new ScriptedServicesModel([call("select_capabilities",plan([intent("financial.report",{financial:{period:"today"}})]))]);
    const secretary=new SalonSecretary(async()=>fake,()=>"fake-financial"),session=await secretary.start(b.actor,"auto");
    await secretary.send(b.actor,{sessionId:session.sessionId,message:"Quanto faturei hoje?"});
    await admin.$transaction(async tx=>{
      await tx.$executeRaw`SELECT set_config('app.current_salon',${b.actor.salonId},true)`;
      await tx.membership.updateMany({where:b.actor,data:{role:"RECEPTIONIST"}});
    });
    await expect(secretary.cancel(b.actor,session.sessionId)).rejects.toThrow("FORBIDDEN");expect(fake.requests).toHaveLength(1);
  });
});
