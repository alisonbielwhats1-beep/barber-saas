import Link from "next/link";
import { AlertTriangle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CreditView } from "@/lib/secretary-credits-rules";

/** Owner decisions 06/10/2026: the Secretária's balance is shown in requests (pedidos), never in money, to everyone who uses it;
 * green down to 20%, then a warning, and at zero it stops (the agenda keeps working). Only the owner recharges. */
const tone = { OK: "bg-success", LOW: "bg-warning", EMPTY: "bg-danger" } as const;
/** Never a negative count on screen (a balance of -1 reads "0 pedidos"). */
export const requestsLabel = (n: number) => { const shown = Math.max(n, 0); return `${shown} ${shown === 1 ? "pedido" : "pedidos"}`; };

/** The compact bar at the top of the chat. */
export function CreditsMeter({ view, className }: { view: CreditView; className?: string }) {
  return <div className={cn("flex items-center gap-2", className)} title={`${view.percent}% dos pedidos restantes`}>
    <div role="progressbar" aria-label="Pedidos restantes da Secretária" aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.percent}
      className="h-1.5 w-20 overflow-hidden rounded-full bg-border sm:w-28">
      <div className={cn("h-full rounded-full transition-[width]", tone[view.status])} style={{ width: `${view.percent}%` }} />
    </div>
    <span className="whitespace-nowrap text-xs text-muted-foreground">{requestsLabel(view.balance)}</span>
  </div>;
}

/** The notice under the conversation when the balance is low or over (nothing at OK). */
export function CreditsNotice({ view, canRecharge }: { view: CreditView; canRecharge: boolean }) {
  if (view.status === "OK") return null;
  const empty = view.status === "EMPTY";
  const Icon = empty ? XCircle : AlertTriangle;
  const text = empty ? "Os pedidos da Secretária acabaram. A agenda segue normal." : `Restam ${requestsLabel(view.balance)} da Secretária.`;
  return <div role={empty ? "alert" : "status"} className={cn("flex items-start gap-2 rounded-lg border p-2 text-sm",
    empty ? "border-danger/40 bg-danger/10" : "border-warning/40 bg-warning/10")}>
    <Icon aria-hidden="true" className={cn("mt-0.5 h-4 w-4 shrink-0", empty ? "text-danger" : "text-warning")} />
    <p className="min-w-0 flex-1">{text}{" "}
      {canRecharge ? <Link href="/assinatura#secretaria" className="font-medium underline underline-offset-2">Recarregar</Link>
        : <span className="text-muted-foreground">Peça ao dono para recarregar.</span>}</p>
  </div>;
}
