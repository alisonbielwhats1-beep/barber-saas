"use client";

import { useEffect, useId, useRef, useState } from "react";
import { addDays, addMonths, eachDayOfInterval, format, isSameMonth, parseISO, startOfMonth, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";

const dateKey = (date: Date) => format(date, "yyyy-MM-dd");
const civilDate = (date: string) => parseISO(`${date}T12:00:00`);

/** Civil dates are supplied in the salon timezone; browsing does not mutate bookings. */
export function DateNavigator({ date, today, onSelect }: { date: string; today: string; onSelect: (date: string) => void }) {
  const [month, setMonth] = useState(() => startOfMonth(civilDate(date)));
  const [focused, setFocused] = useState(date);
  const root = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const titleId = useId();
  useEffect(() => { setMonth(startOfMonth(civilDate(date))); setFocused(date); }, [date]);
  useEffect(() => {
    if (restoreFocus.current) {
      root.current?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)?.focus();
      restoreFocus.current = false;
    }
  }, [focused]);
  const first = startOfWeek(month, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: first, end: addDays(first, 41) });

  function browse(offset: number) {
    const next = addMonths(month, offset);
    setMonth(next);
    setFocused(dateKey(next));
  }
  function keyboard(event: React.KeyboardEvent, day: Date) {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let next: Date;
    if (event.key in offsets) next = addDays(day, offsets[event.key]!);
    else if (event.key === "Home") next = startOfWeek(day, { weekStartsOn: 1 });
    else if (event.key === "End") next = addDays(startOfWeek(day, { weekStartsOn: 1 }), 6);
    else if (event.key === "PageUp" || event.key === "PageDown") next = addMonths(day, event.key === "PageUp" ? -1 : 1);
    else return;
    event.preventDefault();
    restoreFocus.current = true;
    setMonth(startOfMonth(next));
    setFocused(dateKey(next));
  }

  return (
    <div ref={root} role="region" aria-label="Calendário lateral" className="rounded-xl border border-border bg-card p-2.5 [[role=dialog]_&]:border-0 [[role=dialog]_&]:bg-transparent [[role=dialog]_&]:p-0">
      <div className="mb-1.5 flex items-center justify-between gap-1">
        <button type="button" aria-label="Mês anterior no calendário" onClick={() => browse(-1)} className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] text-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:h-8 xl:w-8 xl:rounded-lg"><ChevronLeft aria-hidden="true" size={16} /></button>
        <h2 id={titleId} aria-live="polite" className="min-w-0 truncate text-center text-sm font-semibold capitalize">{format(month, "MMMM yyyy", { locale: ptBR })}</h2>
        <button type="button" aria-label="Próximo mês no calendário" onClick={() => browse(1)} className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] text-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:h-8 xl:w-8 xl:rounded-lg"><ChevronRight aria-hidden="true" size={16} /></button>
      </div>
      <div aria-hidden="true" className="grid grid-cols-7 text-center text-xs text-muted-foreground">
        {["S", "T", "Q", "Q", "S", "S", "D"].map((day, index) => <span key={index} className="py-1">{day}</span>)}
      </div>
      <div role="group" aria-labelledby={titleId} className="grid grid-cols-7 gap-px">
        {days.map(day => {
          const key = dateKey(day);
          const selected = key === date;
          return <button key={key} type="button" data-date={key} tabIndex={focused === key ? 0 : -1}
            aria-label={format(day, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
            aria-pressed={selected} aria-current={key === today ? "date" : undefined}
            onKeyDown={event => keyboard(event, day)} onClick={() => onSelect(key)}
            className={`relative grid h-11 min-w-0 place-items-center rounded-full text-xs tabular-nums transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:h-[26px] ${selected ? "bg-primary font-semibold text-primary-foreground" : `${isSameMonth(day, month) ? "text-foreground" : "text-muted-foreground"} hover:bg-card-hover ${key === today ? "ring-1 ring-inset ring-[hsl(var(--selection-solid))]" : ""}`}`}>
            {format(day, "d")}
          </button>;
        })}
      </div>
      <button type="button" onClick={() => onSelect(today)} className="mt-1 min-h-11 w-full rounded-lg px-2 text-xs font-semibold text-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:min-h-[30px]">Voltar para hoje</button>
      <div className="mt-2 border-t border-border pt-2">
        <p className="mb-1.5 text-xs font-semibold">Pular semanas</p>
        <div className="grid grid-cols-3 gap-1">
          {[1, 2, 3, -1, -2, -3].map(offset => <button key={offset} type="button" aria-label={`${offset > 0 ? "Avançar" : "Voltar"} ${Math.abs(offset)} ${Math.abs(offset) === 1 ? "semana" : "semanas"}`} onClick={() => onSelect(dateKey(addDays(civilDate(date), offset * 7)))} className="min-h-11 rounded-lg text-xs font-medium tabular-nums text-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:min-h-7">{offset > 0 ? "+" : ""}{offset}</button>)}
        </div>
      </div>
    </div>
  );
}
