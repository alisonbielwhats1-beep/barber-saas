import { z } from "zod";
import { fromZonedTime } from "date-fns-tz";
import { setSalonGuc, type Tx } from "../prisma-tenant";
import type { PlanEntitlement } from "../plan-entitlements";
import { getPlanEntitlement } from "../plan-entitlements";
import { BILLING_PLANS, quoteContract } from "./catalog";

export const planGrantsEnabled = () => process.env.PLATFORM_PLAN_GRANTS_ENABLED === "true";
export const grantInput = z.object({
  salonId: z.string().min(1).max(100),
  requestKey: z.string().uuid(),
  plan: z.enum(["INDIVIDUAL", "TEAM", "TEAM_PLUS", "TEAM_MAX"]),
  through: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(3).max(500),
}).strict();

/** The chosen civil date is inclusive; access ends at next midnight in the salon's zone. */
export function grantExpiry(through: string, timezone: string, now: Date) {
  const day = new Date(through + "T00:00:00Z");
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== through) throw new Error("Data inválida.");
  day.setUTCDate(day.getUTCDate() + 1);
  const end = fromZonedTime(day.toISOString().slice(0, 10) + "T00:00:00", timezone);
  if (!Number.isFinite(end.getTime()) || end <= now || end.getTime() - now.getTime() > 366 * 86400000) throw new Error("Escolha um término futuro dentro de um ano.");
  return end;
}

export async function activePlanGrant(tx: Tx, salonId: string, now = new Date()) {
  if (!planGrantsEnabled()) return null;
  return tx.salonPlanGrant.findFirst({ where: { salonId, revokedAt: null, createdAt: { lte: now }, endsAt: { gt: now } }, orderBy: { createdAt: "desc" } });
}

export function grantEntitlement(grant: { planCode: string; amountCents: number; agendaLimit: number }): PlanEntitlement {
  const plan = grantInput.shape.plan.parse(grant.planCode);
  return { label: BILLING_PLANS[plan].label, priceCents: grant.amountCents, maxProfessionals: grant.agendaLimit,
    monthlyAppointments: null, features: { MARKETING: true, INVENTORY: true, PACKAGES: true } };
}

/** Never extends a paid, expired or delinquent contract by administrative accident. */
export async function complimentaryEntitlement(tx: Tx, salonId: string, now = new Date()) {
  const grant = await activePlanGrant(tx, salonId, now);
  if (!grant) return null;
  const paid = await tx.billingSubscription.findFirst({ where: { salonId, OR: [{ paidThrough: { not: null } }, { reviewRequired: true }] }, select: { id: true } });
  return paid ? null : grant;
}

// Existing paid/legacy feature permissions remain unchanged; courtesy is temporary.
export async function featureEntitlement(tx: Tx, salonId: string, legacyPlan: string | undefined, now = new Date()) {
  const grant = await complimentaryEntitlement(tx, salonId, now);
  return grant ? grantEntitlement(grant) : getPlanEntitlement(legacyPlan);
}

export async function grantPlan(tx: Tx, actorId: string, raw: unknown, now = new Date()) {
  if (!planGrantsEnabled()) throw new Error("Cortesias aguardam ativação após a validação do banco.");
  const input = grantInput.parse(raw);
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { platformRole: true } });
  if (actor?.platformRole !== "SUPER_ADMIN") throw new Error("Acesso restrito à administração.");
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`billing:${input.salonId}`}, 0))`;
  await setSalonGuc(tx, input.salonId);
  const salon = await tx.salon.findUniqueOrThrow({ where: { id: input.salonId } });
  const previous = await tx.salonPlanGrant.findUnique({ where: { salonId_requestKey: { salonId: input.salonId, requestKey: input.requestKey } } });
  if (previous) {
    if (previous.planCode !== input.plan || previous.throughDate !== input.through || previous.reason !== input.reason) throw new Error("Solicitação já usada com outros dados.");
    return previous;
  }
  if (salon.accessStatus !== "APPROVED") throw new Error("Libere o acesso do estabelecimento antes de conceder a cortesia.");
  // Preserve grandfathered access and all existing financial contracts.
  if (salon.plan !== "FREE" || await tx.billingSubscription.count({ where: { salonId: salon.id } })) throw new Error("Este estabelecimento já possui plano legado ou assinatura. Gerencie o contrato existente; a cortesia não o substitui.");
  const endsAt = grantExpiry(input.through, salon.timezone, now);
  const quote = quoteContract({ plan: input.plan, cycle: "MONTHLY", extraAgendas: 0 });
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`professional-capacity:${salon.id}`}, 0))`;
  const professionals = await tx.professional.count({ where: { salonId: salon.id, active: true } });
  const invites = await tx.userInvite.count({ where: { salonId: salon.id, role: "PROFESSIONAL", usedAt: null, revokedAt: null, expiresAt: { gt: now } } });
  if (professionals + invites > quote.agendaLimit) throw new Error("O plano não comporta as agendas ativas e os convites pendentes.");
  await tx.salonPlanGrant.updateMany({ where: { salonId: salon.id, revokedAt: null }, data: { revokedAt: now } });
  const grant = await tx.salonPlanGrant.create({ data: {
    salonId: salon.id, actorUserId: actorId, requestKey: input.requestKey, reason: input.reason,
    planCode: input.plan, throughDate: input.through, endsAt, createdAt: now, catalogVersion: quote.catalogVersion,
    amountCents: quote.amountCents, agendaLimit: quote.agendaLimit,
  } });
  const owner = await tx.membership.findFirst({ where: { salonId: salon.id, role: "OWNER" }, select: { user: { select: { name: true, email: true } } }, orderBy: { userId: "asc" } });
  const account = await tx.hqAccounts.upsert({ where: { billingSalonId: salon.id }, update: {}, create: {
    billingSalonId: salon.id, name: owner?.user.name || salon.name, business: salon.name, email: owner?.user.email,
    phone: salon.phone, whatsapp: salon.whatsapp, instagram: salon.instagram, segment: salon.segment, source: "Cortesia administrativa",
  } });
  await tx.hqCustomers.upsert({ where: { accountId: account.id }, update: {}, create: { accountId: account.id, status: "Teste", startedAt: now } });
  await tx.hqActivities.create({ data: { accountId: account.id, actorId, kind: "Observação", entityType: "SalonPlanGrant", entityId: grant.id,
    description: `Cortesia ${BILLING_PLANS[input.plan].label} até ${input.through}, inclusive. Referência mensal R$ ${(quote.amountCents / 100).toFixed(2)}. Sem cobrança automática. ${input.reason}`,
    metadata: { salonId: salon.id, grantId: grant.id, endsAt: endsAt.toISOString(), amountCents: quote.amountCents } } });
  return grant;
}
