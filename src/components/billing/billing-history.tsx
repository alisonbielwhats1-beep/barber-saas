import { Receipt } from "lucide-react";
import { billingMoney, type BillingTone, type SubscriptionView } from "@/lib/billing/presentation";
import { StatusPill } from "./status-pill";

const chargeStates: Record<string, { label: string; tone: BillingTone }> = {
  approved: { label: "Pago", tone: "ok" },
  pending: { label: "Aguardando", tone: "warn" },
  in_process: { label: "Em processamento", tone: "warn" },
  rejected: { label: "Recusado", tone: "danger" },
  cancelled: { label: "Cancelado", tone: "neutral" },
  refunded: { label: "Estornado", tone: "neutral" },
  charged_back: { label: "Contestado", tone: "danger" },
};

export function BillingHistory({ charges, timezone }: { charges: SubscriptionView["charges"]; timezone: string }) {
  const date = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: timezone }).format(new Date(value));
  return <section aria-labelledby="subscription-payments" className="space-y-3">
    <h2 id="subscription-payments" className="text-lg font-semibold">Histórico de cobranças</h2>
    {!charges.length ? <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground"><Receipt aria-hidden="true" className="h-5 w-5 shrink-0" />Nenhuma cobrança registrada ainda. Os pagamentos confirmados pelo Mercado Pago aparecem aqui.</div>
      : <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div aria-hidden="true" className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4 border-b border-border bg-surface-1 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
          <span>Período</span><span>Valor</span><span>Situação</span><span>Pago em</span>
        </div>
        <ul className="divide-y divide-border">{charges.map(charge => {
          const partial = charge.refundedCents > 0 && charge.refundedCents < charge.amountCents;
          const state = partial ? { label: "Estorno parcial", tone: "neutral" as const } : chargeStates[charge.status] ?? { label: "Em conferência", tone: "neutral" as const };
          return <li key={charge.id} className="grid gap-2 px-5 py-4 text-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-4">
            <p className="font-medium">{date(charge.periodStart)} a {date(charge.periodEnd)}</p>
            <div><p className="font-semibold tabular-nums">{billingMoney(charge.amountCents)}</p>{charge.refundedCents > 0 && <p className="text-xs text-muted-foreground">Estornado: {billingMoney(charge.refundedCents)}</p>}</div>
            <div><StatusPill label={state.label} tone={state.tone} /></div>
            <p className="text-muted-foreground">{charge.paidAt ? <><span className="sm:sr-only">Pago em </span>{date(charge.paidAt)}</> : "—"}</p>
          </li>;
        })}</ul>
      </div>}
  </section>;
}
