"use client";
import { useId, useState, type ReactNode } from "react";
import { SlidersHorizontal, ChevronDown } from "lucide-react";

export function MobileListTools({ children, label = "Filtros" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div className="contents">
    <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium md:hidden">
      <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />{label}
    </button>
    <div id={id} className={`${open ? "flex" : "hidden"} w-full min-w-0 flex-wrap items-center gap-2 md:contents`}>{children}</div>
  </div>;
}

export function MobilePerformance({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div>
    <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="mt-2 flex min-h-11 w-full items-center justify-between text-xs font-medium text-muted-foreground md:hidden">Desempenho<ChevronDown aria-hidden="true" className={`h-4 w-4 ${open ? "rotate-180" : ""}`} /></button>
    <div id={id} className={`${open ? "block" : "hidden"} md:block`}>{children}</div>
  </div>;
}
