import { prisma } from "./prisma";
import {
  eachDayOfInterval,
  format,
  differenceInMinutes,
  startOfDay,
  endOfDay,
  subMonths,
  startOfMonth,
  endOfMonth,
} from "date-fns";

/**
 * Queries de BI do dashboard.
 * Todas exigem `salonId` — enforcement de tenant já na assinatura.
 */

export type Period = { from: Date; to: Date };

/**
 * Retorna o período equivalente do mês anterior (mesmo dia-do-mês).
 * Usado para as comparações MoM (▲▼).
 */
export function previousPeriod(p: Period): Period {
  return {
    from: startOfMonth(subMonths(p.from, 1)),
    to: endOfMonth(subMonths(p.to, 1)),
  };
}

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 1 : null;
  return (current - previous) / previous;
}

// ─── Faturamento por dia ────────────────────────────────────────────────

export async function getRevenueByDay(salonId: string, from: Date, to: Date) {
  const rows = await prisma.appointment.findMany({
    where: {
      salonId,
      status: "COMPLETED",
      startAt: { gte: from, lte: to },
    },
    select: { startAt: true, priceCents: true },
  });

  const bucket = new Map<string, number>();
  for (const d of eachDayOfInterval({ start: from, end: to })) {
    bucket.set(format(d, "yyyy-MM-dd"), 0);
  }
  for (const r of rows) {
    const key = format(r.startAt, "yyyy-MM-dd");
    bucket.set(key, (bucket.get(key) ?? 0) + r.priceCents);
  }

  return Array.from(bucket, ([date, cents]) => ({ date, cents }));
}

// ─── Totais + comparação ────────────────────────────────────────────────

async function revenueSums(salonId: string, from: Date, to: Date) {
  const agg = await prisma.appointment.aggregate({
    where: {
      salonId,
      status: "COMPLETED",
      startAt: { gte: from, lte: to },
    },
    _sum: { priceCents: true },
    _count: { _all: true },
  });
  return {
    revenueCents: agg._sum.priceCents ?? 0,
    completedCount: agg._count._all,
  };
}

export async function getRevenueTotals(salonId: string, from: Date, to: Date) {
  return revenueSums(salonId, from, to);
}

/**
 * Faturamento, atendimentos e ticket médio + variação % vs. mesmo período
 * do mês anterior. É o dado que alimenta os cards de KPI do dashboard.
 */
export async function getRevenueKpis(salonId: string, period: Period) {
  const prev = previousPeriod(period);
  const [curr, previous] = await Promise.all([
    revenueSums(salonId, period.from, period.to),
    revenueSums(salonId, prev.from, prev.to),
  ]);

  const currAvg =
    curr.completedCount > 0 ? curr.revenueCents / curr.completedCount : 0;
  const prevAvg =
    previous.completedCount > 0 ? previous.revenueCents / previous.completedCount : 0;

  return {
    revenue: {
      value: curr.revenueCents,
      previous: previous.revenueCents,
      change: pctChange(curr.revenueCents, previous.revenueCents),
    },
    appointments: {
      value: curr.completedCount,
      previous: previous.completedCount,
      change: pctChange(curr.completedCount, previous.completedCount),
    },
    avgTicket: {
      value: currAvg,
      previous: prevAvg,
      change: pctChange(currAvg, prevAvg),
    },
  };
}

// ─── Ocupação (com comparação) ──────────────────────────────────────────

async function occupancy(salonId: string, from: Date, to: Date) {
  const [appointments, workingHours, timeOffs, professionals] =
    await Promise.all([
      prisma.appointment.findMany({
        where: {
          salonId,
          startAt: { gte: from, lte: to },
          status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] },
        },
        select: { startAt: true, endAt: true },
      }),
      prisma.workingHours.findMany({
        where: { salonId },
        select: {
          weekday: true,
          startMinutes: true,
          endMinutes: true,
          professionalId: true,
        },
      }),
      prisma.timeOff.findMany({
        where: {
          professional: { salonId },
          startAt: { lte: to },
          endAt: { gte: from },
        },
        select: { startAt: true, endAt: true },
      }),
      prisma.professional.count({ where: { salonId, active: true } }),
    ]);

  const bookedMinutes = appointments.reduce(
    (sum, a) => sum + differenceInMinutes(a.endAt, a.startAt),
    0,
  );

  let availableMinutes = 0;
  for (const d of eachDayOfInterval({
    start: startOfDay(from),
    end: endOfDay(to),
  })) {
    const weekday = d.getDay();
    for (const wh of workingHours.filter((w) => w.weekday === weekday)) {
      availableMinutes += wh.endMinutes - wh.startMinutes;
    }
  }
  const timeOffMinutes = timeOffs.reduce(
    (sum, t) => sum + differenceInMinutes(t.endAt, t.startAt),
    0,
  );
  availableMinutes = Math.max(0, availableMinutes - timeOffMinutes);

  return {
    rate: availableMinutes > 0 ? bookedMinutes / availableMinutes : 0,
    bookedMinutes,
    availableMinutes,
    professionalCount: professionals,
  };
}

export async function getOccupancyRate(salonId: string, from: Date, to: Date) {
  return occupancy(salonId, from, to);
}

export async function getOccupancyKpi(salonId: string, period: Period) {
  const prev = previousPeriod(period);
  const [curr, previous] = await Promise.all([
    occupancy(salonId, period.from, period.to),
    occupancy(salonId, prev.from, prev.to),
  ]);
  return {
    ...curr,
    change: pctChange(curr.rate, previous.rate),
    previousRate: previous.rate,
  };
}

// ─── Top serviços & performance por profissional ────────────────────────

export async function getTopServices(
  salonId: string,
  from: Date,
  to: Date,
  limit = 5,
) {
  const grouped = await prisma.appointment.groupBy({
    by: ["serviceId"],
    where: {
      salonId,
      status: "COMPLETED",
      startAt: { gte: from, lte: to },
    },
    _sum: { priceCents: true },
    _count: { _all: true },
    orderBy: { _sum: { priceCents: "desc" } },
    take: limit,
  });

  const services = await prisma.service.findMany({
    where: { id: { in: grouped.map((g) => g.serviceId) } },
    select: { id: true, name: true, colorHex: true },
  });
  const byId = new Map(services.map((s) => [s.id, s]));

  return grouped.map((g) => ({
    serviceId: g.serviceId,
    name: byId.get(g.serviceId)?.name ?? "?",
    colorHex: byId.get(g.serviceId)?.colorHex ?? null,
    revenueCents: g._sum.priceCents ?? 0,
    count: g._count._all,
  }));
}

export async function getProfessionalPerformance(
  salonId: string,
  from: Date,
  to: Date,
) {
  const grouped = await prisma.appointment.groupBy({
    by: ["professionalId"],
    where: {
      salonId,
      status: "COMPLETED",
      startAt: { gte: from, lte: to },
    },
    _sum: { priceCents: true },
    _count: { _all: true },
  });

  const pros = await prisma.professional.findMany({
    where: { id: { in: grouped.map((g) => g.professionalId) } },
    select: {
      id: true,
      commissionPct: true,
      colorHex: true,
      user: { select: { name: true, avatarUrl: true } },
    },
  });
  const byId = new Map(pros.map((p) => [p.id, p]));

  return grouped
    .map((g) => {
      const pro = byId.get(g.professionalId);
      const revenue = g._sum.priceCents ?? 0;
      const commission = Math.round(
        (revenue * Number(pro?.commissionPct ?? 0)) / 100,
      );
      return {
        professionalId: g.professionalId,
        name: pro?.user.name ?? "?",
        avatarUrl: pro?.user.avatarUrl ?? null,
        colorHex: pro?.colorHex ?? null,
        revenueCents: revenue,
        commissionCents: commission,
        appointments: g._count._all,
      };
    })
    .sort((a, b) => b.revenueCents - a.revenueCents);
}
