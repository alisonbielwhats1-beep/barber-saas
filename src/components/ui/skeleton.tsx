import { cn } from "@/lib/utils";

/** Placeholder block for loading screens. Decorative: the wrapper announces "Carregando". */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-shimmer rounded-xl", className)} />;
}

/** A list row placeholder: avatar, two text lines and a trailing chevron area. */
export function SkeletonRow({ avatar = true }: { avatar?: boolean }) {
  return (
    <div aria-hidden="true" className="flex items-center gap-3 py-3">
      {avatar && <Skeleton className="h-11 w-11 shrink-0 rounded-full" />}
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3.5 w-2/5 rounded-md" />
        <Skeleton className="h-3 w-3/5 rounded-md" />
      </div>
      <Skeleton className="h-4 w-4 shrink-0 rounded" />
    </div>
  );
}
