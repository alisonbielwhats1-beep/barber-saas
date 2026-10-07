import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Empty list or screen: one icon in a soft disc, a short title, an optional
 * hint and an optional next step. Same look in every panel list.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-2xl border border-dashed border-border text-center",
        compact ? "gap-2 px-5 py-7" : "gap-3 px-6 py-10",
        className,
      )}
    >
      <span className={cn("grid place-items-center rounded-full bg-primary/10 text-primary", compact ? "h-11 w-11" : "h-14 w-14")}>
        <Icon aria-hidden="true" className={compact ? "h-5 w-5" : "h-6 w-6"} strokeWidth={1.8} />
      </span>
      <div className="max-w-xs space-y-1">
        <p className="text-[15px] font-semibold">{title}</p>
        {description && <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
