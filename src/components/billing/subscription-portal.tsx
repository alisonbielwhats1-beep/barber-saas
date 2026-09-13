"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PlanPicker } from "./plan-picker";
import { BILLING_PLANS, quoteContract } from "@/lib/billing/catalog";
import { billingErrors, billingMoney, safeCheckout, type BillingIntent, type SubscriptionView } from "@/lib/billing/presentation";

const states: Record<string, string> = { UNPAID: "Aguardando pagamento", ACTIVE: "Plano ativo", VERIFYING: "Conferindo renovação", GRACE: "Pagamento em atraso · período de carência", RESTRICTED: "Regularização necessária", EXPIRED: "Período encerrado" };
const chargeStates: Record<string, string> = { approved: "Pago", pending: "Aguardando", in_process: "Em processamento", rejected: "Recusado", cancelled: "Cancelado", refunded: "Estornado", charged_back: "Contestado" };
const dateLabel = (value: string | null, timezone: string) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: timezone }).format(new Date(value)) : "Ainda não confirmado";

export function SubscriptionPortal({ salonId, email, timezone, initial }: { salonId: string; email: string; timezone: string; initial?: BillingIntent }) {
  const [subscription, setSubscription] = useState<SubscriptionView | null>();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState<BillingIntent | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const inFlight = useRef(false);
  const requestKeys = useRef(new Map<string, string>());
  const endpoint = `/api/billing/subscriptions?salonId=${encodeURIComponent(salonId)}`;
  const report = useCallback((code: unknown) => setError(typeof code === "string" && billingErrors[code] ? billingErrors[code] : "Não foi possível consultar sua assinatura agora. Tente atualizar em instantes."), []);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      const body = await response.json();
      if (!response.ok) { report(body.error); return; }
      setSubscription(body.subscription); setError(null);
    } catch (e) { if (!(e instanceof Error && e.name === "AbortError")) report(null); }
  }, [endpoint, report]);
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort(); }, [refresh]);
  const pollingId = subscription && !(subscription.state === "ACTIVE" && !subscription.cancelRequestedAt) && !subscription.cancelledAt ? subscription.id : null;
  useEffect(() => {
    if (!pollingId) return;
    const controller = new AbortController(); const deadline = Date.now() + 5 * 60_000;
    const timer = setInterval(() => { if (Date.now() > deadline) { clearInterval(timer); return; } if (document.visibilityState === "visible") void refresh(controller.signal); }, 8000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [refresh, pollingId]);

  async function subscribe() {
    if (!choice || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const storageKey = `billing:${salonId}:${subscription?.id ?? "first"}:${JSON.stringify(choice)}`;
      let key = requestKeys.current.get(storageKey);
      try { key ??= sessionStorage.getItem(storageKey) ?? undefined; } catch { /* Browser storage may be unavailable. */ }
      if (!key || !/^[a-f0-9-]{36}$/.test(key)) key = crypto.randomUUID();
      requestKeys.current.set(storageKey, key);
      try { sessionStorage.setItem(storageKey, key); } catch { /* The in-memory key still protects retries. */ }
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(choice) });
      const body = await response.json();
      if (!response.ok) { setChoice(null); await refresh(); report(body.error); return; }
      setChoice(null);
      const checkout = safeCheckout(body.checkoutUrl);
      if (checkout) { window.location.assign(checkout); return; }
      setMessage("Sua solicitação foi recebida. Estamos preparando o pagamento."); await refresh();
    } catch { setChoice(null); await refresh(); report("PROVIDER_UNAVAILABLE"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function cancel() {
    if (!subscription || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/billing/cancel?salonId=${encodeURIComponent(salonId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscriptionId: subscription.id }) });
      const body = await response.json();
      if (!response.ok) { report(body.error); return; }
      setCancelOpen(false); setMessage("Pedido de cancelamento recebido. Aguarde a confirmação do Mercado Pago."); await refresh();
    } catch { report(null); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const canChoose = subscription === null || Boolean(subscription?.cancelledAt && (!subscription.paidThrough || new Date(subscription.paidThrough) <= new Date()));
  const quote = choice ? quoteContract(choice) : null;
  const checkout = subscription ? safeCheckout(subscription.checkoutUrl) : null;
  return <div className="space-y-6">
    {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">{error}</p>}
    {message && <p role="status" className="rounded-lg border border-border bg-surface-1 p-4 text-sm">{message}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Conta para contratação: <span className="break-all">{email}</span></p><Button variant="outline" disabled={busy} onClick={() => void refresh()}>Atualizar situação</Button></div>
    {subscription === undefined && <p role="status">{error ? "O acompanhamento está indisponível. Use Atualizar situação para tentar novamente." : "Consultando sua assinatura…"}</p>}
    {subscription && <section className="space-y-5 rounded-xl border border-border bg-surface-1 p-5" aria-labelledby="current-subscription">
      <div><p role="status" className="text-sm font-medium">{subscription.cancelledAt ? "Renovação cancelada" : subscription.cancelRequestedAt ? "Cancelamento em confirmação" : states[subscription.state] ?? "Acompanhando assinatura"}</p>
        <h2 id="current-subscription" className="mt-2 text-xl font-semibold">{BILLING_PLANS[subscription.plan as keyof typeof BILLING_PLANS]?.label ?? subscription.plan}</h2>
        <p className="mt-1">{billingMoney(subscription.amountCents)} / {subscription.cycle === "ANNUAL" ? "12 meses" : "mês"} · {subscription.agendaLimit} agendas</p></div>
      <dl className="grid gap-4 sm:grid-cols-2"><div><dt className="text-sm text-muted-foreground">Acesso pago até</dt><dd className="mt-1 font-medium">{dateLabel(subscription.paidThrough, timezone)}</dd></div>
        {!subscription.cancelledAt && <div><dt className="text-sm text-muted-foreground">Próxima cobrança prevista</dt><dd className="mt-1 font-medium">{dateLabel(subscription.nextPaymentAt ?? subscription.paidThrough, timezone)}</dd></div>}</dl>
      {subscription.cancelledAt && <p className="text-sm">A renovação foi cancelada no Mercado Pago. {subscription.state === "ACTIVE" ? "Você continua usando o plano até o fim do período pago." : "Não há novas renovações desta assinatura."}</p>}
      {subscription.state === "UNPAID" && !subscription.cancelledAt && <p className="text-sm">Seu plano será liberado assim que o Mercado Pago confirmar o pagamento. Esta página acompanha a confirmação automaticamente.</p>}
      {subscription.state === "VERIFYING" && <p className="text-sm">Estamos aguardando a confirmação da renovação pelo Mercado Pago. Atualize a situação em instantes.</p>}
      {["GRACE", "RESTRICTED"].includes(subscription.state) && <p className="text-sm">Confira a cobrança e a forma de pagamento na sua conta Mercado Pago. Após o pagamento confirmado, o acesso é regularizado automaticamente. Seus agendamentos e histórico permanecem preservados.</p>}
      {subscription.reviewRequired && <p role="status" className="text-sm">Há uma ocorrência financeira em revisão. Entre em contato com a plataforma para acompanhar.</p>}
      <div className="flex flex-wrap gap-3">{checkout && subscription.state === "UNPAID" && !subscription.cancelRequestedAt && !subscription.cancelledAt && <a href={checkout} className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground">Continuar pagamento no Mercado Pago</a>}
        {!subscription.cancelRequestedAt && !subscription.cancelledAt && <Button variant="outline" disabled={busy} onClick={() => setCancelOpen(true)}>Cancelar renovação</Button>}
        {["GRACE", "RESTRICTED"].includes(subscription.state) && <a href="https://www.mercadopago.com.br/" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center underline">Abrir Mercado Pago</a>}</div>
    </section>}
    {canChoose && <section aria-labelledby="choose-subscription"><h2 id="choose-subscription" className="mb-4 text-xl font-semibold">Escolha seu plano</h2><PlanPicker initial={initial} disabled={busy} onChoose={setChoice} /></section>}
    {subscription && <section aria-labelledby="subscription-payments"><h2 id="subscription-payments" className="mb-3 text-lg font-semibold">Histórico de cobranças</h2>
      {!subscription.charges.length ? <p className="text-sm text-muted-foreground">Nenhuma cobrança registrada ainda.</p> : <ul className="divide-y divide-border rounded-xl border border-border">{subscription.charges.map(charge => <li key={charge.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium">{billingMoney(charge.amountCents)} · {charge.refundedCents > 0 && charge.refundedCents < charge.amountCents ? "Estorno parcial" : chargeStates[charge.status] ?? "Em conferência"}</p><p className="text-sm text-muted-foreground">{dateLabel(charge.periodStart, timezone)} a {dateLabel(charge.periodEnd, timezone)}</p>{charge.refundedCents > 0 && <p className="text-sm text-muted-foreground">Estornado: {billingMoney(charge.refundedCents)}</p>}</div>{charge.paidAt && <p className="text-sm">Pago em {dateLabel(charge.paidAt, timezone)}</p>}</li>)}</ul>}
    </section>}
    <p className="text-sm text-muted-foreground">Precisa de ajuda? <Link href="/contato" className="underline">Fale com a plataforma</Link>.</p>
    <Dialog open={Boolean(choice)} onOpenChange={open => { if (!open && !busy) setChoice(null); }}><DialogContent><DialogTitle>Confirmar contratação</DialogTitle><DialogDescription>Revise o valor antes de seguir para o pagamento seguro no Mercado Pago.</DialogDescription>
      {quote && <><p className="font-semibold">{quote.label} · {quote.agendaLimit} agendas</p><p className="text-2xl font-semibold">{billingMoney(quote.amountCents)}</p><p className="text-sm">Cobrança automática {quote.cycle === "ANNUAL" ? "a cada 12 meses, pelo valor total acima" : "mensal, pelo valor acima"}. O primeiro período só será liberado após a confirmação do pagamento. Você poderá cancelar a renovação no portal.</p></>}
      <Button disabled={busy} onClick={() => void subscribe()}>{busy ? "Preparando pagamento…" : "Ir para pagamento"}</Button><Button variant="outline" disabled={busy} onClick={() => setChoice(null)}>Voltar aos planos</Button>
    </DialogContent></Dialog>
    <Dialog open={cancelOpen} onOpenChange={open => { if (!busy) setCancelOpen(open); }}><DialogContent><DialogTitle>Cancelar a renovação?</DialogTitle><DialogDescription>Vamos solicitar o cancelamento ao Mercado Pago. Após a confirmação, não haverá novas renovações. O período já pago e seu histórico serão preservados; esta ação não solicita estorno.</DialogDescription>
      <Button disabled={busy} onClick={() => void cancel()}>{busy ? "Enviando pedido…" : "Confirmar cancelamento"}</Button><Button variant="outline" disabled={busy} onClick={() => setCancelOpen(false)}>Manter assinatura</Button>
    </DialogContent></Dialog>
  </div>;
}
