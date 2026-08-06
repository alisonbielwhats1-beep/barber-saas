import type { Tx } from "./prisma-tenant";
import { differenceInMinutes, subMonths, startOfMonth, endOfMonth } from "date-fns";
import {
  DEFAULT_TIMEZONE,
  addCalendarDays,
  dateKeyInTimeZone,
  weekdayOfDateKey,
} from "./time";

/**
 * Queries de BI do dashboard.
 *
 * Toda função recebe `tx` (a transação com o contexto de tenant já setado,
 * de `withTenant`/`withSalon`) como primeiro parâmetro, em vez de abrir a
 * própria conexão via `prisma` cru — assim o chamador decide o tenant, e
 * várias chamadas deste arquivo dentro do mesmo `withTenant` reaproveitam a
 * mesma conexão em vez de abrir uma por função.
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

export async function getRevenueByDay(
  tx: Tx,
  salonId: string,
  from: Date,
  to: Date,
  timezone = DEFAULT_TIMEZONE,
) {
  const rows = await tx.appointment.findMany({
    where: {
      salonId,
      status: "COMPLETED",
      startAt: { gte: from, lt: to },
    },
    select: { startAt: true, priceCents: true },
  });

  const bucket = new Map<string, number>();
  const toDate = dateKeyInTimeZone(to, timezone);
  for (
    let date = dateKeyInTimeZone(from, timezone);
    date < toDate;
    date = addCalendarDays(date, 1)
  ) {
    bucket.set(date, 0);
  }
  for (const r of rows) {
    const key = dateKeyInTimeZone(r.startAt, timezone);
    bucket.set(key, (bucket.get(key) ?? 0) + r.priceCents);
  }

  return Array.from(bucket, ([date, cents]) => ({ date, cents }));
}

// ─── Totais + comparação ────────────────────────────────────────────────

async function revenueSums(tx: Tx, salonId: string, from: Date, to: Date) {
  const agg = await tx.appointment.aggregate({
    where: {
      salonId,
      status: "COMPLETED",
      startAt: { gte: from, lt: to },
    },
    _sum: { priceCents: true },
    _count: { _all: true },
  });
  return {
    revenueCents: agg._sum.priceCents ?? 0,
    completedCount: agg._count._all,
  };
}

export async function getRevenueTotals(tx: Tx, salonId: string, from: Date, to: Date) {
  return revenueSums(tx, salonId, from, to);
}

/**
 * Faturamento, atendimentos e ticket médio + variação % vs. mesmo período
 * do mês anterior. É o dado que alimenta os cards de KPI do dashboard.
 *
 * Sequencial de propósito (não Promise.all): concorrência dentro da mesma
 * conexão/transação não reintroduz o esgotamento de pool que as waves de 4
 * evitam — mas as duas chamadas usam a MESMA conexão, então rodar em
 * paralelo não traria ganho real de qualquer forma.
 */
export async function getRevenueKpis(tx: Tx, salonId: string, period: Period) {
  const prev = previousPeriod(period);
  const curr = await revenueSums(tx, salonId, period.from, period.to);
  const previous = await revenueSums(tx, salonId, prev.from, prev.to);

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

async function occupancy(
  tx: Tx,
  salonId: string,
  from: Date,
  to: Date,
  timezone: string,
) {
  // Sequencial de propósito: o pool de conexão do Postgres (Supabase pooler)
  // roda com connection_limit=1 em serverless — 4 queries em paralelo aqui
  // estouravam o timeout de 10s do pool (P2024) quando somadas às outras
  // consultas concorrentes do dashboard. Ver getDashboardMetrics.
  const appointments = await tx.appointment.findMany({
    where: {
      salonId,
      startAt: { gte: from, lt: to },
      status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] },
    },
    select: { startAt: true, endAt: true },
  });
  const workingHours = await tx.workingHours.findMany({
    where: { salonId },
    select: {
      weekday: true,
      startMinutes: true,
      endMinutes: true,
      professionalId: true,
    },
  });
  const timeOffs = await tx.timeOff.findMany({
    where: {
      professional: { salonId },
      startAt: { lt: to },
      endAt: { gt: from },
    },
    select: { startAt: true, endAt: true },
  });
  const professionals = await tx.professional.count({
    where: { salonId, active: true },
  });

  const bookedMinutes = appointments.reduce(
    (sum, a) => sum + differenceInMinutes(a.endAt, a.startAt),
    0,
  );

  let availableMinutes = 0;
  const toDate = dateKeyInTimeZone(to, timezone);
  for (
    let date = dateKeyInTimeZone(from, timezone);
    date < toDate;
    date = addCalendarDays(date, 1)
  ) {
    const weekday = weekdayOfDateKey(date);
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

export async function getOccupancyRate(
  tx: Tx,
  salonId: string,
  from: Date,
  to: Date,
  timezone = DEFAULT_TIMEZONE,
) {
  return occupancy(tx, salonId, from, to, timezone);
}

export async function getOccupancyKpi(tx: Tx, salonId: string, period: Period) {
  const prev = previousPeriod(period);
  const curr = await occupancy(tx, salonId, period.from, period.to, DEFAULT_TIMEZONE);
  const previous = await occupancy(tx, salonId, prev.from, prev.to, DEFAULT_TIMEZONE);
  return {
    ...curr,
    change: pctChange(curr.rate, previous.rate),
    previousRate: previous.rate,
  };
}

// ─── Top serviços & performance por profissional ────────────────────────

export async function getTopServices(
  tx: Tx,
  salonId: string,
  from: Date,
  to: Date,
  limit = 5,
) {
  const grouped = await tx.appointment.groupBy({
    by: ["serviceId"],
    where: {
      salonId,
      status: "COMPLETED",
      startAt: { gte: from, lt: to },
    },
    _sum: { priceCents: true },
    _count: { _all: true },
    orderBy: { _sum: { priceCents: "desc" } },
    take: limit,
  });

  const services = await tx.service.findMany({
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
  tx: Tx,
  salonId: string,
  from: Date,
  to: Date,
) {
  const grouped = await tx.appointment.groupBy({
    by: ["professionalId"],
    where: {
      salonId,
      status: "COMPLETED",
      startAt: { gte: from, lt: to },
    },
    _sum: { priceCents: true },
    _count: { _all: true },
  });

  const pros = await tx.professional.findMany({
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
