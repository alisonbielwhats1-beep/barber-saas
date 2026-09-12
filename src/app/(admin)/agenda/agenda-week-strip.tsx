"use client";

import { addDays, format, parseISO, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";

export function AgendaWeekStrip({ date, today, onSelect }: { date: string; today: string; onSelect: (date: string) => void }) {
  const start = startOfWeek(parseISO(`${date}T12:00:00`), { weekStartsOn: 0 });
  return <nav aria-label="Dias da semana da agenda" className="grid shrink-0 grid-cols-7 rounded-xl border border-border bg-card p-1">
    {Array.from({ length: 7 }, (_, index) => {
      const day = addDays(start, index);
      const key = format(day, "yyyy-MM-dd");
      return <button key={key} type="button" onClick={() => onSelect(key)} aria-label={format(day, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })} aria-pressed={date === key} aria-current={today === key ? "date" : undefined} className="flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-lg hover:bg-card-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
        <span className="text-[10px] uppercase text-muted-foreground">{["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."][index]}</span>
        <span className={`grid h-7 w-7 place-items-center rounded-full text-sm font-semibold ${date === key ? "bg-primary text-primary-foreground" : today === key ? "text-primary ring-1 ring-primary" : ""}`}>{format(day, "d")}</span>
      </button>;
    })}
  </nav>;
}
