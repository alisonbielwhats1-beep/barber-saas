/** Disposable PostgreSQL fixture adapter and independent operational journal. Never points at production. */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { PrismaClient, type Prisma } from "@prisma/client";
import type { SyntheticFixture } from "./hard-conversations-fixtures";
import { syntheticRef, validateFixture } from "./hard-conversations-fixtures";
import { withTenant } from "../../../src/lib/prisma-tenant";

const fail = (code: string): never => { throw Error(`PHASE_A_${code}`); };
function requireSafe(condition: unknown, code: string): asserts condition { if (!condition) fail(code); }
type Tx = Prisma.TransactionClient;

function localUrl(name: "DATABASE_URL" | "DIRECT_URL", role: string) {
  const raw = process.env[name];
  requireSafe(raw, `${name}_MISSING`);
  let url: URL | undefined;
  try { url = new URL(raw); } catch { fail(`${name}_UNSAFE`); }
  requireSafe(url, `${name}_UNSAFE`);
  requireSafe(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === "127.0.0.1" &&
    url.port === "55441" && url.pathname === "/everflair_service_mvp" &&
    decodeURIComponent(url.username) === role, `${name}_UNSAFE`);
  return url;
}

export function assertPhaseAEnvironment() {
  requireSafe(process.env.APP_ENV === "test" && process.env.VERCEL_ENV !== "production", "APP_ENV_UNSAFE");
  requireSafe(process.env.SALON_SECRETARY_MODEL === "gpt-6-luna" &&
    process.env.SALON_SECRETARY_ALLOW_PAID_CALLS === "false" &&
    process.env.SALON_SECRETARY_JEV_ROUTER_ENABLED === "false", "FLAGS_UNSAFE");
  requireSafe(Boolean(process.env.SALON_SECRETARY_OPENAI_API_KEY) &&
    process.env.SALON_SECRETARY_OPENAI_PROJECT === "proj_IcNUaSBqgYGrPkSBtF9dZ0CF", "OPENAI_PROJECT_UNSAFE");
  return { runtime: localUrl("DATABASE_URL", "mvp_service_runtime"),
    admin: localUrl("DIRECT_URL", "mvp_test_admin") };
}

export async function assertPhaseADatabase(admin: PrismaClient, runtime: PrismaClient) {
  const [db] = await admin.$queryRaw<{ name: string; host: string; port: number; directory: string }[]>`
    SELECT current_database() AS name, host(inet_server_addr()) AS host, inet_server_port() AS port,
      current_setting('data_directory') AS directory`;
  requireSafe(db?.name === "everflair_service_mvp" && db.host === "127.0.0.1" && db.port === 55441 &&
    /\/everflair-service-mvp-[^/]+\/data$/i.test(db.directory.replaceAll("\\", "/")), "DATABASE_IDENTITY");
  const [role] = await runtime.$queryRaw<{ name: string; super: boolean; bypass: boolean }[]>`
    SELECT current_user AS name, rolsuper AS super, rolbypassrls AS bypass FROM pg_roles WHERE rolname=current_user`;
  requireSafe(role?.name === "mvp_service_runtime" && !role.super && !role.bypass, "RUNTIME_ROLE");
  const tables = ["Salon", "Membership", "ClientProfile", "Service", "Professional", "WorkingHours",
    "ProfessionalService", "Appointment", "AppointmentService", "AppointmentEvent", "AppointmentProduct",
    "Payment", "Product", "NotificationOutbox", "AuditLog", "SalonClosure", "TimeOff",
    "PhysicalResource", "ResourceBooking"];
  const flags = await runtime.$queryRaw<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
    SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
    WHERE relnamespace='public'::regnamespace AND relname=ANY(${tables}::text[])`;
  requireSafe(flags.length === tables.length && flags.every(row => row.relrowsecurity && row.relforcerowsecurity), "RLS_FORCE");
  return { host: db.host, port: db.port, database: db.name, runtime_role: role.name, rls_force_tables: flags.length };
}

/** Backup is mandatory before the first synthetic write. Return only path/size, never credentials. */
export function backupPhaseALocalDatabase(adminUrl: URL) {
  const installed = "C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe";
  const executable = existsSync(installed) ? installed : "pg_dump";
  const directory = mkdtempSync(join(tmpdir(), "everflair-phase-a-"));
  const file = join(directory, "before-fixtures.dump");
  const result = spawnSync(executable, ["-h", "127.0.0.1", "-p", "55441", "-U", "mvp_test_admin",
    "-d", "everflair_service_mvp", "-Fc", "-f", file],
  { env: { ...process.env, PGPASSWORD: decodeURIComponent(adminUrl.password) }, windowsHide: true, encoding: "utf8" });
  requireSafe(!result.error && result.status === 0 && existsSync(file) && statSync(file).size > 0, "BACKUP_FAILED");
  return { path: file, bytes: statSync(file).size };
}

function expectedRows(f: SyntheticFixture) {
  return { customers: f.customers.filter(row => row.tenant === f.tenant), services: f.services,
    professionals: f.professionals, products: f.products, appointments: f.appointments };
}

/** Case-scoped, create-once. Existing/stale tenants are blocked, never silently reset. */
export async function seedPhaseACase(admin: PrismaClient, f: SyntheticFixture,
  options: { financialYesterday?: boolean } = {}) {
  requireSafe(validateFixture(f).length === 0, "FIXTURE_INVALID");
  const existing = await admin.salon.findUnique({ where: { id: f.tenant }, select: { id: true } });
  requireSafe(!existing, "FIXTURE_ALREADY_EXISTS");
  const rows = expectedRows(f);
  await admin.$transaction(async tx => {
    await tx.user.create({ data: { id: f.actor, email: `${f.actor}@local.test`, name: `Owner Phase A ${f.caseId}`,
      passwordHash: "synthetic-non-login" } });
    for (const p of f.professionals) await tx.user.create({ data: { id: syntheticRef(f.caseId, `professional-user:${p.name}`),
      email: `${syntheticRef(f.caseId, `professional-user:${p.name}`)}@local.test`, name: p.name,
      passwordHash: "synthetic-non-login" } });
    await tx.salon.create({ data: { id: f.tenant, slug: f.tenant, name: `Everflair Phase A ${f.caseId}`,
      accessStatus: "APPROVED", plan: "PRO", timezone: "America/Sao_Paulo", currency: "BRL",
      openMinutes: 540, closeMinutes: 1080, minBookingLeadMinutes: 0, bufferMinutes: 0 } });
    await tx.$executeRaw`SELECT set_config('app.current_salon', ${f.tenant}, true)`;
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${f.actor}, true)`;
    await tx.membership.create({ data: { id: syntheticRef(f.caseId, "membership"), salonId: f.tenant,
      userId: f.actor, role: "OWNER" } });
    for (const p of rows.professionals) {
      await tx.professional.create({ data: { id: p.id, salonId: f.tenant,
        userId: syntheticRef(f.caseId, `professional-user:${p.name}`), active: true } });
      await tx.workingHours.createMany({ data: Array.from({ length: 7 }, (_, weekday) => [
        { id: syntheticRef(f.caseId, `hours:${p.id}:${weekday}:am`), salonId: f.tenant,
          professionalId: p.id, weekday, startMinutes: 540, endMinutes: 720 },
        { id: syntheticRef(f.caseId, `hours:${p.id}:${weekday}:pm`), salonId: f.tenant,
          professionalId: p.id, weekday, startMinutes: 780, endMinutes: 1080 },
      ]).flat() });
    }
    for (const s of rows.services) {
      await tx.service.create({ data: { id: s.id, salonId: f.tenant, name: s.name, durationMin: s.durationMin,
        priceCents: s.priceCents, active: true } });
      await tx.professionalService.createMany({ data: s.professionalIds.map(professionalId =>
        ({ professionalId, serviceId: s.id })) });
    }
    await tx.clientProfile.createMany({ data: rows.customers.map(c => ({ id: c.id, salonId: f.tenant,
      name: c.name, phone: c.contactEligible ? "11987654321" : null })) });
    await tx.product.createMany({ data: rows.products.map(p => ({ id: p.id, salonId: f.tenant,
      name: p.name, priceCents: 3000, stock: p.stock, minStock: p.minStock, active: true })) });
    for (const a of rows.appointments) {
      const service = rows.services.find(s => s.id === a.serviceId)!;
      await tx.appointment.create({ data: { id: a.id, salonId: f.tenant, clientId: a.customerId,
        professionalId: a.professionalId, serviceId: a.serviceId, startAt: new Date(a.startAt),
        endAt: new Date(a.endAt), priceCents: service.priceCents, status: a.status,
        timezone: "America/Sao_Paulo", origin: "ADMIN", version: a.revision } });
      await tx.appointmentService.create({ data: { appointmentId: a.id, salonId: f.tenant,
        serviceId: a.serviceId, position: 0, serviceName: service.name,
        durationMin: service.durationMin, priceCents: service.priceCents } });
    }
    if (options.financialYesterday ?? ["m03", "m07"].includes(f.caseId)) await seedFinancialYesterday(tx, f);
  });
}

async function seedFinancialYesterday(tx: Tx, f: SyntheticFixture) {
  const service = f.services.find(s => s.name === "Corte Completo")!;
  const client = f.customers.find(c => c.name === "Alisson")!;
  const professionalId = service.professionalIds[0]!;
  const id = syntheticRef(f.caseId, "financial-completed-appointment");
  const startAt = new Date("2026-10-04T10:00:00-03:00");
  await tx.appointment.create({ data: { id, salonId: f.tenant, clientId: client.id, professionalId,
    serviceId: service.id, startAt, endAt: new Date(startAt.getTime() + 45 * 60_000),
    priceCents: f.financial.valueCents, status: "COMPLETED", timezone: "America/Sao_Paulo", origin: "ADMIN" } });
  await tx.appointmentService.create({ data: { appointmentId: id, salonId: f.tenant, serviceId: service.id,
    position: 0, serviceName: service.name, durationMin: 45, priceCents: f.financial.valueCents } });
  await tx.payment.create({ data: { id: syntheticRef(f.caseId, "financial-payment"), appointmentId: id,
    amountCents: 8000, currency: "BRL", method: "CASH", paidAt: new Date(startAt.getTime() + 45 * 60_000) } });
}

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export type OperationalSnapshot = { hashes: Record<string, string>; counts: Record<string, number>;
  technical_audits: number; technical_audit_hash?: string; technical_by_kind?: Record<string, number>;
  confirmations: number };

/** Admin sees full case-scoped rows; report retains digests/counts only. */
export async function snapshotPhaseACase(admin: PrismaClient, f: SyntheticFixture): Promise<OperationalSnapshot> {
  const where = { salonId: f.tenant };
  const rows = {
    services: await admin.service.findMany({ where, orderBy: { id: "asc" } }),
    customers: await admin.clientProfile.findMany({ where, orderBy: { id: "asc" } }),
    appointments: await admin.appointment.findMany({ where, orderBy: { id: "asc" } }),
    appointment_services: await admin.appointmentService.findMany({ where, orderBy: [{ appointmentId: "asc" }, { position: "asc" }] }),
    appointment_events: await admin.appointmentEvent.findMany({ where, orderBy: { id: "asc" } }),
    appointment_products: await admin.appointmentProduct.findMany({ where, orderBy: { id: "asc" } }),
    products: await admin.product.findMany({ where, orderBy: { id: "asc" } }),
    outbox: await admin.notificationOutbox.findMany({ where, orderBy: { id: "asc" } }),
    closures: await admin.salonClosure.findMany({ where, orderBy: { id: "asc" } }),
    time_off: await admin.timeOff.findMany({ where: { professional: where }, orderBy: { id: "asc" } }),
    resource_bookings: await admin.resourceBooking.findMany({ where, orderBy: [{ appointmentId: "asc" }, { resourceId: "asc" }] }),
    payments: await admin.payment.findMany({ where: { appointment: where }, orderBy: { id: "asc" } }),
  };
  const audits = await admin.auditLog.findMany({ where, select: { id: true, action: true, entityType: true,
    entityId: true, metadata: true, createdAt: true }, orderBy: { id: "asc" } });
  const technicalByKind = { drafts: 0, proposals: 0, usage: 0, router: 0, other: 0 };
  for (const row of audits) {
    const action = row.action.toUpperCase();
    if (action.includes("DRAFT")) technicalByKind.drafts++;
    else if (action.includes("PROPOSAL")) technicalByKind.proposals++;
    else if (row.entityType === "SALON_SECRETARY_USAGE") technicalByKind.usage++;
    else if (row.entityType === "SECRETARY_ROUTER") technicalByKind.router++;
    else technicalByKind.other++;
  }
  return { hashes: Object.fromEntries(Object.entries(rows).map(([name, value]) => [name, digest(value)])),
    counts: Object.fromEntries(Object.entries(rows).map(([name, value]) => [name, value.length])),
    technical_audits: audits.length, technical_audit_hash: digest(audits), technical_by_kind: technicalByKind,
    confirmations: audits.filter(row =>
      /(?:^|_)CONFIRMED$|^BATCH_EXECUTED$|^STOCK_MOVEMENT_EXECUTED$/.test(row.action)).length };
}

export type IndependentEffectCounters = {
  confirmations: number; operational_writes: number; appointment_mutations: number;
  service_mutations: number; customer_mutations: number; inventory_mutations: number;
  outbox_creations: number; external_messages: number; tool_executions: number;
  openai_requests: number; jev_requests: number; hosted_tools: number; containers: number;
};
export const emptyIndependentCounters = (): IndependentEffectCounters => ({ confirmations: 0, operational_writes: 0,
  appointment_mutations: 0, service_mutations: 0, customer_mutations: 0, inventory_mutations: 0,
  outbox_creations: 0, external_messages: 0, tool_executions: 0, openai_requests: 0,
  jev_requests: 0, hosted_tools: 0, containers: 0 });

/** Query middleware observes attempted writes independently of Secretary output. Install after fixture seeding. */
export function installPhaseAWriteWitness(runtime: PrismaClient, counters: IndependentEffectCounters) {
  const writeActions = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);
  runtime.$use(async (params, next) => {
    if (writeActions.has(params.action)) {
      if (params.model === "AuditLog") {
        // Drafts/proposals/usage/router audit are technical; confirmed actions are checked by journal.
      } else {
        counters.operational_writes++;
        if (["Appointment", "AppointmentService", "AppointmentEvent", "SalonClosure", "Payment"].includes(params.model ?? "")) counters.appointment_mutations++;
        if (params.model === "Service") counters.service_mutations++;
        if (params.model === "ClientProfile") counters.customer_mutations++;
        if (params.model === "Product") counters.inventory_mutations++;
        if (params.model === "NotificationOutbox") counters.outbox_creations++;
      }
    }
    return next(params);
  });
}

export function comparePhaseAJournal(before: OperationalSnapshot, after: OperationalSnapshot) {
  const changed = Object.keys(before.hashes).filter(key => before.hashes[key] !== after.hashes[key]);
  const counts = emptyIndependentCounters();
  counts.confirmations = Math.max(0, after.confirmations - before.confirmations);
  counts.operational_writes = changed.length;
  counts.appointment_mutations = changed.filter(x => x.startsWith("appointment") ||
    ["closures", "time_off", "resource_bookings", "payments"].includes(x)).length;
  counts.service_mutations = Number(changed.includes("services"));
  counts.customer_mutations = Number(changed.includes("customers"));
  counts.inventory_mutations = Number(changed.includes("products") || changed.includes("appointment_products"));
  counts.outbox_creations = Math.max(0, after.counts.outbox - before.counts.outbox);
  const kindDelta = Object.fromEntries(Object.keys(after.technical_by_kind ?? {}).map(kind => [kind,
    (after.technical_by_kind?.[kind] ?? 0) - (before.technical_by_kind?.[kind] ?? 0)]));
  return { counters: counts, changed_tables: changed,
    technical_audit_delta: after.technical_audits - before.technical_audits,
    technical_audit_hash_changed: before.technical_audit_hash !== after.technical_audit_hash,
    technical_by_kind_delta: kindDelta };
}

/** Only the continuation preflight may pass the separately hash-verified i01 history. */
export type ApprovedI01TechnicalAudit = { kind: "APPROVED_I01_HISTORY"; count: 7; technical_audit_hash: string };
export async function precheckPhaseACase(admin: PrismaClient, runtime: PrismaClient, f: SyntheticFixture,
  approvedAudit?: ApprovedI01TechnicalAudit | { kind: "APPROVED_RESUME_HISTORY"; case_id: string; count: number; technical_audit_hash: string },
  options: { financialYesterday?: boolean } = {}) {
  requireSafe(validateFixture(f).length === 0, "FIXTURE_INVALID");
  const rows = expectedRows(f);
  const salon = await admin.salon.findUnique({ where: { id: f.tenant }, select: { id: true, accessStatus: true, plan: true, timezone: true } });
  requireSafe(salon?.accessStatus === "APPROVED" && salon.plan === "PRO" && salon.timezone === "America/Sao_Paulo", "SALON_FIXTURE");
  const member = await admin.membership.findFirst({ where: { salonId: f.tenant, userId: f.actor }, select: { role: true } });
  requireSafe(member?.role === "OWNER", "OWNER_FIXTURE");
  const [customers, services, professionals, products, appointments, audits] = await Promise.all([
    admin.clientProfile.findMany({ where: { salonId: f.tenant }, select: { id: true, name: true } }),
    admin.service.findMany({ where: { salonId: f.tenant }, select: { id: true, name: true, priceCents: true, durationMin: true } }),
    admin.professional.findMany({ where: { salonId: f.tenant }, select: { id: true } }),
    admin.product.findMany({ where: { salonId: f.tenant }, select: { id: true, stock: true, minStock: true } }),
    admin.appointment.findMany({ where: { salonId: f.tenant }, select: { id: true, status: true, version: true,
      startAt: true, endAt: true, clientId: true, professionalId: true, serviceId: true } }),
    admin.auditLog.count({ where: { salonId: f.tenant } }),
  ]);
  requireSafe(approvedAudit
    ? (approvedAudit.kind === "APPROVED_I01_HISTORY" ? f.caseId === "i01" && approvedAudit.count === 7 && audits === 7
      : approvedAudit.case_id === f.caseId && Number.isSafeInteger(approvedAudit.count) && approvedAudit.count >= 0 && audits === approvedAudit.count)
    : audits === 0, "STALE_TECHNICAL_JOURNAL");
  requireSafe(customers.length === rows.customers.length && rows.customers.every(x => customers.some(y => y.id === x.id && y.name === x.name)), "CUSTOMERS_FIXTURE");
  requireSafe(services.length === rows.services.length && rows.services.every(x => services.some(y =>
    y.id === x.id && y.name === x.name && y.priceCents === x.priceCents && y.durationMin === x.durationMin)), "SERVICES_FIXTURE");
  requireSafe(professionals.length === rows.professionals.length && rows.professionals.every(x => professionals.some(y => y.id === x.id)), "PROFESSIONALS_FIXTURE");
  const links = await admin.professionalService.findMany({ where: { professional: { salonId: f.tenant } },
    select: { professionalId: true, serviceId: true } });
  requireSafe(links.length === rows.services.reduce((n, service) => n + service.professionalIds.length, 0) &&
    rows.services.every(service => service.professionalIds.every(professionalId =>
      links.some(link => link.serviceId === service.id && link.professionalId === professionalId))), "SERVICE_ELIGIBILITY");
  const hours = await admin.workingHours.findMany({ where: { salonId: f.tenant },
    select: { professionalId: true, weekday: true, startMinutes: true, endMinutes: true } });
  requireSafe(hours.length === rows.professionals.length * 14 && rows.professionals.every(professional =>
    Array.from({ length: 7 }, (_, weekday) => weekday).every(weekday =>
      hours.some(h => h.professionalId === professional.id && h.weekday === weekday && h.startMinutes === 540 && h.endMinutes === 720) &&
      hours.some(h => h.professionalId === professional.id && h.weekday === weekday && h.startMinutes === 780 && h.endMinutes === 1080))), "WORKING_HOURS");
  requireSafe(products.length === rows.products.length && rows.products.every(x => products.some(y =>
    y.id === x.id && y.stock === x.stock && y.minStock === x.minStock)), "PRODUCTS_FIXTURE");
  const financialYesterday = options.financialYesterday ?? ["m03", "m07"].includes(f.caseId);
  requireSafe(appointments.length === rows.appointments.length + (financialYesterday ? 1 : 0) &&
    rows.appointments.every(x => appointments.some(y => y.id === x.id && y.status === x.status &&
      y.version === x.revision && y.startAt.getTime() === Date.parse(x.startAt) && y.endAt.getTime() === Date.parse(x.endAt) &&
      y.clientId === x.customerId && y.professionalId === x.professionalId && y.serviceId === x.serviceId)), "APPOINTMENTS_FIXTURE");
  const items = await admin.appointmentService.findMany({ where: { salonId: f.tenant },
    select: { appointmentId: true, serviceId: true, durationMin: true, priceCents: true } });
  requireSafe(items.length === appointments.length && rows.appointments.every(a =>
    items.some(item => item.appointmentId === a.id && item.serviceId === a.serviceId &&
      item.durationMin === rows.services.find(s => s.id === a.serviceId)?.durationMin)), "APPOINTMENT_SNAPSHOTS");
  if (financialYesterday) {
    const financialId = syntheticRef(f.caseId, "financial-completed-appointment");
    const completed = appointments.find(row => row.id === financialId);
    const payments = await admin.payment.findMany({ where: { appointmentId: financialId },
      select: { amountCents: true, currency: true, paidAt: true } });
    requireSafe(completed?.status === "COMPLETED" && completed.startAt.toISOString() === "2026-10-04T13:00:00.000Z" &&
      items.some(item => item.appointmentId === financialId && item.priceCents === 12000) &&
      payments.length === 1 && payments[0].amountCents === 8000 && payments[0].currency === "BRL",
    "FINANCIAL_YESTERDAY_FIXTURE");
  }
  const actor = { salonId: f.tenant, userId: f.actor };
  const visible = await withTenant(actor, tx => tx.clientProfile.count({ where: { salonId: f.tenant } }));
  requireSafe(visible === rows.customers.length, "RUNTIME_VISIBILITY");
  const foreign = await runtime.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.current_salon', ${f.foreignTenant}, true)`;
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${f.actor}, true)`;
    return Promise.all([
      tx.clientProfile.count({ where: { salonId: f.tenant } }),
      tx.service.count({ where: { salonId: f.tenant } }),
      tx.appointment.count({ where: { salonId: f.tenant } }),
      tx.product.count({ where: { salonId: f.tenant } }),
      tx.auditLog.count({ where: { salonId: f.tenant } }),
    ]);
  });
  requireSafe(foreign.every(count => count === 0), "CROSS_TENANT_VISIBILITY");
  const snapshot = await snapshotPhaseACase(admin, f);
  if (approvedAudit) requireSafe(snapshot.technical_audit_hash === approvedAudit.technical_audit_hash,
    "STALE_TECHNICAL_JOURNAL");
  requireSafe(snapshot.counts.outbox === 0 && snapshot.counts.appointment_events === 0 && snapshot.confirmations === 0,
    "OPERATIONAL_DIRT");
  return { case_id: f.caseId, tenant_isolated: true, operational_counts: snapshot.counts };
}
