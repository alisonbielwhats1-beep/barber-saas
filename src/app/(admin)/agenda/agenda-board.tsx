"use client";
import { agendaRange } from "./agenda-range";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Search,
  Users,
  ListFilter,
  Loader2,
  Bell,
  AlertTriangle,
  Ban,
  ChevronDown,
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
import { calendarGridRangeInTimeZone } from "@/lib/time";
import { AppointmentDialog, type ProOption, type ServiceOption, type ClientOption, type WaitlistPrefill } from "./appointment-form";
import { AppointmentDetail } from "./appointment-detail";
import { STATUS, STATUS_ORDER } from "./agenda-status";
import { appointmentColor } from "@/lib/agenda-colors";
import { AgendaColorSelect, useAgendaColorMode } from "@/components/agenda-color-select";
import { professionalColors } from "./professional-colors";
import { moveAppointment } from "./actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { layoutAppointmentsAndBlocks, type AgendaPlacement } from "./agenda-layout";
import { AvailabilityPanel, type AvailabilityBlock, type AvailabilityPreset, type BlockSelection } from "./availability-panel";
import { AvailabilityBlockDialog, AvailabilityBlockTrigger } from "./availability-block";
import type { AgendaPrefill } from "./agenda-deep-link";
import { ImageWithFallback } from "@/components/ui/image-with-fallback";
import { DateNavigator } from "./date-navigator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { unavailableScheduleIntervals, type VisualWorkingHours } from "./schedule-visibility";
import { AgendaQuickActions } from "./agenda-quick-actions";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { WeeklyPausePanel } from "./weekly-pause-panel";
import { minuteAtSlotPointer } from "./agenda-slot-pointer";
import { AgendaWeekStrip } from "./agenda-week-strip";
import { AgendaTimeScale } from "./agenda-time-scale";
import { AgendaMobileGuide } from "./agenda-mobile-guide";
import { Button } from "@/components/ui/button";
import "./agenda-workspace.css";

const DAY_START = 8 * 60;
const SLOT_MIN = 30;
const PX_PER_MIN = 1.7;
// The drop position of a dragged booking is measured from the top of its column, header included: keep this height.
const HEADER_H = 64;

type ViewKind = "day" | "week" | "month" | "list";

/** Situation as coloured text on the cards (the label always goes with it; colour is never the only signal). */
const STATUS_TEXT: Record<string, string> = {
  PENDING: "text-warning",
  CONFIRMED: "text-muted-foreground",
  IN_PROGRESS: "text-[hsl(var(--selection-foreground))]",
  COMPLETED: "text-success",
  NO_SHOW: "text-danger",
  CANCELLED: "text-muted-foreground",
};

const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Period title: long form ("5 – 11 de outubro", "Outubro de 2026") and a short one for narrow bars ("5 – 11 out", "Out 2026"). */
function periodLabels(view: ViewKind, day: Date) {
  if (view === "day") {
    return { full: format(day, "d 'de' MMMM", { locale: ptBR }), short: format(day, "d MMM", { locale: ptBR }) };
  }
  if (view === "week") {
    const first = startOfWeek(day, { weekStartsOn: 1 });
    const last = endOfWeek(day, { weekStartsOn: 1 });
    if (isSameMonth(first, last)) {
      return {
        full: `${format(first, "d")} – ${format(last, "d 'de' MMMM", { locale: ptBR })}`,
        short: `${format(first, "d")} – ${format(last, "d MMM", { locale: ptBR })}`,
      };
    }
    const across = `${format(first, "d MMM", { locale: ptBR })} – ${format(last, "d MMM", { locale: ptBR })}`;
    return { full: across, short: across };
  }
  return {
    full: capitalize(format(day, "MMMM 'de' yyyy", { locale: ptBR })),
    short: capitalize(format(day, "MMM yyyy", { locale: ptBR })),
  };
}

export type WaitlistEntryView = {
  id: string;
  name: string;
  phone: string | null;
  serviceName: string;
  position: number;
  /** `null` para quem entrou na fila sem conta (convidado). */
  clientId: string | null;
  professionalId: string;
  startAt: string;
  serviceIds: string[];
};

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
  serviceCategory?: string | null;
  waitlistCount: number;
  waitlistNext: string | null;
  waitlist: WaitlistEntryView[];
  isOverbooked: boolean;
  version: number;
  serviceIds: string[];
  hasPayment: boolean;
  pendingReschedule: {
    status?: string;
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


function appointmentPlacements(appointments: Appointment[], timezone: string, blocks: AvailabilityBlock[], date: string) {
  return layoutAppointmentsAndBlocks(
    appointments.map((appointment) => ({
      id: appointment.id,
      start: minutesOf(appointment.startAt, timezone),
      end: endMinutes(appointment, timezone),
    })),
    blocksOnDate(blocks, date, timezone).map(block => ({ id: block.id,
      start: formatInTimeZone(new Date(block.startAt), timezone, "yyyy-MM-dd") < date ? 0 : minutesOf(block.startAt, timezone),
      end: formatInTimeZone(new Date(block.endAt), timezone, "yyyy-MM-dd") > date ? 1440 : minutesOf(block.endAt, timezone),
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
  colorScope,
  operations,
  prefill,
  initialProfessionalId,
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
  canManageAvailability = canCancel,
}: {
  colorScope: string;
  /** Deep link already re-validated by the page (agendaPrefill): what to open, prefilled. Never books anything. */
  prefill?: AgendaPrefill;
  initialProfessionalId?: string;
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
  canManageAvailability?: boolean;
}) {
  const [colorMode, setColorMode] = useAgendaColorMode(colorScope);
  const colors = useMemo(() => professionalColors(roster), [roster]);
  const professionals = useMemo(() => roster.map(pro => ({ ...pro, colorHex: colors.get(pro.id)! })), [roster, colors]);
  const appointments = useMemo(() => rawAppointments.map(appointment => ({ ...appointment, professionalColor: appointmentColor(colorMode, { professional: colors.get(appointment.professionalId) ?? "#6B9FA8", service: appointment.serviceColor, category: appointment.serviceCategory, status: STATUS[appointment.status as keyof typeof STATUS]?.color ?? "#6B9FA8" }) })), [rawAppointments, colors, colorMode]);
  const [fullDay, setFullDay] = useState(false);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [view, setView] = useState<ViewKind>("day");
  const [proFilter, setProFilter] = useState<string[]>(() => roster.some(pro => pro.id === initialProfessionalId) ? [initialProfessionalId!] : []);
  const [statusFilter, setStatusFilter] = useState<string>("not_cancelled");
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Side calendar (wide screens): open next to the Day and Week grids; Month and List already show the month, so it starts closed there.
  const [sidePanel, setSidePanel] = useState({ grid: true, plain: false });
  const plainView = view === "month" || view === "list";
  const calendarOpen = plainView ? sidePanel.plain : sidePanel.grid;
  const setCalendarOpen = (open: boolean) => setSidePanel(current => plainView ? { ...current, plain: open } : { ...current, grid: open });
  const [noticesOpen, setNoticesOpen] = useState(false);
  const noticesOpener = useRef<HTMLButtonElement | null>(null);
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [pauseLaunch, setPauseLaunch] = useState<string>();
  const [mobileCalendarOpen, setMobileCalendarOpen] = useState(false);
  const mobileCalendarTrigger = useRef<HTMLButtonElement>(null);
  const compactCalendarTrigger = useRef<HTMLButtonElement>(null);
  const quickActionTrigger = useRef<HTMLButtonElement>(null);
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const restoreQuickActionFocus = () => quickActionTrigger.current?.focus();
  const [blockMode, setBlockMode] = useState(false);
  const [blockSelection, setBlockSelection] = useState<(BlockSelection & { key: string }) | undefined>(() => canManageAvailability && prefill?.block ? { ...prefill.block, key: "deep-link" } : undefined);
  const [availabilityLaunch, setAvailabilityLaunch] = useState<{ key: string; preset: AvailabilityPreset } | undefined>();
  const [selectedAvailabilityBlock, setSelectedAvailabilityBlock] = useState<AvailabilityBlock | null>(null);
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<Appointment | null>(() => appointments.find(a => a.id === prefill?.detailId) ?? null);
  const currentDetail = detail ? appointments.find(appointment => appointment.id === detail.id) ?? detail : null;
  const [createAt, setCreateAt] = useState<{ startLocal: string; proId: string; clientId?: string; serviceIds?: string[]; waitlist?: WaitlistPrefill } | null>(() => canCreate && prefill?.create ? prefill.create : null);
  // A later deep link while the agenda is already open (e.g. from the Secretária dock) opens its record or form too.
  const prefillKey = JSON.stringify(prefill ?? {}), appliedPrefill = useRef(prefillKey);
  useEffect(() => {
    if (appliedPrefill.current === prefillKey) return;
    appliedPrefill.current = prefillKey;
    const next = prefill ?? {};
    const linked = appointments.find(appointment => appointment.id === next.detailId);
    if (linked) setDetail(linked);
    if (canCreate && next.create) setCreateAt(next.create);
    if (canManageAvailability && next.block) { setAvailabilityLaunch(undefined); setBlockSelection({ ...next.block, key: crypto.randomUUID() }); }
  // Only a new link applies; the lists it was validated against arrive with it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillKey]);
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
  const shownPros = proFilter.length === 0 ? professionals : professionals.filter((p) => proFilter.includes(p.id));

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
        if (proFilter.length > 0 && !proFilter.includes(a.professionalId)) return false;
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


  const awaitingAcceptance = appointments.filter((a) => a.pendingReschedule && a.pendingReschedule.status !== "REJECTED").length;
  const cancelledWithQueue = appointments.filter((a) => a.status === "CANCELLED" && a.waitlistCount > 0).length;
  const activeFilterCount = Number(proFilter.length > 0) + Number(statusFilter !== "not_cancelled") + Number(Boolean(search.trim()));
  const filterSummary = [
    proFilter.length > 0 ? professionals.filter(pro => proFilter.includes(pro.id)).map(pro => pro.name).join(", ") : null,
    statusFilter !== "not_cancelled"
      ? statusFilter === "all" ? "Todos os status" : STATUS[statusFilter as keyof typeof STATUS]?.label
      : null,
    search.trim() ? `Busca: ${search.trim()}` : null,
  ].filter(Boolean).join(" · ");
  const loadedRange = calendarGridRangeInTimeZone(date, timezone);
  const noticesPeriod = `${formatInTimeZone(loadedRange.from, timezone, "dd/MM")} a ${formatInTimeZone(new Date(loadedRange.to.getTime() - 1), timezone, "dd/MM/yyyy")}`;

  function clearFilters() {
    setProFilter([]);
    setStatusFilter("not_cancelled");
    setSearch("");
  }

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
    if (!canManageAvailability) return;
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

  const period = periodLabels(view, dateObj);
  const periodKicker = view === "day" ? format(dateObj, "EEEE", { locale: ptBR }) : view === "week" ? "semana" : view === "month" ? "mês" : "lista";
  const navigationUnit = view === "week" ? "semana" : view === "month" || view === "list" ? "mês" : "dia";
  const dayCount = dayAppts.filter(appointment => appointment.status !== "CANCELLED").length;
  const dayCountLabel = `${dayCount} ${dayCount === 1 ? "agendamento" : "agendamentos"}`;
  const timezoneLabel = formatInTimeZone(new Date(`${date}T12:00:00.000Z`), timezone, "O");
  const hasNotices = awaitingAcceptance > 0 || cancelledWithQueue > 0;
  const viewOptions: { value: ViewKind; label: string }[] = [
    { value: "day", label: "Dia" },
    { value: "week", label: "Semana" },
    { value: "month", label: "Mês" },
    { value: "list", label: "Lista" },
  ];
  function selectCalendarDate(next: string) {
    startTransition(() => router.push(`/agenda?date=${next}`, { scroll: false }));
    setMobileCalendarOpen(false);
  }
  /** Side list: a ticked box shows that professional. Unticking keeps at least one column, as the filter chips do. */
  function toggleShown(id: string, show: boolean) {
    setProFilter(current => {
      const visible = current.length === 0 ? professionals.map(pro => pro.id) : current;
      const next = show ? Array.from(new Set([...visible, id])) : visible.filter(item => item !== id);
      if (next.length === 0) return current;
      return next.length === professionals.length ? [] : next;
    });
  }
  const noticesButton = (className: string) => (
    <button type="button" onClick={event => { noticesOpener.current = event.currentTarget; setNoticesOpen(true); }} aria-label="Avisos do período" aria-haspopup="dialog" className={`agenda-icon-btn relative ${className}`}>
      <Bell aria-hidden="true" size={18} />
      <span aria-hidden="true" className="absolute right-2 top-2 h-2 w-2 rounded-full bg-foreground ring-2 ring-background" />
    </button>
  );

  return (
    <div className="agenda-workspace" aria-busy={pending}>
      <header className="agenda-toolbar">
        {/* Phone: the period opens the calendar; the arrows move one day, week or month. */}
        <div className="agenda-phone-nav">
          <button type="button" onClick={() => goDate(-1)} aria-label={`Ir para ${navigationUnit} anterior`} className="agenda-icon-btn grid"><ChevronLeft aria-hidden="true" size={18} /></button>
          <h1 className="min-w-0 flex-1">
            <button ref={compactCalendarTrigger} type="button" aria-label="Abrir calendário" aria-haspopup="dialog" onClick={() => setMobileCalendarOpen(true)} className="agenda-phone-title">
              <span className="flex min-w-0 max-w-full items-center gap-1 text-base font-semibold">
                <span className="agenda-period"><span className="agenda-period-full">{period.full}</span><span className="agenda-period-short">{period.short}</span></span>
                <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
              </span>
              <span className="block max-w-full truncate text-xs font-normal text-muted-foreground">{view === "day" ? `${periodKicker} · ${dayCountLabel}` : periodKicker}</span>
            </button>
          </h1>
          <button type="button" onClick={() => goDate(1)} aria-label={`Ir para próximo ${navigationUnit}`} className="agenda-icon-btn grid"><ChevronRight aria-hidden="true" size={18} /></button>
        </div>
        {/* Computer: calendar, arrows, period and "Hoje" on the left; tools, views and "Novo" on the right. */}
        <div className="agenda-date-controls">
          <button type="button" aria-label={calendarOpen ? "Recolher calendário" : "Abrir calendário"} aria-expanded={calendarOpen} aria-controls="agenda-date-panel" onClick={() => setCalendarOpen(!calendarOpen)} className="agenda-icon-btn hidden xl:grid"><CalendarDays aria-hidden="true" size={18} /></button>
          <button ref={mobileCalendarTrigger} type="button" aria-label="Abrir calendário" aria-haspopup="dialog" onClick={() => setMobileCalendarOpen(true)} className="agenda-icon-btn grid xl:hidden"><CalendarDays aria-hidden="true" size={18} /></button>
          <button type="button" onClick={() => goDate(-1)} aria-label={`Ir para ${navigationUnit} anterior`} className="agenda-icon-btn grid"><ChevronLeft aria-hidden="true" size={18} /></button>
          <div className="agenda-date-title" title={period.full}>
            <p className="first-letter:uppercase">{periodKicker}</p>
            <h1>{period.full}</h1>
          </div>
          <button type="button" onClick={() => goDate(1)} aria-label={`Ir para próximo ${navigationUnit}`} className="agenda-icon-btn grid"><ChevronRight aria-hidden="true" size={18} /></button>
          <Button type="button" variant="outline" size="sm" onClick={goToday} aria-label="Ir para hoje">Hoje</Button>
          {pending && <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
        </div>

        <div className="agenda-view-controls">
          <AgendaMobileGuide scope={colorScope} canCreate={canCreate} autoStart={!prefill?.linked} />
          {hasNotices && noticesButton("hidden sm:grid")}
          <button ref={filterTrigger} type="button" onClick={() => setFiltersOpen(true)} aria-label="Buscar e filtrar agenda" aria-describedby={activeFilterCount > 0 ? "agenda-active-filters" : undefined} aria-haspopup="dialog" className="agenda-icon-btn relative grid"><ListFilter size={18} aria-hidden="true" />{activeFilterCount > 0 && <span aria-hidden="true" className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-xs font-semibold tabular-nums text-primary-foreground">{activeFilterCount}</span>}</button>
          <div role="group" aria-label="Visualização da agenda" className="agenda-view-rail hidden sm:flex">
            {viewOptions.map(option => <ViewBtn key={option.value} active={view === option.value} onClick={() => setView(option.value)} label={option.label} />)}
          </div>
          <AgendaQuickActions
            triggerRef={quickActionTrigger}
            canCreateAppointment={canCreate}
            canManageAvailability={canManageAvailability}
            disabled={professionals.length === 0}
            onNewAppointment={() => openSlot(shownPros[0]?.id ?? "", DAY_START)}
            onNewBlock={() => openAvailability("interval")}
            onNewDayOff={() => openAvailability("day")}
            onWeeklyPause={canCancel ? () => setPauseLaunch(crypto.randomUUID()) : undefined}
            onManageAvailability={() => setOperationsOpen(true)}
            onSelectBlock={view === "day" ? () => setBlockMode(true) : undefined}
          />
        </div>
      </header>

      {view === "day" && <AgendaWeekStrip date={date} today={today} onSelect={goToDay} />}
      <div className="agenda-mobile-views">
        <SegmentedControl ariaLabel="Visualização da agenda" value={view} onChange={setView} className="min-w-0 flex-1" options={viewOptions} />
        {hasNotices && noticesButton("grid shrink-0")}
      </div>

      {activeFilterCount > 0 && (
        <div className="agenda-banner">
          <p id="agenda-active-filters" className="min-w-0 flex-1 break-words">
            <span className="font-medium text-foreground">{activeFilterCount} filtro{activeFilterCount > 1 ? "s" : ""} ativo{activeFilterCount > 1 ? "s" : ""}</span>
            <span> · {filterSummary}</span>
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={() => { clearFilters(); filterTrigger.current?.focus(); }} className="shrink-0">Limpar filtros</Button>
        </div>
      )}
      {blockMode && view === "day" && (
        <div role="status" className="agenda-banner">
          <p className="min-w-0 flex-1"><span className="sm:hidden">Toque no início e no fim do intervalo. Escape cancela.</span><span className="hidden sm:inline">Clique no início e no fim do intervalo, ou arraste na grade em passos de 5 minutos. Escape cancela.</span></p>
          <Button type="button" variant="outline" size="sm" onClick={() => setBlockMode(false)} className="shrink-0">Sair da seleção de bloqueio</Button>
        </div>
      )}
      {actionError && (
        <p role="alert" className="flex shrink-0 items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"><AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />{actionError}</p>
      )}

      <div className="agenda-body">
        {calendarOpen && (
          <aside id="agenda-date-panel" aria-label="Navegar por datas" className="agenda-side">
            <DateNavigator date={date} today={today} onSelect={selectCalendarDate} />
            {professionals.length > 1 && (
              <fieldset className="min-w-0">
                <legend className="mb-1 px-0.5 text-xs font-semibold uppercase tracking-[.04em] text-muted-foreground">Profissionais</legend>
                {professionals.map(pro => (
                  <label key={pro.id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-0.5 text-sm font-medium">
                    <input type="checkbox" checked={shownPros.some(shown => shown.id === pro.id)} onChange={event => toggleShown(pro.id, event.target.checked)} className="h-4 w-4 shrink-0 accent-[hsl(var(--muted-foreground))]" />
                    <ProAvatar pro={pro} size={24} />
                    <span className="min-w-0 truncate" title={pro.name}>{pro.name}</span>
                  </label>
                ))}
              </fieldset>
            )}
          </aside>
        )}
        <div className="agenda-content">

      <Dialog open={noticesOpen} onOpenChange={setNoticesOpen}>
        <DialogContent aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); noticesOpener.current?.focus(); }}>
          <DialogHeader><DialogTitle>Avisos do período</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="font-medium">{noticesPeriod} · independente dos filtros</p>
            <p>
              {awaitingAcceptance > 0 && `${awaitingAcceptance} alteração(ões) aguardando aceite do cliente.`}
              {awaitingAcceptance > 0 && cancelledWithQueue > 0 && " "}
              {cancelledWithQueue > 0 && `${cancelledWithQueue} fila(s) têm horário liberado para promoção manual.`}
            </p>
            {awaitingAcceptance > 0 && (
              <Button asChild variant="outline" className="w-full sm:w-auto">
                <Link href="/notificacoes">Ver central de avisos</Link>
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DialogContent aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); filterTrigger.current?.focus(); }} className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>Buscar e filtrar agenda</DialogTitle></DialogHeader>
      <div className="space-y-5">
        <div className="agenda-filter-extras space-y-3 lg:hidden">
          <AgendaColorSelect value={colorMode} onChange={setColorMode} />
          <button type="button" aria-pressed={view === "month"} onClick={() => {setView("month"); setFiltersOpen(false);}} className="min-h-11 rounded-[10px] border border-border-strong px-3 text-sm font-medium aria-pressed:bg-primary aria-pressed:text-primary-foreground">Visualização mensal</button>
          <button type="button" aria-pressed={fullDay} onClick={() => setFullDay(value => !value)} className="min-h-11 w-full rounded-[10px] border border-border-strong px-3 text-left text-sm font-medium">{fullDay ? "Horários habituais" : "Mostrar dia inteiro"}</button>
        </div>
        <div className="flex min-h-11 items-center gap-2 rounded-[10px] border border-border-strong bg-background px-3 focus-within:ring-2 focus-within:ring-ring lg:min-h-10">
          <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            type="search" inputMode="search" enterKeyHint="search" autoComplete="off"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar cliente ou telefone"
            placeholder="Buscar cliente ou telefone"
            className="min-w-0 flex-1 bg-transparent text-base placeholder:text-muted-foreground focus:outline-none sm:text-sm"
          />
        </div>
        <div id="agenda-filters" className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Profissionais</p>
            <div className="flex flex-wrap gap-2">
              <FilterChip active={proFilter.length === 0} onClick={() => setProFilter([])} icon={Users}>
                Todos profissionais
              </FilterChip>
              {professionals.map((p) => (
                <FilterChip key={p.id} active={proFilter.includes(p.id)} onClick={() => setProFilter(current => current.includes(p.id) ? current.filter(id => id !== p.id) : [...current, p.id])} dot={p.colorHex ?? "#2ECC8B"}>
                  {p.name}
                </FilterChip>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Situação</p>
            <div className="flex flex-wrap gap-2">
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
            <p className="text-xs text-muted-foreground">“Agenda” esconde os cancelados, menos os que têm fila de espera.</p>
          </div>
        </div>
      </div>

          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" disabled={activeFilterCount === 0} onClick={clearFilters}>Limpar filtros</Button>
            <Button type="button" onClick={() => setFiltersOpen(false)}>Ver agenda</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={operationsOpen} onOpenChange={setOperationsOpen}>
        <DialogContent aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); restoreQuickActionFocus(); }} className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Expediente e bloqueios</DialogTitle></DialogHeader>
          {canManageAvailability && <AvailabilityPanel canCancelAppointments={canCancel} date={date} timezone={timezone} professionals={professionals} blocks={availabilityBlocks.filter(b => b.kind !== "OFFER")} />}
          {operations}
        </DialogContent>
      </Dialog>
      {canManageAvailability && (availabilityLaunch || blockSelection) && <AvailabilityPanel canCancelAppointments={canCancel} dialogOnly restoreFocus={restoreQuickActionFocus} key={blockSelection?.key ?? availabilityLaunch?.key} date={date} timezone={timezone} professionals={professionals} blocks={availabilityBlocks.filter(b => b.kind !== "OFFER")} selection={blockSelection} initialPreset={availabilityLaunch?.preset} />}
      {canCancel && pauseLaunch && <WeeklyPausePanel key={pauseLaunch} professionals={professionals} initialOpen hideTrigger restoreFocus={restoreQuickActionFocus} />}

      {view === "day" && shownPros.length > 2 && <p className="sr-only">{shownPros.length} profissionais · role a grade para os lados para ver a equipe.</p>}
      <div className="agenda-canvas">
      {professionals.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-16 text-center text-sm text-muted-foreground">
          Cadastre profissionais para ver a agenda.
        </div>
      ) : view === "day" ? (
        <DayView fullDay={fullDay}
          blockMode={blockMode}
          onBlockSelection={selection => { setAvailabilityLaunch(undefined); setBlockSelection({ ...selection, key: crypto.randomUUID() }); setBlockMode(false); }}
          blocks={availabilityBlocks}
          date={date}
          professionals={shownPros}
          appointments={dayAppts}
          timezone={timezone}
          timezoneLabel={timezoneLabel}
          nowMin={nowMin}
          onOpenSlot={openSlot}
          onOpenBlock={canManageAvailability ? setSelectedAvailabilityBlock : undefined}
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
        <WeekView fullDay={fullDay}
          blocks={availabilityBlocks.filter(b => shownPros.some(p => p.id === b.professionalId))}
          professionals={shownPros}
          dateObj={dateObj}
          date={date}
          firstProId={shownPros[0]?.id ?? ""}
          appointments={filteredAll}
          timezone={timezone}
          nowMin={nowMin}
          today={today}
          onOpenSlot={openSlot}
          onOpenBlock={canManageAvailability ? setSelectedAvailabilityBlock : undefined}
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
        <div className="space-y-3 pb-32 lg:pb-0"><BlockList blocks={availabilityBlocks.filter(b => shownPros.some(p => p.id === b.professionalId))} professionals={shownPros} timezone={timezone} onOpenBlock={canManageAvailability ? setSelectedAvailabilityBlock : undefined} /><ListView appointments={filteredAll} professionals={professionals} timezone={timezone} today={today} onOpenDetail={setDetail} /></div>
      )}

      </div>
        </div>
      </div>
      <footer className="agenda-footer agenda-optional-control">
        <p className="min-w-0 truncate">{view === "day" ? `${dayCountLabel} · ${timezone}` : timezone}</p>
        <div className="flex shrink-0 items-center gap-2">
          {(view === "day" || view === "week") && <button type="button" aria-pressed={fullDay} onClick={() => setFullDay(value => !value)} className="min-h-11 rounded-[10px] px-2 text-sm font-semibold text-foreground hover:bg-card-hover lg:min-h-9">{fullDay ? "Horários habituais" : "Mostrar dia inteiro"}</button>}
          <AgendaColorSelect variant="toolbar" value={colorMode} onChange={setColorMode} />
        </div>
      </footer>
      <Dialog open={mobileCalendarOpen} onOpenChange={setMobileCalendarOpen}>
        <DialogContent aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); (window.matchMedia("(max-width: 639px)").matches ? compactCalendarTrigger : mobileCalendarTrigger).current?.focus(); }} className="max-h-[calc(100dvh-2rem)] w-[calc(100%_-_2rem)] max-w-sm overflow-y-auto p-4">
          <DialogHeader className="pr-10"><DialogTitle>Escolher data</DialogTitle></DialogHeader>
          <DateNavigator date={date} today={today} onSelect={selectCalendarDate} />
        </DialogContent>
      </Dialog>

      {createAt && (
        <AppointmentDialog
          initialClient={createAt.waitlist?.client ?? clients.find(client => client.id === createAt.clientId)}
          initialServiceIds={createAt.serviceIds}
          waitlist={createAt.waitlist}
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

      {selectedAvailabilityBlock && canManageAvailability && (
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

      <AppointmentDetail canOverrideSchedule={canOverrideBreak || canOverbook}
        key={detail?.id ?? "empty"}
        appt={currentDetail}
        professionalName={professionals.find(pro => pro.id === currentDetail?.professionalId)?.name}
        services={services.filter(service => professionals.find(pro => pro.id === currentDetail?.professionalId)?.serviceIds.includes(service.id))}
        salonName={salonName}
        timezone={timezone}
        canCreate={canCreate}
        canCancel={canCancel}
        onScheduleWaitlist={canCreate && canCancel ? (entry) => {
          const startLocal = formatInTimeZone(new Date(entry.startAt), timezone, "yyyy-MM-dd'T'HH:mm");
          setDetail(null);
          setCreateAt({
            startLocal,
            proId: entry.professionalId,
            waitlist: {
              entryId: entry.id,
              name: entry.name,
              sourceTime: startLocal.slice(11, 16),
              serviceIds: entry.serviceIds,
              client: entry.clientId ? { id: entry.clientId, name: entry.name, phone: entry.phone } : undefined,
              guest: entry.clientId ? undefined : { name: entry.name, phone: entry.phone ?? "" },
            },
          });
        } : undefined}
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
  fullDay,
  blockMode,
  onBlockSelection,
  blocks,
  date,
  professionals,
  appointments,
  timezone,
  timezoneLabel,
  nowMin,
  onOpenSlot,
  onOpenBlock,
  onOpenDetail,
  onMove,
}: {
  blockMode: boolean;
  onBlockSelection: (selection: BlockSelection) => void;
  fullDay: boolean;
  blocks: AvailabilityBlock[];
  date: string;
  professionals: Professional[];
  appointments: Appointment[];
  timezone: string;
  timezoneLabel: string;
  nowMin: number | null;
  onOpenSlot: (proId: string, minutes: number, dayStr?: string) => void;
  onOpenBlock?: (block: AvailabilityBlock) => void;
  onOpenDetail: (a: Appointment) => void;
  onMove: (appointment: Appointment, proId: string, startLocal: string) => void;
}) {
  const visibleBlocks = blocks.filter(b => professionals.some(p => p.id === b.professionalId) && formatInTimeZone(new Date(b.startAt), timezone, 'yyyy-MM-dd') <= date && formatInTimeZone(new Date(new Date(b.endAt).getTime() - 1), timezone, 'yyyy-MM-dd') >= date);
  const { start: dayStart, end: dayEnd } = agendaRange(appointments, visibleBlocks, professionals.flatMap(p => p.workingHours ?? []), timezone, fullDay);
  const bodyRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const scrolledToNow = useRef("");
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
  // Hoje abre uma hora antes de agora, não às 08:00: no celular a grade não mostra o dia inteiro.
  useEffect(() => {
    if (nowMin == null || scrolledToNow.current === date || !gridRef.current) return;
    scrolledToNow.current = date;
    gridRef.current.scrollTop = Math.max(0, (nowMin - 60 - dayStart) * PX_PER_MIN);
  }, [nowMin, date, dayStart]);

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
    <div ref={gridRef} className="agenda-grid overflow-auto rounded-xl border border-border bg-card">
      <div className="relative flex w-full" style={{ minWidth: `calc(56px + ${professionals.length} * var(--agenda-column-min, 148px))` }} ref={bodyRef}>
        <div className="sticky left-0 z-20 w-14 shrink-0 border-r border-border bg-card">
          <div style={{ height: HEADER_H }} className="sticky top-0 z-30 flex items-center justify-end border-b border-border bg-card pr-2 text-xs text-muted-foreground">{timezoneLabel}</div>
          <AgendaTimeScale start={dayStart} end={dayEnd} pixelsPerMinute={PX_PER_MIN} />
        </div>

        {professionals.map((pro) => {
          const proAppts = appointments.filter((a) => a.professionalId === pro.id);
          const placements = appointmentPlacements(proAppts, timezone, blocks.filter(b => b.professionalId === pro.id), date);
          return (
            <div key={pro.id} data-pro-col data-pro-id={pro.id} className="relative shrink-0 border-r border-border last:border-r-0" style={{ flex: 1, minWidth: `max(var(--agenda-column-min, 148px), ${Math.max(0, ...[...placements.values()].filter(p => p.columns > 1).map(p => p.columns * 112))}px)` }}>
              <div style={{ height: HEADER_H }} className="sticky top-0 z-10 flex min-w-0 items-center gap-2 border-b border-border bg-card px-2.5">
                <ProAvatar pro={pro} size={28} marker />
                <span className="min-w-0 truncate text-sm font-semibold" title={pro.name}>{pro.name}</span>
              </div>

              <div className="relative" style={{ height: totalH }}>
                {slots.map((m) => (
                  <button
                    key={m}
                    onPointerDown={e => { if (blockMode && e.pointerType === "mouse" && e.button === 0) { suppressClick.current = false; selectInterval(pro.id, pointerMinute(e, m), false, 5); } }}
                    onPointerMove={e => { if (blockMode && e.pointerType === "mouse" && e.buttons === 1 && selection.current?.proId === pro.id) { const minute = pointerMinute(e, m); suppressClick.current = selection.current.start !== minute; selectInterval(pro.id, minute, false, 5); } }}
                    onPointerUp={e => { if (blockMode && suppressClick.current) selectInterval(pro.id, pointerMinute(e, m), true, 5); }}
                    onKeyDown={e => { if (e.key === "Escape") { selection.current = null; setSelectionView(null); } }}
                    onClick={e => { if (suppressClick.current) { suppressClick.current = false; return; } const minute = e.detail === 0 ? m : pointerMinute(e, m); if (blockMode) selectInterval(pro.id, minute, !!selection.current, e.detail === 0 ? SLOT_MIN : 5); else onOpenSlot(pro.id, minute); }}
                    style={{ height: SLOT_MIN * PX_PER_MIN }}
                    className={`agenda-half-hour block w-full border-t transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${m % 60 === 0 ? "border-border" : "agenda-quarter-line"} ${blockMode ? "cursor-crosshair" : ""}`}
                    aria-label={`${blockMode ? "Selecionar bloqueio" : "Agendar"} ${minutesToHHMM(m)} com ${pro.name}`}
                  />
                ))}
                {selectionView?.proId === pro.id && <div className="pointer-events-none absolute inset-x-[3px] z-20 rounded-md border-2 border-foreground/70 bg-foreground/10" style={{ top: (Math.min(selectionView.start, selectionView.end) - dayStart) * PX_PER_MIN, height: (Math.abs(selectionView.end - selectionView.start) + selectionView.step) * PX_PER_MIN }} />}

                {unavailableScheduleIntervals(pro.workingHours ?? [], date, dayStart, dayEnd).map((interval) => {
                  const height = (interval.endMinutes - interval.startMinutes) * PX_PER_MIN;
                  const range = `${minutesToHHMM(interval.startMinutes)}–${minutesToHHMM(interval.endMinutes)}`;
                  // A gap between two working periods is a pause; before the first and after the last, it is off hours.
                  const pause = interval.startMinutes > dayStart && interval.endMinutes < dayEnd;
                  if (pause) {
                    return (
                      <div
                        key={`schedule-${interval.startMinutes}-${interval.endMinutes}`}
                        role="note"
                        aria-label={`Pausa de ${pro.name}: ${range}`}
                        className="agenda-pause pointer-events-none absolute inset-x-1 z-[1] overflow-hidden"
                        style={{ top: (interval.startMinutes - dayStart) * PX_PER_MIN + 2, height: Math.max(4, height - 4) }}
                      >
                        {height >= 24 && <span className="block truncate font-medium text-foreground">Pausa</span>}
                        {height >= 40 && <span className="block truncate tabular-nums">{minutesToHHMM(interval.startMinutes)} – {minutesToHHMM(interval.endMinutes)}</span>}
                      </div>
                    );
                  }
                  return (
                    <div
                      key={`schedule-${interval.startMinutes}-${interval.endMinutes}`}
                      role="note"
                      aria-label={`Fora do expediente de ${pro.name}: ${range}`}
                      className="agenda-off-hours pointer-events-none absolute inset-x-0 overflow-hidden px-2 py-1.5 text-xs text-muted-foreground"
                      style={{ top: (interval.startMinutes - dayStart) * PX_PER_MIN, height }}
                    >
                      {height >= 34 && "Fora do expediente"}
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
                  return <AvailabilityBlockTrigger key={block.id} block={block} professionalName={pro.name} timezone={timezone} onOpen={onOpenBlock} className="absolute z-[1]" style={{ left: `calc(${placements.get(`block:${block.id}`)?.leftPct ?? 0}% + 3px)`, width: `calc(${placements.get(`block:${block.id}`)?.widthPct ?? 100}% - 6px)`, top: (start - dayStart) * PX_PER_MIN + 1, height: Math.max(22, (end - start) * PX_PER_MIN - 2) }} />;
                })}

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
                  const time = formatInTimeZone(new Date(a.startAt), timezone, "HH:mm");
                  const narrow = placement.widthPct < 100;
                  const color = a.professionalColor ?? "#6B9FA8";
                  const queueTitle = a.waitlistCount > 0 ? `${a.waitlistCount} na fila de espera${a.waitlistNext ? ` — próximo: ${a.waitlistNext}` : ""}` : undefined;
                  const reschedule = a.pendingReschedule ? (a.pendingReschedule.status === "REJECTED" ? "Alteração recusada" : "Aguardando aceite") : null;
                  const extra = [a.status !== "CONFIRMED" ? cfg.label : null, a.waitlistCount > 0 ? `${a.waitlistCount} na fila` : null, reschedule].filter(Boolean).join(" · ");
                  const warn = a.isOverbooked || placement.conflict;
                  return (
                    <button
                      type="button"
                      key={a.id}
                      onPointerDown={(e) => startDrag(e, a.id)}
                      onClick={() => {
                        if (!drag?.started) onOpenDetail(a);
                      }}
                      aria-label={`${a.clientName}, ${a.serviceName}, ${time}, ${pro.name}, ${cfg.label}.${placement.conflict ? " Conflito de horário detectado." : ""} Abrir detalhes`}
                      data-appointment-professional={a.professionalId} data-colorful-appointment
                      data-narrow={narrow || undefined}
                      title={placement.conflict && !a.isOverbooked ? "Conflito de horário detectado — revise este atendimento" : undefined}
                      className={`agenda-ev group absolute z-[2] cursor-pointer touch-pan-y select-none focus-visible:z-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:cursor-grab ${
                        height < 44 ? "agenda-ev-tight" : ""
                      } ${a.status === "CANCELLED" ? "agenda-ev-cancelled" : ""} ${warn ? "pr-6" : ""} ${
                        placement.conflict ? "ring-1 ring-danger/60" : ""
                      } ${
                        isDragging ? "z-30 opacity-50 ring-2 ring-foreground" : ""
                      }`}
                      style={{
                        top: top + 1,
                        height: height - 2,
                        left: `calc(${placement.leftPct}% + 3px)`,
                        width: `calc(${placement.widthPct}% - 6px)`,
                        background: `color-mix(in srgb, ${color} 14%, hsl(var(--card)))`,
                        borderColor: `color-mix(in srgb, ${color} 28%, hsl(var(--border-strong)))`,
                        borderLeftColor: a.professionalColor,
                      }}
                    >
                      <span className="agenda-ev-l1">
                        <span className="agenda-ev-name">{narrow ? a.clientName.split(" ")[0] : a.clientName}</span>
                        {a.waitlistCount > 0 && height <= 52 && <span title={queueTitle} className="inline-flex shrink-0 items-center gap-0.5 text-warning"><Users aria-hidden="true" className="h-3 w-3" />{a.waitlistCount}</span>}
                        <span className="agenda-ev-time">{time}</span>
                      </span>
                      {height > 36 && <span className="agenda-ev-l2"><span className="agenda-ev-time-inline">{time} · </span>{a.serviceName}</span>}
                      {extra && height > 52 && <span title={queueTitle} className={`agenda-ev-l3 ${a.status !== "CONFIRMED" ? STATUS_TEXT[a.status] ?? "text-muted-foreground" : "text-warning"}`}>{extra}</span>}
                      {warn && (
                        <span
                          title={a.isOverbooked
                            ? "Overbooking deliberado — encaixado apesar de conflito de horário"
                            : "Conflito de horário detectado — revise este atendimento"}
                          className="absolute right-1.5 top-1 text-danger"
                        >
                          <AlertTriangle aria-hidden="true" className="h-3 w-3" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {nowMin != null && nowMin >= dayStart && nowMin <= dayEnd && (
          <div aria-hidden="true" className="agenda-now-line" style={{ top: HEADER_H + (nowMin - dayStart) * PX_PER_MIN, left: 56 }} />
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── Week view ─────────────────────────── */

function WeekView({
  fullDay,
  blocks,
  professionals,
  dateObj,
  date,
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
  fullDay: boolean;
  blocks: AvailabilityBlock[];
  professionals: Professional[];
  dateObj: Date;
  date: string;
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
  const { start: dayStart, end: dayEnd } = agendaRange(appointments, blocks, professionals.flatMap(p => p.workingHours ?? []), timezone, fullDay);
  const slots: number[] = [];
  for (let m = dayStart; m < dayEnd; m += SLOT_MIN) slots.push(m);
  const totalH = (dayEnd - dayStart) * PX_PER_MIN;
  // Computer: 150px days (and 112px per overlapping lane) that scroll sideways; phone: the 7 days share the width (CSS sets both to 0).
  const colW = "var(--agenda-week-col, 150px)";

  return (
    <div className="agenda-grid overflow-auto rounded-xl border border-border bg-card">
      <div className="flex w-full" style={{ minWidth: `calc(56px + ${days.length} * ${colW})` }}>
        <div className="sticky left-0 z-20 w-14 shrink-0 border-r border-border bg-card">
          <div style={{ height: HEADER_H }} className="sticky top-0 z-30 border-b border-border bg-card" />
          <AgendaTimeScale start={dayStart} end={dayEnd} pixelsPerMinute={PX_PER_MIN} />
        </div>

        {days.map((day) => {
          const dStr = ymd(day);
          const isToday = dStr === today;
          const dayAppts = appointments.filter(
            (appointment) =>
              formatInTimeZone(new Date(appointment.startAt), timezone, "yyyy-MM-dd") === dStr,
          );
          const placements = appointmentPlacements(dayAppts, timezone, blocks, dStr);
          return (
            <div key={dStr} className="relative shrink-0 border-r border-border last:border-r-0" style={{ flex: 1, minWidth: `max(${colW}, calc(${Math.max(1, ...[...placements.values()].map(p => p.columns))} * var(--agenda-week-lane, 112px)))` }}>
              <button
                type="button"
                onClick={() => onOpenDay(dStr)}
                style={{ height: HEADER_H }}
                className={`sticky top-0 z-10 flex w-full flex-col items-center justify-center gap-0.5 border-b border-border transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                  dStr === date ? "bg-muted" : "bg-card"
                }`}
              >
                <span className="text-xs font-semibold uppercase tracking-[.02em] text-muted-foreground">
                  {WEEKDAY_SHORT[day.getDay()]}
                </span>
                <span className="flex items-center gap-1 text-sm font-semibold tabular-nums">
                  {format(day, "d")}
                  {isToday && <span aria-hidden="true" className="h-1 w-1 rounded-full bg-[hsl(var(--selection-solid))]" />}
                </span>
              </button>

              <div className="relative" style={{ height: totalH }}>
                {blocks.map(block => <BlockOverlay key={block.id} placement={placements.get(`block:${block.id}`)} block={block} date={dStr} timezone={timezone} start={dayStart} end={dayEnd} name={professionals.find(p => p.id === block.professionalId)?.name} onOpen={onOpenBlock} />)}
                {slots.map((m) => (
                  <button
                    key={m}
                    onClick={() => onOpenSlot(firstProId, m, dStr)}
                    aria-label={`Agendar ${dStr} às ${minutesToHHMM(m)}`}
                    style={{ height: SLOT_MIN * PX_PER_MIN }}
                    className={`agenda-half-hour block w-full border-t transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${m % 60 === 0 ? "border-border" : "agenda-quarter-line"}`}
                  />
                ))}

                {isToday && nowMin != null && nowMin >= dayStart && nowMin <= dayEnd && (
                  <div aria-hidden="true" className="agenda-now-line" style={{ top: (nowMin - dayStart) * PX_PER_MIN, left: 0 }} />
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
                  const conflict = placement.conflict;
                  return (
                    <button
                      type="button"
                      key={a.id}
                      onClick={() => onOpenDetail(a)}
                      aria-label={`${formatInTimeZone(new Date(a.startAt), timezone, "HH:mm")}, ${a.clientName}, ${a.serviceName}, ${professionals.find(p => p.id === a.professionalId)?.name ?? "Profissional"}, ${cfg.label}${conflict ? ", conflito de horário" : ""}`}
                      data-appointment-professional={a.professionalId} data-colorful-appointment
                      title={conflict ? "Conflito de horário detectado — revise este atendimento" : undefined}
                      className={`agenda-ev agenda-ev-week absolute z-[2] focus-visible:z-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${a.status === "CANCELLED" ? "agenda-ev-cancelled" : ""} ${
                        conflict ? "pr-5 ring-1 ring-danger/60" : ""
                      }`}
                      style={{
                        top: top + 1,
                        height: height - 2,
                        left: `calc(${placement.leftPct}% + var(--agenda-week-gap, 2px))`,
                        width: `calc(${placement.widthPct}% - 2 * var(--agenda-week-gap, 2px))`,
                        background: `color-mix(in srgb, ${a.professionalColor ?? "#6B9FA8"} 22%, hsl(var(--card)))`,
                        borderColor: `color-mix(in srgb, ${a.professionalColor ?? "#6B9FA8"} 28%, hsl(var(--border-strong)))`,
                        borderLeftColor: a.professionalColor,
                      }}
                    >
                      <span className="agenda-ev-l1"><span className="agenda-ev-name"><span className="agenda-wk-time tabular-nums"><span>{formatInTimeZone(new Date(a.startAt), timezone, "HH")}</span><span className="agenda-wk-colon">:</span><span>{formatInTimeZone(new Date(a.startAt), timezone, "mm")}</span></span><span className="agenda-wk-name"> {a.clientName.split(" ")[0]}</span></span></span>
                      {height > 30 && <span className="agenda-ev-l2">{a.serviceName}</span>}
                      {height >= 70 && a.status !== "CONFIRMED" && <span className={`agenda-ev-l3 ${STATUS_TEXT[a.status] ?? "text-muted-foreground"}`}>{cfg.label}</span>}
                      {conflict && <AlertTriangle className="absolute right-1 top-1 h-3 w-3 text-danger" aria-label="Conflito de horário" />}
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
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="grid grid-cols-7 border-b border-border">
        {[
          ["Seg", "segunda-feira"],
          ["Ter", "terça-feira"],
          ["Qua", "quarta-feira"],
          ["Qui", "quinta-feira"],
          ["Sex", "sexta-feira"],
          ["Sáb", "sábado"],
          ["Dom", "domingo"],
        ].map(([shortLabel, fullLabel]) => (
          <div key={shortLabel} className="py-2 text-center text-xs font-semibold text-muted-foreground sm:border-r sm:border-border sm:last:border-r-0">
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
              className={`relative flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-[10px] px-0.5 py-1.5 text-sm font-medium transition-colors hover:bg-card-hover focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                inMonth ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              <span className={`grid h-7 w-7 place-items-center rounded-full tabular-nums ${
                isToday ? "bg-primary font-semibold text-primary-foreground" : ""
              }`}>
                {format(day, "d")}
              </span>
              <span className="flex h-3 items-center justify-center gap-[3px]" aria-hidden="true">
                {blocksOnDate(blocks, dStr, timezone).length > 0 && <Ban className="h-3 w-3 text-muted-foreground" />}
                {dayAppts.slice(0, 3).map((appointment) => {
                  return <span key={appointment.id} className="h-[5px] w-[5px] rounded-full" style={{ background: appointment.professionalColor }} />;
                })}
              </span>
            </button>
          );
        })}
      </div>
      <p className="border-t border-border px-3 py-2 text-center text-xs text-muted-foreground sm:hidden">
        Toque em um dia para abrir os agendamentos.
      </p>
      <div className="hidden grid-cols-7 sm:grid">
        {days.map((day) => {
          const dStr = ymd(day);
          const inMonth = isSameMonth(day, dateObj);
          const isToday = dStr === today;
          const dayAppts = (byDay.get(dStr) ?? []).sort((a, b) => a.startAt.localeCompare(b.startAt));
          const dayBlocks = blocksOnDate(blocks, dStr, timezone).length;
          return (
            <div
              key={dStr}
              className={`flex min-h-[104px] min-w-0 flex-col gap-[3px] overflow-hidden border-b border-r border-border px-1 py-1.5 [&:nth-child(7n)]:border-r-0 ${
                inMonth ? "" : "bg-muted/40"
              }`}
            >
              <button
                type="button"
                onClick={() => onOpenDay(dStr)}
                aria-label={`Abrir ${format(day, "d 'de' MMMM", { locale: ptBR })}`}
                aria-current={isToday ? "date" : undefined}
                className={`ml-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:h-8 lg:w-8 ${
                  isToday ? "bg-primary font-semibold text-primary-foreground" : inMonth ? "text-foreground hover:bg-card-hover" : "text-muted-foreground hover:bg-card-hover"
                }`}
              >
                {format(day, "d")}
              </button>
              {dayBlocks > 0 && <button type="button" onClick={() => onOpenDay(dStr)} className="inline-flex min-h-8 max-w-full items-center gap-1 self-start rounded-[5px] bg-muted px-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-6"><Ban aria-hidden="true" className="h-3 w-3 shrink-0" /><span className="truncate">{dayBlocks} bloqueio(s)</span></button>}
              {dayAppts.slice(0, 3).map((a) => {
                const cfg = STATUS[a.status as keyof typeof STATUS] ?? STATUS.CONFIRMED;
                return (
                  <button
                    type="button"
                    key={a.id}
                    onClick={() => onOpenDetail(a)}
                    aria-label={`${formatInTimeZone(new Date(a.startAt), timezone, "HH:mm")}, ${a.clientName}, ${a.serviceName}, ${cfg.label}`}
                    title={`${formatInTimeZone(new Date(a.startAt), timezone, "HH:mm")} · ${a.clientName} · ${a.serviceName}`}
                    data-appointment-professional={a.professionalId} data-colorful-appointment
                    className={`flex min-h-8 w-full min-w-0 items-center gap-1 rounded-[5px] bg-muted px-1 text-left text-xs text-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-6 ${a.status === "CANCELLED" ? "line-through" : ""}`}
                  >
                    <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: a.professionalColor }} />
                    <span className="min-w-0 truncate"><span className="tabular-nums">{formatInTimeZone(new Date(a.startAt), timezone, "HH:mm")}</span> {a.clientName.split(" ")[0]}</span>
                  </button>
                );
              })}
              {dayAppts.length > 3 && (
                <button type="button" onClick={() => onOpenDay(dStr)} className="min-h-8 self-start px-1 text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-6">
                  +{dayAppts.length - 3} mais
                </button>
              )}
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
  today,
  onOpenDetail,
}: {
  appointments: Appointment[];
  professionals: Professional[];
  timezone: string;
  today: string;
  onOpenDetail: (a: Appointment) => void;
}) {
  const proById = new Map(professionals.map((p) => [p.id, p]));
  const sorted = [...appointments].sort((a, b) => a.startAt.localeCompare(b.startAt));
  const listRef = useRef<HTMLDivElement>(null);

  // A lista cobre o mês inteiro: ao abrir, ela começa no primeiro dia que ainda não passou.
  useEffect(() => {
    const list = listRef.current;
    const scroller = list?.closest<HTMLElement>(".agenda-canvas");
    const target = [...(list?.querySelectorAll<HTMLElement>("[data-day]") ?? [])].find((header) => header.dataset.day! >= today);
    if (!scroller || !target) return;
    scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  // Só na abertura: filtros não devem tirar a pessoa do lugar em que ela está.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
        Nenhum agendamento com esse filtro.
      </div>
    );
  }

  const groups: { day: string; items: Appointment[] }[] = [];
  for (const appointment of sorted) {
    const day = formatInTimeZone(new Date(appointment.startAt), timezone, "yyyy-MM-dd");
    const last = groups.at(-1);
    if (last?.day === day) last.items.push(appointment);
    else groups.push({ day, items: [appointment] });
  }
  return (
    <div ref={listRef} className="space-y-4">
      {groups.map((group) => (
        <section key={group.day} data-day={group.day}>
          <h2 className="mb-2 px-0.5 text-xs font-semibold uppercase tracking-[.04em] text-muted-foreground">
            {formatInTimeZone(new Date(group.items[0]!.startAt), timezone, "EEEE, d 'de' MMMM", { locale: ptBR })}{group.day === today ? " · Hoje" : ""}
          </h2>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {group.items.map((a) => {
              const cfg = STATUS[a.status as keyof typeof STATUS] ?? STATUS.CONFIRMED;
              const pro = proById.get(a.professionalId);
              const badges = (
                <>
                  {a.waitlistCount > 0 && (
                    <span title={a.waitlistNext ? `Próximo da fila: ${a.waitlistNext}` : undefined} className="inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full bg-warning/15 px-2.5 text-xs font-medium text-warning">
                      <Users aria-hidden="true" className="h-3 w-3" />
                      {a.waitlistCount} na fila
                    </span>
                  )}
                  <span className={`inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium ${cfg.badgeClass}`}>
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                    {cfg.label}
                  </span>
                </>
              );
              return (
                <button
                  type="button"
                  key={a.id}
                  onClick={() => onOpenDetail(a)}
                  className="flex min-h-14 w-full items-center gap-3 border-b border-border px-3.5 py-2 text-left transition-colors last:border-b-0 hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span aria-hidden="true" className="w-1 shrink-0 self-stretch rounded-full" style={{ background: a.professionalColor }} />
                  <span className="w-12 shrink-0 text-sm font-semibold tabular-nums">
                    {formatInTimeZone(new Date(a.startAt), timezone, "HH:mm")}
                    <span className="block text-xs font-normal text-muted-foreground">{formatInTimeZone(new Date(a.endAt), timezone, "HH:mm")}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm font-medium ${a.status === "CANCELLED" ? "line-through" : ""}`}>{a.clientName}</span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {a.serviceName}{pro ? ` · ${pro.name.split(" ")[0]}` : ""}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1 sm:hidden">{badges}</span>
                  </span>
                  <span className="hidden shrink-0 items-center gap-1.5 sm:flex">{badges}</span>
                  <span className="w-20 shrink-0 whitespace-nowrap text-right text-sm font-medium tabular-nums sm:w-24">{formatMoney(a.priceCents)}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ─────────────────────────── Bits ─────────────────────────── */

function blocksOnDate(blocks: AvailabilityBlock[], date: string, timezone: string) {
  return blocks.filter(b => formatInTimeZone(new Date(b.startAt), timezone, "yyyy-MM-dd") <= date && formatInTimeZone(new Date(+new Date(b.endAt) - 1), timezone, "yyyy-MM-dd") >= date);
}

function BlockOverlay({ block, date, timezone, start, end, name, onOpen, placement }: { placement?: AgendaPlacement; block: AvailabilityBlock; date: string; timezone: string; start: number; end: number; name?: string; onOpen?: (block: AvailabilityBlock) => void }) {
  if (!blocksOnDate([block], date, timezone).length) return null;
  const first = formatInTimeZone(new Date(block.startAt), timezone, "yyyy-MM-dd");
  const last = formatInTimeZone(new Date(block.endAt), timezone, "yyyy-MM-dd");
  const from = Math.max(start, first < date ? 0 : minutesOf(block.startAt, timezone));
  const to = Math.min(end, last > date ? 1440 : minutesOf(block.endAt, timezone));
  if (to <= from) return null;
  return <AvailabilityBlockTrigger block={block} professionalName={name ?? "Profissional"} timezone={timezone} onOpen={onOpen} className="absolute z-[1]" style={{ left: `calc(${placement?.leftPct ?? 0}% + 2px)`, width: `calc(${placement?.widthPct ?? 100}% - 4px)`, top: (from - start) * PX_PER_MIN + 1, height: Math.max(6, (to - from) * PX_PER_MIN - 2) }} />;
}

function BlockList({ blocks, professionals, timezone, onOpenBlock }: { blocks: AvailabilityBlock[]; professionals: Professional[]; timezone: string; onOpenBlock?: (block: AvailabilityBlock) => void }) {
  if (!blocks.length) return null;
  return <section aria-label="Bloqueios do período" className="rounded-xl border border-border bg-card px-3"><details open={blocks.length <= 2}><summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden"><Ban size={16} aria-hidden="true" className="shrink-0 text-muted-foreground" />Bloqueios do período · {blocks.length}<ChevronDown size={16} aria-hidden="true" className="ml-auto shrink-0 text-muted-foreground [details[open]_&]:rotate-180" /></summary><ul className="divide-y divide-border border-t border-border">{blocks.map(b => {
    const content = <><strong className="font-semibold">{professionals.find(p => p.id === b.professionalId)?.name}</strong> · <span className="tabular-nums">{formatInTimeZone(new Date(b.startAt), timezone, "dd/MM HH:mm")} — {formatInTimeZone(new Date(b.endAt), timezone, "dd/MM HH:mm")}</span><span className="block text-xs text-muted-foreground">{b.reason ?? "Indisponível"}</span></>;
    return <li key={b.id} className="py-1 text-sm">{onOpenBlock ? <button type="button" onClick={() => onOpenBlock(b)} className="min-h-11 w-full rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{content}</button> : <div className="px-1.5 py-1">{content}</div>}</li>;
  })}</ul></details></section>;
}

/** Desktop view rail, the `.seg` of the prototype: one quiet track, the chosen view lifted. */
function ViewBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Visualização ${label}`}
      aria-pressed={active}
      className={`inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-lg px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:min-h-[30px] lg:rounded-[7px] ${
        active ? "bg-[hsl(var(--border))] font-semibold text-foreground ring-1 ring-inset ring-border-strong" : "font-medium text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function FilterChip({ active, onClick, children, icon: Icon, dot }: { active: boolean; onClick: () => void; children: React.ReactNode; icon?: typeof Users; dot?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-[10px] border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-10 ${
        active ? "border-primary bg-primary font-semibold text-primary-foreground" : "border-border-strong font-medium text-foreground hover:bg-card-hover"
      }`}
    >
      {Icon && <Icon aria-hidden="true" className="h-4 w-4" />}
      {dot && <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: dot }} />}
      {children}
    </button>
  );
}

/** Initials (or photo) in the professional's colour. `marker` carries the colour the column cards are compared with. */
function ProAvatar({ pro, size, marker = false }: { pro: Professional; size: number; marker?: boolean }) {
  const color = pro.colorHex ?? "#6B9FA8";
  const letters = initials(pro.name).slice(0, size < 28 ? 1 : 2);
  return (
    <span
      aria-hidden="true"
      data-professional-color={marker ? color : undefined}
      style={{ width: size, height: size, borderColor: color, background: `color-mix(in srgb, ${color} 34%, hsl(var(--card)))` }}
      className="grid shrink-0 place-items-center overflow-hidden rounded-full border-2 text-xs font-semibold text-foreground"
    >
      {pro.avatarUrl ? <ImageWithFallback src={pro.avatarUrl} alt="" width={44} height={44} sizes="44px" className="h-full w-full object-cover" fallback={<span>{letters}</span>} /> : letters}
    </span>
  );
}
