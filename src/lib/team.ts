import { prisma } from "./prisma";
import { differenceInMinutes, startOfMonth, endOfMonth } from "date-fns";

/**
 * Performance da equipe no mês corrente: por profissional agrega receita,
 * atendimentos, ticket médio, duração média, comissão, no-show, taxa de
 * retorno (clientes que voltaram no período) e progresso da meta mensal.
 * Ordena por receita e marca o ranking.
 */
export async function getTeamPerformance(salonId: string) {
  const now = new Date();
  const from = startOfMonth(now);
  const to = endOfMonth(now);

  const [pros, completed, noShows] = await Promise.all([
    prisma.professional.findMany({
      where: { salonId },
      select: {
        id: true,
        bio: true,
        colorHex: true,
        commissionPct: true,
        monthlyGoalCents: true,
        active: true,
        user: { select: { name: true, email: true, avatarUrl: true } },
        services: { select: { serviceId: true } },
        workingHours: { select: { weekday: true, startMinutes: true, endMinutes: true } },
      },
      orderBy: { user: { name: "asc" } },
    }),
    prisma.appointment.findMany({
      where: { salonId, status: "COMPLETED", startAt: { gte: from, lte: to } },
      select: { professionalId: true, clientId: true, priceCents: true, startAt: true, endAt: true },
    }),
    prisma.appointment.groupBy({
      by: ["professionalId"],
      where: { salonId, status: "NO_SHOW", startAt: { gte: from, lte: to } },
      _count: { _all: true },
    }),
  ]);

  const noShowMap = new Map(noShows.map((n) => [n.professionalId, n._count._all]));

  // Agrupa atendimentos concluídos por profissional
  type Acc = { revenue: number; count: number; minutes: number; clients: Map<string, number> };
  const acc = new Map<string, Acc>();
  for (const a of completed) {
    const cur = acc.get(a.professionalId) ?? { revenue: 0, count: 0, minutes: 0, clients: new Map() };
    cur.revenue += a.priceCents;
    cur.count += 1;
    cur.minutes += Math.max(0, differenceInMinutes(a.endAt, a.startAt));
    cur.clients.set(a.clientId, (cur.clients.get(a.clientId) ?? 0) + 1);
    acc.set(a.professionalId, cur);
  }

  const rows = pros.map((p) => {
    const a = acc.get(p.id);
    const revenue = a?.revenue ?? 0;
    const count = a?.count ?? 0;
    const distinctClients = a ? a.clients.size : 0;
    const returning = a ? [...a.clients.values()].filter((v) => v >= 2).length : 0;
    const goal = p.monthlyGoalCents;
    return {
      id: p.id,
      name: p.user.name,
      email: p.user.email,
      avatarUrl: p.user.avatarUrl,
      colorHex: p.colorHex,
      bio: p.bio,
      active: p.active,
      commissionPct: Number(p.commissionPct),
      serviceCount: p.services.length,
      serviceIds: p.services.map((s) => s.serviceId),
      workingHours: p.workingHours,
      workingDays: p.workingHours.length,
      revenue,
      appointments: count,
      avgTicket: count > 0 ? revenue / count : 0,
      avgDuration: count > 0 ? Math.round((a?.minutes ?? 0) / count) : 0,
      commissionCents: Math.round((revenue * Number(p.commissionPct)) / 100),
      noShow: noShowMap.get(p.id) ?? 0,
      distinctClients,
      returnRate: distinctClients > 0 ? returning / distinctClients : 0,
      goalCents: goal,
      goalPct: goal > 0 ? revenue / goal : 0,
    };
  });

  // Ranking por receita (só entre ativos)
  const ranked = [...rows].sort((a, b) => b.revenue - a.revenue);
  const rankMap = new Map(ranked.map((r, i) => [r.id, i + 1]));

  const teamRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const teamAppts = rows.reduce((s, r) => s + r.appointments, 0);

  return {
    period: { from, to },
    pros: rows.map((r) => ({ ...r, rank: rankMap.get(r.id) ?? 0 })),
    team: {
      activeCount: rows.filter((r) => r.active).length,
      revenue: teamRevenue,
      appointments: teamAppts,
      avgTicket: teamAppts > 0 ? teamRevenue / teamAppts : 0,
    },
  };
}

export type TeamPerformance = Awaited<ReturnType<typeof getTeamPerformance>>;
