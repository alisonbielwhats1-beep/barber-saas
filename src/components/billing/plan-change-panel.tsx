"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PlanPicker } from "./plan-picker";
import { billingCapacityLabel, billingErrors, billingMoney, resolveBillingIntent, safeCheckout, type BillingIntent, type PlanChangeView, type SubscriptionView } from "@/lib/billing/presentation";

const labels: Record<string, string> = { PREPARING: "Preparando a troca", AWAITING_PAYMENT: "Aguardando você no Mercado Pago", APPLYING: "Pagamento confirmado · atualizando renovação", SCHEDULED: "Troca agendada", APPLIED: "Troca concluída", CANCEL_REQUESTED: "Cancelamento da troca em confirmação", CANCELLED: "Troca cancelada", EXPIRED: "Cotação expirada", REVIEW: "Troca em revisão" };
export function PlanChangePanel({ salonId, subscription, timezone, onRefresh }: { salonId: string; subscription: SubscriptionView; timezone: string; onRefresh: () => Promise<void> }) {
  const [choosing, setChoosing] = useState(false);
  const [quote, setQuote] = useState<PlanChangeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const sending = useRef(false);
  const requestKeys = useRef(new Map<string, string>());
  const change = subscription.change;
  const date = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: timezone }).format(new Date(value));
  async function send(body: unknown) {
    if (sending.current) return null;
    sending.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/billing/changes?salonId=${encodeURIComponent(salonId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(billingErrors[result.error] ?? "Não foi possível concluir a solicitação agora. Atualize a situação antes de tentar novamente.");
      return result.change as PlanChangeView;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível concluir a solicitação."); return null; }
    finally { sending.current = false; setBusy(false); }
  }
  async function preview(selection: BillingIntent) {
    const fingerprint = JSON.stringify(selection);
    const key = requestKeys.current.get(fingerprint) ?? crypto.randomUUID();
    requestKeys.current.set(fingerprint, key);
    const result = await send({ action: "quote", selection, requestKey: key });
    if (result) { setQuote(result); requestKeys.current.delete(fingerprint); }
  }
  async function confirm() {
    if (!quote) return;
    if (await send({ action: "confirm", id: quote.id })) { setQuote(null); setChoosing(false); }
    await onRefresh();
  }
  const checkout = change ? safeCheckout(change.checkoutUrl) : null;
  const interruptedCycle = change?.kind === "CYCLE" && ["CANCELLED", "EXPIRED"].includes(change.state);
  const eligible = subscription.state === "ACTIVE" && ((!subscription.cancelRequestedAt && !subscription.cancelledAt) || interruptedCycle) && !subscription.reviewRequired && !subscription.changePending;
  return <section aria-labelledby="plan-change-title" className="space-y-4 rounded-xl border border-border p-5">
    <div><h2 id="plan-change-title" className="text-lg font-semibold">Trocar de plano</h2><p className="mt-1 text-sm text-muted-foreground">Upgrade no mesmo ciclo: pague a diferença proporcional e mantenha seu vencimento. Reduções e mudanças mensal/anual entram no próximo vencimento.</p></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {change && <div className="space-y-2 rounded-lg bg-surface-1 p-4"><p role="status" className="font-medium">{labels[change.state] ?? "Acompanhando troca"}</p><p>{billingCapacityLabel(change.to.plan, change.to.agendaLimit)} · {change.to.cycle === "ANNUAL" ? "Anual" : "Mensal"}</p>
      {change.kind === "UPGRADE" ? <p className="text-sm">Diferença deste período: {billingMoney(change.amountDueCents)}. Vencimento mantido em {date(change.periodEnd)}.</p> : <p className="text-sm">Novo ciclo a partir de {date(change.effectiveAt)}, após confirmação do pagamento correspondente.</p>}
      {change.to.agendaLimit < change.from.agendaLimit && subscription.changePending && <p className="text-sm">A troca reserva o limite de {change.to.agendaLimit} agendas para novos profissionais e convites. Seus atendimentos e histórico permanecem.</p>}
      {change.kind === "CYCLE" && subscription.changePending && <p className="text-sm">O link de autorização será liberado após confirmar o encerramento da recorrência anterior. Conclua a autorização da nova assinatura para continuar no próximo ciclo. Seu período já pago será preservado.</p>}
      {change.state === "REVIEW" && <p className="text-sm">Uma ocorrência de pagamento precisa de conferência. Seu histórico foi preservado. Entre em contato com a plataforma.</p>}
      <div className="flex flex-wrap gap-3">{checkout && <a href={checkout} className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground">{change.kind === "CYCLE" ? "Autorizar nova recorrência" : "Pagar diferença no Mercado Pago"}</a>}
        {subscription.changePending && !change.paidAt && change.state !== "REVIEW" && change.state !== "CANCEL_REQUESTED" && <Button variant="outline" disabled={busy} onClick={() => setCancelOpen(true)}>Cancelar esta troca</Button>}</div>
    </div>}
    {eligible && <Button variant="outline" disabled={busy} onClick={() => setChoosing(!choosing)}>{choosing ? "Fechar seleção" : "Escolher outro plano"}</Button>}
    {!eligible && !subscription.changePending && <p className="text-sm text-muted-foreground">{subscription.state === "UNPAID" ? "A contratação ainda não foi paga. Use a seleção de planos acima para substituir a tentativa pendente; a diferença proporcional só se aplica a um período pago." : "A troca aguarda uma assinatura paga e ativa, sem cancelamento ou ocorrência financeira em revisão. Confira a situação da assinatura acima."}</p>}
    {eligible && choosing && <PlanPicker initial={resolveBillingIntent({ billingPlan: subscription.plan, cycle: subscription.cycle, extraAgendas: subscription.plan === "TEAM_MAX" ? Math.max(0, subscription.agendaLimit - 10) : 0 })} disabled={busy} onChoose={selection => void preview(selection)} />}
    <Dialog open={Boolean(quote)} onOpenChange={open => { if (!open && !busy) setQuote(null); }}><DialogContent><DialogTitle>Revisar troca de plano</DialogTitle><DialogDescription>Confira os valores e quando a mudança entra em vigor.</DialogDescription>
      {quote && <div className="space-y-4"><p className="font-medium">{billingCapacityLabel(quote.from.plan, quote.from.agendaLimit)} → {billingCapacityLabel(quote.to.plan, quote.to.agendaLimit)}</p>
        <dl className="space-y-3"><div><dt className="text-sm text-muted-foreground">Cobrança adicional agora</dt><dd className="text-2xl font-semibold">{billingMoney(quote.amountDueCents)}</dd></div><div><dt className="text-sm text-muted-foreground">Nova recorrência a partir de {date(quote.periodEnd)}</dt><dd>{billingMoney(quote.to.amountCents)} {quote.to.cycle === "ANNUAL" ? "a cada 12 meses" : "por mês"}</dd></div></dl>
        <p className="text-sm">{quote.kind === "UPGRADE" ? "O plano maior será liberado após o pagamento da diferença. O vencimento permanece igual. Esta cotação vale por até 15 minutos." : quote.kind === "CYCLE" ? "Para evitar duas recorrências, encerraremos a renovação atual antes de liberar a autorização da nova assinatura. Seu período pago será preservado. Se você não concluir a nova autorização, não haverá renovação automática após esse período." : "Você mantém o plano atual até o próximo vencimento. O novo limite será reservado para não ultrapassar a capacidade da troca agendada."}</p>
      </div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button disabled={busy} onClick={() => void confirm()}>{busy ? "Confirmando…" : "Confirmar troca"}</Button><Button variant="outline" disabled={busy} onClick={() => setQuote(null)}>Voltar</Button>
    </DialogContent></Dialog>
    <Dialog open={cancelOpen} onOpenChange={open => { if (!busy) setCancelOpen(open); }}><DialogContent><DialogTitle>Cancelar esta troca?</DialogTitle><DialogDescription>O cancelamento depende da confirmação do Mercado Pago. Se você já autorizou uma troca mensal/anual, a recorrência anterior pode já ter sido encerrada; nesse caso ela não será reativada automaticamente. Seu período pago permanece disponível.</DialogDescription><Button disabled={busy} onClick={async () => { if (change && await send({ action: "cancel", id: change.id })) setCancelOpen(false); await onRefresh(); }}>Confirmar cancelamento da troca</Button></DialogContent></Dialog>
  </section>;
}
