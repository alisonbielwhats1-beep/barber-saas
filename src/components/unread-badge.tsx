import { cn } from "@/lib/utils";
import { unreadCountLabel } from "@/lib/notification-ui";

export function UnreadBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  if (count <= 0) return null;

  return (
    <span
      aria-label={`${count} ${count === 1 ? "notificação não lida" : "notificações não lidas"}`}
      className={cn(
        "inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-destructive-foreground shadow-sm ring-2 ring-background",
        className,
      )}
    >
      {unreadCountLabel(count)}
    </span>
  );
}
