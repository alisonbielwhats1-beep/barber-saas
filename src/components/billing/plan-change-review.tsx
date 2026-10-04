"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { billingCapacityLabel, billingMoney, tablePriceCents, type PlanChangeView } from "@/lib/billing/presentation";

const perCycle = (cycle: string) => cycle === "ANNUAL" ? "a cada 12 meses" : "por mês";

export function PlanChangeReview({ quote, timezone, busy, error, onConfirm, onClose }: {
  quote: PlanChangeView | null; timezone: string; busy: boolean; error: string | null; onConfirm: () => void; onClose: () => void;
}) {
  const date = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: timezone }).format(new Date(value));
  const upgrade = quote?.kind === "UPGRADE";
  // A contract priced below today's table keeps that price only while it stays unchanged.
  const table = quote ? tablePriceCents(quote.from) : null;
  const belowTable = Boolean(quote && table !== null && quote.from.amountCents < table);
  const costlierWithLess = Boolean(quote && !upgrade && quote.to.cycle === quote.from.cycle && quote.to.agendaLimit < quote.from.agendaLimit && quote.to.amountCents > quote.from.amountCents);
  return <Dialog open={Boolean(quote)} onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-w-xl">
      <div className="space-y-1"><DialogTitle>Revisar troca de plano</DialogTitle><DialogDescription>Confira os valores e quando a mudança entra em vigor.</DialogDescription></div>
      {quote && <div className="space-y-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-xl border border-border bg-surface-1 p-4">
          <div className="min-w-0"><p className="text-xs text-muted-foreground">Atual</p><p className="font-medium">{billingCapacityLabel(quote.from.plan, quote.from.agendaLimit)}</p><p className="text-xs text-muted-foreground">{billingMoney(quote.from.amountCents)} {perCycle(quote.from.cycle)}</p></div>
          <ArrowRight aria-hidden="true" className="h-5 w-5 text-muted-foreground" />
          <div className="min-w-0"><p className="text-xs text-muted-foreground">Novo</p><p className="font-semibold">{billingCapacityLabel(quote.to.plan, quote.to.agendaLimit)}</p><p className="text-xs text-muted-foreground">{billingMoney(quote.to.amountCents)} {perCycle(quote.to.cycle)}</p></div>
        </div>
        <dl className="divide-y divide-border rounded-xl border border-border">
          <div className="flex flex-wrap items-baseline justify-between gap-2 p-4"><dt className="text-sm text-muted-foreground">Cobrança adicional agora</dt><dd className="text-2xl font-semibold tabular-nums">{billingMoney(quote.amountDueCents)}</dd></div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 p-4"><dt className="text-sm text-muted-foreground">Nova recorrência a partir de {date(quote.periodEnd)}</dt><dd className="font-medium tabular-nums">{billingMoney(quote.to.amountCents)} {perCycle(quote.to.cycle)}</dd></div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 p-4"><dt className="text-sm text-muted-foreground">Quando vale</dt><dd className="font-medium">{upgrade ? "Logo após o pagamento" : `No próximo vencimento, ${date(quote.periodEnd)}`}</dd></div>
        </dl>
        {costlierWithLess && <p role="note" className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">Atenção: mesmo com menos agendas, a renovação passa de {billingMoney(quote.from.amountCents)} para {billingMoney(quote.to.amountCents)} {perCycle(quote.to.cycle)}.</p>}
        {belowTable && table !== null && <p className="text-sm text-muted-foreground">Hoje você paga {billingMoney(quote.from.amountCents)} {perCycle(quote.from.cycle)}, valor anterior à tabela atual ({billingMoney(table)} para a mesma capacidade). Com a troca, o novo plano segue a tabela atual.</p>}
        <p className="text-sm">{upgrade ? "O plano maior será liberado após o pagamento da diferença. O vencimento permanece igual. Esta cotação vale por até 15 minutos."
          : quote.kind === "CYCLE" ? "Para evitar duas recorrências, encerraremos a renovação atual antes de liberar a autorização da nova assinatura. Seu período pago será preservado. Se você não concluir a nova autorização, não haverá renovação automática após esse período."
          : "Você mantém o plano atual até o próximo vencimento. O novo limite será reservado para não ultrapassar a capacidade da troca agendada."}</p>
      </div>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onClose}>Voltar</Button>
        <Button disabled={busy} onClick={onConfirm}>{busy && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}{busy ? "Confirmando…" : upgrade ? "Confirmar e pagar diferença" : "Confirmar troca"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
