import { Prisma } from "@prisma/client";
import type { Tx } from "./prisma-tenant";
import { setSalonGuc } from "./prisma-tenant";

// These are the only registration records that may disappear with an empty salon.
// Access decisions are copied into the independent HQ audit before deletion.
const registrationTables = new Set(["Membership", "WorkingHours", "SalonAccessEvent"]);
// Unknown dependencies fail closed: a future table may have a different read
// policy, and an RLS-filtered zero must never authorize a cascading deletion.
const inspectedTables = new Set([
  "BillingSubscription", "hq_accounts", "Professional", "Service", "ClientProfile",
  "Appointment", "Product", "AppointmentProduct", "PortfolioItem", "Expense", "ProfessionalOpening",
  "Package", "MembershipPlan", "UserInvite", "WaitlistEntry", "SalonClosure",
  "AuditLog", "AppointmentService", "AppointmentEvent", "NotificationOutbox",
  "PlatformInvoice", "ClientReview", "ServicePricingRule", "RescheduleProposal",
  "PhysicalResource", "ResourceBooking", "ClientDependent", "CareEntry",
  "FlexibleWaitlist", "FlexibleWaitlistService",
]);
const identifier = (value: string) => Prisma.raw('"' + value.replaceAll('"', '""') + '"');

export async function inspectSalonRemoval(tx: Tx, actorId: string, salonId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { platformRole: true } });
  if (actor?.platformRole !== "SUPER_ADMIN") throw new Error("Acesso restrito à administração.");
  await setSalonGuc(tx, salonId);
  const salon = await tx.salon.findUnique({ where: { id: salonId }, select: { id: true, name: true, slug: true, accessStatus: true } });
  if (!salon) throw new Error("Estabelecimento não encontrado.");
  // Discover actual FK dependencies, including future tables and optional migrations.
  // Identifiers come exclusively from PostgreSQL's catalog; values stay bound.
  const dependencies = await tx.$queryRaw<{ schema: string; table: string; column: string }[]>`
    SELECT DISTINCT ns.nspname AS schema, t.relname AS table, a.attname AS column
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace ns ON ns.oid=t.relnamespace
    JOIN LATERAL unnest(c.conkey, c.confkey) AS keys(local_key, remote_key) ON true
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=keys.local_key
    JOIN pg_attribute target ON target.attrelid=c.confrelid AND target.attnum=keys.remote_key
    WHERE c.contype='f' AND c.confrelid='public."Salon"'::regclass AND target.attname='id'`;
  const blockers: { table: string; count: number }[] = [];
  const checks: Prisma.Sql[] = [];
  for (const dependency of dependencies) {
    if (dependency.schema === "public" && registrationTables.has(dependency.table)) continue;
    if (dependency.schema !== "public" || !inspectedTables.has(dependency.table)) {
      blockers.push({ table: dependency.table, count: -1 });
      continue;
    }
    checks.push(Prisma.sql`SELECT ${dependency.table}::text AS table, count(*) AS count FROM ${identifier(dependency.schema)}.${identifier(dependency.table)} WHERE ${identifier(dependency.column)} = ${salonId}`);
  }
  if (checks.length) {
    const rows = await tx.$queryRaw<{ table: string; count: bigint }[]>(Prisma.join(checks, " UNION ALL "));
    blockers.push(...rows.filter(row => row.count > 0n).map(row => ({ table: row.table, count: Number(row.count) })));
  }
  const team = await tx.membership.count({ where: { salonId, role: { not: "OWNER" } } });
  if (team) blockers.push({ table: "Membership", count: team });
  return { salon, blockers, eligible: ["SUSPENDED", "REJECTED"].includes(salon.accessStatus) && blockers.length === 0 };
}

export async function removeEmptySalon(tx: Tx, actorId: string, salonId: string, confirmation: string) {
  // Match billing's lock order. FOR UPDATE also serializes FK inserts before the
  // final inspection, so a new client/reservation cannot slip into the cascade.
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`billing:${salonId}`}, 0))`;
  await setSalonGuc(tx, salonId);
  await tx.$queryRaw`SELECT id FROM "Salon" WHERE id=${salonId} FOR UPDATE`;
  const inspection = await inspectSalonRemoval(tx, actorId, salonId);
  if (confirmation !== inspection.salon.slug) throw new Error("Digite o identificador exato do estabelecimento.");
  if (!inspection.eligible) throw new Error("Exclusão bloqueada: o estabelecimento está ativo ou possui clientes, histórico ou outros vínculos. Nenhum dado foi apagado.");
  const decisions = await tx.salonAccessEvent.findMany({ where: { salonId }, orderBy: { createdAt: "asc" } });
  await tx.hqActivities.create({ data: {
    actorId, kind: "Observação", entityType: "Salon", entityId: salonId,
    description: `Cadastro vazio excluído: ${inspection.salon.name} (${inspection.salon.slug}). Contas de usuários preservadas.`,
    metadata: JSON.parse(JSON.stringify({ salon: inspection.salon, decisions })),
  } });
  await tx.salon.delete({ where: { id: salonId } });
  return { ok: true as const };
}
