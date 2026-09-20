"use client";
import { useId, useState, type ReactNode } from "react";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { SlidersHorizontal, ChevronDown } from "lucide-react";

export function MobileListTools({ children, label = "Filtros" }: { children: ReactNode; label?: string }) {
  return <Dialog>
    <DialogTrigger asChild><button type="button" aria-label={label} title={label} className="admin-list-tools-trigger grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"><SlidersHorizontal aria-hidden className="h-4 w-4" /></button></DialogTrigger>
    <DialogContent aria-describedby={undefined} className="max-h-[85dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>{label}</DialogTitle></DialogHeader>
      <div className="flex min-w-0 flex-wrap items-center gap-3">{children}</div>
      <DialogClose asChild><button type="button" className="min-h-11 rounded-lg bg-primary px-4 font-semibold text-primary-foreground">Aplicar filtros</button></DialogClose>
    </DialogContent>
  </Dialog>;
}

export function MobilePerformance({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div>
    <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="mt-2 flex min-h-11 w-full items-center justify-between text-xs font-medium text-muted-foreground md:hidden">Desempenho<ChevronDown aria-hidden="true" className={`h-4 w-4 ${open ? "rotate-180" : ""}`} /></button>
    <div id={id} className={`${open ? "block" : "hidden"} md:block`}>{children}</div>
  </div>;
}
