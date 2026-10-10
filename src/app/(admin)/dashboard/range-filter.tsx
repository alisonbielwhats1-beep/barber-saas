"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { RANGE_LABELS, type RangeKey } from "@/lib/dashboard";
import { SelectSheet } from "@/components/ui/select-sheet";

const ORDER: RangeKey[] = ["today", "yesterday", "7d", "15d", "30d", "90d", "year"];

export function RangeFilter({ current, compact = false, clearCalendar = false }: { current: RangeKey; compact?: boolean; clearCalendar?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function select(range: RangeKey) {
    const sp = new URLSearchParams(params);
    sp.set("range", range);
    if (clearCalendar) { sp.delete("period"); sp.delete("date"); }
    startTransition(() => router.push(`${pathname}?${sp}`, { scroll: false }));
  }

  if (compact) return <div className="flex min-h-11 w-full items-center gap-2 rounded-[10px] border border-border-strong bg-card px-3 lg:min-h-10">
    <SelectSheet aria-label="Período" title="Período" value={current} disabled={pending} onValueChange={value => select(value as RangeKey)}
      options={ORDER.map(range => ({ value: range, label: RANGE_LABELS[range] }))} className="min-h-11 w-full bg-transparent text-center text-sm font-medium lg:min-h-10" />
    {pending && <Loader2 className="h-4 w-4 animate-spin" aria-label="Atualizando período" />}
  </div>;

  // Trilho de períodos do protótipo. No celular as opções quebram em linhas (todas à vista);
  // no computador ficam numa linha que rola por dentro se faltar espaço.
  return (
    <div className="flex min-w-0 max-w-full items-center gap-2 max-lg:w-full">
      <div
        role="group"
        aria-label="Período"
        className="flex min-w-0 max-w-full gap-[3px] rounded-[11px] border border-border-strong bg-card p-[3px] [scrollbar-width:none] max-lg:flex-1 max-lg:flex-wrap lg:overflow-x-auto lg:rounded-[10px] [&::-webkit-scrollbar]:hidden"
      >
        {ORDER.map((r) => {
          const active = r === current;
          return (
            <button
              key={r}
              type="button"
              onClick={() => select(r)}
              aria-pressed={active}
              disabled={pending && !active}
              className={cn(
                "min-h-11 shrink-0 whitespace-nowrap rounded-[8px] px-3 text-sm transition-colors max-lg:flex-[1_1_auto] lg:min-h-[30px] lg:rounded-[7px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60",
                active
                  ? "bg-[hsl(var(--border))] font-semibold text-foreground ring-1 ring-inset ring-border-strong"
                  : "font-medium text-muted-foreground hover:text-foreground",
              )}
            >
              {RANGE_LABELS[r]}
            </button>
          );
        })}
      </div>
      {pending && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-label="Atualizando período" />}
    </div>
  );
}
