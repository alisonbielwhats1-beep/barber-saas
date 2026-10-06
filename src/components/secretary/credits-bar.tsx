import Link from "next/link";
import { AlertTriangle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CreditView } from "@/lib/secretary-credits-rules";

/** Owner decisions 06/10/2026: the customer sees only a bar and a percentage of the Secretária's credit (no amounts, no number
 * of requests, no days); green down to 20%, then a warning, and with nothing left it stops (the agenda keeps working). Only the
 * owner recharges. */
const tone = { OK: "bg-success", LOW: "bg-warning", EMPTY: "bg-danger" } as const;

/** The compact bar at the top of the chat. */
export function CreditsMeter({ view, className }: { view: CreditView; className?: string }) {
  return <div className={cn("flex items-center gap-2", className)}>
    <div role="progressbar" aria-label="Crédito restante da Secretária" aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.percent}
      className="h-1.5 w-20 overflow-hidden rounded-full bg-border sm:w-28">
      <div className={cn("h-full rounded-full transition-[width]", tone[view.status])} style={{ width: `${view.percent}%` }} />
    </div>
    <span className="whitespace-nowrap text-xs text-muted-foreground">{view.percent}%</span>
  </div>;
}

/** The notice under the conversation when the credit is low or over (nothing at OK). */
export function CreditsNotice({ view, canRecharge }: { view: CreditView; canRecharge: boolean }) {
  if (view.status === "OK") return null;
  const empty = view.status === "EMPTY";
  const Icon = empty ? XCircle : AlertTriangle;
  const text = empty ? "O crédito da Secretária acabou. A agenda segue normal." : "O crédito da Secretária está acabando.";
  return <div role={empty ? "alert" : "status"} className={cn("flex items-start gap-2 rounded-lg border p-2 text-sm",
    empty ? "border-danger/40 bg-danger/10" : "border-warning/40 bg-warning/10")}>
    <Icon aria-hidden="true" className={cn("mt-0.5 h-4 w-4 shrink-0", empty ? "text-danger" : "text-warning")} />
    <p className="min-w-0 flex-1">{text}{" "}
      {canRecharge ? <Link href="/assinatura#secretaria" className="font-medium underline underline-offset-2">Recarregar</Link>
        : <span className="text-muted-foreground">Peça ao dono para recarregar.</span>}</p>
  </div>;
}
