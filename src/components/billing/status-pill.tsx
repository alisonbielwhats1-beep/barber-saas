import { cn } from "@/lib/utils";
import type { BillingTone } from "@/lib/billing/presentation";

// Prototype v6: "em dia" reads as a plain confirmed badge; amber and red keep their meaning; neutral stays muted.
const tones: Record<BillingTone, string> = {
  ok: "bg-muted text-foreground",
  warn: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
  neutral: "bg-muted text-muted-foreground",
};
const dots: Record<BillingTone, string> = { ok: "bg-foreground", warn: "bg-warning", danger: "bg-danger", neutral: "bg-muted-foreground" };

export function StatusPill({ label, tone, className, ...props }: { label: string; tone: BillingTone } & React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("inline-flex min-h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium", tones[tone], className)} {...props}>
    <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", dots[tone])} />{label}
  </span>;
}
