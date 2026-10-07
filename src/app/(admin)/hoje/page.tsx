import { ReceiptWorkspace } from "../financeiro/receipt-workspace";
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
  const initialNow = new Date();

  const result = await withTenant(ctx, async (tx) => {
    const salon = await tx.salon.findUnique({
      where: { id: ctx.salonId },
      select: { name: true, timezone: true, currency: true },
    });
    if (!salon) throw new Error("Estabelecimento não encontrado");

    const todayKey = dateKeyInTimeZone(initialNow, salon.timezone);
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
        checkedInAt: true,
        dependentName: true,
        priceCents: true,
        payment: { select: { id: true } },
        client: { select: { name: true, phone: true } },
        professional: { select: { id: true, colorHex: true, user: { select: { name: true } } } },
        service: { select: { name: true, colorHex: true, category: true } },
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
      checkedInAt: appointment.checkedInAt?.toISOString() ?? null,
      priceCents: appointment.priceCents,
      hasPayment: Boolean(appointment.payment),
      clientName: appointment.dependentName ? `${appointment.dependentName} (titular: ${appointment.client.name})` : appointment.client.name,
      clientPhone: appointment.client.phone,
      professionalName: appointment.professional.user.name,
      professionalColor: appointment.professional.colorHex, serviceColor: appointment.service.colorHex, category: appointment.service.category,
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
  const nextAppointment = result.rows.find(item => ["PENDING", "CONFIRMED"].includes(item.status) && new Date(item.startAt).getTime() >= initialNow.getTime());
  return (
    <div className="flex flex-col gap-6 max-md:gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3 md:gap-4">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-widest text-primary max-md:hidden">Operação</p>
          <h1 className="text-[26px] font-semibold tracking-tight">Hoje</h1>
          <p className="mt-1 text-sm text-muted-foreground first-letter:uppercase">{dateLabel}</p>
        </div>
        {/* No celular: botões redondos de dia anterior/próximo e um atalho curto para a agenda. */}
        <div className="flex flex-wrap gap-2">
          <Link href={`/hoje?date=${previousDate}`} className="press inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium transition hover:bg-card-hover max-md:w-11 max-md:justify-center max-md:px-0">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> <span className="max-md:sr-only">Anterior</span>
          </Link>
          {result.dateKey !== result.todayKey && (
            <Link href="/hoje" className="press inline-flex min-h-11 items-center rounded-full border border-primary/30 bg-primary/10 px-4 text-sm font-semibold text-primary">Hoje</Link>
          )}
          {result.dateKey !== result.todayKey && nextDate <= result.todayKey && (
            <Link href={`/hoje?date=${nextDate}`} className="press inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium transition hover:bg-card-hover max-md:w-11 max-md:justify-center max-md:px-0">
              <span className="max-md:sr-only">Próximo</span> <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
          <Link href={`/agenda?date=${result.dateKey}`} className="press inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium transition hover:bg-card-hover max-md:w-11 max-md:justify-center max-md:px-0">
            <span className="max-md:sr-only">Agenda completa</span> <CalendarRange className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </header>

      {nextAppointment && <section aria-label="Próximo atendimento" className="rounded-2xl border border-primary/30 bg-primary/10 p-4 sm:p-5">
        <p className="text-[13px] font-medium text-primary">Próximo atendimento</p>
        <div className="mt-3 flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-lg font-semibold">{nextAppointment.clientName}</h2><p className="mt-1 text-sm text-muted-foreground">{nextAppointment.serviceName}</p><p className="mt-1 text-[13px] text-muted-foreground">Com {nextAppointment.professionalName}</p></div><p className="shrink-0 text-xl font-semibold tabular-nums">{formatInTimeZone(new Date(nextAppointment.startAt), result.salon.timezone, "HH:mm")}</p></div>
        <Link href={"/agenda?date=" + result.dateKey} className="mt-4 flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">Ver agenda do dia</Link>
      </section>}
      {/* No celular o recebimento em lote vem depois da lista do dia, que é o que se consulta primeiro. */}
      {["OWNER", "MANAGER"].includes(ctx.role) && <div className="max-md:order-last"><ReceiptWorkspace date={result.dateKey} /></div>}

      <HojeView
        colorScope={`${ctx.salonId}:${ctx.userId}`}
        date={result.dateKey}
        initialNowMs={initialNow.getTime()}
        salonName={result.salon.name}
        timezone={result.salon.timezone}
        currency={result.salon.currency}
        appointments={result.rows}
      />
    </div>
  );
}
