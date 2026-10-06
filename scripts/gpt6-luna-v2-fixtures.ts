/** Explicit, disposable-only V2 fixture reset and read-only 10/10 precheck. No Agent or network. */
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadEnvConfig } from "@next/env";
import { PrismaClient, type Prisma } from "@prisma/client";
import { createGpt6V2Manifest, GPT6_V2_TIMEZONE, type Gpt6V2Case, type Gpt6V2Manifest } from "../packages/salon-secretary/evaluation/gpt6-luna-golden-v2";
import { dateKeyInTimeZone, localDateTimeToUtc } from "../src/lib/time";
import { withTenant } from "../src/lib/prisma-tenant";
import { searchSalonCustomer } from "../src/lib/customer-catalog";
import { getSchedulingAvailability, listSchedulingServices, listSchedulingProfessionals, listSchedulingAppointments } from "../src/lib/scheduling-catalog";
import { getFinancialSummary } from "../src/lib/secretary-financial";
import { searchProducts } from "../src/lib/inventory-catalog";
import { getCustomerMessageContext } from "../src/lib/communication-actions";

loadEnvConfig(process.cwd(), true);

type Tx = Prisma.TransactionClient;
const need: (condition: unknown, code: string) => asserts condition = (condition, code) => { if (!condition) throw Error(`GPT6_V2_${code}`); };
const expectedUrl = (key: "DATABASE_URL" | "DIRECT_URL", role: string) => {
  const raw = process.env[key];
  need(raw, `${key}_MISSING`);
  const url = new URL(raw);
  need(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === "127.0.0.1" && url.port === "55441" &&
    url.pathname === "/everflair_service_mvp" && decodeURIComponent(url.username) === role, `${key}_UNSAFE`);
  return url;
};

export function assertGpt6V2LocalEnvironment() {
  need(process.env.APP_ENV === "test" && process.env.VERCEL_ENV !== "production", "APP_ENV_UNSAFE");
  need(process.env.SALON_SECRETARY_ALLOW_PAID_CALLS === "false", "PAID_CALLS_NOT_DISABLED");
  need(["gpt-6-luna", "gpt-5.6-luna"].includes(process.env.SALON_SECRETARY_MODEL ?? ""), "ACTIVE_MODEL_UNSUPPORTED");
  const runtime = expectedUrl("DATABASE_URL", "mvp_service_runtime");
  const admin = expectedUrl("DIRECT_URL", "mvp_test_admin");
  return { runtime, admin };
}

async function assertDatabaseIdentity(admin: PrismaClient, runtime: PrismaClient) {
  const [target] = await admin.$queryRaw<{ db: string; host: string; port: number; directory: string }[]>`
    SELECT current_database() AS db, host(inet_server_addr()) AS host, inet_server_port() AS port,
      current_setting('data_directory') AS directory`;
  need(target?.db === "everflair_service_mvp" && target.host === "127.0.0.1" && target.port === 55441 &&
    /\/everflair-service-mvp-[^/]+\/data$/i.test(target.directory.replaceAll("\\", "/")), "DATABASE_IDENTITY");
  const [role] = await runtime.$queryRaw<{ name: string; super: boolean; bypass: boolean }[]>`
    SELECT current_user AS name, rolsuper AS super, rolbypassrls AS bypass FROM pg_roles WHERE rolname=current_user`;
  need(role?.name === "mvp_service_runtime" && !role.super && !role.bypass, "RUNTIME_ROLE");
  const tables = ["Salon", "Membership", "ClientProfile", "Service", "Professional", "Appointment", "AppointmentService", "Payment", "Product", "NotificationOutbox"];
  const flags = await runtime.$queryRaw<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
    SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
    WHERE relnamespace='public'::regnamespace AND relname=ANY(${tables}::text[])`;
  need(flags.length === tables.length && flags.every(x => x.relrowsecurity && x.relforcerowsecurity), "RLS_FORCE");
  return { host: target.host, port: target.port, database: target.db, runtime_role: role.name, rls_force_tables: tables.length };
}

function backupLocalDatabase(adminUrl: URL) {
  const installed = "C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe";
  const executable = existsSync(installed) ? installed : "pg_dump";
  const directory = mkdtempSync(join(tmpdir(), "everflair-gpt6-v2-"));
  const path = join(directory, "pre-reset.dump");
  const result = spawnSync(executable, ["-h", "127.0.0.1", "-p", "55441", "-U", "mvp_test_admin", "-d", "everflair_service_mvp", "-Fc", "-f", path],
    { env: { ...process.env, PGPASSWORD: decodeURIComponent(adminUrl.password) }, windowsHide: true, encoding: "utf8" });
  need(!result.error && result.status === 0 && existsSync(path) && statSync(path).size > 0, "BACKUP_FAILED");
  return { path, bytes: statSync(path).size };
}

function ref(item: Gpt6V2Case, key: string) {
  const id = item.fixture_refs[key];
  need(id, `MISSING_REF_${key}`);
  return id;
}
async function createOwnerAndSalon(tx: Tx, item: Gpt6V2Case, ownerName: string) {
  const userId = ref(item, "owner"), salonId = ref(item, "salon");
  await tx.user.create({ data: { id: userId, email: `${userId}@local.test`, name: ownerName, passwordHash: "synthetic-non-login" } });
  await tx.salon.create({ data: { id: salonId, slug: salonId, name: `Everflair GPT6 V2 ${item.case_id}`, accessStatus: "APPROVED", plan: "FREE", timezone: GPT6_V2_TIMEZONE, currency: "BRL" } });
  await tx.$executeRaw`SELECT set_config('app.current_salon', ${salonId}, true)`;
  await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
  await tx.membership.create({ data: { id: `${salonId}-membership`, salonId, userId, role: "OWNER" } });
}
async function professional(tx: Tx, item: Gpt6V2Case, serviceIds: string[]) {
  const salonId = ref(item, "salon"), professionalId = ref(item, "professional");
  await tx.professional.create({ data: { id: professionalId, salonId, userId: ref(item, "owner"), active: true } });
  await tx.professionalService.createMany({ data: serviceIds.map(serviceId => ({ professionalId, serviceId })) });
  await tx.workingHours.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ id: `${professionalId}-hours-${weekday}`, salonId, professionalId, weekday, startMinutes: 540, endMinutes: 1080 })) });
}
async function appointment(tx: Tx, item: Gpt6V2Case, date: string, time: string, durationMin: number, priceCents: number, status: "CONFIRMED" | "COMPLETED") {
  const salonId = ref(item, "salon"), serviceId = ref(item, "service"), id = ref(item, "appointment");
  const startAt = localDateTimeToUtc(`${date}T${time}`, GPT6_V2_TIMEZONE);
  await tx.appointment.create({ data: { id, salonId, clientId: ref(item, "customer"), professionalId: ref(item, "professional"), serviceId,
    startAt, endAt: new Date(startAt.getTime() + durationMin * 60_000), priceCents, status, timezone: GPT6_V2_TIMEZONE, origin: "ADMIN", version: 1 } });
  const service = await tx.service.findUniqueOrThrow({ where: { id: serviceId }, select: { name: true } });
  await tx.appointmentService.create({ data: { appointmentId: id, salonId, serviceId, position: 0, serviceName: service.name, durationMin, priceCents } });
  return startAt;
}
async function seedCase(tx: Tx, item: Gpt6V2Case, manifest: Gpt6V2Manifest) {
  const salonId = ref(item, "salon");
  if (await tx.salon.findUnique({ where: { id: salonId }, select: { id: true } })) return "EXISTS" as const;
  const ownerName = item.case_id === "scheduling-create" || item.case_id === "scheduling-change" || item.case_id === "scheduling-batch" ? "Tatiana Almeida" : `Owner GPT6 ${item.case_id}`;
  await createOwnerAndSalon(tx, item, ownerName);
  switch (item.case_id) {
    case "services-create":
    case "customers-create": break;
    case "services-price":
      await tx.service.create({ data: { id: ref(item, "service"), salonId, name: "Hidratação Capilar Aurora", durationMin: 60, priceCents: 6000, active: true } }); break;
    case "scheduling-create":
      await tx.clientProfile.create({ data: { id: ref(item, "customer"), salonId, name: "Camila Lemos" } });
      await tx.service.create({ data: { id: ref(item, "service"), salonId, name: "Progressiva Aurora", durationMin: 60, priceCents: 12000 } });
      await professional(tx, item, [ref(item, "service")]); break;
    case "scheduling-change":
      await tx.clientProfile.create({ data: { id: ref(item, "customer"), salonId, name: "Amanda Ribeiro" } });
      await tx.service.create({ data: { id: ref(item, "service"), salonId, name: "Progressiva Aurora", durationMin: 60, priceCents: 12000 } });
      await professional(tx, item, [ref(item, "service")]);
      await appointment(tx, item, manifest.tomorrow, "10:00", 60, 12000, "CONFIRMED"); break;
    case "scheduling-batch":
      await tx.clientProfile.createMany({ data: [
        { id: ref(item, "customer"), salonId, name: "Amanda Batista" },
        { id: ref(item, "replacement_customer"), salonId, name: "Fábio Rocha" },
      ] });
      await tx.service.createMany({ data: [
        { id: ref(item, "service"), salonId, name: "Progressiva Aurora", durationMin: 60, priceCents: 12000 },
        { id: ref(item, "replacement_service"), salonId, name: "Corte Masculino", durationMin: 30, priceCents: 5000 },
      ] });
      await professional(tx, item, [ref(item, "service"), ref(item, "replacement_service")]);
      await appointment(tx, item, manifest.tomorrow, "10:00", 60, 12000, "CONFIRMED"); break;
    case "financial-revenue": {
      await tx.clientProfile.create({ data: { id: ref(item, "customer"), salonId, name: "Cliente Financeiro Aurora" } });
      await tx.service.create({ data: { id: ref(item, "service"), salonId, name: "Tratamento Financeiro Aurora", durationMin: 60, priceCents: 12000 } });
      await professional(tx, item, [ref(item, "service")]);
      const at = await appointment(tx, item, manifest.yesterday, "10:00", 60, 12000, "COMPLETED");
      await tx.payment.create({ data: { id: ref(item, "payment"), appointmentId: ref(item, "appointment"), amountCents: 8000, method: "CASH", currency: "BRL", paidAt: new Date(at.getTime() + 60 * 60_000) } }); break;
    }
    case "inventory-low":
      await tx.product.createMany({ data: [
        { id: ref(item, "low_product"), salonId, name: "Shampoo Aurora", priceCents: 3000, stock: 1, minStock: 3, active: true },
        { id: ref(item, "normal_product"), salonId, name: "Condicionador Aurora", priceCents: 3500, stock: 8, minStock: 2, active: true },
      ] }); break;
    case "communication-exact":
      await tx.clientProfile.create({ data: { id: ref(item, "customer"), salonId, name: "Fábio Nogueira", phone: "11987654321" } }); break;
    case "communication-dependent-name":
      await tx.clientProfile.create({ data: { id: ref(item, "customer"), salonId, name: "Amanda Maria de Souza", phone: "21987654321" } });
      await tx.service.create({ data: { id: ref(item, "service"), salonId, name: "Escova Aurora", durationMin: 60, priceCents: 7000 } });
      await professional(tx, item, [ref(item, "service")]);
      await appointment(tx, item, manifest.tomorrow, "14:00", 60, 7000, "CONFIRMED"); break;
    default: throw Error("GPT6_V2_CASE_UNSUPPORTED");
  }
  return "CREATED" as const;
}

async function checkCase(item: Gpt6V2Case, manifest: Gpt6V2Manifest) {
  const actor = { salonId: ref(item, "salon"), userId: ref(item, "owner") };
  await withTenant(actor, async tx => {
    const salon = await tx.salon.findFirst({ where: { id: actor.salonId }, select: { id: true, slug: true, timezone: true, accessStatus: true, plan: true } });
    need(salon?.slug === actor.salonId && salon.timezone === GPT6_V2_TIMEZONE && salon.accessStatus === "APPROVED" && salon.plan === "FREE", `${item.case_id}_SALON`);
    const membership = await tx.membership.findFirst({ where: { salonId: actor.salonId, userId: actor.userId }, select: { role: true } });
    need(membership?.role === "OWNER", `${item.case_id}_OWNER`);
    const counts = await Promise.all([tx.clientProfile.count({ where: { salonId: actor.salonId } }), tx.service.count({ where: { salonId: actor.salonId } }),
      tx.appointment.count({ where: { salonId: actor.salonId } }), tx.product.count({ where: { salonId: actor.salonId } }),
      tx.notificationOutbox.count({ where: { salonId: actor.salonId } }), tx.appointmentEvent.count({ where: { salonId: actor.salonId } })]);
    const expected: Record<Gpt6V2Case["case_id"], number[]> = {
      "services-create": [0,0,0,0,0,0], "services-price": [0,1,0,0,0,0], "customers-create": [0,0,0,0,0,0],
      "scheduling-create": [1,1,0,0,0,0], "scheduling-change": [1,1,1,0,0,0], "scheduling-batch": [2,2,1,0,0,0],
      "financial-revenue": [1,1,1,0,0,0], "inventory-low": [0,0,0,2,0,0], "communication-exact": [1,0,0,0,0,0],
      "communication-dependent-name": [1,1,1,0,0,0],
    };
    need(JSON.stringify(counts) === JSON.stringify(expected[item.case_id]), `${item.case_id}_COUNTS`);
    if (item.case_id === "services-create") need((await tx.service.count({ where: { salonId: actor.salonId, name: { equals: "Massagem Relaxante Aurora", mode: "insensitive" } } })) === 0, "SERVICES_CREATE_COLLISION");
    if (item.case_id === "services-price") {
      const rows = await tx.service.findMany({ where: { salonId: actor.salonId, name: { contains: "Hidratação Capilar Aurora", mode: "insensitive" } }, select: { id: true, priceCents: true, durationMin: true, active: true } });
      need(rows.length === 1 && rows[0]!.id === ref(item,"service") && rows[0]!.priceCents === 6000 && rows[0]!.durationMin === 60 && rows[0]!.active, "SERVICE_PRICE_FIXTURE");
    }
    if (item.case_id === "customers-create") need((await searchSalonCustomer(tx,actor,"Maria Clara de Alencar")).length === 0, "CUSTOMERS_CREATE_COLLISION");
    const customerNames: Partial<Record<Gpt6V2Case["case_id"], string[]>> = {
      "scheduling-create": ["Camila Lemos"], "scheduling-change": ["Amanda Ribeiro"], "scheduling-batch": ["Amanda Batista", "Fábio Rocha"],
      "financial-revenue": ["Cliente Financeiro Aurora"], "communication-exact": ["Fábio Nogueira"], "communication-dependent-name": ["Amanda Maria de Souza"],
    };
    for (const name of customerNames[item.case_id] ?? []) {
      const rows = await searchSalonCustomer(tx,actor,name);
      need(rows.length === 1 && rows[0]!.name === name, `${item.case_id}_CUSTOMER_AMBIGUITY`);
    }
    if (["scheduling-create","scheduling-change","scheduling-batch","communication-dependent-name"].includes(item.case_id)) {
      const serviceName = item.case_id === "communication-dependent-name" ? "Escova Aurora" : "Progressiva Aurora";
      const services = await listSchedulingServices(tx,actor,serviceName);
      need(services.length === 1 && services[0]!.id === ref(item,"service"), `${item.case_id}_SERVICE`);
      const pros = await listSchedulingProfessionals(tx,actor,{service_ref:ref(item,"service"),query:"Tatiana Almeida"});
      if (item.case_id !== "communication-dependent-name") need(pros.length === 1 && pros[0]!.id === ref(item,"professional"), `${item.case_id}_PROFESSIONAL`);
      else need((await listSchedulingProfessionals(tx,actor,{service_ref:ref(item,"service")})).length === 1, "COMM_DEP_PROFESSIONAL");
    }
    if (item.case_id === "scheduling-create") {
      const result = await getSchedulingAvailability(tx,actor,{service_ref:ref(item,"service"),professional_ref:ref(item,"professional"),date:manifest.tomorrow,time:"10:00"});
      need(result.plan && result.timezone === GPT6_V2_TIMEZONE, "CREATE_SLOT_UNAVAILABLE");
    }
    if (["scheduling-change","scheduling-batch","communication-dependent-name"].includes(item.case_id)) {
      const time = item.case_id === "communication-dependent-name" ? "14:00" : "10:00";
      const appointments = await listSchedulingAppointments(tx,actor,{date:manifest.tomorrow,customer_ref:ref(item,"customer")});
      need(appointments.length === 1 && appointments[0]!.appointment_ref === ref(item,"appointment") && appointments[0]!.status === "CONFIRMED" &&
        appointments[0]!.revision === 1 && appointments[0]!.start_local === `${manifest.tomorrow}T${time}`, `${item.case_id}_APPOINTMENT`);
      need((await tx.appointmentService.count({where:{appointmentId:ref(item,"appointment"),salonId:actor.salonId}}))===1,`${item.case_id}_SNAPSHOT`);
    }
    if (item.case_id === "scheduling-change") {
      const result = await getSchedulingAvailability(tx,actor,{service_ref:ref(item,"service"),professional_ref:ref(item,"professional"),date:manifest.tomorrow,time:"11:00"});
      need(result.plan, "CHANGE_TARGET_UNAVAILABLE");
    }
    if (item.case_id === "scheduling-batch") {
      need((await listSchedulingServices(tx,actor,"Corte Masculino")).length === 1, "BATCH_REPLACEMENT_SERVICE");
      const projected = await getSchedulingAvailability(tx,actor,{service_ref:ref(item,"replacement_service"),professional_ref:ref(item,"professional"),date:manifest.tomorrow,time:"10:00"},new Date(),{releasedAppointmentId:ref(item,"appointment")});
      const occupied = await getSchedulingAvailability(tx,actor,{service_ref:ref(item,"replacement_service"),professional_ref:ref(item,"professional"),date:manifest.tomorrow,time:"10:00"});
      need(projected.plan && !occupied.plan, "BATCH_PROJECTION");
    }
    if (item.case_id === "financial-revenue") {
      const fixedNow=localDateTimeToUtc(`${manifest.base_date}T12:00`,GPT6_V2_TIMEZONE);
      const result=await getFinancialSummary(tx,actor,{metrics:["service_revenue"],period:"yesterday"},fixedNow);
      need(result.metrics.find(x=>x.id==="service_revenue")?.value===12000 && result.resolved_period?.from_date===manifest.yesterday && result.resolved_period?.timezone===GPT6_V2_TIMEZONE,"FINANCIAL_VALUE_OR_PERIOD");
      // Runtime intentionally has four column-level SELECT grants, not table SELECT.
      const payments=await tx.$queryRaw<{appointmentId:string;amountCents:number;paidAt:Date;currency:string}[]>`
        SELECT "appointmentId","amountCents","paidAt",currency FROM "Payment"
        WHERE "appointmentId"=${ref(item,"appointment")}`;
      need(payments.length===1 && payments[0]!.amountCents===8000 && payments[0]!.currency==="BRL" && dateKeyInTimeZone(payments[0]!.paidAt,GPT6_V2_TIMEZONE)===manifest.yesterday,"FINANCIAL_PAYMENT");
    }
    if (item.case_id === "inventory-low") {
      const products=await tx.product.findMany({where:{salonId:actor.salonId},select:{id:true,name:true,stock:true,minStock:true,active:true}});
      need(products.length===2 && products.some(p=>p.id===ref(item,"low_product")&&p.stock===1&&p.minStock===3&&p.active) &&
        products.some(p=>p.id===ref(item,"normal_product")&&p.stock===8&&p.minStock===2&&p.active),"INVENTORY_FIXTURES");
      const low=await searchProducts(tx,actor,{low_stock:true});
      need(low.length===1 && low[0]!.id===ref(item,"low_product"),"INVENTORY_LOW_STOCK");
    }
    if (item.case_id==="communication-exact"||item.case_id==="communication-dependent-name") {
      const context=await getCustomerMessageContext(tx,actor,ref(item,"customer"));
      need(context.channel_eligible && context.channel==="WHATSAPP" && context.provider==="LOCAL_FAKE" && context.missing_requirements.length===0,`${item.case_id}_CONTACT`);
    }
  });
}

export async function precheckGpt6V2(manifest:Gpt6V2Manifest, admin:PrismaClient, runtime:PrismaClient) {
  assertGpt6V2LocalEnvironment();
  const identity=await assertDatabaseIdentity(admin,runtime);
  need(dateKeyInTimeZone(new Date(),GPT6_V2_TIMEZONE)===manifest.base_date,"BASE_DATE_DRIFT");
  const checked:string[]=[];
  for(const item of manifest.cases){ await checkCase(item,manifest); checked.push(item.case_id); }
  const first=manifest.cases[3]!, second=manifest.cases[4]!, financial=manifest.cases[6]!;
  const isolated=await withTenant({salonId:ref(first,"salon"),userId:ref(first,"owner")},async tx=>({
    own:await tx.clientProfile.count({where:{id:ref(first,"customer")}}),
    foreign:await tx.clientProfile.count({where:{id:ref(second,"customer")}}),
    foreignPayment:(await tx.$queryRaw<{count:bigint}[]>`SELECT count("appointmentId")::bigint AS count FROM "Payment" WHERE "appointmentId"=${ref(financial,"appointment")}`)[0]?.count,
  }));
  need(isolated.own===1 && isolated.foreign===0 && isolated.foreignPayment===0n,"CROSS_TENANT");
  return {...identity,base_date:manifest.base_date,timezone:manifest.timezone,cases_checked:checked.length,case_ids:checked,cross_tenant_visible:isolated.foreign, payment_cross_tenant_visible:0,paid_calls:false};
}

async function main() {
  const command=process.argv[2];
  need(command==="reset"||command==="precheck","USAGE_RESET_OR_PRECHECK");
  const dateArg=process.argv.find(x=>x.startsWith("--base-date="));
  need(dateArg,"BASE_DATE_REQUIRED");
  const manifest=createGpt6V2Manifest(dateArg.slice("--base-date=".length));
  const urls=assertGpt6V2LocalEnvironment();
  const admin=new PrismaClient({datasources:{db:{url:process.env.DIRECT_URL}}});
  const runtime=new PrismaClient({datasources:{db:{url:process.env.DATABASE_URL}}});
  try {
    const identity=await assertDatabaseIdentity(admin,runtime);
    need(dateKeyInTimeZone(new Date(),GPT6_V2_TIMEZONE)===manifest.base_date,"BASE_DATE_DRIFT");
    let backup:ReturnType<typeof backupLocalDatabase>|undefined;
    const created:string[]=[];
    if(command==="reset") {
      backup=backupLocalDatabase(urls.admin);
      for(const item of manifest.cases){
        const result=await admin.$transaction(tx=>seedCase(tx,item,manifest));
        if(result==="CREATED")created.push(item.case_id);
      }
    }
    const checked=await precheckGpt6V2(manifest,admin,runtime);
    console.log(JSON.stringify({mode:command,identity,backup,created,precheck:checked},null,2));
  } finally {await admin.$disconnect();await runtime.$disconnect();}
}
if (require.main===module) main().catch(error=>{console.error(error instanceof Error?error.message:"GPT6_V2_FAILURE");process.exitCode=1;});
