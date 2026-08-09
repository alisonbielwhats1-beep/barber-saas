import Link from "next/link";
import { cn } from "@/lib/utils";

export function ProductWordmark({
  href = "/",
  className,
  compact = false,
}: {
  href?: string;
  className?: string;
  compact?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label="SalonSaaS"
      className={cn(
        "group inline-flex min-h-11 items-center rounded-lg font-semibold tracking-[-0.035em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        compact ? "text-[15px]" : "text-xl",
        className,
      )}
    >
      <span>Salon</span>
      <span className="experience-accent-text text-primary">SaaS</span>
      <span
        aria-hidden="true"
        className="experience-accent-bg ml-1.5 h-1.5 w-1.5 rounded-full transition-transform duration-200 group-hover:scale-125"
      />
    </Link>
  );
}
