import Link from "next/link";
import { ArrowUpRight, Crown } from "lucide-react";

export function PlanShortcut({ plan, href }: { plan: string | null; href: string }) {
  return (
    <Link
      href={href}
      aria-label={plan ? `Plano atual: ${plan}. Alterar plano` : "Ativar plano"}
      className="inline-flex min-h-11 max-w-full items-center gap-3 rounded-full bg-amber-300 px-4 py-2 text-slate-950 shadow-sm transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Crown className="h-5 w-5 shrink-0" aria-hidden="true" />
      {plan ? <><span className="truncate text-sm font-semibold">{plan}</span><span aria-hidden="true" className="h-4 w-px shrink-0 bg-slate-950/20" /><span className="shrink-0 text-xs font-semibold">Alterar plano</span></> : <span className="text-sm font-semibold">Ativar plano</span>}
      <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />
    </Link>
  );
}
