import Link from "next/link";
import { ArrowLeft, ArrowRight, CalendarCheck2, CheckCircle2, CircleAlert, CreditCard, Receipt, Wallet, type LucideIcon } from "lucide-react";
import { ptBR } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import { requireRole, FINANCE_ROLES } from "@/lib/tenant";
import { withTenant } from "@/lib/prisma-tenant";
import { addCalendarDays, dateKeyInTimeZone, isDateKey, startOfDateInTimeZone } from "@/lib/time";
import { formatMoney } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { summarizeDailyClosing, type ClosingPaymentMethod } from "@/lib/daily-closing";
import { ClosingForm } from "./closing-form";

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: "A confirmar",
  CONFIRMED: "Confirmado",
  IN_PROGRESS: "Em atendimento",
  COMPLETED: "Concluído",
  NO_SHOW: "No-show",
  CANCELLED: "Cancelado",
};

export default async function FechamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { date: requestedDate } = await searchParams;

  const result = await withTenant(ctx, async (tx) => {
    const salon = await tx.salon.findUnique({
      where: { id: ctx.salonId },
      select: { name: true, timezone: true, currency: true },
    });
    if (!salon) throw new Error("Estabelecimento não encontrado");

    const todayKey = dateKeyInTimeZone(new Date(), salon.timezone);
    const dateKey = requestedDate && isDateKey(requestedDate) && requestedDate <= todayKey
      ? requestedDate
      : todayKey;
    const from = startOfDateInTimeZone(dateKey, salon.timezone);
    const to = startOfDateInTimeZone(addCalendarDays(dateKey, 1), salon.timezone);

    const appointments = await tx.appointment.findMany({
      where: { salonId: ctx.salonId, startAt: { gte: from, lt: to } },
      orderBy: { startAt: "asc" },
      select: {
        id: true,
        status: true,
        priceCents: true,
        startAt: true,
        client: { select: { name: true } },
        professional: { select: { user: { select: { name: true } } } },
        service: { select: { name: true } },
        serviceItems: {
          orderBy: { position: "asc" },
          select: { serviceName: true },
        },
        payment: { select: { amountCents: true, method: true } },
      },
    });
    const payments = await tx.payment.findMany({
      where: { appointment: { salonId: ctx.salonId }, paidAt: { gte: from, lt: to } },
      select: { amountCents: true, method: true },
    });
    const expenses = await tx.expense.findMany({
      where: { salonId: ctx.salonId, paidAt: { gte: from, lt: to } },
      orderBy: { paidAt: "desc" },
      select: { id: true, description: true, amountCents: true, category: true },
    });
    const closing = await tx.auditLog.findFirst({
      where: {
        salonId: ctx.salonId,
        action: "DAILY_CLOSING",
        entityType: "DAILY_CLOSING",
        entityId: dateKey,
      },
      orderBy: { createdAt: "desc" },
      select: { actorName: true, createdAt: true, reason: true, metadata: true },
    });

    const summary = summarizeDailyClosing({
      appointments,
      payments: payments.map((payment) => ({
        amountCents: payment.amountCents,
        method: payment.method as ClosingPaymentMethod,
      })),
      expenses,
    });
    const pendingAppointments = appointments
      .filter((appointment) => appointment.status === "COMPLETED" && appointment.payment === null)
      .map((appointment) => ({
        id: appointment.id,
        startAt: appointment.startAt.toISOString(),
        clientName: appointment.client.name,
        professionalName: appointment.professional.user.name,
        serviceName: appointment.serviceItems.length > 0
          ? appointment.serviceItems.map((service) => service.serviceName).join(" + ")
          : appointment.service.name,
        amountCents: appointment.priceCents,
      }));
    const appointmentRows = appointments.map((appointment) => ({
      id: appointment.id,
      startAt: appointment.startAt.toISOString(),
      status: appointment.status,
      clientName: appointment.client.name,
      professionalName: appointment.professional.user.name,
      serviceName: appointment.serviceItems.length > 0
        ? appointment.serviceItems.map((service) => service.serviceName).join(" + ")
        : appointment.service.name,
      amountCents: appointment.priceCents,
      paymentCents: appointment.payment?.amountCents ?? null,
    }));

    return {
      salon,
      todayKey,
      dateKey,
      summary,
      expenses,
      pendingAppointments,
      appointmentRows,
      closing: closing
        ? {
            actorName: closing.actorName,
            createdAt: closing.createdAt.toISOString(),
            declaredCashCents: numberOrNull(jsonRecord(closing.metadata).declaredCashCents),
            cashDifferenceCents: numberOrNull(jsonRecord(closing.metadata).cashDifferenceCents),
            notes: closing.reason,
          }
        : null,
    };
  });

  const { salon, dateKey, todayKey, summary } = result;
  const from = startOfDateInTimeZone(dateKey, salon.timezone);
  const dateLabel = formatInTimeZone(from, salon.timezone, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });
  const previousDate = addCalendarDays(dateKey, -1);
  const nextDate = addCalendarDays(dateKey, 1);

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Operação financeira"
        title="Fechamento do dia"
        meta={<p className="mb-1 text-sm capitalize text-muted-foreground">{dateLabel}</p>}
      >
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/fechamento?date=${previousDate}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium transition hover:bg-card-hover"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Anterior
          </Link>
          {dateKey !== todayKey && (
            <Link
              href="/fechamento"
              className="inline-flex min-h-11 items-center rounded-full border border-primary/30 bg-primary/10 px-4 text-sm font-semibold text-primary"
            >
              Hoje
            </Link>
          )}
          {nextDate <= todayKey && (
            <Link
              href={`/fechamento?date=${nextDate}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium transition hover:bg-card-hover"
            >
              Próximo <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
        </div>
      </PageHeader>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric icon={Wallet} label="Recebido" value={formatMoney(summary.receivedCents, salon.currency)} tone="success" />
        <Metric icon={Receipt} label="Despesas pagas" value={formatMoney(summary.expensesCents, salon.currency)} tone="danger" />
        <Metric icon={CreditCard} label="Saldo do dia" value={formatMoney(summary.netCents, salon.currency)} tone={summary.netCents >= 0 ? "success" : "danger"} />
        <Metric icon={CalendarCheck2} label="Atendimentos concluídos" value={String(summary.completedCount)} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Entradas por forma de pagamento</h2>
              <p className="mt-1 text-sm text-muted-foreground">Considera a data em que o recebimento foi registrado.</p>
            </div>
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
              {summary.paymentBreakdown.length} formas
            </span>
          </div>
          {summary.paymentBreakdown.length === 0 ? (
            <p className="mt-5 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">Nenhum recebimento registrado neste dia.</p>
          ) : (
            <div className="mt-5 space-y-2">
              {summary.paymentBreakdown.map((item) => (
                <div key={item.method} className="flex items-center justify-between rounded-xl bg-surface-1 px-3.5 py-3 text-sm">
                  <span>{item.label}</span>
                  <strong>{formatMoney(item.amountCents, salon.currency)}</strong>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold">Pendências antes de fechar</h2>
          <div className="mt-4 space-y-3 text-sm">
            <AttentionRow label="Atendimentos sem recebimento" value={`${summary.pendingPaymentCount} · ${formatMoney(summary.pendingPaymentCents, salon.currency)}`} danger={summary.pendingPaymentCount > 0} />
            <AttentionRow label="No-show" value={String(summary.noShowCount)} danger={summary.noShowCount > 0} />
            <AttentionRow label="Cancelamentos" value={String(summary.cancelledCount)} />
          </div>
          {summary.pendingPaymentCount > 0 && (
            <>
              <div className="mt-4 space-y-2 border-t border-border pt-3">
                {result.pendingAppointments.map((appointment) => (
                  <div key={appointment.id} className="flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate text-muted-foreground">{appointment.clientName} · {appointment.serviceName}</span>
                    <strong className="shrink-0">{formatMoney(appointment.amountCents, salon.currency)}</strong>
                  </div>
                ))}
              </div>
              <Link href={`/agenda?date=${dateKey}`} className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-primary">
                Revisar na agenda <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </>
          )}
        </div>
      </section>

      <ClosingForm
        dateKey={dateKey}
        cashReceivedCents={summary.cashReceivedCents}
        currency={salon.currency}
        closed={result.closing}
      />

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold">Movimentos do dia</h2>
            <p className="mt-1 text-sm text-muted-foreground">{result.appointmentRows.length} agendamentos registrados.</p>
          </div>
          <div className="divide-y divide-border">
            {result.appointmentRows.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">Nenhum atendimento neste dia.</p>
            ) : result.appointmentRows.map((appointment) => (
              <div key={appointment.id} className="flex items-center gap-3 px-5 py-3">
                <span className="w-12 shrink-0 text-sm font-semibold tabular-nums">
                  {formatInTimeZone(new Date(appointment.startAt), salon.timezone, "HH:mm")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{appointment.clientName}</p>
                  <p className="truncate text-xs text-muted-foreground">{appointment.serviceName} · {appointment.professionalName}</p>
                </div>
                <div className="shrink-0 text-right">
                  <span className="block rounded-full bg-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground">{STATUS_LABELS[appointment.status] ?? appointment.status}</span>
                  <span className="mt-1 block text-xs font-semibold">
                    {appointment.paymentCents !== null
                      ? formatMoney(appointment.paymentCents, salon.currency)
                      : `${formatMoney(appointment.amountCents, salon.currency)} · a receber`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold">Despesas pagas</h2>
            <p className="mt-1 text-sm text-muted-foreground">Somente despesas marcadas como pagas neste dia.</p>
          </div>
          <div className="divide-y divide-border">
            {result.expenses.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">Nenhuma despesa paga neste dia.</p>
            ) : result.expenses.map((expense) => (
              <div key={expense.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{expense.description}</p>
                  <p className="text-xs text-muted-foreground">{expense.category}</p>
                </div>
                <span className="text-sm font-semibold text-danger">− {formatMoney(expense.amountCents, salon.currency)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: "neutral" | "success" | "danger";
}) {
  const color = tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <p className={`mt-3 text-xl font-semibold tracking-tight ${color}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function AttentionRow({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-1 px-3 py-2.5">
      <span className="flex min-w-0 items-center gap-2">
        {danger ? <CircleAlert className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />}
        <span className="truncate">{label}</span>
      </span>
      <strong className={danger ? "text-warning" : ""}>{value}</strong>
    </div>
  );
}
