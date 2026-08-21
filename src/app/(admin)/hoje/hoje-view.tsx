"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, CheckCircle2, CircleAlert, Clock3, Loader2, MessageCircle, Play, UserX, type LucideIcon } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { formatMoney } from "@/lib/utils";
import { buildAppointmentWhatsAppLink } from "@/lib/whatsapp";
import { STATUS, nextActions, type ApptStatus } from "../agenda/agenda-status";
import { markReminderSent, updateAppointmentStatus } from "../agenda/actions";

export type TodayAppointment = {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  version: number;
  priceCents: number;
  hasPayment: boolean;
  clientName: string;
  clientPhone: string | null;
  professionalName: string;
  serviceName: string;
};

type Filter = "all" | "attention" | "active" | "completed";

const ACTION_LABELS: Partial<Record<ApptStatus, string>> = {
  CONFIRMED: "Confirmar presença",
  IN_PROGRESS: "Iniciar atendimento",
  COMPLETED: "Concluir atendimento",
  NO_SHOW: "Marcar no-show",
};

const ACTION_ICONS: Partial<Record<ApptStatus, typeof Check>> = {
  CONFIRMED: Check,
  IN_PROGRESS: Play,
  COMPLETED: CheckCircle2,
  NO_SHOW: UserX,
};

export function HojeView({
  date,
  salonName = "o estabelecimento",
  timezone,
  currency,
  appointments,
}: {
  date: string;
  salonName?: string;
  timezone: string;
  currency: string;
  appointments: TodayAppointment[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [reminderId, setReminderId] = useState<string | null>(null);
  const [sentReminderIds, setSentReminderIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const now = Date.now();

  const counts = useMemo(() => ({
    total: appointments.length,
    attention: appointments.filter((appointment) => appointment.status === "PENDING").length,
    active: appointments.filter((appointment) => ["PENDING", "CONFIRMED", "IN_PROGRESS"].includes(appointment.status)).length,
    inProgress: appointments.filter((appointment) => appointment.status === "IN_PROGRESS").length,
    completed: appointments.filter((appointment) => appointment.status === "COMPLETED").length,
    noShow: appointments.filter((appointment) => appointment.status === "NO_SHOW").length,
  }), [appointments]);

  const filtered = useMemo(() => appointments.filter((appointment) => {
    if (filter === "attention") return appointment.status === "PENDING";
    if (filter === "active") return ["PENDING", "CONFIRMED", "IN_PROGRESS"].includes(appointment.status);
    if (filter === "completed") return ["COMPLETED", "NO_SHOW", "CANCELLED"].includes(appointment.status);
    return true;
  }), [appointments, filter]);

  function runStatus(appointment: TodayAppointment, next: ApptStatus) {
    setError(null);
    setPendingId(appointment.id);
    startTransition(async () => {
      const result = await updateAppointmentStatus(appointment.id, next, {
        expectedVersion: appointment.version,
        idempotencyKey: crypto.randomUUID(),
      });
      setPendingId(null);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function sendReminder(appointment: TodayAppointment) {
    const when = formatInTimeZone(new Date(appointment.startAt), timezone, "HH:mm");
    const link = buildAppointmentWhatsAppLink({
      phone: appointment.clientPhone,
      clientName: appointment.clientName,
      salonName,
      when,
      serviceName: appointment.serviceName,
      professionalName: appointment.professionalName,
    });
    if (!link) return;

    window.open(link, "_blank", "noopener,noreferrer");
    setReminderId(appointment.id);
    startTransition(async () => {
      try {
        await markReminderSent(appointment.id);
        setSentReminderIds((previous) => new Set(previous).add(appointment.id));
      } catch {
        // O WhatsApp já foi aberto; a próxima tentativa continua disponível.
      } finally {
        setReminderId(null);
      }
    });
  }

  return (
    <>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard icon={CalendarDays} label="Agendamentos" value={String(counts.total)} />
        <SummaryCard icon={CircleAlert} label="A confirmar" value={String(counts.attention)} tone={counts.attention > 0 ? "warning" : "neutral"} />
        <SummaryCard icon={Clock3} label="Em atendimento" value={String(counts.inProgress)} tone="primary" />
        <SummaryCard icon={CheckCircle2} label="Concluídos" value={String(counts.completed)} tone="success" />
      </section>

      {error && <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}

      <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Atendimentos do dia</h2>
            <p className="mt-1 text-sm text-muted-foreground">A próxima ação aparece em cada cartão.</p>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar atendimentos">
            <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>Todos {counts.total}</FilterButton>
            <FilterButton active={filter === "attention"} onClick={() => setFilter("attention")}>A confirmar {counts.attention}</FilterButton>
            <FilterButton active={filter === "active"} onClick={() => setFilter("active")}>Em aberto {counts.active}</FilterButton>
            <FilterButton active={filter === "completed"} onClick={() => setFilter("completed")}>Encerrados {counts.completed + counts.noShow}</FilterButton>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-border p-8 text-center">
            <p className="text-sm font-medium">Nenhum atendimento neste filtro.</p>
            <p className="mt-1 text-sm text-muted-foreground">A agenda continua disponível para consulta e novos horários.</p>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {filtered.map((appointment) => {
              const start = new Date(appointment.startAt);
              const isStarted = start.getTime() <= now;
              const actions = nextActions(appointment.status)
                .filter((action) => action !== "NO_SHOW" || isStarted)
                .filter((action) => action !== "IN_PROGRESS" || isStarted)
                .filter((action) => ACTION_LABELS[action]);
              const status = STATUS[appointment.status as ApptStatus];

              return (
                <article key={appointment.id} className="rounded-2xl border border-border bg-surface-1 p-4 transition-colors hover:border-border-strong">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                    <div className="flex items-start gap-3 lg:w-48 lg:shrink-0">
                      <span className="w-14 shrink-0 text-xl font-semibold tabular-nums">{formatInTimeZone(start, timezone, "HH:mm")}</span>
                      <div className="min-w-0">
                        <span className="inline-flex rounded-full px-2 py-1 text-[10px] font-semibold" style={{ background: `${status?.color ?? "#94A3B8"}1c`, color: status?.color ?? "#94A3B8" }}>
                          {status?.label ?? appointment.status}
                        </span>
                        <p className="mt-1 text-xs text-muted-foreground">{formatInTimeZone(new Date(appointment.endAt), timezone, "HH:mm")}</p>
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold">{appointment.clientName}</p>
                      <p className="mt-1 truncate text-sm text-muted-foreground">{appointment.serviceName} · {appointment.professionalName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatMoney(appointment.priceCents, currency)}{appointment.hasPayment ? " · recebido" : ""}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      <button
                        type="button"
                        disabled={!appointment.clientPhone || pending || reminderId === appointment.id}
                        onClick={() => sendReminder(appointment)}
                        title={!appointment.clientPhone ? "Cliente sem telefone cadastrado" : "Enviar lembrete pelo WhatsApp"}
                        aria-label={appointment.clientPhone
                          ? `Enviar lembrete pelo WhatsApp para ${appointment.clientName}`
                          : `${appointment.clientName} está sem telefone cadastrado`}
                        className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl transition disabled:cursor-not-allowed disabled:opacity-40 ${
                          sentReminderIds.has(appointment.id)
                            ? "bg-[#25D366]/25 text-[#25D366]"
                            : "bg-[#25D366]/15 text-[#25D366] hover:bg-[#25D366]/25"
                        }`}
                      >
                        {reminderId === appointment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" aria-hidden="true" />}
                      </button>
                      {actions.map((action) => {
                        const Icon = ACTION_ICONS[action] ?? Check;
                        const actionLabel = ACTION_LABELS[action] ?? STATUS[action].label;
                        return (
                          <button
                            key={action}
                            type="button"
                            disabled={pending || pendingId === appointment.id}
                            onClick={() => runStatus(appointment, action)}
                            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-3.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                          >
                            {pendingId === appointment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" aria-hidden="true" />}
                            {actionLabel}
                          </button>
                        );
                      })}
                      <Link href={`/agenda?date=${date}`} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border px-3.5 text-xs font-medium text-muted-foreground transition hover:bg-card-hover hover:text-foreground">
                        Ver detalhes
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: "neutral" | "primary" | "success" | "warning";
}) {
  const toneClass = tone === "primary" ? "text-primary" : tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <p className={`mt-3 text-2xl font-semibold tracking-tight ${toneClass}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-11 rounded-full border px-3 text-xs font-medium transition ${active ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-card-hover hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}
