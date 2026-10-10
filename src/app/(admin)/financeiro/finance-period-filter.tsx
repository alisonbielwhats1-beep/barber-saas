"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { addCalendarDays, isDateKey } from "@/lib/time";
import type { FinanceCalendarPeriod } from "@/lib/finance-period";
import { cn } from "@/lib/utils";

const arrow = "grid h-11 w-11 shrink-0 place-items-center rounded-[10px] border border-border-strong text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 lg:h-9 lg:w-9 lg:rounded-[9px]";

/**
 * Filtro do Financeiro no desenho do protótipo: trilho Dia / Semana / Mês, setas e o botão de período
 * com calendário. O botão é o próprio campo de data de referência (o calendário do sistema), com os
 * mesmos parâmetros de antes (period e date na URL).
 */
export function FinancePeriodFilter({ mode, date, label, buttonLabel }: { mode: FinanceCalendarPeriod["mode"] | null; date: string; label: string; buttonLabel?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  function select(nextMode: FinanceCalendarPeriod["mode"], nextDate = date) {
    if (!isDateKey(nextDate)) return;
    const query = new URLSearchParams(params);
    query.delete("range");
    query.set("period", nextMode);
    query.set("date", nextDate);
    startTransition(() => router.push(`${pathname}?${query}`, { scroll: false }));
  }
  function move(direction: number) {
    if (mode === "month") {
      const first = `${date.slice(0, 7)}-01`;
      const shifted = addCalendarDays(first, direction < 0 ? -1 : 32);
      select("month", `${shifted.slice(0, 7)}-01`);
    } else select(mode ?? "day", addCalendarDays(date, direction * (mode === "week" ? 7 : 1)));
  }
  return <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:justify-end lg:gap-2.5" aria-busy={pending}>
    <div role="group" aria-label="Período financeiro" className="flex gap-[3px] rounded-[11px] border border-border-strong bg-card p-[3px] lg:rounded-[10px]">
      {([['day','Dia'],['week','Semana'],['month','Mês']] as const).map(([value, title]) => <button type="button" key={value} disabled={pending} onClick={() => select(value)} aria-pressed={mode === value}
        className={cn("min-h-11 flex-1 whitespace-nowrap rounded-[8px] px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60 lg:min-h-[30px] lg:flex-none lg:rounded-[7px]",
          mode === value ? "bg-[hsl(var(--border))] font-semibold text-foreground ring-1 ring-inset ring-border-strong" : "font-medium text-muted-foreground hover:text-foreground")}>{title}</button>)}
    </div>
    <div className="flex min-w-0 items-center gap-1.5">
      <button type="button" disabled={pending} onClick={() => move(-1)} aria-label="Período anterior" className={arrow}><ChevronLeft aria-hidden="true" className="h-4 w-4" /></button>
      <label className="relative flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[10px] border border-border-strong bg-card px-2.5 text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-card-hover lg:min-h-9 lg:w-44 lg:flex-none lg:rounded-[9px]">
        {pending ? <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" /> : <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <span aria-hidden="true" className="min-w-0 flex-1 truncate tabular-nums">{buttonLabel ?? label}</span>
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input type="date" aria-label="Data de referência" value={date} disabled={pending} onChange={e => select(mode ?? "day", e.target.value)}
          onClick={e => { try { (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* o navegador abre o próprio calendário */ } }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      </label>
      <button type="button" disabled={pending} onClick={() => move(1)} aria-label="Próximo período" className={arrow}><ChevronRight aria-hidden="true" className="h-4 w-4" /></button>
    </div>
    <p className="sr-only" role="status">{label}</p>
  </div>;
}
