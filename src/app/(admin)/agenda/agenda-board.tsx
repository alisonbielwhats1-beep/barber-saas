"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  CalendarRange,
  Grid3x3,
  List,
  Plus,
  Search,
  Users,
  CircleDollarSign,
  Clock,
  Loader2,
} from "lucide-react";
import {
  format,
  addDays,
  parseISO,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { minutesToHHMM, formatMoney } from "@/lib/utils";
import { AppointmentDialog, type ProOption, type ServiceOption, type ClientOption } from "./appointment-form";
import { AppointmentDetail } from "./appointment-detail";
import { STATUS, STATUS_ORDER } from "./agenda-status";
import { moveAppointment, resizeAppointment } from "./actions";

const DAY_START = 8 * 60;
const DAY_END = 21 * 60;
const SLOT_MIN = 30;
const PX_PER_MIN = 1.7;
const COL_WIDTH = 200;
const HEADER_H = 56;

type ViewKind = "day" | "week" | "month" | "list";

export type Appointment = {
  id: string;
  professionalId: string;
  startAt: string;
  endAt: string;
  priceCents: number;
  status: string;
  notes: string | null;
  clientName: string;
  clientPhone: string | null;
  serviceName: string;
  serviceColor: string | null;
};

export type Professional = {
  id: string;
  name: string;
  colorHex: string | null;
  serviceIds: string[];
};

function minutesOf(iso: string) {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}
function initials(name: string) {
  return name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
}
function ymd(d: Date) {
  return format(d, "yyyy-MM-dd");
}

export function AgendaBoard({
  date,
  salonName,
  professionals,
  appointments,
  services,
  clients,
}: {
  date: string;
  salonName: string;
  professionals: Professional[];
  appointments: Appointment[];
  services: ServiceOption[];
  clients: ClientOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [view, setView] = useState<ViewKind>("day");
  const [proFilter, setProFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<Appointment | null>(null);
  const [createAt, setCreateAt] = useState<{ slotISO: string; proId: string } | null>(null);
  const [nowMin, setNowMin] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const dateObj = parseISO(`${date}T12:00:00`);
  const isToday = ymd(new Date()) === date;

  useEffect(() => {
    if (!isToday) return setNowMin(null);
    const tick = () => {
      const n = new Date();
      setNowMin(n.getHours() * 60 + n.getMinutes());
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [isToday]);

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
        if (statusFilter !== "all" && a.status !== statusFilter) return false;
        if (proFilter !== "all" && a.professionalId !== proFilter) return false;
        if (q && !a.clientName.toLowerCase().includes(q) && !(a.clientPhone ?? "").includes(q)) return false;
        return true;
      });
  }, [statusFilter, proFilter, search]);

  const filteredAll = useMemo(() => applyFilters(appointments), [applyFilters, appointments]);
  const dayAppts = useMemo(
    () => filteredAll.filter((a) => ymd(new Date(a.startAt)) === date),
    [filteredAll, date],
  );

  const kpis = useMemo(() => {
    const sum = (pred: (a: Appointment) => boolean) =>
      dayAppts.filter(pred).reduce((s, a) => s + a.priceCents, 0);
    return {
      total: dayAppts.length,
      inProgress: dayAppts.filter((a) => a.status === "IN_PROGRESS").length,
      realized: sum((a) => a.status === "COMPLETED"),
      forecast: sum((a) => ["PENDING", "CONFIRMED", "IN_PROGRESS"].includes(a.status)),
    };
  }, [dayAppts]);

  function goDate(offset: number) {
    const step = view === "month" ? 30 : view === "week" ? 7 : 1;
    const d = ymd(addDays(dateObj, offset * step));
    startTransition(() => router.push(`/agenda?date=${d}`, { scroll: false }));
  }
  function goToday() {
    startTransition(() => router.push(`/agenda?date=${ymd(new Date())}`, { scroll: false }));
  }
  function goToDay(d: string) {
    setView("day");
    startTransition(() => router.push(`/agenda?date=${d}`, { scroll: false }));
  }

  function openSlot(proId: string, minutes: number, dayStr = date) {
    const start = new Date(`${dayStr}T00:00:00`);
    start.setHours(0, minutes, 0, 0);
    setCreateAt({ slotISO: start.toISOString(), proId });
  }
  function refresh() {
    startTransition(() => router.refresh());
  }
  function runAction(fn: () => Promise<void>) {
    setActionError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Não foi possível concluir");
      }
    });
  }

  const rangeLabel =
    view === "week"
      ? `${format(startOfWeek(dateObj, { weekStartsOn: 1 }), "d MMM", { locale: ptBR })} – ${format(endOfWeek(dateObj, { weekStartsOn: 1 }), "d MMM", { locale: ptBR })}`
      : view === "month"
        ? format(dateObj, "MMMM yyyy", { locale: ptBR })
        : format(dateObj, "d 'de' MMMM", { locale: ptBR });

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-full border border-border bg-surface-1 p-1">
            <button onClick={() => goDate(-1)} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-card-hover hover:text-foreground">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button onClick={goToday} className="rounded-full px-3 py-1 text-[12px] font-medium text-muted-foreground hover:text-foreground">
              Hoje
            </button>
            <button onClick={() => goDate(1)} className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-card-hover hover:text-foreground">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              {format(dateObj, "EEEE", { locale: ptBR })}
            </p>
            <h1 className="text-xl font-semibold capitalize tracking-tight">{rangeLabel}</h1>
          </div>
          {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-full border border-border bg-surface-1 p-1">
            <ViewBtn active={view === "day"} onClick={() => setView("day")} icon={CalendarDays} label="Dia" />
            <ViewBtn active={view === "week"} onClick={() => setView("week")} icon={CalendarRange} label="Semana" />
            <ViewBtn active={view === "month"} onClick={() => setView("month")} icon={Grid3x3} label="Mês" />
            <ViewBtn active={view === "list"} onClick={() => setView("list")} icon={List} label="Lista" />
          </div>
          <button
            onClick={() => openSlot(professionals[0]?.id ?? "", DAY_START)}
            disabled={professionals.length === 0}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
            Novo
          </button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <DayKpi icon={CalendarDays} accent="#3B9EFF" label="Agendamentos (dia)" value={kpis.total.toString()} />
        <DayKpi icon={Clock} accent="#A855F7" label="Em atendimento" value={kpis.inProgress.toString()} />
        <DayKpi icon={CircleDollarSign} accent="#2ECC8B" label="Receita realizada" value={formatMoney(kpis.realized)} />
        <DayKpi icon={CircleDollarSign} accent="#F59E0B" label="Receita prevista" value={formatMoney(kpis.forecast)} />
      </section>

      <section className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar cliente ou telefone…"
            className="w-44 bg-transparent text-[13px] placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <FilterChip active={proFilter === "all"} onClick={() => setProFilter("all")} icon={Users}>
          Todos profissionais
        </FilterChip>
        {professionals.map((p) => (
          <FilterChip key={p.id} active={proFilter === p.id} onClick={() => setProFilter(p.id)} dot={p.colorHex ?? "#2ECC8B"}>
            {p.name.split(" ")[0]}
          </FilterChip>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <FilterChip active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>
          Todos status
        </FilterChip>
        {STATUS_ORDER.map((s) => (
          <FilterChip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)} dot={STATUS[s].color}>
            {STATUS[s].label}
          </FilterChip>
        ))}
      </section>

      {actionError && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">{actionError}</p>
      )}

      {professionals.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-16 text-center text-sm text-muted-foreground">
          Cadastre profissionais para ver a agenda.
        </div>
      ) : view === "day" ? (
        <DayView
          date={date}
          professionals={shownPros}
          appointments={dayAppts}
          nowMin={nowMin}
          onOpenSlot={openSlot}
          onOpenDetail={setDetail}
          onMove={(id, proId, startISO) => runAction(() => moveAppointment({ id, professionalId: proId, startAt: startISO }))}
          onResize={(id, endISO) => runAction(() => resizeAppointment({ id, endAt: endISO }))}
        />
      ) : view === "week" ? (
        <WeekView
          dateObj={dateObj}
          firstProId={professionals[0]?.id ?? ""}
          appointments={filteredAll}
          nowMin={nowMin}
          today={ymd(new Date())}
          onOpenSlot={openSlot}
          onOpenDetail={setDetail}
          onOpenDay={goToDay}
        />
      ) : view === "month" ? (
        <MonthView
          dateObj={dateObj}
          appointments={filteredAll}
          today={ymd(new Date())}
          onOpenDay={goToDay}
          onOpenDetail={setDetail}
        />
      ) : (
        <ListView appointments={filteredAll} professionals={professionals} onOpenDetail={setDetail} />
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
        {STATUS_ORDER.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: STATUS[s].color }} />
            {STATUS[s].label}
          </span>
        ))}
      </div>

      {createAt && (
        <AppointmentDialog
          open={!!createAt}
          onOpenChange={(o) => {
            if (!o) {
              setCreateAt(null);
              refresh();
            }
          }}
          slotStartISO={createAt.slotISO}
          professionalId={createAt.proId}
          professionals={proOptions}
          services={services}
          clients={clients}
        />
      )}

      <AppointmentDetail
        appt={detail}
        salonName={salonName}
        onClose={() => {
          setDetail(null);
          refresh();
        }}
      />
    </div>
  );
}

/* ─────────────────────────── Day view ─────────────────────────── */

function DayView({
  date,
  professionals,
  appointments,
  nowMin,
  onOpenSlot,
  onOpenDetail,
  onMove,
  onResize,
}: {
  date: string;
  professionals: Professional[];
  appointments: Appointment[];
  nowMin: number | null;
  onOpenSlot: (proId: string, minutes: number, dayStr?: string) => void;
  onOpenDetail: (a: Appointment) => void;
  onMove: (id: string, proId: string, startISO: string) => void;
  onResize: (id: string, endISO: string) => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const apptById = useRef(new Map<string, Appointment>());
  apptById.current = new Map(appointments.map((a) => [a.id, a]));
  const [drag, setDrag] = useState<
    { id: string; mode: "move" | "resize"; x: number; y: number; started: boolean } | null
  >(null);

  const slots: number[] = [];
  for (let m = DAY_START; m < DAY_END; m += SLOT_MIN) slots.push(m);
  const totalH = (DAY_END - DAY_START) * PX_PER_MIN;

  function startDrag(e: React.PointerEvent, id: string, mode: "move" | "resize") {
    if (e.button !== 0) return;
    if (mode === "resize") e.stopPropagation();
    setDrag({ id, mode, x: e.clientX, y: e.clientY, started: false });
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
            let mins = DAY_START + Math.round(rel / PX_PER_MIN / 15) * 15;
            mins = Math.max(DAY_START, Math.min(DAY_END, mins));
            if (d.mode === "move") {
              const start = new Date(`${date}T00:00:00`);
              start.setHours(0, mins, 0, 0);
              onMove(d.id, col.dataset.proId!, start.toISOString());
            } else {
              const appt = apptById.current.get(d.id);
              if (appt) {
                const startMin = minutesOf(appt.startAt);
                const endMin = Math.max(startMin + 15, mins);
                const end = new Date(`${date}T00:00:00`);
                end.setHours(0, endMin, 0, 0);
                onResize(d.id, end.toISOString());
              }
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
  }, [drag, date, onMove, onResize]);

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card">
      <div className="flex min-w-max" ref={bodyRef}>
        <div className="w-14 shrink-0 border-r border-border bg-surface-1">
          <div style={{ height: HEADER_H }} className="border-b border-border" />
          {slots.map((m) => (
            <div key={m} style={{ height: SLOT_MIN * PX_PER_MIN }} className="px-2 pt-1 text-[10px] text-muted-foreground">
              {minutesToHHMM(m)}
            </div>
          ))}
        </div>

        {professionals.map((pro) => {
          const proAppts = appointments.filter((a) => a.professionalId === pro.id);
          return (
            <div key={pro.id} data-pro-col data-pro-id={pro.id} className="relative shrink-0 border-r border-border last:border-r-0" style={{ width: COL_WIDTH }}>
              <div style={{ height: HEADER_H }} className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-card px-3">
                <span className="grid h-7 w-7 place-items-center rounded-full text-[10px] font-semibold text-black/80" style={{ background: pro.colorHex ?? "#2ECC8B" }}>
                  {initials(pro.name)}
                </span>
                <span className="truncate text-[13px] font-medium">{pro.name}</span>
              </div>

              <div className="relative" style={{ height: totalH }}>
                {slots.map((m) => (
                  <button
                    key={m}
                    onClick={() => onOpenSlot(pro.id, m)}
                    style={{ height: SLOT_MIN * PX_PER_MIN }}
                    className="block w-full border-b border-border/40 transition hover:bg-primary/5"
                    aria-label={`Agendar ${minutesToHHMM(m)} com ${pro.name}`}
                  />
                ))}

                {nowMin != null && nowMin >= DAY_START && nowMin <= DAY_END && (
                  <div className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{ top: (nowMin - DAY_START) * PX_PER_MIN }}>
                    <span className="h-2 w-2 rounded-full bg-danger" />
                    <span className="h-px flex-1 bg-danger" />
                  </div>
                )}

                {proAppts.map((a) => {
                  const startMin = minutesOf(a.startAt);
                  const endMin = minutesOf(a.endAt);
                  const top = (startMin - DAY_START) * PX_PER_MIN;
                  const height = Math.max(24, (endMin - startMin) * PX_PER_MIN);
                  if (top < 0 || top > totalH) return null;
                  const cfg = STATUS[a.status as keyof typeof STATUS] ?? STATUS.CONFIRMED;
                  const isDragging = drag?.id === a.id && drag.started;
                  return (
                    <div
                      key={a.id}
                      onPointerDown={(e) => startDrag(e, a.id, "move")}
                      onClick={() => {
                        if (!drag?.started) onOpenDetail(a);
                      }}
                      className={`group absolute inset-x-1 cursor-grab touch-none select-none rounded-lg border-l-[3px] p-2 text-xs shadow-sm transition ${
                        isDragging ? "z-30 opacity-70 ring-2 ring-primary" : "hover:shadow-md"
                      }`}
                      style={{ top, height, borderLeftColor: cfg.color, background: `${cfg.color}1f` }}
                    >
                      <p className="truncate font-semibold text-foreground">{a.clientName}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{a.serviceName}</p>
                      {height > 46 && (
                        <p className="mt-0.5 text-[10px] font-medium" style={{ color: cfg.color }}>
                          {format(new Date(a.startAt), "HH:mm")} · {formatMoney(a.priceCents)}
                        </p>
                      )}
                      {/* Alça de redimensionar */}
                      <div
                        onPointerDown={(e) => startDrag(e, a.id, "resize")}
                        className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize rounded-b-lg opacity-0 transition group-hover:opacity-100"
                        style={{ background: `${cfg.color}55` }}
                        aria-label="Redimensionar duração"
                      />
                    </div>
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
  dateObj,
  firstProId,
  appointments,
  nowMin,
  today,
  onOpenSlot,
  onOpenDetail,
  onOpenDay,
}: {
  dateObj: Date;
  firstProId: string;
  appointments: Appointment[];
  nowMin: number | null;
  today: string;
  onOpenSlot: (proId: string, minutes: number, dayStr?: string) => void;
  onOpenDetail: (a: Appointment) => void;
  onOpenDay: (d: string) => void;
}) {
  const days = eachDayOfInterval({
    start: startOfWeek(dateObj, { weekStartsOn: 1 }),
    end: endOfWeek(dateObj, { weekStartsOn: 1 }),
  });
  const slots: number[] = [];
  for (let m = DAY_START; m < DAY_END; m += SLOT_MIN) slots.push(m);
  const totalH = (DAY_END - DAY_START) * PX_PER_MIN;
  const colW = 150;

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card">
      <div className="flex min-w-max">
        <div className="w-14 shrink-0 border-r border-border bg-surface-1">
          <div style={{ height: HEADER_H }} className="border-b border-border" />
          {slots.map((m) => (
            <div key={m} style={{ height: SLOT_MIN * PX_PER_MIN }} className="px-2 pt-1 text-[10px] text-muted-foreground">
              {minutesToHHMM(m)}
            </div>
          ))}
        </div>

        {days.map((day) => {
          const dStr = ymd(day);
          const isToday = dStr === today;
          const dayAppts = appointments.filter((a) => ymd(new Date(a.startAt)) === dStr);
          return (
            <div key={dStr} className="relative shrink-0 border-r border-border last:border-r-0" style={{ width: colW }}>
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
                {slots.map((m) => (
                  <button
                    key={m}
                    onClick={() => onOpenSlot(firstProId, m, dStr)}
                    style={{ height: SLOT_MIN * PX_PER_MIN }}
                    className="block w-full border-b border-border/40 transition hover:bg-primary/5"
                  />
                ))}

                {isToday && nowMin != null && nowMin >= DAY_START && nowMin <= DAY_END && (
                  <div className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{ top: (nowMin - DAY_START) * PX_PER_MIN }}>
                    <span className="h-1.5 w-1.5 rounded-full bg-danger" />
                    <span className="h-px flex-1 bg-danger" />
                  </div>
                )}

                {dayAppts.map((a) => {
                  const startMin = minutesOf(a.startAt);
                  const endMin = minutesOf(a.endAt);
                  const top = (startMin - DAY_START) * PX_PER_MIN;
                  const height = Math.max(20, (endMin - startMin) * PX_PER_MIN);
                  if (top < 0 || top > totalH) return null;
                  const cfg = STATUS[a.status as keyof typeof STATUS] ?? STATUS.CONFIRMED;
                  return (
                    <button
                      key={a.id}
                      onClick={() => onOpenDetail(a)}
                      className="absolute inset-x-0.5 overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-left text-[10px] shadow-sm transition hover:shadow-md"
                      style={{ top, height, borderLeftColor: cfg.color, background: `${cfg.color}1f` }}
                    >
                      <p className="truncate font-semibold">{format(new Date(a.startAt), "HH:mm")} {a.clientName.split(" ")[0]}</p>
                      {height > 30 && <p className="truncate text-muted-foreground">{a.serviceName}</p>}
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
  dateObj,
  appointments,
  today,
  onOpenDay,
  onOpenDetail,
}: {
  dateObj: Date;
  appointments: Appointment[];
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
    const k = ymd(new Date(a.startAt));
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(a);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="grid grid-cols-7 border-b border-border bg-surface-1">
        {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((d) => (
          <div key={d} className="py-2 text-center text-[11px] font-medium text-muted-foreground">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
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
                onClick={() => onOpenDay(dStr)}
                className={`mb-1 grid h-6 w-6 place-items-center rounded-full text-[11px] transition hover:bg-card-hover ${
                  isToday ? "bg-primary font-semibold text-primary-foreground" : inMonth ? "text-foreground" : "text-muted-foreground/50"
                }`}
              >
                {format(day, "d")}
              </button>
              <div className="space-y-0.5">
                {dayAppts.slice(0, 3).map((a) => {
                  const cfg = STATUS[a.status as keyof typeof STATUS] ?? STATUS.CONFIRMED;
                  return (
                    <button
                      key={a.id}
                      onClick={() => onOpenDetail(a)}
                      className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[10px] transition hover:bg-card-hover"
                      style={{ background: `${cfg.color}14` }}
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: cfg.color }} />
                      <span className="truncate">{format(new Date(a.startAt), "HH:mm")} {a.clientName.split(" ")[0]}</span>
                    </button>
                  );
                })}
                {dayAppts.length > 3 && (
                  <button onClick={() => onOpenDay(dStr)} className="px-1 text-[10px] text-muted-foreground hover:text-foreground">
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
  onOpenDetail,
}: {
  appointments: Appointment[];
  professionals: Professional[];
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
        const dayKey = ymd(new Date(a.startAt));
        const showDay = dayKey !== lastDay;
        lastDay = dayKey;
        return (
          <div key={a.id}>
            {showDay && (
              <div className="border-b border-border bg-surface-1 px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {format(new Date(a.startAt), "EEEE, d 'de' MMMM", { locale: ptBR })}
              </div>
            )}
            <button
              onClick={() => onOpenDetail(a)}
              className="flex w-full items-center gap-4 border-b border-border px-4 py-3 text-left transition last:border-0 hover:bg-card-hover"
            >
              <div className="w-14 shrink-0 text-center">
                <p className="text-sm font-semibold">{format(new Date(a.startAt), "HH:mm")}</p>
                <p className="text-[10px] text-muted-foreground">{format(new Date(a.endAt), "HH:mm")}</p>
              </div>
              <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: cfg.color }} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{a.clientName}</p>
                <p className="truncate text-[12px] text-muted-foreground">
                  {a.serviceName}{pro ? ` · ${pro.name.split(" ")[0]}` : ""}
                </p>
              </div>
              <span className="hidden shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline" style={{ background: `${cfg.color}22`, color: cfg.color }}>
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

function ViewBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof List; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function FilterChip({ active, onClick, children, icon: Icon, dot }: { active: boolean; onClick: () => void; children: React.ReactNode; icon?: typeof Users; dot?: string }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${
        active ? "border-primary/40 bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
      }`}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {dot && <span className="h-2 w-2 rounded-full" style={{ background: dot }} />}
      {children}
    </button>
  );
}

function DayKpi({ icon: Icon, accent, label, value }: { icon: typeof Clock; accent: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: `${accent}1f`, color: accent }}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-lg font-semibold leading-none tracking-tight">{value}</p>
        <p className="mt-1 truncate text-[11px] text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
