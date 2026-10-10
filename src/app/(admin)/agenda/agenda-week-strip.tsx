"use client";

import { addDays, format, parseISO, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";

const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** Week of the selected day: a card on the computer ("SEG 5" in one line), a strip of stacked days on the phone. Today has a lilac dot. */
export function AgendaWeekStrip({ date, today, onSelect }: { date: string; today: string; onSelect: (date: string) => void }) {
  const start = startOfWeek(parseISO(`${date}T12:00:00`), { weekStartsOn: 0 });
  return <nav aria-label="Dias da semana da agenda" className="grid shrink-0 grid-cols-7 gap-0.5 sm:rounded-[10px] sm:border sm:border-border sm:bg-card sm:p-0.5">
    {Array.from({ length: 7 }, (_, index) => {
      const day = addDays(start, index);
      const key = format(day, "yyyy-MM-dd");
      return <button key={key} type="button" onClick={() => onSelect(key)} aria-label={format(day, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })} aria-pressed={date === key} aria-current={today === key ? "date" : undefined} className="relative flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-[10px] text-xs font-medium uppercase tracking-[.02em] text-muted-foreground transition-colors hover:bg-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:text-foreground aria-pressed:ring-1 aria-pressed:ring-inset aria-pressed:ring-border-strong sm:min-h-9 sm:flex-row sm:gap-1.5 sm:rounded-lg">
        <span>{WEEKDAYS[index]}</span>
        <span className="text-sm font-semibold normal-case tracking-normal text-foreground tabular-nums">{format(day, "d")}</span>
        {today === key && <span aria-hidden="true" className="absolute bottom-1 h-1 w-1 rounded-full bg-[hsl(var(--selection-solid))] sm:static" />}
      </button>;
    })}
  </nav>;
}
