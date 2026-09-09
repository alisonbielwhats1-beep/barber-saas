"use client";

import { WEEKDAY_LABELS } from "@/lib/team-schedule";

export function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  return <fieldset className="space-y-2">
    <legend className="mb-2 text-sm font-medium">Dias da semana</legend>
    <div className="flex flex-wrap gap-2">
      {[["Todos os dias", [0, 1, 2, 3, 4, 5, 6]], ["Segunda a sexta", [1, 2, 3, 4, 5]], ["Sábado e domingo", [0, 6]]].map(([label, days]) => <button key={String(label)} type="button" className="min-h-11 rounded-full border border-border px-3 text-xs hover:bg-muted" onClick={() => onChange(days as number[])}>{String(label)}</button>)}
    </div>
    <div className="flex flex-wrap gap-1">{[1, 2, 3, 4, 5, 6, 0].map(day => <button key={day} type="button" aria-label={WEEKDAY_LABELS[day]} aria-pressed={value.includes(day)} className={`min-h-11 min-w-11 rounded-full border px-2 text-xs font-medium ${value.includes(day) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`} onClick={() => onChange(value.includes(day) ? value.filter(d => d !== day) : [...value, day].sort())}>{WEEKDAY_LABELS[day].slice(0, 3)}</button>)}</div>
  </fieldset>;
}
