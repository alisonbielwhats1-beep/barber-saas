import Link from "next/link";
import { ptBR } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { formatMoney } from "@/lib/utils";
import { WhatsAppReminderButton } from "./whatsapp-reminder-button";

export type NowStripAppointment = {
  id: string;
  startAt: Date;
  status: string;
  client: { name: string; phone: string | null };
  service: { name: string; colorHex: string | null };
  professional: { user: { name: string } };
};

export function NowStrip({
  appointments,
  salonName,
  timezone,
  todayDate,
  now,
  revenueToday,
  apptsToday,
  apptsTomorrow,
  outOfStock,
}: {
  appointments: NowStripAppointment[];
  salonName: string;
  timezone: string;
  todayDate: string;
  now: Date;
  revenueToday: number;
  apptsToday: number;
  apptsTomorrow: number;
  outOfStock: number;
}) {
  return (
    <section
      aria-labelledby="now-strip-title"
      className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
    >
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/80 to-transparent"
      />
      <div className="relative flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-primary">
              <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-40" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
              </span>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">Operação de hoje</p>
            </div>
            <h2 id="now-strip-title" className="mt-1 text-lg font-semibold tracking-tight">
              Próximos atendimentos de hoje
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {formatInTimeZone(now, timezone, "EEEE, d 'de' MMMM '·' HH:mm", { locale: ptBR })}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground/80">Atualização automática a cada minuto</p>
          </div>
          <Link
            href={`/hoje?date=${todayDate}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 text-[13px] font-semibold text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Ver o dia
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </div>

        {appointments.length === 0 ? (
          <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border bg-surface-1/70 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[14px] font-medium">A agenda está livre pelo restante do dia.</p>
              <p className="mt-1 text-[13px] text-muted-foreground">Revise os próximos dias ou abra um novo horário.</p>
            </div>
            <Link
              href={`/agenda?date=${todayDate}`}
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Ir para a agenda
            </Link>
          </div>
        ) : (
          <div
            role="group"
            aria-label="Próximos atendimentos de hoje"
            className="stagger scrollbar-dark flex snap-x gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible sm:pb-0 xl:grid-cols-4"
          >
            {appointments.slice(0, 4).map((appointment, index) => (
              <div
                key={appointment.id}
                className={`group relative w-[78vw] max-w-72 shrink-0 snap-start rounded-xl border p-3.5 pb-12 transition-colors sm:w-auto sm:max-w-none sm:min-w-0 ${
                  index === 0
                    ? "border-primary/30 bg-primary/[0.07] hover:bg-primary/10"
                    : "border-border bg-surface-1/70 hover:border-border-strong hover:bg-card-hover"
                }`}
              >
                <Link
                  href={`/agenda?date=${todayDate}`}
                  aria-label={`${formatInTimeZone(appointment.startAt, timezone, "HH:mm")}, ${appointment.client.name}, ${appointment.service.name}. Abrir agenda`}
                  className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[15px] font-semibold tabular-nums">
                      {formatInTimeZone(appointment.startAt, timezone, "HH:mm")}
                    </span>
                    <span
                      className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                        appointment.status === "IN_PROGRESS"
                          ? "bg-primary/15 text-primary"
                          : appointment.status === "PENDING"
                            ? "bg-warning/10 text-warning"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {appointmentStatusLabel(appointment.status)}
                    </span>
                  </div>
                  <div className="mt-3 flex min-w-0 gap-2.5">
                    <span
                      aria-hidden="true"
                      className="mt-1 h-8 w-1 shrink-0 rounded-full"
                      style={{ background: appointment.service.colorHex ?? "hsl(var(--primary))" }}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium">{appointment.client.name}</p>
                      <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
                        {appointment.service.name}
                      </p>
                      <p className="truncate text-[12px] text-muted-foreground">
                        com {appointment.professional.user.name}
                      </p>
                    </div>
                  </div>
                </Link>
                <WhatsAppReminderButton
                  appointmentId={appointment.id}
                  phone={appointment.client.phone}
                  clientName={appointment.client.name}
                  salonName={salonName}
                  when={formatInTimeZone(appointment.startAt, timezone, "HH:mm")}
                  serviceName={appointment.service.name}
                  professionalName={appointment.professional.user.name}
                />
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
          <DailyPulse label="Receita concluída hoje" value={formatMoney(revenueToday)} emphasis />
          <DailyPulse label="Agendamentos hoje" value={apptsToday.toString()} />
          <DailyPulse label="Agendamentos amanhã" value={apptsTomorrow.toString()} />
        </div>

        {outOfStock > 0 ? (
          <Link
            href="/produtos"
            className="flex min-h-11 items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-2 text-[13px] font-medium text-warning transition-colors hover:border-warning/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
            {outOfStock} {outOfStock === 1 ? "produto precisa de reposição" : "produtos precisam de reposição"}
            <ArrowRight aria-hidden="true" className="ml-auto h-4 w-4" />
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function appointmentStatusLabel(status: string) {
  if (status === "IN_PROGRESS") return "Em atendimento";
  if (status === "PENDING") return "A confirmar";
  return "Confirmado";
}

function DailyPulse({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex min-h-16 items-center justify-between gap-3 bg-surface-1 px-4 py-3 sm:block">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className={`text-[16px] font-semibold tracking-tight sm:mt-1 ${emphasis ? "text-primary" : ""}`}>
        {value}
      </p>
    </div>
  );
}
