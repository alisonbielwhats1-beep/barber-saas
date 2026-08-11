"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { RANGE_LABELS, type RangeKey } from "@/lib/dashboard";

const ORDER: RangeKey[] = ["today", "yesterday", "7d", "15d", "30d", "90d", "year"];

export function RangeFilter({ current }: { current: RangeKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function select(range: RangeKey) {
    const sp = new URLSearchParams(params);
    sp.set("range", range);
    startTransition(() => router.push(`${pathname}?${sp}`, { scroll: false }));
  }

  return (
    <div className="flex min-w-0 max-w-full items-center gap-2">
      {pending && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" aria-label="Atualizando período" />}
      <div className="scrollbar-dark flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-border bg-surface-1 p-1">
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
                 "min-h-11 shrink-0 whitespace-nowrap rounded-full px-3 text-[12px] font-medium transition-colors disabled:opacity-60",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-card-hover hover:text-foreground",
              )}
            >
              {RANGE_LABELS[r]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
