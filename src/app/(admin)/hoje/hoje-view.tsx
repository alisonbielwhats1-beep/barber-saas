"use client";

import { AgendaColorSelect, useAgendaColorMode } from "@/components/agenda-color-select";
import { appointmentColor } from "@/lib/agenda-colors";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck2, CalendarDays, Check, CheckCircle2, ChevronRight, Clock3, Loader2, LogIn, MessageCircle, MoreHorizontal, Phone, Play, ReceiptText, UserX, type LucideIcon } from "lucide-react";
import { ActionSheet, type SheetAction } from "@/components/ui/action-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { formatInTimeZone } from "date-fns-tz";
import { cn } from "@/lib/utils";
import { contrastForeground } from "@/lib/color-contrast";
import { buildAppointmentWhatsAppLink } from "@/lib/whatsapp";
import { isValidPhoneBR, normalizePhone } from "@/lib/phone";
import { ACTION_LABELS, STATUS, nextActions, type ApptStatus } from "../agenda/agenda-status";
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
/** Rótulo curto do botão no cartão do celular (o nome acessível continua o rótulo completo). */
const SHORT_LABELS: Partial<Record<ApptStatus, string>> = {
  CONFIRMED: "Confirmar",
  IN_PROGRESS: "Iniciar",
  COMPLETED: "Concluir",
};
const FALLBACK_PRO_COLOR = "#6B9FA8";

/*
 * Lista do dia, um único DOM para três arranjos:
 *  - celular (abaixo de 768 px): um cartão por atendimento;
 *  - tabela estreita (contêiner da lista com menos de 1040 px): Horário | Cliente e serviço | Situação, ações numa 2ª linha;
 *  - tabela larga: Horário | Cliente e serviço | Profissional | Situação | Ações (colunas compartilhadas por subgrid).
 * As classes de cada arranjo usam variantes que não se sobrepõem (max-md, md + @container < 1040, @container ≥ 1040).
 */
const LIST_GRID = "flex flex-col gap-3 md:grid md:gap-x-4 md:gap-y-0 md:[@container(max-width:1039px)]:grid-cols-[auto_minmax(0,1fr)_auto] [@container(min-width:1040px)]:grid-cols-[auto_minmax(0,1.6fr)_minmax(0,1fr)_auto_auto]";
const LIST_HEAD = "hidden items-center px-4 text-xs font-semibold text-muted-foreground md:col-span-full md:grid md:min-h-[38px] md:grid-cols-subgrid";
const ROW = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-y-1.5 max-md:gap-x-2 rounded-[14px] border border-border bg-card p-3.5 md:col-span-full md:grid-cols-subgrid md:gap-y-2 md:rounded-none md:border-x-0 md:border-b-0 md:bg-transparent md:px-4 md:[@container(max-width:1039px)]:items-start md:[@container(max-width:1039px)]:py-3 [@container(min-width:1040px)]:min-h-[62px] [@container(min-width:1040px)]:py-2";
const ROW_TIME = "col-start-1 row-start-1 whitespace-nowrap text-base tabular-nums md:text-sm";
const ROW_MAIN = "group min-w-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:order-1 max-md:col-span-2 md:col-start-2 md:row-start-1";
const ROW_PRO = "flex min-w-0 items-center gap-2 text-sm max-md:order-2 max-md:col-span-2 max-md:text-muted-foreground md:[@container(max-width:1039px)]:hidden [@container(min-width:1040px)]:col-start-3 [@container(min-width:1040px)]:row-start-1";
const ROW_PRO_INLINE = "hidden md:[@container(max-width:1039px)]:inline";
const ROW_STATUS = "row-start-1 max-md:col-start-2 max-md:justify-self-end md:[@container(max-width:1039px)]:col-start-3 [@container(min-width:1040px)]:col-start-4";
const ROW_ACTIONS = "flex flex-wrap items-center gap-2 max-md:order-4 max-md:col-span-2 max-md:mt-1.5 md:[@container(max-width:1039px)]:row-start-2 md:[@container(max-width:1039px)]:[grid-column:2/-1] [@container(min-width:1040px)]:col-start-5 [@container(min-width:1040px)]:row-start-1 [@container(min-width:1040px)]:flex-nowrap [@container(min-width:1040px)]:justify-end";
const ROW_REMIND = "flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-dashed border-border-strong px-2.5 py-2 text-xs text-muted-foreground max-md:order-3 max-md:col-span-2 md:[grid-column:1/-1]";
const COL_STRETCH_ONLY = "md:[@container(max-width:1039px)]:hidden";
/** Ícone de contorno do protótipo: 44 px no toque, 36 px a partir de lg. */
const ICON_OUTLINE = "border border-border-strong text-foreground";
const ICON_LINK = "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-border-strong text-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:pointer-events-none aria-disabled:opacity-40 lg:h-9 lg:w-9 lg:rounded-[9px]";

/** Filter label: "Todos · 14" on the computer; number above the name on the phone. Accessible name stays "Todos 14". */
function filterLabel(label: string, count: number) {
  return (
    <span className="flex flex-col-reverse items-center leading-tight md:flex-row md:gap-1">
      <span className="max-md:text-xs">{label}</span>{" "}
      <span aria-hidden="true" className="max-md:hidden">·</span>{" "}
      <span className="tabular-nums max-md:text-sm max-md:font-semibold max-md:text-foreground">{count}</span>
    </span>
  );
}

/** Price as in the prototype: cents only when the value has them. `R$` and the number never break apart. */
function priceLabel(cents: number, currency: string) {
  const digits = cents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(cents / 100);
}

function startsIn(ms: number) {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `em ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `em ${hours} h ${rest} min` : `em ${hours} h`;
}

export function HojeView({
  colorScope,
  date,
  initialNowMs,
  salonName = "o estabelecimento",
  timezone,
  currency,
  appointments,
  receipts,
}: {
  colorScope: string;
  date: string;
  initialNowMs: number;
  salonName?: string;
  timezone: string;
  currency: string;
  appointments: TodayAppointment[];
  /** Baixa em lote (dono e gerente). Vai na linha de recebimentos das Pendências; sem ela, a linha só filtra a lista. */
  receipts?: ReactNode;
}) {
  const [colorMode, setColorMode] = useAgendaColorMode(colorScope);
  const router = useRouter();
  const listTitleId = useId();
  const listRef = useRef<HTMLElement>(null);
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
    unpaid: appointments.filter((appointment) => appointment.status === "COMPLETED" && !appointment.hasPayment).length,
  }), [appointments]);

  const filtered = useMemo(() => appointments.filter((appointment) => {
    if (filter === "attention") return appointment.status === "PENDING";
    if (filter === "active") return ["PENDING", "CONFIRMED", "IN_PROGRESS"].includes(appointment.status);
    if (filter === "completed") return ["COMPLETED", "NO_SHOW", "CANCELLED"].includes(appointment.status);
    return true;
  }), [appointments, filter]);

  const todayKey = formatInTimeZone(now, timezone, "yyyy-MM-dd");
  const isToday = date === todayKey;
  // Same rule the page used: the first booking still to confirm or confirmed that starts from now on.
  const next = appointments.find((appointment) => ["PENDING", "CONFIRMED"].includes(appointment.status) && Date.parse(appointment.startAt) >= now);

  /** Actions offered for a booking, with the same filters as before: start and no-show only after the scheduled start; arrival only today. */
  function plan(appointment: TodayAppointment) {
    const started = Date.parse(appointment.startAt) <= now;
    const actions = nextActions(appointment.status)
      .filter((action) => action !== "NO_SHOW" || started)
      .filter((action) => action !== "IN_PROGRESS" || started)
      .filter((action) => ACTION_LABELS[action]);
    const primary = actions.find((action) => action !== "NO_SHOW");
    const canArrive = !appointment.checkedInAt && ["PENDING", "CONFIRMED"].includes(appointment.status) && isToday;
    return { started, primary, canArrive, arriveIsPrimary: canArrive && !primary };
  }

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

  function showFilter(value: Filter) {
    setFilter(value);
    listRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }

  const detailsHref = (appointment: TodayAppointment) => `/agenda?date=${date}&appointment=${encodeURIComponent(appointment.id)}&from=hoje`;

  /** The one main action of a booking (status change or arrival), or null. */
  function primaryButton(appointment: TodayAppointment, where: "row" | "next") {
    const { primary, arriveIsPrimary } = plan(appointment);
    const busy = pendingId === appointment.id;
    // Celular: botão largo ao lado dos três ícones; abaixo de 390 px ele ocupa a linha e os ícones descem (em todos os cartões).
    const grow = where === "next" ? "min-w-[8rem] flex-1" : "max-md:flex-1 max-[389px]:basis-full";
    // No cartão Próximo o botão vai sem ícone, como no protótipo (divide a largura com "Ver na agenda").
    const icon = (Icon: LucideIcon) => where === "next" ? null : busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> : <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />;
    if (primary) {
      const Icon = ACTION_ICONS[primary] ?? Check;
      const label = ACTION_LABELS[primary] ?? STATUS[primary].label;
      return (
        <Button type="button" variant="secondary" aria-label={label} disabled={pending || busy} onClick={() => runStatus(appointment, primary)} className={grow}>
          {icon(Icon)}
          {where === "next" ? label : <><span className="max-md:hidden">{label}</span><span className="md:hidden">{SHORT_LABELS[primary] ?? label}</span></>}
        </Button>
      );
    }
    if (arriveIsPrimary) {
      return (
        <Button type="button" variant="secondary" disabled={pending} onClick={() => arrive(appointment)} className={grow}>
          {icon(LogIn)}
          Registrar chegada
        </Button>
      );
    }
    return null;
  }

  const nextPrimary = next ? primaryButton(next, "next") : null;
  // Pendências do dia: só o que esta tela já sabe (recebimentos e reservas a confirmar).
  const unpaidText = counts.unpaid === 1 ? "atendimento finalizado sem pagamento" : "atendimentos finalizados sem pagamento";
  const pendingRows = [
    receipts ? null : { key: "unpaid", icon: ReceiptText, count: counts.unpaid, text: unpaidText, onSelect: counts.unpaid ? () => showFilter("completed") : undefined },
    { key: "attention", icon: Clock3, count: counts.attention, text: counts.attention === 1 ? "reserva a confirmar" : "reservas a confirmar", onSelect: counts.attention ? () => showFilter("attention") : undefined },
  ].filter((row) => row !== null);
  const firstPhoneRow = pendingRows.find((row) => row.count > 0)?.key;

  return (
    <>
      {/* Indicadores: quatro cartões com pastilha de ícone no computador; no celular um cartão só com quatro números
          (2 × 2 abaixo de 400 px), sem ícones, para a lista continuar perto do topo. */}
      <section aria-label="Resumo do dia" className="grid grid-cols-4 gap-3.5 max-md:order-2 max-md:gap-px max-md:overflow-hidden max-md:rounded-[14px] max-md:border max-md:border-border max-md:bg-border max-[399px]:grid-cols-2">
        <SummaryCard icon={CalendarDays} label="Agendamentos" value={counts.total} tone="info" />
        <SummaryCard icon={Clock3} label="A confirmar" value={counts.attention} tone="warning" dot />
        <SummaryCard icon={Play} label="Em atendimento" value={counts.inProgress} tone="info" dot />
        <SummaryCard icon={Check} label="Concluídos" value={counts.completed} tone="success" dot />
      </section>

      {/* Próximo + Pendências lado a lado no computador; no celular os dois viram blocos soltos na ordem do protótipo. */}
      <div className="grid gap-4 md:grid-cols-2 max-md:contents">
        {next ? (
          <section aria-label="Próximo atendimento" className="rounded-[14px] border border-border bg-card p-4 max-md:order-1">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-muted-foreground">{isToday ? `Próximo · ${startsIn(Date.parse(next.startAt) - now)}` : "Próximo atendimento"}</p>
              <p className="text-lg font-semibold tabular-nums">{formatInTimeZone(new Date(next.startAt), timezone, "HH:mm")}</p>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <ProAvatar name={next.professionalName} color={next.professionalColor} large />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold" title={next.clientName}>{next.clientName}</p>
                <p className="truncate text-sm text-muted-foreground">{next.serviceName} · com {next.professionalName.trim().split(/\s+/)[0]}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {nextPrimary}
              <Button asChild variant="outline" className="min-w-[8rem] flex-1">
                <Link href={`/agenda?date=${date}`}>Ver na agenda</Link>
              </Button>
            </div>
          </section>
        ) : (
          <div className="hidden rounded-[14px] border border-border bg-card p-4 text-sm text-muted-foreground md:block">
            Nenhum próximo atendimento {isToday ? "hoje" : "neste dia"}.
          </div>
        )}

        <section aria-label="Pendências do dia" className="max-md:contents md:flex md:flex-col md:overflow-hidden md:rounded-[14px] md:border md:border-border md:bg-card">
          <h2 className="px-4 pb-1.5 pt-4 text-sm font-semibold max-md:sr-only">Pendências do dia</h2>
          {receipts && (
            // A baixa em lote é o componente do Financeiro (sem variante compacta): as caixas dele são achatadas
            // (display: contents), o título fica só para leitor de tela e o botão "Registrar recebimentos" vira o
            // atalho da linha (computador) ou cobre o cartão inteiro, invisível, com o foco no cartão (celular).
            <div className="relative flex items-center gap-3 text-sm max-md:order-3 max-md:min-h-[54px] max-md:rounded-[14px] max-md:border max-md:border-border max-md:bg-card max-md:px-3.5 max-md:py-2 max-md:has-[button:focus-visible]:ring-2 max-md:has-[button:focus-visible]:ring-ring md:grid md:min-h-[46px] md:grid-cols-[20px_minmax(0,1fr)_auto] md:gap-4 md:border-t md:border-border md:pl-4 md:pr-1">
              <span className="grid shrink-0 place-items-center max-md:h-[34px] max-md:w-[34px] max-md:rounded-[9px] max-md:bg-warning/15 max-md:text-warning md:text-muted-foreground">
                <ReceiptText className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span aria-hidden="true" className="block font-medium md:hidden">Registrar recebimentos</span>
                <span className={cn("block max-md:text-muted-foreground", counts.unpaid === 0 && "max-md:hidden")}>
                  <span className="font-semibold tabular-nums text-foreground">{counts.unpaid}</span> {unpaidText}
                </span>
                {counts.unpaid === 0 && <span className="block text-muted-foreground md:hidden">Dar baixa em vários atendimentos de uma vez</span>}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground md:hidden" aria-hidden="true" />
              <div className="max-md:absolute max-md:inset-0 [&>*]:contents [&_div]:contents [&_h2+p]:sr-only [&_h2]:sr-only [&_button]:font-semibold max-md:[&_button]:absolute max-md:[&_button]:inset-0 max-md:[&_button]:z-[1] max-md:[&_button]:cursor-pointer max-md:[&_button]:opacity-0 md:[&_button:focus-visible]:outline-none md:[&_button:focus-visible]:ring-2 md:[&_button:focus-visible]:ring-ring md:[&_button:hover]:bg-card-hover md:[&_button]:rounded-[9px] md:[&_button]:border-0 md:[&_button]:bg-transparent md:[&_button]:px-3 md:[&_button]:text-foreground lg:[&_button]:min-h-9">
                {receipts}
              </div>
            </div>
          )}
          <div className={cn("md:contents", firstPhoneRow ? "max-md:order-4 max-md:overflow-hidden max-md:rounded-[14px] max-md:border max-md:border-border max-md:bg-card" : "max-md:hidden")}>
            {pendingRows.map((row) => (
              <button
                key={row.key}
                type="button"
                disabled={!row.onSelect}
                onClick={row.onSelect}
                className={cn(
                  "flex w-full items-center gap-3 text-left text-sm transition-colors enabled:hover:bg-card-hover disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  "max-md:min-h-[54px] max-md:px-3.5 max-md:py-2 md:grid md:min-h-[46px] md:grid-cols-[20px_minmax(0,1fr)_auto] md:gap-4 md:border-t md:border-border md:pl-4 md:pr-1",
                  row.count === 0 && "max-md:hidden",
                  row.key !== firstPhoneRow && "max-md:border-t max-md:border-border",
                )}
              >
                <span className="grid shrink-0 place-items-center max-md:h-[34px] max-md:w-[34px] max-md:rounded-[9px] max-md:bg-warning/15 max-md:text-warning md:text-muted-foreground">
                  <row.icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1"><span className="font-semibold tabular-nums">{row.count}</span> {row.text}</span>
                <span className={cn("shrink-0 px-3 font-semibold", row.onSelect ? "text-foreground" : "text-muted-foreground")}>{row.onSelect ? "Ver" : "Nada pendente"}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      {error && <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger max-md:order-5">{error}</p>}

      <section ref={listRef} aria-labelledby={listTitleId} className="scroll-mt-4 max-md:order-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1 max-md:order-1">
            <h2 id={listTitleId} className="text-sm font-semibold">Atendimentos do dia</h2>
          </div>
          {/* Celular: o seletor de cor vira um botão de 44 px (paleta) na linha do título; abre o seletor nativo do aparelho.
              Os quatro filtros ficam sozinhos na linha de baixo, com o número sobre o nome, para caberem a partir de 360 px. */}
          <div className="max-md:order-2 lg:[&_select]:min-h-9">
            <AgendaColorSelect compactOnPhone value={colorMode} onChange={setColorMode} />
          </div>
          <SegmentedControl
            ariaLabel="Filtrar atendimentos"
            value={filter}
            onChange={setFilter}
            stretch={false}
            className="max-md:order-3 max-md:basis-full max-md:[&>button]:min-h-[50px] max-md:[&>button]:flex-1 max-md:[&>button]:px-1"
            options={[
              { value: "all", label: filterLabel("Todos", counts.total) },
              { value: "attention", label: filterLabel("A confirmar", counts.attention) },
              { value: "active", label: filterLabel("Em aberto", counts.active) },
              { value: "completed", label: filterLabel("Encerrados", counts.completed + counts.noShow) },
            ]}
          />
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            compact
            icon={CalendarCheck2}
            title="Nenhum atendimento neste filtro."
            description="A agenda continua disponível para consulta e novos horários."
            className="mt-3"
          />
        ) : (
          <div className="mt-3 [container-type:inline-size] md:overflow-hidden md:rounded-[14px] md:border md:border-border md:bg-card">
            <div className={LIST_GRID}>
              <div aria-hidden="true" className={LIST_HEAD}>
                <span>Horário</span>
                <span>Cliente e serviço</span>
                <span className={COL_STRETCH_ONLY}>Profissional</span>
                <span>Situação</span>
                <span className={cn("text-right", COL_STRETCH_ONLY)}>Ações</span>
              </div>
              {filtered.map((appointment) => {
                const start = new Date(appointment.startAt);
                const callHref = phoneHref(appointment.clientPhone);
                const { primary, canArrive, arriveIsPrimary } = plan(appointment);
                const status = STATUS[appointment.status as ApptStatus];
                const accent = appointmentColor(colorMode, { professional: appointment.professionalColor ?? FALLBACK_PRO_COLOR, service: appointment.serviceColor, category: appointment.category, status: status?.color ?? "#64748B" });
                const reminderSent = sentReminderIds.has(appointment.id);
                const awaitingReminder = openedReminderIds.has(appointment.id) && !reminderSent;

                return (
                  <article key={appointment.id} style={{ boxShadow: `inset 3px 0 0 ${accent}` }} className={ROW}>
                    <p className={ROW_TIME}>
                      <span className="font-semibold">{formatInTimeZone(start, timezone, "HH:mm")}</span>
                      <span className="text-sm text-muted-foreground"> – {formatInTimeZone(new Date(appointment.endAt), timezone, "HH:mm")}</span>
                    </p>
                    <Link href={detailsHref(appointment)} prefetch={false} className={ROW_MAIN}>
                      <span className="sr-only">Ver detalhes: </span>
                      <span className="block truncate text-sm font-semibold group-hover:underline" title={appointment.clientName}>{appointment.clientName}</span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">
                        {appointment.serviceName} · {priceLabel(appointment.priceCents, currency)}{appointment.hasPayment ? " · recebido" : ""}{reminderSent ? " · lembrete enviado" : ""}
                        <span className={ROW_PRO_INLINE}> · com {appointment.professionalName}</span>
                      </span>
                      {appointment.checkedInAt && <span className="mt-0.5 block text-xs font-medium text-info">Chegou às {formatInTimeZone(new Date(appointment.checkedInAt), timezone, "HH:mm")}{["PENDING", "CONFIRMED"].includes(appointment.status) ? ` · aguardando ${Math.max(0, Math.floor((now - Date.parse(appointment.checkedInAt)) / 60000))} min` : ""}</span>}
                    </Link>
                    <p className={ROW_PRO}>
                      <ProAvatar name={appointment.professionalName} color={appointment.professionalColor} />
                      <span className="truncate" title={appointment.professionalName}>{appointment.professionalName}</span>
                    </p>
                    <div className={ROW_STATUS}>
                      <Badge variant="outline" className={cn("border-transparent", status?.badgeClass ?? "bg-muted text-muted-foreground")}>
                        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                        {status?.label ?? appointment.status}
                      </Badge>
                    </div>
                    <div className={ROW_ACTIONS}>
                      {primaryButton(appointment, "row")}
                      {/* Com a ação de situação como principal, a chegada continua à mão no computador (no celular fica no "⋯"). */}
                      {canArrive && !arriveIsPrimary && (
                        <IconButton label="Registrar chegada" disabled={pending} onClick={() => arrive(appointment)} className={cn(ICON_OUTLINE, "max-md:hidden")}>
                          <LogIn className="h-4 w-4" aria-hidden="true" />
                        </IconButton>
                      )}
                      {!primary && !arriveIsPrimary && (
                        <Button asChild variant="outline" className="max-md:flex-1 max-[389px]:basis-full md:hidden">
                          <Link href={detailsHref(appointment)} prefetch={false}>Ver detalhes</Link>
                        </Button>
                      )}
                      <div className="flex shrink-0 items-center gap-2 max-md:ml-auto">
                        <a
                          href={callHref}
                          aria-label={callHref !== "#" ? `Ligar para ${appointment.clientName}` : `${appointment.clientName} está sem telefone válido`}
                          title={callHref !== "#" ? "Ligar para o cliente" : "Cliente sem telefone válido"}
                          className={ICON_LINK}
                          aria-disabled={callHref === "#"}
                          onClick={(event) => { if (callHref === "#") event.preventDefault(); }}
                        >
                          <Phone className="h-4 w-4" aria-hidden="true" />
                        </a>
                        <IconButton
                          label={appointment.clientPhone
                            ? `Enviar lembrete pelo WhatsApp para ${appointment.clientName}`
                            : `${appointment.clientName} está sem telefone cadastrado`}
                          title={!appointment.clientPhone ? "Cliente sem telefone cadastrado" : "Enviar lembrete pelo WhatsApp"}
                          disabled={!appointment.clientPhone || pending || reminderId === appointment.id}
                          onClick={() => sendReminder(appointment)}
                          className={cn(ICON_OUTLINE, "disabled:opacity-40", reminderSent && "border-success/40 bg-success/15 text-success")}
                        >
                          {reminderId === appointment.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MessageCircle className="h-4 w-4" aria-hidden="true" />}
                        </IconButton>
                        <IconButton
                          label={`Mais ações para ${appointment.clientName}`}
                          title="Mais ações"
                          aria-haspopup="dialog"
                          onClick={() => setMenuFor(appointment)}
                          className={ICON_OUTLINE}
                        >
                          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                        </IconButton>
                      </div>
                    </div>
                    {awaitingReminder && (
                      <div role="status" className={ROW_REMIND}>
                        <span className="min-w-0 flex-1 basis-40">WhatsApp aberto. Depois de enviar a mensagem, confirme aqui.</span>
                        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => confirmReminder(appointment)}>Confirmar envio manual</Button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
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

  /** "⋯": the actions that are not on the row (arrival when it is not the main one, no-show, details). */
  function sheetActions(appointment: TodayAppointment): SheetAction[] {
    const { started, canArrive, arriveIsPrimary } = plan(appointment);
    const items: SheetAction[] = [];
    if (canArrive && !arriveIsPrimary) items.push({ key: "arrive", label: "Registrar chegada", icon: LogIn, tone: "primary", disabled: pending, onSelect: () => arrive(appointment) });
    if (nextActions(appointment.status).includes("NO_SHOW") && started) {
      items.push({ key: "no-show", label: "Marcar falta", icon: UserX, tone: "danger", disabled: pending, onSelect: () => runStatus(appointment, "NO_SHOW") });
    }
    items.push({ key: "details", label: "Ver detalhes", description: "Abrir na agenda", icon: CalendarDays, href: detailsHref(appointment) });
    return items;
  }
}

function phoneHref(phone: string | null): string {
  return phone && isValidPhoneBR(phone) ? `tel:+55${normalizePhone(phone)}` : "#";
}

/** Professional's initials on their agenda colour, with readable ink. */
function ProAvatar({ name, color, large = false }: { name: string; color?: string | null; large?: boolean }) {
  const background = color && /^#[\da-f]{6}$/i.test(color) ? color : FALLBACK_PRO_COLOR;
  const initials = name.trim().split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, large ? 2 : 1).join("").toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={cn("grid shrink-0 place-items-center rounded-full text-xs font-semibold leading-none", large ? "h-9 w-9" : "h-6 w-6 max-md:h-[22px] max-md:w-[22px]")}
      style={{ background, color: contrastForeground(background) }}
    >
      {initials}
    </span>
  );
}

const TONES = {
  info: { chip: "bg-info/15 text-info", dot: "bg-info" },
  warning: { chip: "bg-warning/15 text-warning", dot: "bg-warning" },
  success: { chip: "bg-success/15 text-success", dot: "bg-success" },
} as const;

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone,
  dot = false,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone: keyof typeof TONES;
  /** Phone strip: small status dot before the number (the computer shows the icon chip instead). */
  dot?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-border bg-card p-4 max-md:items-center max-md:justify-center max-md:gap-0.5 max-md:rounded-none max-md:border-0 max-md:px-1 max-md:py-3 max-md:text-center">
      <p className="flex min-h-7 items-center justify-between gap-2 text-xs font-medium text-muted-foreground max-md:order-2 max-md:min-h-0 max-md:justify-center max-md:leading-tight">
        <span>{label}</span>
        <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg max-md:hidden", TONES[tone].chip)}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </p>
      <p className="flex items-center gap-1.5 text-2xl font-semibold leading-tight tabular-nums max-md:order-1 max-md:text-lg">
        {dot && <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full md:hidden", TONES[tone].dot)} />}
        {value}
      </p>
    </div>
  );
}
