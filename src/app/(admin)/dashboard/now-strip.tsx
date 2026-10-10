import Link from "next/link";
import { ptBR } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import { AlertTriangle, ArrowRight, Clock3 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { STATUS, type ApptStatus } from "../agenda/agenda-status";
import { WhatsAppReminderButton } from "./whatsapp-reminder-button";
import { formatMoneyWhole } from "./results-ui";

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
  const visibleAppointments = appointments.slice(0, 4);
  const nextAppointment = visibleAppointments
    .filter((appointment) =>
      ["PENDING", "CONFIRMED"].includes(appointment.status) && appointment.startAt >= now,
    )
    .reduce<NowStripAppointment | undefined>((next, appointment) =>
      !next || appointment.startAt < next.startAt ? appointment : next, undefined,
    );
  const today = formatInTimeZone(now, timezone, "EEEE, d 'de' MMMM '·' HH:mm", { locale: ptBR });

  return (
    <section
      aria-labelledby="now-strip-title"
      className="flex flex-col gap-3.5 rounded-[14px] border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-accent" />
            Operação de hoje
          </p>
          <h2 id="now-strip-title" className="mt-1.5 text-sm font-semibold leading-snug">
            Próximos atendimentos de hoje
          </h2>
          <p className="text-xs leading-snug text-muted-foreground tabular-nums">
            {today.charAt(0).toUpperCase() + today.slice(1)}
          </p>
          <p className="text-xs leading-snug text-muted-foreground">Atualização automática a cada minuto</p>
        </div>
        <Link href={`/hoje?date=${todayDate}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Ver o dia
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Link>
      </div>

      {appointments.length === 0 ? (
        <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border-strong p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">A agenda está livre pelo restante do dia.</p>
            <p className="mt-0.5 text-sm text-muted-foreground">Revise os próximos dias ou abra um novo horário.</p>
          </div>
          <Link href={`/agenda?date=${todayDate}`} className={buttonVariants({ size: "sm" })}>
            Ir para a agenda
          </Link>
        </div>
      ) : (
        <div
          role="group"
          aria-label="Próximos atendimentos de hoje"
          className="scrollbar-dark flex snap-x gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:gap-3 sm:overflow-visible sm:pb-0 xl:grid-cols-4"
        >
          {visibleAppointments.map((appointment) => {
            const cue = appointmentCue(appointment, now, appointment.id === nextAppointment?.id);
            const time = formatInTimeZone(appointment.startAt, timezone, "HH:mm");
            const status = STATUS[appointment.status as ApptStatus];
            // O selo só aparece quando diz algo que a frase de cima ainda não disse.
            const showBadge = status && cue.kind !== "progress" && cue.kind !== "pending";
            return (
              <div
                key={appointment.id}
                data-cue={cue.kind}
                className={cn(
                  "flex w-[78vw] max-w-72 shrink-0 snap-start flex-col gap-2 rounded-xl border p-3 sm:w-auto sm:min-w-0 sm:max-w-none",
                  cue.card,
                )}
              >
                <Link
                  href={`/agenda?date=${todayDate}`}
                  aria-label={`${cue.label}. ${time}, ${appointment.client.name}, ${appointment.service.name}. Abrir agenda`}
                  className="flex min-w-0 flex-col gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <p className={cn("flex min-h-[34px] items-start gap-1.5 text-xs font-semibold leading-snug", cue.text)}>
                    {cue.urgent
                      ? <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      : <Clock3 aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                    {cue.label}
                  </p>
                  <div className="flex min-h-[22px] flex-wrap items-center justify-between gap-2">
                    <span className="text-base font-semibold tabular-nums">{time}</span>
                    {showBadge ? (
                      <span className={cn("inline-flex min-h-[22px] items-center gap-1.5 rounded-full px-2.5 text-xs font-medium", status.badgeClass)}>
                        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                        {appointmentStatusLabel(appointment.status)}
                      </span>
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium" title={appointment.client.name}>{appointment.client.name}</p>
                    <p className="truncate text-xs text-muted-foreground" title={appointment.service.name}>
                      {appointment.service.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      com {appointment.professional.user.name}
                    </p>
                  </div>
                </Link>
                <WhatsAppReminderButton
                  appointmentId={appointment.id}
                  phone={appointment.client.phone}
                  clientName={appointment.client.name}
                  salonName={salonName}
                  when={time}
                  serviceName={appointment.service.name}
                  professionalName={appointment.professional.user.name}
                />
              </div>
            );
          })}
        </div>
      )}

      <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
        <DailyPulse label="Receita concluída hoje" value={formatMoneyWhole(revenueToday)} />
        <DailyPulse label="Agendamentos hoje" value={apptsToday.toString()} />
        <DailyPulse label="Agendamentos amanhã" value={apptsTomorrow.toString()} />
      </div>

      {outOfStock > 0 ? (
        <Link
          href="/produtos?filter=restock"
          className="flex min-h-11 items-center gap-2.5 rounded-xl border border-warning/35 bg-warning/10 px-3.5 py-2.5 text-sm font-medium transition-colors hover:border-warning/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">{outOfStock} {outOfStock === 1 ? "produto precisa de reposição" : "produtos precisam de reposição"}</span>
          <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0 text-warning" />
        </Link>
      ) : null}
    </section>
  );
}

function appointmentCue(appointment: NowStripAppointment, now: Date, isNext: boolean) {
  if (appointment.status === "IN_PROGRESS") return {
    kind: "progress",
    label: "Em atendimento", text: "text-info", urgent: false,
    card: "border-info/45 bg-info/10",
  };
  if (appointment.startAt < now) return {
    kind: "review",
    label: "Horário ultrapassado · revisar início", text: "text-danger", urgent: true,
    card: "border-danger/40 bg-danger/10",
  };
  if (isNext) return {
    kind: "next",
    label: "Próximo atendimento", text: "text-foreground", urgent: false,
    card: "border-foreground/80 bg-card",
  };
  if (appointment.status === "PENDING") return {
    kind: "pending",
    label: "Aguardando confirmação", text: "text-warning", urgent: false,
    card: "border-warning/40 bg-card",
  };
  return {
    kind: "scheduled",
    label: "Agendado para hoje", text: "text-muted-foreground", urgent: false,
    card: "border-border bg-card",
  };
}

function appointmentStatusLabel(status: string) {
  if (status === "IN_PROGRESS") return "Em atendimento";
  if (status === "PENDING") return "A confirmar";
  return "Confirmado";
}

function DailyPulse({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 bg-card px-3.5 py-2.5 sm:block sm:py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="whitespace-nowrap text-base font-semibold tabular-nums sm:mt-0.5">
        {value}
      </p>
    </div>
  );
}
