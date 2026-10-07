"use client";

import { AgendaColorSelect, useAgendaColorMode } from "@/components/agenda-color-select";
import { appointmentColor } from "@/lib/agenda-colors";
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck2, CalendarDays, Check, CheckCircle2, CircleAlert, Clock3, DoorOpen, Loader2, MessageCircle, MoreHorizontal, Phone, Play, UserX, type LucideIcon } from "lucide-react";
import { ActionSheet, type SheetAction } from "@/components/ui/action-sheet";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { formatInTimeZone } from "date-fns-tz";
import { formatMoney } from "@/lib/utils";
import { buildAppointmentWhatsAppLink } from "@/lib/whatsapp";
import { isValidPhoneBR, normalizePhone } from "@/lib/phone";
import { ACTION_LABELS, STATUS, nextActions, statusActionClasses, type ApptStatus } from "../agenda/agenda-status";
import { markReminderSent, updateAppointmentStatus } from "../agenda/actions";
import { registerArrival } from "./actions";

export type TodayAppointment = {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
  version: number;
  checkedInAt?: string | null;
  priceCents: number;
  hasPayment: boolean;
  clientName: string;
  clientPhone: string | null;
  professionalName: string;
  professionalColor?: string | null;
  serviceColor?: string | null;
  category?: string | null;
  serviceName: string;
};

type Filter = "all" | "attention" | "active" | "completed";

const ACTION_ICONS: Partial<Record<ApptStatus, typeof Check>> = {
  CONFIRMED: Check,
  IN_PROGRESS: Play,
  COMPLETED: CheckCircle2,
  NO_SHOW: UserX,
};

export function HojeView({
  colorScope,
  date,
  initialNowMs,
  salonName = "o estabelecimento",
  timezone,
  currency,
  appointments,
}: {
  colorScope: string;
  date: string;
  initialNowMs: number;
  salonName?: string;
  timezone: string;
  currency: string;
  appointments: TodayAppointment[];
}) {
  const [colorMode, setColorMode] = useAgendaColorMode(colorScope);
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("active");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [reminderId, setReminderId] = useState<string | null>(null);
  const [sentReminderIds, setSentReminderIds] = useState<Set<string>>(new Set());
  const [openedReminderIds, setOpenedReminderIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<TodayAppointment | null>(null);
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(initialNowMs);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  function arrive(appointment: TodayAppointment) {
    setError(null);
    setPendingId(appointment.id);
    startTransition(async () => {
      try {
        const result = await registerArrival({ appointmentId: appointment.id, expectedVersion: appointment.version });
        if (result.error) setError(result.error);
        else router.refresh();
      } catch { setError("Não foi possível registrar a chegada. Tente novamente."); }
      finally { setPendingId(null); }
    });
  }

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
    setOpenedReminderIds(previous => new Set(previous).add(appointment.id));
  }

  function confirmReminder(appointment: TodayAppointment) {
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
      {/* No celular os números ficam nos filtros abaixo: a lista do dia aparece já na primeira tela. */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 max-md:hidden">
        <SummaryCard icon={CalendarDays} label="Agendamentos" value={String(counts.total)} />
        <SummaryCard icon={CircleAlert} label="A confirmar" value={String(counts.attention)} tone={counts.attention > 0 ? "warning" : "neutral"} />
        <SummaryCard icon={Clock3} label="Em atendimento" value={String(counts.inProgress)} tone="info" />
        <SummaryCard icon={CheckCircle2} label="Concluídos" value={String(counts.completed)} tone="success" />
      </section>

      {error && <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}

      <section className="rounded-2xl border border-border bg-card p-4 sm:p-5 max-md:border-0 max-md:bg-transparent max-md:p-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="max-md:sr-only">
            <h2 className="text-base font-semibold">Atendimentos do dia</h2>
            <p className="mt-1 text-sm text-muted-foreground">A próxima ação aparece em cada cartão.</p>
          </div>
          <div className="max-md:hidden"><AgendaColorSelect value={colorMode} onChange={setColorMode} /></div>
          <SegmentedControl
            ariaLabel="Filtrar atendimentos"
            value={filter}
            onChange={setFilter}
            stretch={false}
            className="max-md:w-full"
            options={[
              { value: "active", label: `Em aberto ${counts.active}` },
              { value: "attention", label: `A confirmar ${counts.attention}` },
              { value: "completed", label: `Encerrados ${counts.completed + counts.noShow}` },
              { value: "all", label: `Todos ${counts.total}` },
            ]}
          />
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            compact
            icon={CalendarCheck2}
            title="Nenhum atendimento neste filtro."
            description="A agenda continua disponível para consulta e novos horários."
            className="mt-5 max-md:mt-4"
          />
        ) : (
          <div className="mt-5 space-y-3 max-md:mt-4">
            {filtered.map((appointment) => {
              const start = new Date(appointment.startAt);
              const isStarted = start.getTime() <= now;
              const callHref = phoneHref(appointment.clientPhone);
              const actions = nextActions(appointment.status)
                .filter((action) => action !== "NO_SHOW" || isStarted)
                .filter((action) => action !== "IN_PROGRESS" || isStarted)
                .filter((action) => ACTION_LABELS[action]);
              const status = STATUS[appointment.status as ApptStatus];
              // Celular: uma ação principal larga; chegada, falta e detalhes ficam no "⋯".
              const primary = actions.find((action) => action !== "NO_SHOW");
              const canArrive = !appointment.checkedInAt && ["PENDING", "CONFIRMED"].includes(appointment.status) && date === formatInTimeZone(now, timezone, "yyyy-MM-dd");
              const arriveIsPrimary = canArrive && !primary;

              return (
                <article key={appointment.id} style={{ borderLeftWidth: 5, borderLeftColor: appointmentColor(colorMode, { professional: appointment.professionalColor ?? "#6B9FA8", service: appointment.serviceColor, category: appointment.category, status: STATUS[appointment.status as ApptStatus]?.color ?? "#64748B" }), background: `color-mix(in srgb, ${appointmentColor(colorMode, { professional: appointment.professionalColor ?? "#6B9FA8", service: appointment.serviceColor, category: appointment.category, status: STATUS[appointment.status as ApptStatus]?.color ?? "#64748B" })} 10%, hsl(var(--card)))` }} className="rounded-2xl border border-border bg-surface-1 p-4 transition-colors hover:border-border-strong max-md:p-3.5">
                  <div className="grid gap-4 max-md:gap-2.5 sm:grid-cols-[auto_minmax(0,1fr)] 2xl:grid-cols-[auto_minmax(220px,1fr)_auto] 2xl:items-center">
                    <div className="flex items-start gap-3 sm:w-48 max-md:items-center">
                      <span className="w-16 shrink-0 whitespace-nowrap text-xl font-semibold tabular-nums max-md:w-auto max-md:text-lg">{formatInTimeZone(start, timezone, "HH:mm")}</span>
                      <div className="min-w-0 max-md:flex max-md:flex-1 max-md:flex-row-reverse max-md:items-center max-md:justify-between max-md:gap-2">
                        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${status?.badgeClass ?? "bg-muted text-muted-foreground"}`}>
                          {status?.label ?? appointment.status}
                        </span>
                        <p className="mt-1 text-[13px] text-muted-foreground max-md:mt-0"><span className="md:hidden">até </span>{formatInTimeZone(new Date(appointment.endAt), timezone, "HH:mm")}</p>
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold">{appointment.clientName}</p>
                      <p className="mt-1 truncate text-sm text-muted-foreground">{appointment.serviceName} · {appointment.professionalName}</p>
                      {appointment.checkedInAt && <p className="mt-1 text-[13px] font-medium text-success">Chegou às {formatInTimeZone(new Date(appointment.checkedInAt), timezone, "HH:mm")}{["PENDING", "CONFIRMED"].includes(appointment.status) ? ` · aguardando ${Math.max(0, Math.floor((now - Date.parse(appointment.checkedInAt)) / 60000))} min` : ""}</p>}
                      <p className="mt-1 text-[13px] text-muted-foreground">{formatMoney(appointment.priceCents, currency)}{appointment.hasPayment ? " · recebido" : ""}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:col-span-2 2xl:col-span-1 2xl:max-w-[660px] 2xl:justify-end max-md:pt-1">
                      {canArrive && <button type="button" disabled={pending} onClick={() => arrive(appointment)} className={`press min-h-11 rounded-lg border border-success/40 bg-success/10 px-3 text-[13px] font-semibold text-success ${arriveIsPrimary ? "max-md:order-first max-md:flex-1 max-md:rounded-xl max-[359px]:basis-full" : "max-md:hidden"}`}>Registrar chegada</button>}
                      {openedReminderIds.has(appointment.id) && !sentReminderIds.has(appointment.id) && <button type="button" disabled={pending} onClick={() => confirmReminder(appointment)} className="min-h-11 rounded-lg border border-border px-3 text-[13px]">Confirmar envio manual</button>}
                      <button
                        type="button"
                        disabled={!appointment.clientPhone || pending || reminderId === appointment.id}
                        onClick={() => sendReminder(appointment)}
                        title={!appointment.clientPhone ? "Cliente sem telefone cadastrado" : "Enviar lembrete pelo WhatsApp"}
                        aria-label={appointment.clientPhone
                          ? `Enviar lembrete pelo WhatsApp para ${appointment.clientName}`
                          : `${appointment.clientName} está sem telefone cadastrado`}
                        className={`press grid h-11 w-11 shrink-0 place-items-center rounded-xl transition disabled:cursor-not-allowed disabled:opacity-40 ${
                          sentReminderIds.has(appointment.id)
                            ? "bg-success/15 text-success"
                            : "bg-success/10 text-success hover:bg-success/15"
                        }`}
                      >
                        {reminderId === appointment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" aria-hidden="true" />}
                      </button>
                      <a
                        href={callHref}
                        aria-label={callHref !== "#" ? `Ligar para ${appointment.clientName}` : `${appointment.clientName} está sem telefone válido`}
                        title={callHref !== "#" ? "Ligar para o cliente" : "Cliente sem telefone válido"}
                        className="press grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary transition hover:bg-primary/20 aria-disabled:pointer-events-none aria-disabled:opacity-40"
                        aria-disabled={callHref === "#"}
                        onClick={(event) => { if (callHref === "#") event.preventDefault(); }}
                      >
                        <Phone className="h-4 w-4" aria-hidden="true" />
                      </a>
                      {actions.map((action) => {
                        const Icon = ACTION_ICONS[action] ?? Check;
                        const actionLabel = ACTION_LABELS[action] ?? STATUS[action].label;
                        return (
                          <button
                            key={action}
                            type="button"
                            disabled={pending || pendingId === appointment.id}
                            onClick={() => runStatus(appointment, action)}
                            className={`press inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-xl px-3.5 text-[13px] font-semibold transition disabled:opacity-50 ${statusActionClasses(action)} ${action === primary ? "max-md:order-first max-md:flex-1 max-md:justify-center max-[359px]:basis-full" : "max-md:hidden"}`}
                          >
                            {pendingId === appointment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4 max-md:hidden" aria-hidden="true" />}
                            {actionLabel}
                          </button>
                        );
                      })}
                      <Link href={`/agenda?date=${date}&appointment=${encodeURIComponent(appointment.id)}&from=hoje`} className={`press inline-flex min-h-11 items-center justify-center rounded-xl border border-border px-3.5 text-[13px] font-medium text-muted-foreground transition hover:bg-card-hover hover:text-foreground ${primary || arriveIsPrimary ? "max-md:hidden" : "max-md:order-first max-md:flex-1 max-[359px]:basis-full"}`}>
                        Ver detalhes
                      </Link>
                      <button
                        type="button"
                        aria-label={`Mais ações para ${appointment.clientName}`}
                        aria-haspopup="dialog"
                        onClick={() => setMenuFor(appointment)}
                        className="press grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border text-foreground md:hidden"
                      >
                        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      <ActionSheet
        open={menuFor !== null}
        onOpenChange={(open) => { if (!open) setMenuFor(null); }}
        title={menuFor?.clientName ?? "Atendimento"}
        description={menuFor ? `${formatInTimeZone(new Date(menuFor.startAt), timezone, "HH:mm")} · ${menuFor.serviceName}` : undefined}
        actions={menuFor ? sheetActions(menuFor) : []}
      />
    </>
  );

  function sheetActions(appointment: TodayAppointment): SheetAction[] {
    const started = new Date(appointment.startAt).getTime() <= now;
    const items: SheetAction[] = [];
    const canArrive = !appointment.checkedInAt && ["PENDING", "CONFIRMED"].includes(appointment.status) && date === formatInTimeZone(now, timezone, "yyyy-MM-dd");
    if (canArrive) items.push({ key: "arrive", label: "Registrar chegada", icon: DoorOpen, tone: "primary", disabled: pending, onSelect: () => arrive(appointment) });
    if (nextActions(appointment.status).includes("NO_SHOW") && started) {
      items.push({ key: "no-show", label: "Marcar falta", icon: UserX, tone: "danger", disabled: pending, onSelect: () => runStatus(appointment, "NO_SHOW") });
    }
    items.push({ key: "details", label: "Ver detalhes", description: "Abrir na agenda", icon: CalendarDays, href: `/agenda?date=${date}&appointment=${encodeURIComponent(appointment.id)}&from=hoje` });
    return items;
  }
}

function phoneHref(phone: string | null): string {
  return phone && isValidPhoneBR(phone) ? `tel:+55${normalizePhone(phone)}` : "#";
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
  tone?: "neutral" | "info" | "success" | "warning";
}) {
  const toneClass = tone === "info" ? "text-info" : tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <Icon className={`h-4 w-4 ${tone === "neutral" ? "text-muted-foreground" : toneClass}`} aria-hidden="true" />
      <p className={`mt-3 text-2xl font-semibold tracking-tight ${toneClass}`}>{value}</p>
      <p className="mt-1 text-[13px] text-muted-foreground">{label}</p>
    </div>
  );
}
