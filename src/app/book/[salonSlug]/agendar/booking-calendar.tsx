"use client";

import { useMemo, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";

/**
 * `available`: clicável; `waitlist`: lotado, clicável para entrar na fila;
 * `closed`: sem atendimento possível, desativado.
 */
export type CalendarDayState = "available" | "waitlist" | "closed";

const WEEKDAYS = [
  ["S", "segunda-feira"],
  ["T", "terça-feira"],
  ["Q", "quarta-feira"],
  ["Q", "quinta-feira"],
  ["S", "sexta-feira"],
  ["S", "sábado"],
  ["D", "domingo"],
] as const;

/** Calendário mensal do agendamento do cliente (um serviço ou visita completa). */
export function BookingCalendar({
  todayDate,
  maxDateKey,
  selected,
  viewMonth,
  onViewMonthChange,
  dayState,
  onSelect,
  children,
}: {
  todayDate: string;
  maxDateKey: string;
  selected: Date;
  viewMonth: Date;
  onViewMonthChange: (month: Date) => void;
  dayState: (dateKey: string) => CalendarDayState;
  onSelect: (day: Date) => void;
  children?: ReactNode;
}) {
  const calendarDays = useMemo(() => {
    const first = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
    const last = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: first, end: last });
  }, [viewMonth]);

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onViewMonthChange(addMonths(viewMonth, -1))}
          disabled={format(viewMonth, "yyyy-MM") <= todayDate.slice(0, 7)}
          className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:text-foreground disabled:opacity-30"
          aria-label="Mês anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-sm font-medium">
          <span className="text-muted-foreground">{format(viewMonth, "yyyy")}</span>{" "}
          <span className="text-primary">
            {format(viewMonth, "MMMM", { locale: ptBR })}
          </span>
        </p>
        <button
          type="button"
          onClick={() => onViewMonthChange(addMonths(viewMonth, 1))}
          disabled={format(addMonths(viewMonth, 1), "yyyy-MM-dd") > maxDateKey}
          className="grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:text-foreground disabled:opacity-30"
          aria-label="Próximo mês"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
        {WEEKDAYS.map(([shortLabel, fullLabel]) => (
          <span key={fullLabel} className="py-1">
            <span aria-hidden="true">{shortLabel}</span>
            <span className="sr-only">{fullLabel}</span>
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {calendarDays.map((d) => {
          const inMonth = isSameMonth(d, viewMonth);
          const dateKey = format(d, "yyyy-MM-dd");
          const past = dateKey < todayDate;
          const beyondWindow = dateKey > maxDateKey;
          const isSelected = isSameDay(d, selected);
          const inWindow = inMonth && !past && !beyondWindow;
          const state = inWindow ? dayState(dateKey) : "available";
          const waitlistOnly = state === "waitlist";
          const noAvailability = state === "closed";
          const disabled = !inWindow || noAvailability;
          return (
            <button
              type="button"
              key={d.toISOString()}
              disabled={disabled}
              onClick={() => onSelect(d)}
              aria-label={`${format(d, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}${
                waitlistOnly ? ", lotado, só fila de espera" : noAvailability ? ", sem horários" : ""
              }`}
              aria-pressed={isSelected}
              aria-current={dateKey === todayDate ? "date" : undefined}
              className={`relative grid h-11 place-items-center rounded-full text-sm transition ${
                isSelected
                  ? "bg-primary font-semibold text-primary-foreground"
                  : disabled
                    ? "text-muted-foreground/30"
                    : "text-foreground hover:bg-muted"
              }`}
            >
              {format(d, "d")}
              {waitlistOnly && (
                <span aria-hidden="true" className="absolute bottom-1 h-1 w-1 rounded-full bg-warning" />
              )}
            </button>
          );
        })}
      </div>
      {children}
    </div>
  );
}
