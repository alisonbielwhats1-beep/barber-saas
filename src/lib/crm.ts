import type { Tx } from "./prisma-tenant";
import { differenceInDays } from "date-fns";
import { parseClientCareProfile } from "./client-care-profile";
import { loyaltyProgress } from "./growth-tools";
import { calculateLoyaltyBalance } from "./operational-flows";
import { normalizeLapsedClientDays } from "./marketing-settings";

/**
 * Motor de CRM: consolida, por cliente, LTV, visitas, última visita,
 * profissional e serviço favoritos, nível de fidelidade e segmentação
 * (VIP, sumido, aniversariante do mês). Usa só dados reais de atendimentos.
 */

export type LoyaltyTier = "Novo" | "Bronze" | "Prata" | "Ouro" | "Diamante";

export function loyaltyOf(visits: number): { tier: LoyaltyTier; color: string } {
  if (visits >= 16) return { tier: "Diamante", color: "#3B9EFF" };
  if (visits >= 8) return { tier: "Ouro", color: "#F4C430" };
  if (visits >= 3) return { tier: "Prata", color: "#C0C0C0" };
  if (visits >= 1) return { tier: "Bronze", color: "#CD7F32" };
  return { tier: "Novo", color: "#94A3B8" };
}

function topOf(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let n = 0;
  for (const [k, v] of counts) if (v > n) { n = v; best = k; }
  return best;
}

export async function getClientList(
  tx: Tx,
  salonId: string,
  options?: { professionalId?: string; includeCommercialData?: boolean; lapsedClientDays?: number },
) {
  const now = new Date();
  const professionalId = options?.professionalId;
  const lapsedClientDays = normalizeLapsedClientDays(options?.lapsedClientDays);
  // Sequencial de propósito: pooler com connection_limit=1 em serverless —
  // 5 queries em Promise.all estouravam o timeout do pool (P2024).
  // Mesma correção aplicada em lib/dashboard.ts, lib/kpis.ts e lib/finance.ts.
  const clients = await tx.clientProfile.findMany({
    where: {
      salonId,
      ...(professionalId
        ? { appointments: { some: { professionalId } } }
        : {}),
    },
    select: {
      id: true, name: true, phone: true, email: true, birthday: true, gender: true, notes: true, createdAt: true,
      appointments: {
        where: {
          status: "COMPLETED",
          ...(professionalId ? { professionalId } : {}),
        },
        select: { priceCents: true, startAt: true, professionalId: true, serviceId: true },
      },
    },
    orderBy: { name: "asc" },
  });
  const pros = await tx.professional.findMany({
    where: { salonId, ...(professionalId ? { id: professionalId } : {}) },
    select: { id: true, user: { select: { name: true } } },
  });
  const services = await tx.service.findMany({ where: { salonId }, select: { id: true, name: true } });
  const activePkgs = options?.includeCommercialData === false
    ? []
    : await tx.packagePurchase.groupBy({ by: ["clientId"], where: { salonId, status: "ACTIVE" }, _count: { _all: true } });
  const activeSubs = options?.includeCommercialData === false
    ? []
    : await tx.clientSubscription.groupBy({ by: ["clientId"], where: { salonId, status: "ACTIVE" }, _count: { _all: true } });
  const loyaltyRedemptions = options?.includeCommercialData === false
    ? []
    : await tx.auditLog.findMany({
        where: { salonId, action: "LOYALTY_REDEEMED", entityType: "ClientProfile" },
        select: { entityId: true, metadata: true },
      });

  const proName = new Map(pros.map((p) => [p.id, p.user.name]));
  const svcName = new Map(services.map((s) => [s.id, s.name]));
  const pkgCount = new Map(activePkgs.map((g) => [g.clientId, g._count._all]));
  const subCount = new Map(activeSubs.map((g) => [g.clientId, g._count._all]));
  const redeemedPoints = new Map<string, number>();
  for (const redemption of loyaltyRedemptions) {
    const metadata = redemption.metadata as Record<string, unknown> | null;
    const points = typeof metadata?.points === "number" ? Math.max(0, Math.floor(metadata.points)) : 0;
    redeemedPoints.set(redemption.entityId, (redeemedPoints.get(redemption.entityId) ?? 0) + points);
  }

  return clients.map((c) => {
    const visits = c.appointments.length;
    const totalSpent = c.appointments.reduce((s, a) => s + a.priceCents, 0);
    const dates = c.appointments.map((a) => a.startAt).sort((a, b) => +b - +a);
    const lastVisit = dates[0] ?? null;
    const daysSince = lastVisit ? differenceInDays(now, lastVisit) : null;

    const proCounts = new Map<string, number>();
    const svcCounts = new Map<string, number>();
    for (const a of c.appointments) {
      proCounts.set(a.professionalId, (proCounts.get(a.professionalId) ?? 0) + 1);
      svcCounts.set(a.serviceId, (svcCounts.get(a.serviceId) ?? 0) + 1);
    }
    const favProId = topOf(proCounts);
    const favSvcId = topOf(svcCounts);

    const loyalty = loyaltyOf(visits);
    const loyaltyStatus = loyaltyProgress(visits);
    const loyaltyBalance = calculateLoyaltyBalance({ completedVisits: visits, redeemedPoints: redeemedPoints.get(c.id) ?? 0, rewardCost: 5 });
    const care = parseClientCareProfile(c.notes);
    const isVip = totalSpent >= 50000 || visits >= 8;
    const isLapsed = visits > 0 && daysSince != null && daysSince >= lapsedClientDays;
    const birthdayThisMonth = c.birthday ? c.birthday.getMonth() === now.getMonth() : false;

    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      gender: c.gender,
      notes: care.notes,
      allergies: care.allergies,
      preferences: care.preferences,
      consentGiven: care.consentGiven,
      birthday: c.birthday ? c.birthday.toISOString() : null,
      createdAt: c.createdAt.toISOString(),
      visits,
      totalSpent,
      avgTicket: visits > 0 ? Math.round(totalSpent / visits) : 0,
      lastVisit: lastVisit ? lastVisit.toISOString() : null,
      daysSince,
      favoritePro: favProId ? proName.get(favProId) ?? null : null,
      favoriteService: favSvcId ? svcName.get(favSvcId) ?? null : null,
      loyaltyTier: loyalty.tier,
      loyaltyColor: loyalty.color,
      loyaltyPoints: loyaltyBalance.availablePoints,
      loyaltyEarnedPoints: loyaltyBalance.earnedPoints,
      loyaltyRedeemedPoints: loyaltyBalance.redeemedPoints,
      canRedeemLoyaltyReward: loyaltyBalance.canRedeem,
      nextLoyaltyTier: loyaltyStatus.nextTier,
      loyaltyRemaining: loyaltyStatus.remaining,
      loyaltyProgressPct: loyaltyStatus.progressPct,
      activePackages: pkgCount.get(c.id) ?? 0,
      activeSubscriptions: subCount.get(c.id) ?? 0,
      isVip,
      isLapsed,
      birthdayThisMonth,
    };
  });
}

export type ClientRow = Awaited<ReturnType<typeof getClientList>>[number];

export async function getClientHistory(
  tx: Tx,
  salonId: string,
  clientId: string,
  professionalId?: string,
) {
  const appts = await tx.appointment.findMany({
    where: { salonId, clientId, ...(professionalId ? { professionalId } : {}) },
    orderBy: { startAt: "desc" },
    take: 40,
    select: {
      id: true, startAt: true, priceCents: true, status: true,
      service: { select: { name: true, colorHex: true } },
      serviceItems: {
        orderBy: { position: "asc" },
        select: { serviceName: true },
      },
      professional: { select: { user: { select: { name: true } } } },
    },
  });
  return appts.map((a) => ({
    id: a.id,
    startAt: a.startAt.toISOString(),
    priceCents: a.priceCents,
    status: a.status,
    serviceName: a.serviceItems.length > 0
      ? a.serviceItems.map((service) => service.serviceName).join(" + ")
      : a.service.name,
    serviceColor: a.service.colorHex,
    proName: a.professional.user.name,
  }));
}
