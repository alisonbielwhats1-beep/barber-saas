"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  CalendarRange,
  Grid3x3,
  List,
  Search,
  Users,
  SlidersHorizontal,
  Loader2,
  AlertTriangle,
  Ban,
} from "lucide-react";
import {
  format,
  addDays,
  parseISO,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  addMonths,
  eachDayOfInterval,
  isSameMonth,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";
import { minutesToHHMM, formatMoney } from "@/lib/utils";
import { AppointmentDialog, type ProOption, type ServiceOption, type ClientOption } from "./appointment-form";
import { AppointmentDetail } from "./appointment-detail";
import { STATUS, STATUS_ORDER } from "./agenda-status";
import { professionalColors } from "./professional-colors";
import { moveAppointment } from "./actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { layoutOverlappingIntervals } from "./agenda-layout";
import { AvailabilityPanel, type AvailabilityBlock, type AvailabilityPreset, type BlockSelection } from "./availability-panel";
import { AvailabilityBlockDialog, AvailabilityBlockTrigger } from "./availability-block";
import { ImageWithFallback } from "@/components/ui/image-with-fallback";
import { DateNavigator } from "./date-navigator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { unavailableScheduleIntervals, type VisualWorkingHours } from "./schedule-visibility";
import { AgendaQuickActions } from "./agenda-quick-actions";
import { WeeklyPausePanel } from "./weekly-pause-panel";
import { minuteAtSlotPointer } from "./agenda-slot-pointer";
import { AgendaWeekStrip } from "./agenda-week-strip";
import { AgendaTimeScale } from "./agenda-time-scale";
import "./agenda-workspace.css";

const DAY_START = 8 * 60;
const DAY_END = 21 * 60;
const SLOT_MIN = 30;
const PX_PER_MIN = 1.7;
const HEADER_H = 64;

type ViewKind = "day" | "week" | "month" | "list";

export type Appointment = {
  stages?: { name: string; durationMin: number; processingMin: number; finishingMin: number }[];
  seriesId?: string | null;
  id: string;
  professionalId: string;
  professionalColor?: string;
  startAt: string;
  endAt: string;
  priceCents: number;
  status: string;
  notes: string | null;
  clientName: string;
  clientPhone: string | null;
  serviceName: string;
  serviceColor: string | null;
  waitlistCount: number;
  waitlistNext: string | null;
  waitlist: Array<{
    id: string;
    name: string;
    phone: string | null;
    serviceName: string;
    position: number;
  }>;
  isOverbooked: boolean;
  version: number;
  serviceIds: string[];
  hasPayment: boolean;
  pendingReschedule: {
    id: string;
    targetStartAt: string;
    targetEndAt: string;
    targetPriceCents: number;
    targetProfessionalName: string;
    reason: string | null;
  } | null;
  events: Array<{
    id: string;
    eventType: string;
    actorType: string;
    actorName: string | null;
    reason: string | null;
    createdAt: string;
    previousStartAt: string | null;
    startAt: string | null;
    previousStatus: string | null;
    status: string | null;
  }>;
};

export type Professional = {
  id: string;
  name: string;
  colorHex: string | null;
  avatarUrl?: string | null;
  serviceIds: string[];
  workingHours?: VisualWorkingHours[];
};

function minutesOf(iso: string, timezone: string) {
  const [hour, minute] = formatInTimeZone(new Date(iso), timezone, "HH:mm")
    .split(":")
    .map(Number);
  return hour! * 60 + minute!;
}

function endMinutes(appointment: Appointment, timezone: string) {
  const end = minutesOf(appointment.endAt, timezone);
  return end === 0 && new Date(appointment.endAt) > new Date(appointment.startAt) ? 1440 : end;
}

function visibleHours(appointments: Appointment[], timezone: string, professionals: Professional[] = []) {
  const hours = professionals.flatMap((professional) => professional.workingHours ?? []);
  const starts = [...hours.map((h) => h.startMinutes), ...appointments.map((a) => minutesOf(a.startAt, timezone))];
  const ends = [...hours.map((h) => h.endMinutes), ...appointments.map((a) => endMinutes(a, timezone))];
  return { start: Math.max(0, Math.floor(Math.min(DAY_START, ...starts) / 30) * 30),
    end: Math.min(1440, Math.ceil(Math.max(DAY_END, ...ends) / 30) * 30) };
}

function appointmentPlacements(appointments: Appointment[], timezone: string) {
  return layoutOverlappingIntervals(
    appointments.map((appointment) => ({
      id: appointment.id,
      start: minutesOf(appointment.startAt, timezone),
      end: endMinutes(appointment, timezone),
    })),
  );
}

function initials(name: string) {
  return name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
}
function ymd(d: Date) {
  return format(d, "yyyy-MM-dd");
}

export function AgendaBoard({
  operations,
  initialAppointmentId,
  availabilityBlocks = [],
  date,
  salonName,
  timezone,
  professionals: roster,
  appointments: rawAppointments,
  services,
  clients,
  canOverbook,
  canOverrideBreak,
  canRepeat,
  canCreate,
  canCancel,
}: {
  initialAppointmentId?: string;
  availabilityBlocks?: AvailabilityBlock[];
  operations?: ReactNode;
  date: string;
  salonName: string;
  timezone: string;
  professionals: Professional[];
  appointments: Appointment[];
  services: ServiceOption[];
  clients: ClientOption[];
  canOverbook: boolean;
  canOverrideBreak: boolean;
  canRepeat: boolean;
  canCreate: boolean;
  canCancel: boolean;
}) {
  const colors = useMemo(() => professionalColors(roster), [roster]);
  const professionals = useMemo(() => roster.map(pro => ({ ...pro, colorHex: colors.get(pro.id)! })), [roster, colors]);
  const appointments = useMemo(() => rawAppointments.map(appointment => ({ ...appointment, professionalColor: colors.get(appointment.professionalId) ?? "#6B9FA8" })), [rawAppointments, colors]);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [view, setView] = useState<ViewKind>("day");
  const [proFilter, setProFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("not_cancelled");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [pauseLaunch, setPauseLaunch] = useState<string>();
  const [mobileCalendarOpen, setMobileCalendarOpen] = useState(false);
  const mobileCalendarTrigger = useRef<HTMLButtonElement>(null);
  const compactCalendarTrigger = useRef<HTMLButtonElement>(null);
  const quickActionTrigger = useRef<HTMLButtonElement>(null);
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const restoreQuickActionFocus = () => quickActionTrigger.current?.focus();
  const [blockMode, setBlockMode] = useState(false);
  const [blockSelection, setBlockSelection] = useState<(BlockSelection & { key: string }) | undefined>();
  const [availabilityLaunch, setAvailabilityLaunch] = useState<{ key: string; preset: AvailabilityPreset } | undefined>();
  const [selectedAvailabilityBlock, setSelectedAvailabilityBlock] = useState<AvailabilityBlock | null>(null);
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<Appointment | null>(() => appointments.find(a => a.id === initialAppointmentId) ?? null);
  const currentDetail = detail ? appointments.find(appointment => appointment.id === detail.id) ?? detail : null;
  const [createAt, setCreateAt] = useState<{ startLocal: string; proId: string } | null>(null);
  const [moveProposal, setMoveProposal] = useState<{
    appointment: Appointment;
    professionalId: string;
    startLocal: string;
    idempotencyKey: string;
  } | null>(null);
  const [nowMin, setNowMin] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const dateObj = parseISO(`${date}T12:00:00`);
  const today = formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
  const isToday = today === date;

  useEffect(() => {
    if (!isToday) return setNowMin(null);
    const tick = () => {
      const [hour, minute] = formatInTimeZone(new Date(), timezone, "HH:mm")
        .split(":")
        .map(Number);
      setNowMin(hour! * 60 + minute!);
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [isToday, timezone]);

  const proOptions: ProOption[] = professionals.map((p) => ({
    id: p.id,
    name: p.name,
    serviceIds: p.serviceIds,
  }));
  const shownPros = proFilter === "all" ? professionals : professionals.filter((p) => p.id === proFilter);

  // Filtros de profissional/status/busca aplicados a qualquer subconjunto
  const applyFilters = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list: Appointment[]) =>
      list.filter((a) => {
        if (
          statusFilter === "not_cancelled" &&
          a.status === "CANCELLED" &&
          a.waitlistCount === 0
        ) return false;
        if (
          statusFilter !== "all" &&
          statusFilter !== "not_cancelled" &&
          a.status !== statusFilter
        ) return false;
        if (proFilter !== "all" && a.professionalId !== proFilter) return false;
        if (q && !a.clientName.toLowerCase().includes(q) && !(a.clientPhone ?? "").includes(q)) return false;
        return true;
      });
  }, [statusFilter, proFilter, search]);

  const filteredAll = useMemo(() => applyFilters(appointments), [applyFilters, appointments]);
  const dayAppts = useMemo(
    () => filteredAll.filter(
      (appointment) =>
        formatInTimeZone(new Date(appointment.startAt), timezone, "yyyy-MM-dd") === date,
    ),
    [filteredAll, date, timezone],
  );


  const awaitingAcceptance = appointments.filter((a) => a.pendingReschedule !== null).length;
  const cancelledWithQueue = appointments.filter((a) => a.status === "CANCELLED" && a.waitlistCount > 0).length;

  function goDate(offset: number) {
    const targetDate = view === "month" || view === "list"
      ? addMonths(dateObj, offset)
      : addDays(dateObj, offset * (view === "week" ? 7 : 1));
    const d = ymd(targetDate);
    startTransition(() => router.push(`/agenda?date=${d}`, { scroll: false }));
  }
  function goToday() {
    startTransition(() => router.push(`/agenda?date=${today}`, { scroll: false }));
  }
  function goToDay(d: string) {
    setView("day");
    startTransition(() => router.push(`/agenda?date=${d}`, { scroll: false }));
  }

  function openSlot(proId: string, minutes: number, dayStr = date) {
    if (!canCreate) return;
    setCreateAt({ startLocal: `${dayStr}T${minutesToHHMM(minutes)}`, proId });
  }
  function openAvailability(preset: AvailabilityPreset) {
    if (!canCancel) return;
    setBlockSelection(undefined);
    setAvailabilityLaunch({ key: crypto.randomUUID(), preset });
  }
  function refresh() {
    startTransition(() => router.refresh());
  }
  function runAction(fn: () => Promise<{ error: string } | { success: true }>) {
    setActionError(null);
    startTransition(async () => {
      const result = await fn();
      if ("error" in result) {
        setActionError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  const rangeLabel =
    view === "week"
      ? `${format(startOfWeek(dateObj, { weekStartsOn: 1 }), "d MMM", { locale: ptBR })} – ${format(endOfWeek(dateObj, { weekStartsOn: 1 }), "d MMM", { locale: ptBR })}`
      : view === "month" || view === "list"
        ? format(dateObj, "MMMM yyyy", { locale: ptBR })
        : format(dateObj, "d 'de' MMMM", { locale: ptBR });
  const navigationUnit = view === "week" ? "semana" : view === "month" || view === "list" ? "mês" : "dia";
  function selectCalendarDate(next: string) {
    startTransition(() => router.push(`/agenda?date=${next}`, { scroll: false }));
    setMobileCalendarOpen(false);
  }

  return (
    <div className="agenda-workspace" aria-busy={pending}>
      <header className="agenda-toolbar">
        <div className="flex min-w-0 items-center gap-2 sm:hidden">
          <button type="button" onClick={() => goDate(-1)} aria-label={`Ir para ${navigationUnit} anterior`} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg hover:bg-muted"><ChevronLeft aria-hidden="true" size={16} /></button>
          <h1><button ref={compactCalendarTrigger} type="button" aria-label="Abrir calendário" aria-haspopup="dialog" onClick={() => setMobileCalendarOpen(true)} className="min-h-11 min-w-11 rounded-lg text-sm font-semibold">
            <span className="block whitespace-nowrap">{format(dateObj, view === "month" || view === "list" ? "MMM yy" : "d MMM", { locale: ptBR })}</span>
            <span className="block text-[10px] font-normal text-muted-foreground">{format(dateObj, "EEE", { locale: ptBR })}</span>
          </button></h1>
          <button type="button" onClick={() => goDate(1)} aria-label={`Ir para próximo ${navigationUnit}`} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg hover:bg-muted"><ChevronRight aria-hidden="true" size={16} /></button>
        </div>
        <div className="agenda-date-controls">
          <button type="button" aria-label={calendarOpen ? "Recolher calendário" : "Abrir calendário"} aria-expanded={calendarOpen} aria-controls="agenda-date-panel" onClick={() => setCalendarOpen(!calendarOpen)} className="hidden h-11 w-11 shrink-0 place-items-center rounded-lg border border-border bg-card text-[hsl(var(--selection-foreground))] xl:grid"><CalendarDays size={18} /></button>
          <button ref={mobileCalendarTrigger} type="button" aria-label="Abrir calendário" aria-haspopup="dialog" onClick={() => setMobileCalendarOpen(true)} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-border bg-card xl:hidden"><CalendarDays size={18} /></button>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-1 p-1">
            <button
              type="button"
              onClick={() => goDate(-1)}
              aria-label={`Ir para ${navigationUnit} anterior`}
              className="grid min-h-11 min-w-11 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground"
            >
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={goToday}
              aria-label="Ir para hoje"
              className="min-h-11 rounded-lg px-3 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Hoje
            </button>
            <button
              type="button"
              onClick={() => goDate(1)}
              aria-label={`Ir para próximo ${navigationUnit}`}
              className="grid min-h-11 min-w-11 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground"
            >
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              {format(dateObj, "EEEE", { locale: ptBR })}
            </p>
            <h1 className="text-base font-semibold tracking-tight first-letter:uppercase sm:text-xl">{rangeLabel}</h1>
          </div>
          {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        <div className="agenda-view-controls">
          <select aria-label="Visualização da agenda" value={view} onChange={event => setView(event.target.value as ViewKind)} className="h-11 w-[94px] min-w-0 rounded-lg border border-border bg-card px-2 text-xs sm:hidden">
            <option value="day">Dia</option>
            <option value="week">Semana</option>
            <option value="month">Mês</option>
            <option value="list">Lista</option>
          </select>
          <button ref={filterTrigger} type="button" onClick={() => setFiltersOpen(true)} aria-label="Buscar e filtrar agenda" aria-haspopup="dialog" className="relative grid h-11 w-11 place-items-center rounded-lg border border-border"><SlidersHorizontal size={18} />{(proFilter !== "all" || statusFilter !== "not_cancelled" || search) && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" />}</button>
          <div role="group" aria-label="Visualização da agenda" className="hidden items-center gap-0.5 rounded-lg border border-border bg-surface-1 p-1 sm:flex">
            <ViewBtn active={view === "day"} onClick={() => setView("day")} icon={CalendarDays} label="Dia" />
            <ViewBtn active={view === "week"} onClick={() => setView("week")} icon={CalendarRange} label="Semana" />
            <ViewBtn active={view === "month"} onClick={() => setView("month")} icon={Grid3x3} label="Mês" />
            <ViewBtn active={view === "list"} onClick={() => setView("list")} icon={List} label="Lista" />
          </div>
          <AgendaQuickActions
            triggerRef={quickActionTrigger}
            canCreateAppointment={canCreate}
            canManageAvailability={canCancel}
            disabled={professionals.length === 0}
            onNewAppointment={() => openSlot(shownPros[0]?.id ?? "", DAY_START)}
            onNewBlock={() => openAvailability("interval")}
            onNewDayOff={() => openAvailability("day")}
            onWeeklyPause={() => setPauseLaunch(crypto.randomUUID())}
            onManageAvailability={() => setOperationsOpen(true)}
            onSelectBlock={view === "day" ? () => setBlockMode(true) : undefined}
          />
        </div>
      </header>

      {view === "day" && <AgendaWeekStrip date={date} today={today} onSelect={goToDay} />}

      <div className="agenda-body">
        {calendarOpen && <aside id="agenda-date-panel" aria-label="Navegar por datas" className="sticky top-0 hidden w-64 shrink-0 xl:block"><DateNavigator date={date} today={today} onSelect={selectCalendarDate} /></aside>}
        <div className="agenda-content">


      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DialogContent aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); filterTrigger.current?.focus(); }} className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>Buscar e filtrar agenda</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 max-sm:w-full">
          <Search aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar cliente ou telefone"
            placeholder="Buscar cliente ou telefone…"
            className="min-w-0 flex-1 bg-transparent text-[13px] placeholder:text-muted-foreground focus:outline-none sm:w-44"
          />
        </div>
        <div id="agenda-filters" className="flex flex-wrap items-center gap-2">
        <FilterChip active={proFilter === "all"} onClick={() => setProFilter("all")} icon={Users}>
          Todos profissionais
        </FilterChip>
        {professionals.map((p) => (
          <FilterChip key={p.id} active={proFilter === p.id} onClick={() => setProFilter(p.id)} dot={p.colorHex ?? "#2ECC8B"}>
            {p.name.split(" ")[0]}
          </FilterChip>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <FilterChip active={statusFilter === "not_cancelled"} onClick={() => setStatusFilter("not_cancelled")}>
          Agenda
        </FilterChip>
        <FilterChip active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>
          Todos status
        </FilterChip>
        {STATUS_ORDER.map((s) => (
          <FilterChip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)} dot={STATUS[s].color}>
            {STATUS[s].label}
          </FilterChip>
        ))}
        </div>
      </div>


          <button type="button" onClick={() => setFiltersOpen(false)} className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">Ver agenda</button>
        </DialogContent>
      </Dialog>
      <Dialog open={operationsOpen} onOpenChange={setOperationsOpen}>
        <DialogContent aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); restoreQuickActionFocus(); }} className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Expediente e bloqueios</DialogTitle></DialogHeader>
          {canCancel && <AvailabilityPanel date={date} timezone={timezone} professionals={professionals} blocks={availabilityBlocks} />}
          {operations}
        </DialogContent>
      </Dialog>
      {canCancel && (availabilityLaunch || blockSelection) && <AvailabilityPanel dialogOnly restoreFocus={restoreQuickActionFocus} key={blockSelection?.key ?? availabilityLaunch?.key} date={date} timezone={timezone} professionals={professionals} blocks={availabilityBlocks} selection={blockSelection} initialPreset={availabilityLaunch?.preset} />}
      {canCancel && pauseLaunch && <WeeklyPausePanel key={pauseLaunch} professionals={professionals} initialOpen hideTrigger restoreFocus={restoreQuickActionFocus} />}
      {blockMode && view === "day" && <div className="flex shrink-0 items-center justify-between gap-2 rounded-lg bg-muted px-3 text-xs"><p>Toque no início e no fim do intervalo. Escape cancela.</p><button type="button" onClick={() => setBlockMode(false)} className="min-h-11 shrink-0 px-2 font-medium">Sair da seleção de bloqueio</button></div>}
      {actionError && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">{actionError}</p>
      )}

      {(awaitingAcceptance > 0 || cancelledWithQueue > 0) && (
        <div className="flex flex-col gap-2 rounded-2xl border border-amber-500/30 bg-warning/10 px-4 py-3 text-[12px] text-warning sm:flex-row sm:items-center sm:justify-between">
          <p>
            {awaitingAcceptance > 0 && `${awaitingAcceptance} alteração(ões) aguardando aceite do cliente.`}
            {awaitingAcceptance > 0 && cancelledWithQueue > 0 && " "}
            {cancelledWithQueue > 0 && `${cancelledWithQueue} fila(s) têm horário liberado para promoção manual.`}
          </p>
          {awaitingAcceptance > 0 && (
            <Link href="/notificacoes" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
              Ver central de avisos
            </Link>
          )}
        </div>
      )}

      <div className="agenda-canvas">
      {professionals.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-16 text-center text-sm text-muted-foreground">
          Cadastre profissionais para ver a agenda.
        </div>
      ) : view === "day" ? (
        <DayView
          blockMode={blockMode}
          onBlockSelection={selection => { setAvailabilityLaunch(undefined); setBlockSelection({ ...selection, key: crypto.randomUUID() }); setBlockMode(false); }}
          blocks={availabilityBlocks}
          date={date}
          professionals={shownPros}
          appointments={dayAppts}
          timezone={timezone}
          nowMin={nowMin}
          onOpenSlot={openSlot}
          onOpenBlock={canCancel ? setSelectedAvailabilityBlock : undefined}
          onOpenDetail={setDetail}
          onMove={(appointment, professionalId, startLocal) =>
            setMoveProposal({
              appointment,
              professionalId,
              startLocal,
              idempotencyKey: crypto.randomUUID(),
            })
          }
        />
      ) : view === "week" ? (
        <WeekView
          blocks={availabilityBlocks.filter(b => shownPros.some(p => p.id === b.professionalId))}
          professionals={shownPros}
          dateObj={dateObj}
          firstProId={shownPros[0]?.id ?? ""}
          appointments={filteredAll}
          timezone={timezone}
          nowMin={nowMin}
          today={today}
          onOpenSlot={openSlot}
          onOpenBlock={canCancel ? setSelectedAvailabilityBlock : undefined}
          onOpenDetail={setDetail}
          onOpenDay={goToDay}
        />
      ) : view === "month" ? (
        <MonthView
          blocks={availabilityBlocks.filter(b => shownPros.some(p => p.id === b.professionalId))}
          dateObj={dateObj}
          appointments={filteredAll}
          timezone={timezone}
          today={today}
          onOpenDay={goToDay}
          onOpenDetail={setDetail}
        />
      ) : (
        <div className="space-y-3"><BlockList blocks={availabilityBlocks.filter(b => shownPros.some(p => p.id === b.professionalId))} professionals={shownPros} timezone={timezone} onOpenBlock={canCancel ? setSelectedAvailabilityBlock : undefined} /><ListView appointments={filteredAll} professionals={professionals} timezone={timezone} onOpenDetail={setDetail} /></div>
      )}

      </div>
        </div>
      </div>
      <Dialog open={mobileCalendarOpen} onOpenChange={setMobileCalendarOpen}>
        <DialogContent aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); (window.matchMedia("(max-width: 639px)").matches ? compactCalendarTrigger : mobileCalendarTrigger).current?.focus(); }} className="max-h-[calc(100dvh-2rem)] w-[calc(100%_-_2rem)] max-w-sm overflow-y-auto p-4">
          <DialogHeader className="pr-10"><DialogTitle>Escolher data</DialogTitle></DialogHeader>
          <DateNavigator date={date} today={today} onSelect={selectCalendarDate} />
        </DialogContent>
      </Dialog>

      {createAt && (
        <AppointmentDialog
          open={!!createAt}
          onOpenChange={(o) => {
            if (!o) {
              setCreateAt(null);
              refresh();
            }
          }}
          slotStartLocal={createAt.startLocal}
          professionalId={createAt.proId}
          professionals={proOptions}
          services={services}
          clients={clients}
          canOverbook={canOverbook}
          canOverrideBreak={canOverrideBreak}
          canRepeat={canRepeat}
          timezone={timezone}
        />
      )}

      {selectedAvailabilityBlock && canCancel && (
        <AvailabilityBlockDialog
          key={selectedAvailabilityBlock.id}
          open
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setSelectedAvailabilityBlock(null);
          }}
          block={selectedAvailabilityBlock}
          professionalName={professionals.find((professional) => professional.id === selectedAvailabilityBlock.professionalId)?.name ?? "Profissional"}
          timezone={timezone}
          onSchedule={canCreate ? (target) => {
            setSelectedAvailabilityBlock(null);
            setCreateAt({ startLocal: target.startLocal, proId: target.professionalId });
          } : undefined}
        />
      )}

      <AppointmentDetail
        key={detail?.id ?? "empty"}
        appt={currentDetail}
        services={services.filter(service => professionals.find(pro => pro.id === currentDetail?.professionalId)?.serviceIds.includes(service.id))}
        salonName={salonName}
        timezone={timezone}
        canCreate={canCreate}
        canCancel={canCancel}
        onClose={() => {
          setDetail(null);
          refresh();
        }}
      />

      <ConfirmDialog
        open={moveProposal !== null}
        onOpenChange={(open) => !open && setMoveProposal(null)}
        title="Confirmar remarcação?"
        description={
          moveProposal
            ? `${moveProposal.appointment.clientName}: ${formatInTimeZone(new Date(moveProposal.appointment.startAt), timezone, "dd/MM 'às' HH:mm")} → ${moveProposal.startLocal.slice(8, 10)}/${moveProposal.startLocal.slice(5, 7)} às ${moveProposal.startLocal.slice(11)}, com ${professionals.find((professional) => professional.id === moveProposal.professionalId)?.name ?? "o profissional selecionado"}. O cliente receberá uma atualização.`
            : ""
        }
        confirmLabel="Confirmar remarcação"
        pending={pending}
        onConfirm={() => {
          if (!moveProposal) return;
          const proposal = moveProposal;
          runAction(async () => {
            const result = await moveAppointment({
              id: proposal.appointment.id,
              professionalId: proposal.professionalId,
              serviceIds: proposal.appointment.serviceIds,
              startLocal: proposal.startLocal,
              idempotencyKey: proposal.idempotencyKey,
              expectedVersion: proposal.appointment.version,
            });
            if ("success" in result) setMoveProposal(null);
            return result;
          });
        }}
      />
    </div>
  );
}

/* ─────────────────────────── Day view ─────────────────────────── */

function DayView({
  blockMode,
  onBlockSelection,
  blocks,
  date,
  professionals,
  appointments,
  timezone,
  nowMin,
  onOpenSlot,
  onOpenBlock,
  onOpenDetail,
  onMove,
}: {
  blockMode: boolean;
  onBlockSelection: (selection: BlockSelection) => void;
  blocks: AvailabilityBlock[];
  date: string;
  professionals: Professional[];
  appointments: Appointment[];
  timezone: string;
  nowMin: number | null;
  onOpenSlot: (proId: string, minutes: number, dayStr?: string) => void;
  onOpenBlock?: (block: AvailabilityBlock) => void;
  onOpenDetail: (a: Appointment) => void;
  onMove: (appointment: Appointment, proId: string, startLocal: string) => void;
}) {
  const { start: dayStart, end: dayEnd } = visibleHours(appointments, timezone, professionals);
  const bodyRef = useRef<HTMLDivElement>(null);
  const apptById = useRef(new Map<string, Appointment>());
  apptById.current = new Map(appointments.map((a) => [a.id, a]));
  const [drag, setDrag] = useState<
    { id: string; x: number; y: number; started: boolean } | null
  >(null);
  const selection = useRef<{ proId: string; start: number; end: number; step: number } | null>(null);
  const [selectionView, setSelectionView] = useState<{ proId: string; start: number; end: number; step: number } | null>(null);
  const suppressClick = useRef(false);
  function pointerMinute(event: React.MouseEvent<HTMLElement> | React.PointerEvent<HTMLElement>, slotStart: number) {
    const rect = event.currentTarget.getBoundingClientRect();
    return minuteAtSlotPointer(slotStart, event.clientY, rect.top, rect.height, SLOT_MIN);
  }
  function selectInterval(proId: string, minutes: number, finish: boolean, step = SLOT_MIN) {
    if (!blockMode) return;
    const current = selection.current;
    if (!current || current.proId !== proId) {
      selection.current = { proId, start: minutes, end: minutes, step };
      setSelectionView(selection.current);
    } else if (finish) {
      const from = Math.min(current.start, minutes);
      const to = Math.min(1439, Math.max(current.start, minutes) + step);
      selection.current = null; setSelectionView(null);
      onBlockSelection({ professionalId: proId, startLocal: `${date}T${minutesToHHMM(from)}`, endLocal: `${date}T${minutesToHHMM(to)}` });
    } else {
      selection.current = { ...current, end: minutes, step }; setSelectionView(selection.current);
    }
  }
  useEffect(() => { selection.current = null; setSelectionView(null); }, [blockMode, date]);

  const slots: number[] = [];
  for (let m = dayStart; m < dayEnd; m += SLOT_MIN) slots.push(m);
  const totalH = (dayEnd - dayStart) * PX_PER_MIN;

  function startDrag(e: React.PointerEvent, id: string) {
    if (e.button !== 0 || e.pointerType === "touch") return;
    const appointment = apptById.current.get(id);
    if (
      !appointment ||
      !["PENDING", "CONFIRMED"].includes(appointment.status) ||
      new Date(appointment.startAt).getTime() <= Date.now()
    ) return;
    setDrag({ id, x: e.clientX, y: e.clientY, started: false });
  }

  useEffect(() => {
    if (!drag) return;
    function onMoveEv(e: PointerEvent) {
      setDrag((d) => {
        if (!d) return d;
        const moved = Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y);
        return { ...d, x: e.clientX, y: e.clientY, started: d.started || moved > 6 };
      });
    }
    function onUp(e: PointerEvent) {
      setDrag((d) => {
        if (d && d.started) {
          const el = document.elementFromPoint(e.clientX, e.clientY);
          const col = el?.closest<HTMLElement>("[data-pro-col]");
          if (col) {
            const rect = col.getBoundingClientRect();
            const rel = e.clientY - rect.top;
            let mins = dayStart + Math.round(rel / PX_PER_MIN / 15) * 15;
            mins = Math.max(dayStart, Math.min(dayEnd, mins));
            const appointment = apptById.current.get(d.id);
            if (appointment) {
              onMove(
                appointment,
                col.dataset.proId!,
                `${date}T${minutesToHHMM(mins)}`,
              );
            }
          }
        }
        return null;
      });
    }
    window.addEventListener("pointermove", onMoveEv);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMoveEv);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, date, onMove, dayStart, dayEnd]);

  return (
    <div className="agenda-grid overflow-auto rounded-xl border border-border bg-card">
      <div className="flex w-full" style={{ minWidth: 56 + professionals.length * 148 }} ref={bodyRef}>
        <div className="sticky left-0 z-20 w-14 shrink-0 border-r border-border bg-surface-1">
          <div style={{ height: HEADER_H }} className="border-b border-border" />
          <AgendaTimeScale start={dayStart} end={dayEnd} pixelsPerMinute={PX_PER_MIN} />
        </div>

        {professionals.map((pro) => {
          const proAppts = appointments.filter((a) => a.professionalId === pro.id);
          const placements = appointmentPlacements(proAppts, timezone);
          return (
            <div key={pro.id} data-pro-col data-pro-id={pro.id} className="relative shrink-0 border-r border-border last:border-r-0" style={{ flex: 1, minWidth: 148 }}>
              <div data-professional-color={pro.colorHex} style={{ height: HEADER_H, borderBottom: `3px solid ${pro.colorHex}` }} className="sticky top-0 z-10 flex flex-col items-center justify-center gap-1.5 bg-card px-3">
                <span style={{ borderColor: pro.colorHex ?? undefined }} className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full border-2 bg-muted text-xs font-semibold text-foreground">
                  {pro.avatarUrl ? <ImageWithFallback src={pro.avatarUrl} alt="" width={44} height={44} sizes="44px" className="h-full w-full object-cover" fallback={<span>{initials(pro.name)}</span>} /> : initials(pro.name)}
                </span>
                <span className="w-full truncate text-center text-xs font-medium" title={pro.name}>{pro.name}</span>
              </div>

              <div className="relative" style={{ height: totalH }}>
                {slots.map((m) => (
                  <button
                    key={m}
                    onPointerDown={e => { if (blockMode && e.pointerType === "mouse" && e.button === 0) { suppressClick.current = false; selectInterval(pro.id, pointerMinute(e, m), false, 5); } }}
                    onPointerMove={e => { if (blockMode && e.pointerType === "mouse" && e.buttons === 1 && selection.current?.proId === pro.id) { const minute = pointerMinute(e, m); suppressClick.current = selection.current.start !== minute; selectInterval(pro.id, minute, false, 5); } }}
                    onPointerUp={e => { if (blockMode && suppressClick.current) selectInterval(pro.id, pointerMinute(e, m), true, 5); }}
                    onKeyDown={e => { if (e.key === "Escape") { selection.current = null; setSelectionView(null); } }}
                    onClick={e => { if (suppressClick.current) { suppressClick.current = false; return; } const minute = e.detail === 0 ? m : pointerMinute(e, m); if (blockMode) selectInterval(pro.id, minute, !!selection.current, e.detail === 0 ? SLOT_MIN : 5); else onOpenSlot(pro.id, m); }}
                    style={{ height: SLOT_MIN * PX_PER_MIN }}
                    className={`agenda-half-hour block w-full border-t transition hover:bg-primary/5 ${m % 60 === 0 ? "border-border" : "border-dashed border-border/60"}`}
                    aria-label={`${blockMode ? "Selecionar bloqueio" : "Agendar"} ${minutesToHHMM(m)} com ${pro.name}`}
                  />
                ))}
                {selectionView?.proId === pro.id && <div className="pointer-events-none absolute inset-x-0 z-20 border-2 border-danger bg-danger/20" style={{ top: (Math.min(selectionView.start, selectionView.end) - dayStart) * PX_PER_MIN, height: (Math.abs(selectionView.end - selectionView.start) + selectionView.step) * PX_PER_MIN }} />}

                {unavailableScheduleIntervals(pro.workingHours ?? [], date, dayStart, dayEnd).map((interval) => {
                  const height = (interval.endMinutes - interval.startMinutes) * PX_PER_MIN;
                  return (
                    <div
                      key={`schedule-${interval.startMinutes}-${interval.endMinutes}`}
                      role="note"
                      aria-label={`Fora do expediente de ${pro.name}: ${minutesToHHMM(interval.startMinutes)}–${minutesToHHMM(interval.endMinutes)}`}
                      className="pointer-events-none absolute inset-x-0 overflow-hidden border-y border-border/70 bg-muted/45 px-2 py-1 text-[10px] text-muted-foreground"
                      style={{
                        top: (interval.startMinutes - dayStart) * PX_PER_MIN,
                        height,
                        backgroundImage: "repeating-linear-gradient(135deg, transparent, transparent 6px, hsl(var(--border) / .28) 6px, hsl(var(--border) / .28) 7px)",
                      }}
                    >
                      {height >= 34 && <span className="rounded bg-card/90 px-1">Fora do expediente</span>}
                    </div>
                  );
                })}

                {blocks.filter(b => b.professionalId === pro.id).map(block => {
                  const firstDate = formatInTimeZone(new Date(block.startAt), timezone, "yyyy-MM-dd");
                  const lastDate = formatInTimeZone(new Date(block.endAt), timezone, "yyyy-MM-dd");
                  if (firstDate > date || lastDate < date) return null;
                  const start = Math.max(dayStart, firstDate < date ? 0 : minutesOf(block.startAt, timezone));
                  const end = Math.min(dayEnd, lastDate > date ? 1440 : minutesOf(block.endAt, timezone));
                  if (end <= start) return null;
                  return <AvailabilityBlockTrigger key={block.id} block={block} professionalName={pro.name} timezone={timezone} onOpen={onOpenBlock} className="absolute inset-x-0 z-[1] px-2 py-1 text-xs" style={{ top: (start - dayStart) * PX_PER_MIN, height: (end - start) * PX_PER_MIN }} />;
                })}

                {nowMin != null && nowMin >= dayStart && nowMin <= dayEnd && (
                  <div className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{ top: (nowMin - dayStart) * PX_PER_MIN }}>
                    <span className="h-2 w-2 rounded-full bg-danger" />
                    <span className="h-px flex-1 bg-danger" />
                  </div>
                )}

                {proAppts.map((a) => {
                  const startMin = minutesOf(a.startAt, timezone);
                  const endMin = endMinutes(a, timezone);
                  const top = (startMin - dayStart) * PX_PER_MIN;
                  const height = Math.max(24, (endMin - startMin) * PX_PER_MIN);
                  if (top < 0 || top > totalH) return null;
                  const cfg = STATUS[a.status as keyof typeof STATUS] ?? STATUS.CONFIRMED;
                  const placement = placements.get(a.id) ?? {
                    leftPct: 0,
                    widthPct: 100,
                    conflict: false,
                  };
                  const isDragging = drag?.id === a.id && drag.started;
                  return (
                    <button
                      type="button"
                      key={a.id}
                      onPointerDown={(e) => startDrag(e, a.id)}
                      onClick={() => {
                        if (!drag?.started) onOpenDetail(a);
                      }}
                      aria-label={`${a.clientName}, ${a.serviceName}, ${formatInTimeZone(new Date(a.startAt), timezone, "HH:mm")}, ${pro.name}, ${cfg.label}.${placement.conflict ? " Conflito de horário detectado." : ""} Abrir detalhes`}
                      data-appointment-professional={a.professionalId} data-colorful-appointment
                      title={placement.conflict && !a.isOverbooked ? "Conflito de horário detectado — revise este atendimento" : undefined}
                      className={`group absolute z-[2] cursor-pointer touch-pan-y select-none rounded-lg border-l-[3px] p-2 text-left text-xs shadow-sm transition focus-visible:z-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:cursor-grab ${
                        placement.conflict ? "ring-1 ring-danger/60" : ""
                      } ${
                        isDragging ? "z-30 opacity-70 ring-2 ring-primary" : "hover:shadow-md"
                      }`}
                      style={{
                        top,
                        height,
                        left: `calc(${placement.leftPct}% + 4px)`,
                        width: `calc(${placement.widthPct}% - 8px)`,
                        borderLeftColor: a.professionalColor,
                        background: `color-mix(in srgb, ${a.professionalColor} 60%, white)`,
                      }}
                    >
                      <p className="flex items-center gap-1.5 font-semibold text-foreground"><span aria-hidden="true" title={cfg.label} className="h-2 w-2 shrink-0 rounded-full" style={{ background: cfg.color }} /><span className="truncate">{a.clientName}</span></p>
                      {height >= 42 && <p className="truncate text-[11px] text-foreground/85">{a.serviceName}</p>}
                      {height >= 90 && <span style={{ backgroundColor: "hsl(var(--card))" }} className={`inline-flex max-w-full truncate rounded px-1 text-[10px] font-medium ${cfg.badgeClass}`}>{cfg.label}</span>}
                      {a.pendingReschedule && (
                        <span className="mt-1 inline-flex rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-warning">
                          Aguardando aceite
                        </span>
                      )}
                      {height >= 70 && (
                        <p className="mt-0.5 text-[10px] font-medium text-foreground">
                          {formatInTimeZone(new Date(a.startAt), timezone, "HH:mm")} · {formatMoney(a.priceCents)}
                        </p>
                      )}
                      {a.waitlistCount > 0 && (
                        <span
                          title={`${a.waitlistCount} na fila de espera${a.waitlistNext ? ` — próximo: ${a.waitlistNext}` : ""}`}
                          className="absolute right-1 top-1 inline-flex items-center gap-0.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold text-black"
                        >
                          <Users className="h-2.5 w-2.5" />
                          {a.waitlistCount}
                        </span>
                      )}
                      {(a.isOverbooked || placement.conflict) && (
                        <span
                          title={a.isOverbooked
                            ? "Overbooking deliberado — encaixado apesar de conflito de horário"
                            : "Conflito de horário detectado — revise este atendimento"}
                          className="absolute left-1 top-1 grid h-[18px] w-[18px] place-items-center rounded-full bg-danger text-white"
                        >
                          <AlertTriangle className="h-2.5 w-2.5" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────── Week view ─────────────────────────── */

function WeekView({
  blocks,
  professionals,
  dateObj,
  firstProId,
  appointments,
  timezone,
  nowMin,
  today,
  onOpenSlot,
  onOpenBlock,
  onOpenDetail,
  onOpenDay,
}: {
  blocks: AvailabilityBlock[];
  professionals: Professional[];
  dateObj: Date;
  firstProId: string;
  appointments: Appointment[];
  timezone: string;
  nowMin: number | null;
  today: string;
  onOpenSlot: (proId: string, minutes: number, dayStr?: string) => void;
  onOpenBlock?: (block: AvailabilityBlock) => void;
  onOpenDetail: (a: Appointment) => void;
  onOpenDay: (d: string) => void;
}) {
  const days = eachDayOfInterval({
    start: startOfWeek(dateObj, { weekStartsOn: 1 }),
    end: endOfWeek(dateObj, { weekStartsOn: 1 }),
  });
  const { start: dayStart, end: dayEnd } = visibleHours(appointments, timezone, professionals);
  const slots: number[] = [];
  for (let m = dayStart; m < dayEnd; m += SLOT_MIN) slots.push(m);
  const totalH = (dayEnd - dayStart) * PX_PER_MIN;
  const colW = 150;

  return (
    <div className="agenda-grid overflow-auto rounded-xl border border-border bg-card">
      <div className="flex w-full" style={{ minWidth: 56 + days.length * colW }}>
        <div className="sticky left-0 z-20 w-14 shrink-0 border-r border-border bg-surface-1">
          <div style={{ height: HEADER_H }} className="border-b border-border" />
          <AgendaTimeScale start={dayStart} end={dayEnd} pixelsPerMinute={PX_PER_MIN} />
        </div>

        {days.map((day) => {
          const dStr = ymd(day);
          const isToday = dStr === today;
          const dayAppts = appointments.filter(
            (appointment) =>
              formatInTimeZone(new Date(appointment.startAt), timezone, "yyyy-MM-dd") === dStr,
          );
          const placements = appointmentPlacements(dayAppts, timezone);
          return (
            <div key={dStr} className="relative shrink-0 border-r border-border last:border-r-0" style={{ flex: 1, minWidth: colW }}>
              <button
                onClick={() => onOpenDay(dStr)}
                style={{ height: HEADER_H }}
                className={`sticky top-0 z-10 flex w-full flex-col items-center justify-center border-b border-border transition hover:bg-card-hover ${
                  isToday ? "bg-primary/10" : "bg-card"
                }`}
              >
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {format(day, "EEE", { locale: ptBR })}
                </span>
                <span className={`text-sm font-semibold ${isToday ? "text-primary" : ""}`}>
                  {format(day, "d")}
                </span>
              </button>

              <div className="relative" style={{ height: totalH }}>
                {blocks.map(block => <BlockOverlay key={block.id} block={block} date={dStr} timezone={timezone} start={dayStart} end={dayEnd} name={professionals.find(p => p.id === block.professionalId)?.name} onOpen={onOpenBlock} />)}
                {slots.map((m) => (
                  <button
                    key={m}
                    onClick={() => onOpenSlot(firstProId, m, dStr)}
                    aria-label={`Agendar ${dStr} às ${minutesToHHMM(m)}`}
                    style={{ height: SLOT_MIN * PX_PER_MIN }}
                    className={`agenda-half-hour block w-full border-t transition hover:bg-primary/5 ${m % 60 === 0 ? "border-border" : "border-dashed border-border/60"}`}
                  />
                ))}

                {isToday && nowMin != null && nowMin >= dayStart && nowMin <= dayEnd && (
                  <div className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{ top: (nowMin - dayStart) * PX_PER_MIN }}>
                    <span className="h-1.5 w-1.5 rounded-full bg-danger" />
                    <span className="h-px flex-1 bg-danger" />
                  </div>
                )}

                {dayAppts.map((a) => {
                  const startMin = minutesOf(a.startAt, timezone);
                  const endMin = endMinutes(a, timezone);
                  const top = (startMin - dayStart) * PX_PER_MIN;
                  const height = Math.max(20, (endMin - startMin) * PX_PER_MIN);
                  if (top < 0 || top > totalH) return null;
                  const cfg = STATUS[a.status as keyof typeof STATUS] ?? STATUS.CONFIRMED;
                  const placement = placements.get(a.id) ?? {
                    leftPct: 0,
                    widthPct: 100,
                    conflict: false,
                  };
                  return (
                    <button
                      key={a.id}
                      onClick={() => onOpenDetail(a)}
                      aria-label={`${formatInTimeZone(new Date(a.startAt), timezone, "HH:mm")}, ${a.clientName}, ${a.serviceName}, ${professionals.find(p => p.id === a.professionalId)?.name ?? "Profissional"}, ${cfg.label}${placement.conflict ? ", conflito de horário" : ""}`}
                      data-appointment-professional={a.professionalId} data-colorful-appointment
                      title={placement.conflict ? "Conflito de horário detectado — revise este atendimento" : undefined}
                      className={`absolute z-[2] overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-left text-[10px] shadow-sm transition hover:shadow-md ${
                        placement.conflict ? "ring-1 ring-danger/60" : ""
                      }`}
                      style={{
                        top,
                        height,
                        left: `calc(${placement.leftPct}% + 3px)`,
                        width: `calc(${placement.widthPct}% - 6px)`,
                        borderLeftColor: a.professionalColor,
                        background: `color-mix(in srgb, ${a.professionalColor} 60%, white)`,
                      }}
                    >
                      <p className="truncate font-semibold">{formatInTimeZone(new Date(a.startAt), timezone, "HH:mm")} {a.clientName.split(" ")[0]}</p>
                      {height > 30 && <p className="truncate text-foreground/85">{a.serviceName}</p>}
                      {height >= 70 && <span style={{ backgroundColor: "hsl(var(--card))" }} className={`inline-flex max-w-full truncate rounded px-1 text-[9px] ${cfg.badgeClass}`}>{cfg.label}</span>}
                      {placement.conflict && <AlertTriangle className="absolute right-1 top-1 h-3 w-3 text-danger" aria-label="Conflito de horário" />}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────── Month view ─────────────────────────── */

function MonthView({
  blocks,
  dateObj,
  appointments,
  timezone,
  today,
  onOpenDay,
  onOpenDetail,
}: {
  blocks: AvailabilityBlock[];
  dateObj: Date;
  appointments: Appointment[];
  timezone: string;
  today: string;
  onOpenDay: (d: string) => void;
  onOpenDetail: (a: Appointment) => void;
}) {
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(dateObj), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(dateObj), { weekStartsOn: 1 }),
  });
  const byDay = new Map<string, Appointment[]>();
  for (const a of appointments) {
    const k = formatInTimeZone(new Date(a.startAt), timezone, "yyyy-MM-dd");
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(a);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="grid grid-cols-7 border-b border-border bg-surface-1">
        {[
          ["Seg", "segunda-feira"],
          ["Ter", "terça-feira"],
          ["Qua", "quarta-feira"],
          ["Qui", "quinta-feira"],
          ["Sex", "sexta-feira"],
          ["Sáb", "sábado"],
          ["Dom", "domingo"],
        ].map(([shortLabel, fullLabel]) => (
          <div key={shortLabel} className="py-2 text-center text-[11px] font-medium text-muted-foreground">
            <span aria-hidden="true">{shortLabel}</span>
            <span className="sr-only">{fullLabel}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 sm:hidden">
        {days.map((day) => {
          const dStr = ymd(day);
          const inMonth = isSameMonth(day, dateObj);
          const isToday = dStr === today;
          const dayAppts = (byDay.get(dStr) ?? []).sort((a, b) => a.startAt.localeCompare(b.startAt));
          const appointmentLabel = dayAppts.length === 1 ? "1 agendamento" : `${dayAppts.length} agendamentos`;
          const dateLabel = format(day, "EEEE, d 'de' MMMM", { locale: ptBR });

          return (
            <button
              type="button"
              key={dStr}
              onClick={() => onOpenDay(dStr)}
              aria-label={`${dateLabel}, ${appointmentLabel}, ${blocksOnDate(blocks, dStr, timezone).length} bloqueios${isToday ? ", hoje" : ""}${inMonth ? "" : ", fora do mês atual"}`}
              aria-current={isToday ? "date" : undefined}
              className={`relative flex min-h-12 min-w-0 flex-col items-center justify-center border-b border-r border-border px-0.5 py-1 transition-colors hover:bg-card-hover focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&:nth-child(7n)]:border-r-0 ${
                inMonth ? "" : "bg-surface-1/40 text-muted-foreground/50"
              }`}
            >
              {dayAppts.length > 0 && (
                <span className="absolute right-1 top-1 text-[9px] font-semibold leading-none text-muted-foreground" aria-hidden="true">
                  {dayAppts.length}
                </span>
              )}
              <span className={`grid h-7 w-7 place-items-center rounded-full text-xs ${
                isToday ? "bg-primary font-semibold text-primary-foreground" : ""
              }`}>
                {format(day, "d")}
              </span>
              <span className="mt-0.5 flex h-1.5 items-center justify-center gap-0.5" aria-hidden="true">
                {blocksOnDate(blocks, dStr, timezone).length > 0 && <Ban className="h-3 w-3 text-danger" />}
                {dayAppts.slice(0, 3).map((appointment) => {
                  return <span key={appointment.id} className="h-1.5 w-1.5 rounded-full" style={{ background: appointment.professionalColor }} />;
                })}
              </span>
            </button>
          );
        })}
      </div>
      <p className="border-t border-border bg-surface-1 px-3 py-2 text-center text-[11px] text-muted-foreground sm:hidden">
        Toque em um dia para abrir os agendamentos.
      </p>
      <div className="hidden grid-cols-7 sm:grid">
        {days.map((day) => {
          const dStr = ymd(day);
          const inMonth = isSameMonth(day, dateObj);
          const isToday = dStr === today;
          const dayAppts = (byDay.get(dStr) ?? []).sort((a, b) => a.startAt.localeCompare(b.startAt));
          return (
            <div
              key={dStr}
              className={`min-h-[104px] border-b border-r border-border p-1.5 last:border-r-0 [&:nth-child(7n)]:border-r-0 ${
                inMonth ? "" : "bg-surface-1/40"
              }`}
            >
              <button
                type="button"
                onClick={() => onOpenDay(dStr)}
                aria-label={`Abrir ${format(day, "d 'de' MMMM", { locale: ptBR })}`}
                aria-current={isToday ? "date" : undefined}
                className={`mb-1 grid h-11 w-11 place-items-center rounded-full text-[11px] transition hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isToday ? "bg-primary font-semibold text-primary-foreground" : inMonth ? "text-foreground" : "text-muted-foreground/50"
                }`}
              >
                {format(day, "d")}
              </button>
              <div className="space-y-0.5">
                {blocksOnDate(blocks, dStr, timezone).length > 0 && <button onClick={() => onOpenDay(dStr)} className="flex min-h-8 items-center gap-1 rounded bg-muted px-1 text-xs"><Ban size={12} />{blocksOnDate(blocks, dStr, timezone).length} bloqueio(s)</button>}
                {dayAppts.slice(0, 3).map((a) => {
                  const cfg = STATUS[a.status as keyof typeof STATUS] ?? STATUS.CONFIRMED;
                  return (
                    <button
                      type="button"
                      key={a.id}
                      onClick={() => onOpenDetail(a)}
                      aria-label={`${formatInTimeZone(new Date(a.startAt), timezone, "HH:mm")}, ${a.clientName}, ${a.serviceName}, ${cfg.label}`}
                      data-appointment-professional={a.professionalId} data-colorful-appointment
                      className="flex min-h-6 w-full items-center gap-1 truncate rounded px-1 py-1 text-left text-[11px] transition hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      style={{ background: `color-mix(in srgb, ${a.professionalColor} 60%, white)`, color: "#111827" }}
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: a.professionalColor }} />
                      <span className="truncate">{formatInTimeZone(new Date(a.startAt), timezone, "HH:mm")} {a.clientName.split(" ")[0]}</span>
                    </button>
                  );
                })}
                {dayAppts.length > 3 && (
                  <button type="button" onClick={() => onOpenDay(dStr)} className="min-h-6 px-1 text-[10px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    +{dayAppts.length - 3} mais
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────── List view ─────────────────────────── */

function ListView({
  appointments,
  professionals,
  timezone,
  onOpenDetail,
}: {
  appointments: Appointment[];
  professionals: Professional[];
  timezone: string;
  onOpenDetail: (a: Appointment) => void;
}) {
  const proById = new Map(professionals.map((p) => [p.id, p]));
  const sorted = [...appointments].sort((a, b) => a.startAt.localeCompare(b.startAt));

  if (sorted.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
        Nenhum agendamento com esse filtro.
      </div>
    );
  }

  let lastDay = "";
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      {sorted.map((a) => {
        const cfg = STATUS[a.status as keyof typeof STATUS] ?? STATUS.CONFIRMED;
        const pro = proById.get(a.professionalId);
        const dayKey = formatInTimeZone(new Date(a.startAt), timezone, "yyyy-MM-dd");
        const showDay = dayKey !== lastDay;
        lastDay = dayKey;
        return (
          <div key={a.id}>
            {showDay && (
              <div className="border-b border-border bg-surface-1 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {formatInTimeZone(new Date(a.startAt), timezone, "EEEE, d 'de' MMMM", { locale: ptBR })}
              </div>
            )}
            <button
              onClick={() => onOpenDetail(a)}
              className="flex w-full items-center gap-4 border-b border-border px-4 py-3 text-left transition last:border-0 hover:bg-card-hover"
            >
              <div className="w-14 shrink-0 text-center">
                <p className="text-sm font-semibold">{formatInTimeZone(new Date(a.startAt), timezone, "HH:mm")}</p>
                <p className="text-[10px] text-muted-foreground">{formatInTimeZone(new Date(a.endAt), timezone, "HH:mm")}</p>
              </div>
              <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: a.professionalColor }} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{a.clientName}</p>
                <p className="truncate text-[12px] text-muted-foreground">
                  {a.serviceName}{pro ? ` · ${pro.name.split(" ")[0]}` : ""}
                </p>
              </div>
              {a.waitlistCount > 0 && (
                <span
                  title={a.waitlistNext ? `Próximo da fila: ${a.waitlistNext}` : undefined}
                  className="hidden shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-600 sm:inline-flex"
                >
                  <Users className="h-3 w-3" />
                  {a.waitlistCount} na fila
                </span>
              )}
              <span className={`hidden shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline ${cfg.badgeClass}`}>
                {cfg.label}
              </span>
              <p className="w-20 shrink-0 text-right text-[13px] font-semibold">{formatMoney(a.priceCents)}</p>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────── Bits ─────────────────────────── */

function blocksOnDate(blocks: AvailabilityBlock[], date: string, timezone: string) {
  return blocks.filter(b => formatInTimeZone(new Date(b.startAt), timezone, "yyyy-MM-dd") <= date && formatInTimeZone(new Date(+new Date(b.endAt) - 1), timezone, "yyyy-MM-dd") >= date);
}

function BlockOverlay({ block, date, timezone, start, end, name, onOpen }: { block: AvailabilityBlock; date: string; timezone: string; start: number; end: number; name?: string; onOpen?: (block: AvailabilityBlock) => void }) {
  if (!blocksOnDate([block], date, timezone).length) return null;
  const first = formatInTimeZone(new Date(block.startAt), timezone, "yyyy-MM-dd");
  const last = formatInTimeZone(new Date(block.endAt), timezone, "yyyy-MM-dd");
  const from = Math.max(start, first < date ? 0 : minutesOf(block.startAt, timezone));
  const to = Math.min(end, last > date ? 1440 : minutesOf(block.endAt, timezone));
  if (to <= from) return null;
  return <AvailabilityBlockTrigger block={block} professionalName={name ?? "Profissional"} timezone={timezone} onOpen={onOpen} className="absolute inset-x-0 z-[1] p-1 text-[10px]" style={{ top: (from - start) * PX_PER_MIN, height: (to - from) * PX_PER_MIN }} />;
}

function BlockList({ blocks, professionals, timezone, onOpenBlock }: { blocks: AvailabilityBlock[]; professionals: Professional[]; timezone: string; onOpenBlock?: (block: AvailabilityBlock) => void }) {
  if (!blocks.length) return null;
  return <section aria-label="Bloqueios do período" className="rounded-xl border border-border bg-muted/40 p-3"><h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Ban size={16} />Bloqueios do período</h2><ul className="divide-y divide-border">{blocks.map(b => {
    const content = <><strong>{professionals.find(p => p.id === b.professionalId)?.name}</strong> · {formatInTimeZone(new Date(b.startAt), timezone, "dd/MM HH:mm")} — {formatInTimeZone(new Date(b.endAt), timezone, "dd/MM HH:mm")}<p className="text-xs text-muted-foreground">{b.reason ?? "Indisponível"}</p></>;
    return <li key={b.id} className="py-1 text-sm">{onOpenBlock ? <button type="button" onClick={() => onOpenBlock(b)} className="min-h-11 w-full rounded-lg px-2 py-1 text-left transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{content}</button> : <div className="px-2 py-1">{content}</div>}</li>;
  })}</ul></section>;
}

function ViewBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof List; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Visualização ${label}`}
      aria-pressed={active}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function FilterChip({ active, onClick, children, icon: Icon, dot }: { active: boolean; onClick: () => void; children: React.ReactNode; icon?: typeof Users; dot?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        active ? "border-primary/40 bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
      }`}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {dot && <span className="h-2 w-2 rounded-full" style={{ background: dot }} />}
      {children}
    </button>
  );
}
