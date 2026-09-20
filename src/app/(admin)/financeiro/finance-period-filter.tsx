"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addCalendarDays, isDateKey } from "@/lib/time";
import type { FinanceCalendarPeriod } from "@/lib/finance-period";

export function FinancePeriodFilter({ mode, date, label }: { mode: FinanceCalendarPeriod["mode"] | null; date: string; label: string }) {
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
  return <div className="min-w-0 space-y-2" aria-busy={pending}>
    <div role="group" aria-label="Período financeiro" className="flex gap-2">
      {([['day','Dia'],['week','Semana'],['month','Mês']] as const).map(([value, title]) => <button type="button" key={value} disabled={pending} onClick={() => select(value)} aria-pressed={mode === value} className={`min-h-9 flex-1 rounded-full border px-3 text-xs font-medium ${mode === value ? "border-transparent bg-primary text-primary-foreground" : "border-border text-muted-foreground"}`}>{title}</button>)}
    </div>
    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-surface-1 px-1">
      <button type="button" disabled={pending} onClick={() => move(-1)} aria-label="Período anterior" className="grid h-11 w-11 shrink-0 place-items-center"><ChevronLeft className="h-4 w-4" /></button>
      <input type="date" aria-label="Data de referência" value={date} disabled={pending} onChange={e => select(mode ?? "day", e.target.value)} className="min-h-11 min-w-0 w-full flex-1 bg-transparent text-center text-sm" />
      <button type="button" disabled={pending} onClick={() => move(1)} aria-label="Próximo período" className="grid h-11 w-11 shrink-0 place-items-center"><ChevronRight className="h-4 w-4" /></button>
    </div>
    <p className="text-center text-xs text-muted-foreground" role="status">{label}</p>
  </div>;
}
