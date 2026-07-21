import { prisma } from "./prisma";
import {
  startOfDay,
  endOfDay,
  subDays,
  addDays,
  startOfYear,
  differenceInCalendarDays,
  differenceInMinutes,
  eachDayOfInterval,
  format,
} from "date-fns";
import { getProfessionalPerformance, getTopServices, getOccupancyRate } from "./kpis";

/**
 * Motor de métricas do dashboard do dono. Uma única função resolve o período
 * a partir do filtro (`range`), roda as queries em paralelo e devolve o
 * conjunto completo de indicadores + comparação com o período anterior de
 * mesmo tamanho. Split por gênero incluído (campo ClientProfile.gender).
 *
 * Só calcula o que existe de verdade no schema — nada de número inventado.
 */

export type RangeKey = "today" | "yesterday" | "7d" | "15d" | "30d" | "90d" | "year";

export const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  "7d": "7 dias",
  "15d": "15 dias",
  "30d": "30 dias",
  "90d": "90 dias",
  year: "Este ano",
};

export function resolveRange(range: RangeKey, now = new Date()) {
  switch (range) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "yesterday": {
      const d = subDays(now, 1);
      return { from: startOfDay(d), to: endOfDay(d) };
    }
    case "7d":
      return { from: startOfDay(subDays(now, 6)), to: endOfDay(now) };
    case "15d":
      return { from: startOfDay(subDays(now, 14)), to: endOfDay(now) };
    case "30d":
      return { from: startOfDay(subDays(now, 29)), to: endOfDay(now) };
    case "90d":
      return { from: startOfDay(subDays(now, 89)), to: endOfDay(now) };
    case "year":
      return { from: startOfYear(now), to: endOfDay(now) };
  }
}

function previousWindow(from: Date, to: Date) {
  const len = differenceInCalendarDays(to, from) + 1;
  return { from: startOfDay(subDays(from, len)), to: endOfDay(subDays(from, 1)) };
}

function pctChange(curr: number, prev: number): number | null {
  if (prev === 0) return curr > 0 ? 1 : null;
  return (curr - prev) / prev;
}

const SCHEDULED = ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] as const;

export async function getDashboardMetrics(salonId: string, range: RangeKey) {
  const now = new Date();
  const { from, to } = resolveRange(range, now);
  const prev = previousWindow(from, to);
  const lostThreshold = subDays(now, 60);

  const [
    completed,
    prevCompleted,
    statusGroups,
    upcoming,
    proPerf,
    topServices,
    occupancy,
    clientsByGender,
    newClientsByGender,
    clientAgg,
    professionals,
    productsSoldAgg,
    outOfStock,
    totalClients,
  ] = await Promise.all([
    // 1. Atendimentos concluídos no período (motor de receita, ticket, gênero)
    prisma.appointment.findMany({
      where: { salonId, status: "COMPLETED", startAt: { gte: from, lte: to } },
      select: {
        priceCents: true,
        startAt: true,
        endAt: true,
        serviceId: true,
        client: { select: { gender: true } },
        service: { select: { name: true, colorHex: true } },
      },
    }),
    // 2. Concluídos no período anterior (comparação)
    prisma.appointment.aggregate({
      where: { salonId, status: "COMPLETED", startAt: { gte: prev.from, lte: prev.to } },
      _sum: { priceCents: true },
      _count: { _all: true },
    }),
    // 3. Contagem por status no período (cancelamentos, no-show)
    prisma.appointment.groupBy({
      by: ["status"],
      where: { salonId, startAt: { gte: from, lte: to } },
      _count: { _all: true },
    }),
    // 4. Próximos agendamentos (previsão, hoje, amanhã, comissão pendente)
    prisma.appointment.findMany({
      where: {
        salonId,
        status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] },
        startAt: { gte: startOfDay(now) },
      },
      select: { startAt: true, priceCents: true, professionalId: true },
    }),
    getProfessionalPerformance(salonId, from, to),
    getTopServices(salonId, from, to, 5),
    getOccupancyRate(salonId, from, to),
    // Clientes por gênero (base total)
    prisma.clientProfile.groupBy({
      by: ["gender"],
      where: { salonId },
      _count: { _all: true },
    }),
    // Novos clientes por gênero no período
    prisma.clientProfile.groupBy({
      by: ["gender"],
      where: { salonId, createdAt: { gte: from, lte: to } },
      _count: { _all: true },
    }),
    // Por cliente: nº de concluídos + último atendimento (retorno/perdidos)
    prisma.appointment.groupBy({
      by: ["clientId"],
      where: { salonId, status: "COMPLETED" },
      _count: { _all: true },
      _max: { startAt: true },
    }),
    prisma.professional.findMany({
      where: { salonId },
      select: { id: true, commissionPct: true },
    }),
    // Produtos vendidos no período
    prisma.appointmentProduct.aggregate({
      where: { appointment: { salonId, startAt: { gte: from, lte: to } } },
      _sum: { quantity: true },
    }),
    prisma.product.count({ where: { salonId, active: true, stock: { lte: 0 } } }),
    prisma.clientProfile.count({ where: { salonId } }),
  ]);

  // ── Receita / ticket / duração ────────────────────────────────
  const revenue = completed.reduce((s, a) => s + a.priceCents, 0);
  const count = completed.length;
  const avgTicket = count > 0 ? revenue / count : 0;
  const avgDuration =
    count > 0
      ? Math.round(
          completed.reduce((s, a) => s + differenceInMinutes(a.endAt, a.startAt), 0) / count,
        )
      : 0;

  const prevRevenue = prevCompleted._sum.priceCents ?? 0;
  const prevCount = prevCompleted._count._all;
  const prevAvg = prevCount > 0 ? prevRevenue / prevCount : 0;

  // Receita de hoje (subconjunto, independe do filtro)
  const revenueToday = completed
    .filter((a) => a.startAt >= startOfDay(now) && a.startAt <= endOfDay(now))
    .reduce((s, a) => s + a.priceCents, 0);

  // ── Comissões / lucro ─────────────────────────────────────────
  const commissionPaid = proPerf.reduce((s, p) => s + p.commissionCents, 0);
  const profit = revenue - commissionPaid;
  const commissionPctById = new Map(
    professionals.map((p) => [p.id, Number(p.commissionPct)]),
  );

  // ── Status ────────────────────────────────────────────────────
  const statusCount = (s: string) =>
    statusGroups.find((g) => g.status === s)?._count._all ?? 0;
  const cancellations = statusCount("CANCELLED");
  const noShow = statusCount("NO_SHOW");

  // ── Próximos ──────────────────────────────────────────────────
  const in30 = addDays(now, 30);
  const forecast = upcoming
    .filter((a) => a.startAt <= in30)
    .reduce((s, a) => s + a.priceCents, 0);
  const commissionPending = upcoming.reduce(
    (s, a) => s + Math.round((a.priceCents * (commissionPctById.get(a.professionalId) ?? 0)) / 100),
    0,
  );
  const tomorrow = addDays(now, 1);
  const apptsToday = upcoming.filter(
    (a) => a.startAt >= startOfDay(now) && a.startAt <= endOfDay(now),
  ).length;
  const apptsTomorrow = upcoming.filter(
    (a) => a.startAt >= startOfDay(tomorrow) && a.startAt <= endOfDay(tomorrow),
  ).length;

  // ── Clientes ──────────────────────────────────────────────────
  const activeClients = clientAgg.filter(
    (c) => (c._max.startAt ?? new Date(0)) >= from && (c._max.startAt ?? new Date(0)) <= to,
  ).length;
  const returningClients = clientAgg.filter((c) => c._count._all >= 2).length;
  const lostClients = clientAgg.filter(
    (c) => c._max.startAt != null && c._max.startAt < lostThreshold,
  ).length;
  const withHistory = clientAgg.length;
  const retentionRate = withHistory > 0 ? returningClients / withHistory : 0;

  const genderCount = (rows: { gender: string | null; _count: { _all: number } }[], g: string) =>
    rows.find((r) => r.gender === g)?._count._all ?? 0;
  const newClients = newClientsByGender.reduce((s, r) => s + r._count._all, 0);

  // ── Split por gênero (receita, ticket, serviço) ───────────────
  const byGender = (g: "MALE" | "FEMALE") => {
    const rows = completed.filter((a) => a.client?.gender === g);
    const rev = rows.reduce((s, a) => s + a.priceCents, 0);
    const svc = new Map<string, { name: string; count: number; colorHex: string | null }>();
    for (const a of rows) {
      const cur = svc.get(a.serviceId) ?? { name: a.service.name, count: 0, colorHex: a.service.colorHex };
      cur.count++;
      svc.set(a.serviceId, cur);
    }
    const topSvc = [...svc.values()].sort((x, y) => y.count - x.count)[0] ?? null;
    return {
      revenue: rev,
      count: rows.length,
      avgTicket: rows.length > 0 ? rev / rows.length : 0,
      clients: genderCount(clientsByGender, g),
      newClients: genderCount(newClientsByGender, g),
      topService: topSvc,
    };
  };

  // ── Séries de gráfico ─────────────────────────────────────────
  const dayBucket = new Map<string, { total: number; male: number; female: number }>();
  for (const d of eachDayOfInterval({ start: from, end: to })) {
    dayBucket.set(format(d, "yyyy-MM-dd"), { total: 0, male: 0, female: 0 });
  }
  for (const a of completed) {
    const k = format(a.startAt, "yyyy-MM-dd");
    const b = dayBucket.get(k);
    if (b) {
      b.total += a.priceCents;
      if (a.client?.gender === "MALE") b.male += a.priceCents;
      if (a.client?.gender === "FEMALE") b.female += a.priceCents;
    }
  }
  const series = [...dayBucket.entries()].map(([date, v]) => ({
    date,
    cents: v.total,
    male: v.male,
    female: v.female,
  }));

  return {
    range,
    period: { from, to },
    revenue: { value: revenue, change: pctChange(revenue, prevRevenue) },
    revenueToday,
    forecast,
    profit: { value: profit, margin: revenue > 0 ? profit / revenue : 0 },
    commissionPaid,
    commissionPending,
    appointments: { value: count, change: pctChange(count, prevCount) },
    avgTicket: { value: avgTicket, change: pctChange(avgTicket, prevAvg) },
    avgDuration,
    occupancy: {
      rate: occupancy.rate,
      idleMinutes: Math.max(0, occupancy.availableMinutes - occupancy.bookedMinutes),
      professionalCount: occupancy.professionalCount,
    },
    cancellations,
    noShow,
    apptsToday,
    apptsTomorrow,
    clients: {
      total: totalClients,
      active: activeClients,
      new: newClients,
      returning: returningClients,
      lost: lostClients,
      retentionRate,
    },
    products: {
      sold: productsSoldAgg._sum.quantity ?? 0,
      outOfStock,
    },
    topService: topServices[0] ?? null,
    topProfessional: proPerf[0] ?? null,
    proPerf,
    topServices,
    gender: { male: byGender("MALE"), female: byGender("FEMALE") },
    series,
  };
}

export type DashboardMetrics = Awaited<ReturnType<typeof getDashboardMetrics>>;
