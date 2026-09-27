import { cn } from "@/lib/utils";
import type { BillingTone } from "@/lib/billing/presentation";

const tones: Record<BillingTone, string> = {
  ok: "bg-success/15 text-success",
  warn: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
  neutral: "bg-muted text-muted-foreground",
};
const dots: Record<BillingTone, string> = { ok: "bg-success", warn: "bg-warning", danger: "bg-danger", neutral: "bg-muted-foreground" };

export function StatusPill({ label, tone, className, ...props }: { label: string; tone: BillingTone } & React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", tones[tone], className)} {...props}>
    <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", dots[tone])} />{label}
  </span>;
}
