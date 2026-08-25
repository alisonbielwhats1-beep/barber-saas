import { withSalon } from "./prisma-tenant";
import {
  differenceInMinutes,
} from "date-fns";
import { getProfessionalPerformance, getTopServices, getOccupancyRate } from "./kpis";
import { inferGenderFromName } from "./name-gender";
import {
  DEFAULT_TIMEZONE,
  addCalendarDays,
  dateKeyInTimeZone,
  startOfDateInTimeZone,
} from "./time";

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

export function resolveRange(
  range: RangeKey,
  timezone = DEFAULT_TIMEZONE,
  now = new Date(),
) {
  const today = dateKeyInTimeZone(now, timezone);
  const endDate = addCalendarDays(today, 1);
  let fromDate: string;
  switch (range) {
    case "today":
      fromDate = today;
      break;
    case "yesterday":
      fromDate = addCalendarDays(today, -1);
      return {
        from: startOfDateInTimeZone(fromDate, timezone),
        to: startOfDateInTimeZone(today, timezone),
        fromDate,
        toDate: today,
      };
    case "7d":
      fromDate = addCalendarDays(today, -6);
      break;
    case "15d":
      fromDate = addCalendarDays(today, -14);
      break;
    case "30d":
      fromDate = addCalendarDays(today, -29);
      break;
    case "90d":
      fromDate = addCalendarDays(today, -89);
      break;
    case "year":
      fromDate = `${today.slice(0, 4)}-01-01`;
      break;
  }
  return {
    from: startOfDateInTimeZone(fromDate, timezone),
    to: startOfDateInTimeZone(endDate, timezone),
    fromDate,
    toDate: endDate,
  };
}

function daysBetween(fromDate: string, toDate: string): number {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

function previousWindow(
  fromDate: string,
  toDate: string,
  timezone: string,
) {
  const length = daysBetween(fromDate, toDate);
  const previousFromDate = addCalendarDays(fromDate, -length);
  return {
    from: startOfDateInTimeZone(previousFromDate, timezone),
    to: startOfDateInTimeZone(fromDate, timezone),
  };
}

export function percentageChange(curr: number, prev: number): number | null {
  if (prev === 0) return null;
  return (curr - prev) / prev;
}

export async function getDashboardMetrics(
  salonId: string,
  range: RangeKey,
  timezone = DEFAULT_TIMEZONE,
  lapsedClientDays = 60,
) {
  const now = new Date();
  const resolved = resolveRange(range, timezone, now);
  const { from, to } = resolved;
  const prev = previousWindow(resolved.fromDate, resolved.toDate, timezone);
  const todayDate = dateKeyInTimeZone(now, timezone);
  const today = {
    from: startOfDateInTimeZone(todayDate, timezone),
    to: startOfDateInTimeZone(addCalendarDays(todayDate, 1), timezone),
  };
  const tomorrow = {
    from: today.to,
    to: startOfDateInTimeZone(addCalendarDays(todayDate, 2), timezone),
  };
  const lostThreshold = startOfDateInTimeZone(addCalendarDays(todayDate, -lapsedClientDays), timezone);

  // O dashboard costumava iniciar mais de vinte queries ao mesmo tempo.
  // Em serverless, isso pode esgotar o pool do Prisma/Supavisor antes que as
  // primeiras queries devolvam a conexão. As ondas abaixo mantêm no máximo
  // quatro operações concorrentes sem alterar os indicadores calculados.
  //
  // Cada query abre a própria withSalon (transação curta, uma conexão),
  // e as N chamadas de cada onda continuam concorrentes via Promise.all —
  // de propósito, para não trocar o modelo de concorrência que B1.1/B1.5
  // calibraram contra esgotamento de pool. A alternativa óbvia — uma única
  // withTenant envolvendo a função inteira — serializaria as ~20 queries
  // numa transação/conexão só, multiplicando a latência da página mais
  // visitada do painel. Isso não é uma troca para fazer de passagem junto
  // de uma migração de assinatura.
  const [completed, prevCompleted, statusGroups, upcoming] = await Promise.all([
    // 1. Atendimentos concluídos no período (motor de receita, ticket, gênero)
    withSalon(salonId, (tx) =>
      tx.appointment.findMany({
        where: { salonId, status: "COMPLETED", startAt: { gte: from, lt: to } },
        select: {
          priceCents: true,
          startAt: true,
          endAt: true,
          serviceId: true,
          client: { select: { gender: true, name: true } },
          service: { select: { name: true, colorHex: true } },
        },
      }),
    ),
    // 2. Concluídos no período anterior (comparação)
    withSalon(salonId, (tx) =>
      tx.appointment.aggregate({
        where: { salonId, status: "COMPLETED", startAt: { gte: prev.from, lt: prev.to } },
        _sum: { priceCents: true },
        _count: { _all: true },
      }),
    ),
    // 3. Contagem por status no período (cancelamentos, no-show)
    withSalon(salonId, (tx) =>
      tx.appointment.groupBy({
        by: ["status"],
        where: { salonId, startAt: { gte: from, lt: to } },
        _count: { _all: true },
      }),
    ),
    // 4. Próximos agendamentos (previsão, hoje, amanhã, comissão pendente)
    withSalon(salonId, (tx) =>
      tx.appointment.findMany({
        where: {
          salonId,
          status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] },
          startAt: { gte: today.from },
        },
        select: { startAt: true, priceCents: true, professionalId: true },
      }),
    ),
  ]);

  const [proPerf, topServices, occupancy, waitlistEntries] = await Promise.all([
    withSalon(salonId, (tx) => getProfessionalPerformance(tx, salonId, from, to)),
    withSalon(salonId, (tx) => getTopServices(tx, salonId, from, to, 5)),
    withSalon(salonId, (tx) => getOccupancyRate(tx, salonId, from, to, timezone)),
    // Conversão da lista de espera: de quem entrou na fila NO PERÍODO, quantos
    // acabaram confirmados (fulfilledAt não-nulo, seja qual for a data do
    // preenchimento). Volume esperado é baixo (dezenas por salão/mês) — busca
    // as linhas e conta em memória em vez de duas queries de agregação.
    withSalon(salonId, (tx) =>
      tx.waitlistEntry.findMany({
        where: { salonId, createdAt: { gte: from, lt: to } },
        select: { fulfilledAt: true },
      }),
    ),
  ]);

  const [clientsByGender, newClientsByGender, clientAgg, totalClients] = await Promise.all([
    // Clientes por gênero (base total). Busca nome junto porque o split usa
    // inferGenderFromName() como fallback para quem não preencheu o campo —
    // um groupBy no banco não consegue aplicar essa heurística.
    withSalon(salonId, (tx) =>
      tx.clientProfile.findMany({
        where: { salonId },
        select: { gender: true, name: true },
      }),
    ),
    // Novos clientes por gênero no período (mesmo motivo acima)
    withSalon(salonId, (tx) =>
      tx.clientProfile.findMany({
        where: { salonId, createdAt: { gte: from, lt: to } },
        select: { gender: true, name: true },
      }),
    ),
    // Por cliente: nº de concluídos + último atendimento (retorno/perdidos)
    withSalon(salonId, (tx) =>
      tx.appointment.groupBy({
        by: ["clientId"],
        where: { salonId, status: "COMPLETED" },
        _count: { _all: true },
        _max: { startAt: true },
      }),
    ),
    withSalon(salonId, (tx) => tx.clientProfile.count({ where: { salonId } })),
  ]);

  const [professionals, productsSoldAgg, outOfStock, completedToday] = await Promise.all([
    withSalon(salonId, (tx) =>
      tx.professional.findMany({
        where: { salonId },
        select: { id: true, commissionPct: true },
      }),
    ),
    // Produtos vendidos no período
    withSalon(salonId, (tx) =>
      tx.appointmentProduct.aggregate({
        where: { appointment: { salonId, startAt: { gte: from, lt: to } } },
        _sum: { quantity: true },
      }),
    ),
    withSalon(salonId, (tx) =>
      tx.product.count({ where: { salonId, active: true, stock: { lte: 0 } } }),
    ),
    withSalon(salonId, (tx) =>
      tx.appointment.aggregate({
        where: {
          salonId,
          status: "COMPLETED",
          startAt: { gte: today.from, lt: today.to },
        },
        _sum: { priceCents: true },
      }),
    ),
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
  const revenueToday = completedToday._sum.priceCents ?? 0;

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
  const totalInPeriod = statusGroups.reduce((s, g) => s + g._count._all, 0);
  const cancellationRate = totalInPeriod > 0 ? cancellations / totalInPeriod : null;
  const noShowRate = totalInPeriod > 0 ? noShow / totalInPeriod : null;

  // ── Lista de espera ──────────────────────────────────────────────
  const waitlistTotal = waitlistEntries.length;
  const waitlistFulfilled = waitlistEntries.filter((w) => w.fulfilledAt !== null).length;
  const waitlistConversionRate = waitlistTotal > 0 ? waitlistFulfilled / waitlistTotal : null;

  // ── Próximos ──────────────────────────────────────────────────
  const in30 = startOfDateInTimeZone(addCalendarDays(todayDate, 31), timezone);
  const forecast = upcoming
    .filter((a) => a.startAt <= in30)
    .reduce((s, a) => s + a.priceCents, 0);
  const commissionPending = upcoming.reduce(
    (s, a) => s + Math.round((a.priceCents * (commissionPctById.get(a.professionalId) ?? 0)) / 100),
    0,
  );
  const apptsToday = upcoming.filter(
    (appointment) => appointment.startAt >= today.from && appointment.startAt < today.to,
  ).length;
  const apptsTomorrow = upcoming.filter(
    (appointment) =>
      appointment.startAt >= tomorrow.from && appointment.startAt < tomorrow.to,
  ).length;

  // ── Clientes ──────────────────────────────────────────────────
  const activeClients = clientAgg.filter(
    (client) =>
      (client._max.startAt ?? new Date(0)) >= from &&
      (client._max.startAt ?? new Date(0)) < to,
  ).length;
  const returningClients = clientAgg.filter((c) => c._count._all >= 2).length;
  const lostClients = clientAgg.filter(
    (c) => c._max.startAt != null && c._max.startAt < lostThreshold,
  ).length;
  const withHistory = clientAgg.length;
  const retentionRate = withHistory > 0 ? returningClients / withHistory : 0;

  // Gênero informado manualmente tem prioridade; sem isso, tenta estimar
  // pelo primeiro nome. Cliente sem gênero e sem nome reconhecido fica de
  // fora do split (nunca inventa um valor sem nenhum sinal).
  const resolvedGender = (client: { gender: string | null; name?: string | null } | null | undefined) =>
    client?.gender ?? inferGenderFromName(client?.name);

  const genderCount = (rows: { gender: string | null; name: string }[], g: "MALE" | "FEMALE") =>
    rows.filter((r) => resolvedGender(r) === g).length;
  const newClients = newClientsByGender.length;

  // ── Split por gênero (receita, ticket, serviço) ───────────────
  const byGender = (g: "MALE" | "FEMALE") => {
    const rows = completed.filter((a) => resolvedGender(a.client) === g);
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
  for (
    let date = resolved.fromDate;
    date < resolved.toDate;
    date = addCalendarDays(date, 1)
  ) {
    dayBucket.set(date, { total: 0, male: 0, female: 0 });
  }
  for (const a of completed) {
    const k = dateKeyInTimeZone(a.startAt, timezone);
    const b = dayBucket.get(k);
    if (b) {
      b.total += a.priceCents;
      const g = resolvedGender(a.client);
      if (g === "MALE") b.male += a.priceCents;
      if (g === "FEMALE") b.female += a.priceCents;
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
    period: { from, to: new Date(to.getTime() - 1) },
    revenue: { value: revenue, change: percentageChange(revenue, prevRevenue) },
    revenueToday,
    forecast,
    profit: { value: profit, margin: revenue > 0 ? profit / revenue : 0 },
    commissionPaid,
    commissionPending,
    appointments: { value: count, change: percentageChange(count, prevCount) },
    avgTicket: { value: avgTicket, change: percentageChange(avgTicket, prevAvg) },
    avgDuration,
    occupancy: {
      rate: occupancy.rate,
      idleMinutes: Math.max(0, occupancy.availableMinutes - occupancy.bookedMinutes),
      professionalCount: occupancy.professionalCount,
    },
    cancellations,
    noShow,
    cancellationRate,
    noShowRate,
    waitlist: {
      total: waitlistTotal,
      fulfilled: waitlistFulfilled,
      conversionRate: waitlistConversionRate,
    },
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
