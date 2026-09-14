import Link from "next/link";
import { ArrowUpRight, Crown } from "lucide-react";

export function PlanShortcut({
  plan,
  href,
  compact = false,
}: {
  plan: string | null;
  href: string;
  compact?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label={plan ? `Plano atual: ${plan}. Alterar plano` : "Ativar plano"}
      title={plan ? `${plan} · Alterar plano` : "Ativar plano"}
      className={`inline-flex min-h-11 max-w-full items-center rounded-full bg-amber-300 text-slate-950 shadow-sm transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${compact ? "w-full min-w-0 gap-2 px-3 py-1" : "gap-3 px-4 py-2"}`}
    >
      <Crown className="h-5 w-5 shrink-0" aria-hidden="true" />
      {plan ? (
        compact ? (
          <span className="min-w-0 text-left leading-4">
            <span className="block truncate text-xs font-semibold">{plan}</span>
            <span className="block whitespace-nowrap text-xs font-medium">
              Alterar plano
            </span>
          </span>
        ) : (
          <>
            <span className="truncate text-sm font-semibold">{plan}</span>
            <span
              aria-hidden="true"
              className="h-4 w-px shrink-0 bg-slate-950/20"
            />
            <span className="shrink-0 text-xs font-semibold">
              Alterar plano
            </span>
          </>
        )
      ) : (
        <span className="text-xs font-semibold sm:text-sm">Ativar plano</span>
      )}
      {!compact && (
        <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}
    </Link>
  );
}
