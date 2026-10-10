import Link from "next/link";
import { AlertTriangle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CreditView } from "@/lib/secretary-credits-rules";

/** Owner decisions 06/10/2026: the customer sees only a bar and a percentage of the Secretária's credit (no amounts, no number
 * of requests, no days); a warning below 20%, and with nothing left it stops (the agenda keeps working). Only the owner
 * recharges. Prototype v6 (08/10/2026): the bar is the Secretária's lilac while there is credit, amber below 20%, red when over. */
const tone = { OK: "bg-[hsl(var(--selection-solid))]", LOW: "bg-warning", EMPTY: "bg-danger" } as const;

/** The compact bar at the top of the chat. */
export function CreditsMeter({ view, className }: { view: CreditView; className?: string }) {
  return <div className={cn("sec-meter flex h-11 shrink-0 items-center gap-2 rounded-[10px] border border-border-strong px-2.5 lg:h-8", className)}>
    <div role="progressbar" aria-label="Crédito restante da Secretária" aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.percent}
      className="sec-meter-track h-[5px] w-11 overflow-hidden rounded-full bg-border-strong">
      <div className={cn("h-full rounded-full transition-[width]", tone[view.status])} style={{ width: `${view.percent}%` }} />
    </div>
    <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{view.percent}%</span>
  </div>;
}

/** The notice under the conversation when the credit is low or over (nothing at OK). */
export function CreditsNotice({ view, canRecharge }: { view: CreditView; canRecharge: boolean }) {
  if (view.status === "OK") return null;
  const empty = view.status === "EMPTY";
  const Icon = empty ? XCircle : AlertTriangle;
  const text = empty ? "O crédito da Secretária acabou. A agenda segue normal." : "O crédito da Secretária está acabando.";
  return <div role={empty ? "alert" : "status"} className={cn("flex items-center gap-2.5 rounded-[12px] border py-1 pl-3 pr-1 text-sm",
    empty ? "border-danger/40 bg-danger/10" : "border-warning/40 bg-warning/10")}>
    <Icon aria-hidden="true" className={cn("h-4 w-4 shrink-0", empty ? "text-danger" : "text-warning")} />
    <p className="min-w-0 flex-1 py-1.5">{text}{" "}
      {!canRecharge && <span className="block text-muted-foreground">Peça ao dono para recarregar.</span>}</p>
    {canRecharge && <Link href="/assinatura#secretaria" className="inline-flex min-h-11 shrink-0 items-center rounded-[10px] px-2 font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:min-h-8">Recarregar</Link>}
  </div>;
}
