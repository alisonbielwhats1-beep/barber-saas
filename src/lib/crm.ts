import { prisma } from "./prisma";
import { differenceInDays } from "date-fns";

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

export async function getClientList(salonId: string) {
  const now = new Date();
  const [clients, pros, services, activePkgs, activeSubs] = await Promise.all([
    prisma.clientProfile.findMany({
      where: { salonId },
      select: {
        id: true, name: true, phone: true, email: true, birthday: true, gender: true, notes: true, createdAt: true,
        appointments: {
          where: { status: "COMPLETED" },
          select: { priceCents: true, startAt: true, professionalId: true, serviceId: true },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.professional.findMany({ where: { salonId }, select: { id: true, user: { select: { name: true } } } }),
    prisma.service.findMany({ where: { salonId }, select: { id: true, name: true } }),
    prisma.packagePurchase.groupBy({ by: ["clientId"], where: { salonId, status: "ACTIVE" }, _count: { _all: true } }),
    prisma.clientSubscription.groupBy({ by: ["clientId"], where: { salonId, status: "ACTIVE" }, _count: { _all: true } }),
  ]);

  const proName = new Map(pros.map((p) => [p.id, p.user.name]));
  const svcName = new Map(services.map((s) => [s.id, s.name]));
  const pkgCount = new Map(activePkgs.map((g) => [g.clientId, g._count._all]));
  const subCount = new Map(activeSubs.map((g) => [g.clientId, g._count._all]));

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
    const isVip = totalSpent >= 50000 || visits >= 8;
    const isLapsed = visits > 0 && daysSince != null && daysSince > 60;
    const birthdayThisMonth = c.birthday ? c.birthday.getMonth() === now.getMonth() : false;

    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      gender: c.gender,
      notes: c.notes,
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
      activePackages: pkgCount.get(c.id) ?? 0,
      activeSubscriptions: subCount.get(c.id) ?? 0,
      isVip,
      isLapsed,
      birthdayThisMonth,
    };
  });
}

export type ClientRow = Awaited<ReturnType<typeof getClientList>>[number];

export async function getClientHistory(salonId: string, clientId: string) {
  const appts = await prisma.appointment.findMany({
    where: { salonId, clientId },
    orderBy: { startAt: "desc" },
    take: 40,
    select: {
      id: true, startAt: true, priceCents: true, status: true,
      service: { select: { name: true, colorHex: true } },
      professional: { select: { user: { select: { name: true } } } },
    },
  });
  return appts.map((a) => ({
    id: a.id,
    startAt: a.startAt.toISOString(),
    priceCents: a.priceCents,
    status: a.status,
    serviceName: a.service.name,
    serviceColor: a.service.colorHex,
    proName: a.professional.user.name,
  }));
}
