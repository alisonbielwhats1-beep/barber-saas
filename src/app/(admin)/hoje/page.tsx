import Link from "next/link";
import { ArrowLeft, ArrowRight, CalendarRange } from "lucide-react";
import { ptBR } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import { requireRole } from "@/lib/tenant";
import { DASHBOARD_ROLES } from "@/lib/role-permissions";
import { withTenant } from "@/lib/prisma-tenant";
import { addCalendarDays, dateKeyInTimeZone, isDateKey, startOfDateInTimeZone } from "@/lib/time";
import { HojeView, type TodayAppointment } from "./hoje-view";

export default async function HojePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const ctx = await requireRole(DASHBOARD_ROLES);
  const { date: requestedDate } = await searchParams;

  const result = await withTenant(ctx, async (tx) => {
    const salon = await tx.salon.findUnique({
      where: { id: ctx.salonId },
      select: { name: true, timezone: true, currency: true },
    });
    if (!salon) throw new Error("Estabelecimento não encontrado");

    const todayKey = dateKeyInTimeZone(new Date(), salon.timezone);
    const dateKey = requestedDate && isDateKey(requestedDate) ? requestedDate : todayKey;
    const from = startOfDateInTimeZone(dateKey, salon.timezone);
    const to = startOfDateInTimeZone(addCalendarDays(dateKey, 1), salon.timezone);
    const appointments = await tx.appointment.findMany({
      where: { salonId: ctx.salonId, startAt: { gte: from, lt: to } },
      orderBy: { startAt: "asc" },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        status: true,
        version: true,
        priceCents: true,
        payment: { select: { id: true } },
        client: { select: { name: true, phone: true } },
        professional: { select: { id: true, user: { select: { name: true } } } },
        service: { select: { name: true } },
        serviceItems: {
          orderBy: { position: "asc" },
          select: { serviceName: true },
        },
      },
    });

    const rows: TodayAppointment[] = appointments.map((appointment) => ({
      id: appointment.id,
      startAt: appointment.startAt.toISOString(),
      endAt: appointment.endAt.toISOString(),
      status: appointment.status,
      version: appointment.version,
      priceCents: appointment.priceCents,
      hasPayment: Boolean(appointment.payment),
      clientName: appointment.client.name,
      clientPhone: appointment.client.phone,
      professionalName: appointment.professional.user.name,
      serviceName: appointment.serviceItems.length > 0
        ? appointment.serviceItems.map((service) => service.serviceName).join(" + ")
        : appointment.service.name,
    }));

    return {
      salon,
      todayKey,
      dateKey,
      rows,
    };
  });

  const date = startOfDateInTimeZone(result.dateKey, result.salon.timezone);
  const dateLabel = formatInTimeZone(date, result.salon.timezone, "EEEE, d 'de' MMMM", { locale: ptBR });
  const previousDate = addCalendarDays(result.dateKey, -1);
  const nextDate = addCalendarDays(result.dateKey, 1);
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-primary">Operação</p>
          <h1 className="text-[26px] font-semibold tracking-tight">Hoje</h1>
          <p className="mt-1 text-sm capitalize text-muted-foreground">{dateLabel}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/hoje?date=${previousDate}`} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium transition hover:bg-card-hover">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Anterior
          </Link>
          {result.dateKey !== result.todayKey && (
            <Link href="/hoje" className="inline-flex min-h-11 items-center rounded-full border border-primary/30 bg-primary/10 px-4 text-sm font-semibold text-primary">Hoje</Link>
          )}
          {result.dateKey !== result.todayKey && nextDate <= result.todayKey && (
            <Link href={`/hoje?date=${nextDate}`} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium transition hover:bg-card-hover">
              Próximo <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
          <Link href={`/agenda?date=${result.dateKey}`} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium transition hover:bg-card-hover">
            Agenda completa <CalendarRange className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </header>

      <HojeView
        date={result.dateKey}
        salonName={result.salon.name}
        timezone={result.salon.timezone}
        currency={result.salon.currency}
        appointments={result.rows}
      />
    </div>
  );
}
