import { ReceiptWorkspace } from "../financeiro/receipt-workspace";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { ptBR } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import { requireRole } from "@/lib/tenant";
import { DASHBOARD_ROLES } from "@/lib/role-permissions";
import { withTenant } from "@/lib/prisma-tenant";
import { addCalendarDays, dateKeyInTimeZone, isDateKey, startOfDateInTimeZone } from "@/lib/time";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HojeGreeting } from "./hoje-greeting";
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
  const hour = Number(formatInTimeZone(initialNow, result.salon.timezone, "H"));
  const greeting = hour >= 5 && hour < 12 ? "Bom dia" : hour >= 12 && hour < 18 ? "Boa tarde" : "Boa noite";
  const notToday = result.dateKey !== result.todayKey;
  // Computador: botões de contorno com texto; celular: botões redondos de 44 px só com ícone (o texto fica para o leitor de tela).
  const dayButton = buttonVariants({ variant: "outline" });
  const iconOnPhone = "max-md:w-11 max-md:rounded-full max-md:px-0";
  return (
    // No celular os blocos da HojeView se reordenam (Próximo, resumo, recebimentos, pendências, lista) com `order`.
    <div className="flex flex-col gap-3.5 md:gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3 md:gap-4">
        <div className="min-w-0">
          <HojeGreeting greeting={greeting} />
          <h1 className="text-lg font-semibold leading-tight tracking-tight lg:text-2xl">Hoje</h1>
          <p className="mt-0.5 text-sm text-muted-foreground first-letter:uppercase">{dateLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/hoje?date=${previousDate}`} className={cn(dayButton, iconOnPhone)}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" /><span className="max-md:sr-only">Anterior</span>
          </Link>
          {notToday && <Link href="/hoje" className={cn(dayButton, "max-md:rounded-full")}>Hoje</Link>}
          {notToday && nextDate <= result.todayKey && (
            <Link href={`/hoje?date=${nextDate}`} className={cn(dayButton, iconOnPhone)}>
              <span className="max-md:sr-only">Próximo</span><ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
          <Link href={`/agenda?date=${result.dateKey}`} className={cn(dayButton, iconOnPhone)}>
            <span className="max-md:sr-only">Agenda completa</span><CalendarDays className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </header>

      <HojeView
        colorScope={`${ctx.salonId}:${ctx.userId}`}
        date={result.dateKey}
        initialNowMs={initialNow.getTime()}
        salonName={result.salon.name}
        timezone={result.salon.timezone}
        currency={result.salon.currency}
        appointments={result.rows}
        receipts={["OWNER", "MANAGER"].includes(ctx.role) ? <ReceiptWorkspace date={result.dateKey} variant="bare" /> : null}
      />
    </div>
  );
}
