"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PlanPicker, type PlanPickerMode } from "./plan-picker";
import { CurrentPlanCard, Notice, type LegacyPlan } from "./current-plan-card";
import { BillingHistory } from "./billing-history";
import { PlanChangeReview } from "./plan-change-review";
import { goToCheckout } from "./navigation";
import { BILLING_PLANS, quoteContract } from "@/lib/billing/catalog";
import { billingCapacityLabel, billingErrors, billingMoney, isRenewalReactivation, renewalStatusOf, safeCheckout, type BillingIntent, type PlanChangeView, type SubscriptionView } from "@/lib/billing/presentation";

const FREE_PLAN: LegacyPlan = { label: "Grátis", agendas: 1, free: true };

export function SubscriptionPortal({ salonId, email, timezone, initial, accessBlocked = false, legacy = FREE_PLAN, occupiedAgendas = 0, billingOrigin = null, returnedFromCheckout = false }: {
  salonId: string; email: string; timezone: string; initial?: BillingIntent; accessBlocked?: boolean;
  /** Plan in use when no paid contract exists (legacy or free). */
  legacy?: LegacyPlan;
  /** Active professionals plus pending invitations; server still enforces capacity. */
  occupiedAgendas?: number;
  /** Origin accepted by billing mutations; another host cannot pay or change plans. */
  billingOrigin?: string | null;
  returnedFromCheckout?: boolean;
}) {
  const [subscription, setSubscription] = useState<SubscriptionView | null>();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [choice, setChoice] = useState<BillingIntent | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [quote, setQuote] = useState<PlanChangeView | null>(null);
  const [quoting, setQuoting] = useState<string | null>(null);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [cancelChangeOpen, setCancelChangeOpen] = useState(false);
  const [awaitingCheckout, setAwaitingCheckout] = useState<string | null>(null);
  const [foreignHost, setForeignHost] = useState<string | null>(null);
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [boost, setBoost] = useState(0);
  const [reveal, setReveal] = useState(0);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const changeErrorRef = useRef<HTMLParagraphElement>(null);
  const inFlight = useRef(false);
  const requestKeys = useRef(new Map<string, string>());
  const changeKeys = useRef(new Map<string, string>());
  const reactivationKeys = useRef(new Map<string, string>());
  const endpoint = `/api/billing/subscriptions?salonId=${encodeURIComponent(salonId)}`;
  const report = useCallback((code: unknown, fallback = "Não foi possível consultar sua assinatura agora. Tente atualizar em instantes.") => setError(typeof code === "string" && billingErrors[code] ? billingErrors[code] : fallback), []);
  // Errors caused by a click are brought into view; background polling never moves the page.
  const failed = (code: unknown, fallback?: string) => { report(code, fallback); setReveal(n => n + 1); };
  useEffect(() => { if (reveal) (changeErrorRef.current ?? errorRef.current)?.scrollIntoView?.({ block: "center", behavior: "smooth" }); }, [reveal]);
  const refresh = useCallback(async (signal?: AbortSignal, quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      const body = await response.json();
      if (!response.ok) { report(body.error); return; }
      setSubscription(body.subscription); setError(null);
    } catch (e) { if (!(e instanceof Error && e.name === "AbortError")) report(null); }
    finally { if (!quiet && !signal?.aborted) setRefreshing(false); }
  }, [endpoint, report]);
  // Ask the server to consult Mercado Pago now (it never trusts the browser for access), then follow closely.
  const syncNow = useCallback(async () => {
    if (billingOrigin && window.location.origin !== billingOrigin) return;
    try { await fetch(`/api/billing/sync?salonId=${encodeURIComponent(salonId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); } catch { /* Best effort; the schedule still reconciles. */ }
    setBoost(n => n + 1);
  }, [billingOrigin, salonId]);
  const syncAndRefresh = useCallback(async () => { await syncNow(); await refresh(); }, [syncNow, refresh]);
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort(); }, [refresh]);
  useEffect(() => { if (returnedFromCheckout) void syncNow(); }, [returnedFromCheckout, syncNow]);
  useEffect(() => { if (billingOrigin && window.location.origin !== billingOrigin) setForeignHost(window.location.host); }, [billingOrigin]);

  const renewalStatus = subscription ? renewalStatusOf(subscription) : "AVAILABLE";
  const watching = Boolean(subscription && (subscription.changePending || renewalStatus === "PENDING" || (!(subscription.state === "ACTIVE" && !subscription.cancelRequestedAt) && !subscription.cancelledAt)));
  // A manual sync of a settled subscription is followed briefly; open situations for five minutes.
  const pollingKey = subscription ? watching ? `watch:${subscription.id}` : boost ? `sync:${boost}` : null : null;
  const fastPolling = Boolean(awaitingCheckout) || (returnedFromCheckout && subscription?.state === "UNPAID") || boost > 0;
  useEffect(() => {
    if (!pollingKey) return;
    const controller = new AbortController(); const started = Date.now(); const deadline = started + (pollingKey.startsWith("sync:") ? 30_000 : 5 * 60_000);
    let timer: ReturnType<typeof setTimeout>;
    // Faster while the owner waits for a checkout link or a payment return, then back to the normal pace.
    const schedule = () => { timer = setTimeout(tick, fastPolling && Date.now() - started < 90_000 ? 3000 : 8000); };
    const tick = () => { if (Date.now() > deadline) return; if (document.visibilityState === "visible") void refresh(controller.signal, true); schedule(); };
    schedule();
    return () => { clearTimeout(timer); controller.abort(); };
    // `boost` restarts the fast phase after each manual sync.
  }, [refresh, pollingKey, fastPolling, boost]);
  // After confirming an upgrade or cycle change, continue to the provider as soon as its link exists.
  useEffect(() => {
    const change = subscription?.change;
    if (!awaitingCheckout || !change || change.id !== awaitingCheckout) return;
    const checkout = safeCheckout(change.checkoutUrl);
    if (checkout) { setAwaitingCheckout(null); goToCheckout(checkout); }
    else if (!subscription.changePending || !["PREPARING", "AWAITING_PAYMENT"].includes(change.state)) setAwaitingCheckout(null);
  }, [subscription, awaitingCheckout]);

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
      if (!response.ok) { setChoice(null); await refresh(); failed(body.error, "Não foi possível iniciar a contratação agora. Atualize a situação antes de tentar novamente."); return; }
      setChoice(null);
      const checkout = safeCheckout(body.checkoutUrl);
      if (checkout) { goToCheckout(checkout); return; }
      setMessage("Sua solicitação foi recebida. Estamos preparando o pagamento."); await refresh();
    } catch { setChoice(null); await refresh(); failed("PROVIDER_UNAVAILABLE"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function cancel() {
    if (!subscription || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/billing/cancel?salonId=${encodeURIComponent(salonId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscriptionId: subscription.id }) });
      const body = await response.json();
      if (!response.ok) { failed(body.error, "Não foi possível registrar o cancelamento agora. Tente novamente em instantes."); return; }
      setCancelOpen(false); setMessage(null); await refresh();
    } catch { await refresh(); failed("PROVIDER_UNAVAILABLE"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function sendChange(body: unknown) {
    if (inFlight.current) return null;
    inFlight.current = true; setBusy(true); setChangeError(null);
    try {
      const response = await fetch(`/api/billing/changes?salonId=${encodeURIComponent(salonId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(billingErrors[result.error] ?? "Não foi possível concluir a solicitação agora. Atualize a situação antes de tentar novamente.");
      return result.change as PlanChangeView;
    } catch (cause) { setChangeError(cause instanceof Error ? cause.message : "Não foi possível concluir a solicitação."); setReveal(n => n + 1); return null; }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function previewChange(selection: BillingIntent) {
    const fingerprint = JSON.stringify(selection);
    const key = changeKeys.current.get(fingerprint) ?? crypto.randomUUID();
    changeKeys.current.set(fingerprint, key);
    setQuoting(fingerprint);
    const result = await sendChange({ action: "quote", selection, requestKey: key });
    setQuoting(null);
    if (result) { setQuote(result); changeKeys.current.delete(fingerprint); }
  }
  async function confirmChange() {
    if (!quote) return;
    const confirmed = await sendChange({ action: "confirm", id: quote.id });
    if (confirmed) { setQuote(null); if (["UPGRADE", "CYCLE"].includes(confirmed.kind)) setAwaitingCheckout(confirmed.id); }
    await refresh();
  }
  async function cancelChange() {
    const change = subscription?.change;
    if (change && await sendChange({ action: "cancel", id: change.id })) { setCancelChangeOpen(false); setAwaitingCheckout(null); }
    await refresh();
  }
  async function reactivate() {
    if (!subscription || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const key = reactivationKeys.current.get(subscription.id) ?? crypto.randomUUID();
      reactivationKeys.current.set(subscription.id, key);
      const response = await fetch(`/api/billing/reactivate?salonId=${encodeURIComponent(salonId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscriptionId: subscription.id, requestKey: key }) });
      const body = await response.json();
      if (!response.ok) { setReactivateOpen(false); failed(body.error, "Não foi possível reativar a renovação agora. Atualize a situação antes de tentar novamente."); return; }
      reactivationKeys.current.delete(subscription.id);
      setReactivateOpen(false); setAwaitingCheckout(body.change.id); await refresh();
    } catch { setReactivateOpen(false); await refresh(); failed("PROVIDER_UNAVAILABLE"); }
    finally { inFlight.current = false; setBusy(false); }
  }

  const canChoose = subscription === null || Boolean(renewalStatus === "CANCELLED" && subscription?.cancelledAt && (!subscription.paidThrough || new Date(subscription.paidThrough) <= new Date()));
  const canReplacePending = subscription?.state === "UNPAID" && !subscription.paidThrough && !subscription.reviewRequired && !subscription.changePending && renewalStatus === "AVAILABLE";
  const change = subscription?.change;
  // Only an unfinished monthly/annual switch reopens cycle changes; an unfinished reactivation offers reactivation again.
  const interruptedCycle = change?.kind === "CYCLE" && ["CANCELLED", "EXPIRED"].includes(change.state) && !isRenewalReactivation(change);
  const changeEligible = Boolean(subscription?.changesAvailable && subscription.state === "ACTIVE" && ((!subscription.cancelRequestedAt && !subscription.cancelledAt) || interruptedCycle) && !subscription.reviewRequired && !subscription.changePending);
  const accessEnd = subscription?.paidThrough ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: timezone }).format(new Date(subscription.paidThrough)) : null;
  // Same limits the server applies: paid period with at least one hour left and no financial review.
  const canReactivate = Boolean(!accessBlocked && subscription?.changesAvailable && subscription.state === "ACTIVE" && renewalStatus === "CANCELLED" && !subscription.reviewRequired && !subscription.changePending && subscription.paidThrough && new Date(subscription.paidThrough).getTime() > Date.now() + 60 * 60_000);
  const reactivationPending = Boolean(change && subscription?.changePending && isRenewalReactivation(change));
  const mode: PlanPickerMode = canChoose ? "subscribe" : canReplacePending ? "replace-pending" : "change";
  const lockedReason = canChoose || canReplacePending || changeEligible ? null
    : subscription?.reviewRequired ? "Há uma ocorrência financeira em revisão. A troca de plano fica disponível depois da conferência pela plataforma."
    : reactivationPending && change ? `A renovação foi reativada a partir de ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: timezone }).format(new Date(change.periodEnd))}. Trocas de plano voltam a ficar disponíveis quando a nova recorrência começar.`
    : subscription?.changePending ? "Há uma troca em andamento. Conclua ou cancele essa troca para escolher outro plano."
    : renewalStatus === "PENDING" ? "Estamos confirmando um cancelamento no Mercado Pago. Aguarde a confirmação para escolher outro plano."
    : subscription?.state === "ACTIVE" && renewalStatus === "CANCELLED" ? canReactivate ? "A renovação está cancelada. Use Reativar renovação acima para continuar no mesmo plano; trocas voltam a ficar disponíveis quando a nova recorrência começar."
      : `A renovação foi cancelada. Você poderá contratar um plano novamente quando o período pago terminar${accessEnd ? `, em ${accessEnd}` : ""}.`
    : subscription?.state === "ACTIVE" && !subscription.changesAvailable ? "A troca de planos pelo painel ainda não está disponível. Fale com a plataforma se precisar mudar de plano."
    : ["GRACE", "RESTRICTED", "VERIFYING"].includes(subscription?.state ?? "") ? "Regularize a situação da assinatura acima para trocar de plano."
    : "A troca de plano não está disponível neste momento. Atualize a situação para conferir.";
  const blockedByHost = Boolean(foreignHost);
  function choose(intent: BillingIntent) {
    setError(null); setChangeError(null);
    if (canChoose || canReplacePending) { setReplacing(!canChoose); setChoice(intent); }
    else if (changeEligible) void previewChange(intent);
  }
  const terms = subscription && { plan: subscription.plan as BillingIntent["plan"], cycle: subscription.cycle as BillingIntent["cycle"], agendaLimit: subscription.agendaLimit, amountCents: subscription.amountCents };
  const showPlans = !accessBlocked && subscription !== undefined;
  const choiceQuote = choice ? quoteContract(choice) : null;
  const unpaid = subscription?.state === "UNPAID";
  // Retention: before cancelling, show a cheaper plan when one still fits the team (it applies at renewal).
  const smallerPlanFits = Boolean(changeEligible && terms && Object.values(BILLING_PLANS).some(plan => plan.agendas < terms.agendaLimit && plan.agendas >= occupiedAgendas));

  return <div className="space-y-8">
    {foreignHost && billingOrigin && <Notice tone="warn" title="Abra o endereço oficial para pagar ou trocar de plano"
      actions={<a href={`${billingOrigin}/assinatura`} className="font-semibold underline underline-offset-4">Abrir {new URL(billingOrigin).host}</a>}>
      Você está acessando por {foreignHost}. Por segurança, pagamentos, trocas e cancelamentos só são aceitos pelo endereço oficial do Everflair.
    </Notice>}
    {error && <p ref={errorRef} role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm">{error}</p>}
    {message && <p role="status" className="rounded-xl border border-border bg-surface-1 p-4 text-sm">{message}</p>}

    {subscription === undefined ? <div role="status" className="rounded-2xl border border-border bg-card p-6">
      {error ? <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm">O acompanhamento está indisponível. Use Atualizar situação para tentar novamente.</p><Button variant="outline" disabled={refreshing} onClick={() => void refresh()}>Atualizar situação</Button></div>
        : <div className="flex items-center gap-3 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />Consultando sua assinatura…</div>}
    </div>
      : accessBlocked && subscription === null ? <p className="text-sm">Nenhuma assinatura recorrente foi encontrada para este estabelecimento.</p>
      : <CurrentPlanCard subscription={subscription} legacy={legacy} occupiedAgendas={occupiedAgendas} timezone={timezone} email={email} accessBlocked={accessBlocked}
          returnedFromCheckout={returnedFromCheckout} refreshing={refreshing} busy={busy} preparingChangeCheckout={Boolean(awaitingCheckout)}
          onRefresh={() => void syncAndRefresh()} onCancelChange={() => { setChangeError(null); setCancelChangeOpen(true); }}
          onReactivate={canReactivate && !blockedByHost ? () => { setError(null); setReactivateOpen(true); } : undefined} />}

    {showPlans && <section aria-labelledby="choose-subscription" className="space-y-4">
      <div>
        <h2 id="choose-subscription" className="text-lg font-semibold">{mode === "subscribe" ? "Escolha seu plano" : mode === "replace-pending" ? "Prefere outro plano?" : "Mudar de plano"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">Todos os planos incluem agendamentos ilimitados e todos os recursos. A diferença está na quantidade de agendas.
          {mode === "replace-pending" && " Para trocar, primeiro encerramos a tentativa atual no Mercado Pago — nada é cobrado por isso."}</p>
      </div>
      {mode === "subscribe" && initial && <Notice tone="ok" title={`Você escolheu ${billingCapacityLabel(initial.plan, quoteContract(initial).agendaLimit)} · ${initial.cycle === "ANNUAL" ? "anual" : "mensal"}`}
        actions={<Button disabled={busy || blockedByHost} onClick={() => choose(initial)}>Continuar com este plano</Button>}>
        {billingMoney(quoteContract(initial).amountCents)} {initial.cycle === "ANNUAL" ? "a cada 12 meses" : "por mês"}. Você também pode comparar os planos abaixo.
      </Notice>}
      <PlanPicker key={`${mode}:${subscription?.id ?? "none"}`} mode={mode} initial={mode === "subscribe" ? initial : undefined}
        current={mode === "change" ? terms : null} pending={mode === "replace-pending" && terms ? { ...terms, checkoutUrl: subscription?.cancelRequestedAt ? null : subscription?.checkoutUrl ?? null } : null}
        occupiedAgendas={occupiedAgendas} disabled={busy || blockedByHost} lockedReason={lockedReason} loadingKey={quoting} onChoose={choose}
        feedback={changeError && !quote && !cancelChangeOpen ? <p ref={changeErrorRef} role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm">{changeError}</p> : null} />
    </section>}

    {subscription && <BillingHistory charges={subscription.charges} timezone={timezone} />}

    {/* While a reactivation awaits authorization, "Desistir da reativação" is the only exit. */}
    {subscription && renewalStatus === "AVAILABLE" && !(reactivationPending && change?.state !== "SCHEDULED") && <section aria-labelledby="renewal-title" className="flex flex-col gap-4 rounded-2xl border border-border p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div className="max-w-2xl">
        <h2 id="renewal-title" className="font-semibold">{unpaid ? "Contratação pendente" : "Renovação automática"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{unpaid ? "Se desistir, encerramos a tentativa no Mercado Pago sem nenhuma cobrança. " : "Você pode cancelar a renovação aqui a qualquer momento, sem precisar falar com o suporte. "}
          {unpaid ? "Seu histórico é preservado." : accessBlocked ? "O período pago e seu histórico serão preservados." : "O plano continua disponível até o fim do período pago."}</p>
      </div>
      <Button variant="outline" className="shrink-0 border-danger/40 text-danger hover:bg-danger/10 hover:text-danger" disabled={busy || blockedByHost} onClick={() => setCancelOpen(true)}>{unpaid ? "Cancelar contratação" : "Cancelar renovação"}</Button>
    </section>}

    <p className="text-sm text-muted-foreground">Precisa de ajuda? <Link href="/contato" className="underline underline-offset-4">Fale com a plataforma</Link>.</p>

    <Dialog open={Boolean(choice)} onOpenChange={open => { if (!open && !busy) setChoice(null); }}><DialogContent>
      <div className="space-y-1"><DialogTitle>{replacing ? "Trocar contratação pendente" : "Confirmar contratação"}</DialogTitle><DialogDescription>{replacing ? "Primeiro, confirme o encerramento da tentativa anterior. O novo pagamento só ficará disponível depois da confirmação do Mercado Pago." : "Revise o valor antes de seguir para o pagamento seguro no Mercado Pago."}</DialogDescription></div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {choiceQuote && <div className="rounded-xl border border-border bg-surface-1 p-4">
        <p className="font-semibold">{billingCapacityLabel(choiceQuote.plan, choiceQuote.agendaLimit)}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{billingMoney(choiceQuote.amountCents)}<span className="text-sm font-normal text-muted-foreground"> {choiceQuote.cycle === "ANNUAL" ? "a cada 12 meses" : "por mês"}</span></p>
        <p className="mt-2 text-sm text-muted-foreground">Cobrança automática {choiceQuote.cycle === "ANNUAL" ? "a cada 12 meses, pelo valor total acima" : "mensal, pelo valor acima"}. O primeiro período só será liberado após a confirmação do pagamento. Você poderá cancelar a renovação no portal.</p>
      </div>}
      {replacing && subscription && <ol className="space-y-3 text-sm">
        <li className="flex gap-3"><span aria-hidden="true" className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold", canChoose ? "bg-success text-background" : "bg-muted")}>{canChoose ? <Check className="h-3.5 w-3.5" /> : 1}</span>
          <span>Encerrar a tentativa de {billingCapacityLabel(subscription.plan as BillingIntent["plan"], subscription.agendaLimit)} no Mercado Pago{canChoose ? " — confirmado." : renewalStatus === "PENDING" ? " — aguardando confirmação…" : "."}</span></li>
        <li className="flex gap-3"><span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">2</span><span>Seguir para o pagamento do novo plano.</span></li>
      </ol>}
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={() => setChoice(null)}>Voltar aos planos</Button>
        {canChoose ? <Button disabled={busy || blockedByHost} onClick={() => void subscribe()}>{busy ? "Preparando pagamento…" : <>Ir para pagamento<ExternalLink aria-hidden="true" className="h-4 w-4" /></>}</Button>
          : canReplacePending ? <Button disabled={busy || blockedByHost} onClick={() => void cancel()}>{busy ? "Enviando pedido…" : "Confirmar cancelamento da tentativa anterior"}</Button>
          : <Button variant="outline" disabled={busy || refreshing} onClick={() => void syncAndRefresh()}>{refreshing && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}Atualizar situação</Button>}
      </DialogFooter>
      {!canChoose && !canReplacePending && <p role="status" className="text-sm text-muted-foreground">Aguardando a confirmação do Mercado Pago. Esta janela avança sozinha assim que o cancelamento for confirmado; se houve pagamento, a troca deverá usar a cotação do plano ativo.</p>}
    </DialogContent></Dialog>

    <Dialog open={cancelOpen} onOpenChange={open => { if (!busy) setCancelOpen(open); }}><DialogContent>
      <div className="space-y-1"><DialogTitle>{unpaid ? "Cancelar esta contratação?" : "Cancelar a renovação?"}</DialogTitle><DialogDescription>{unpaid ? "Vamos encerrar a tentativa de assinatura no Mercado Pago. Nenhuma cobrança será feita e você poderá escolher um plano novamente." : "Vamos encerrar a cobrança recorrente no Mercado Pago, incluindo uma nova assinatura agendada por troca de plano. Após a confirmação, não haverá novas renovações. Esta ação não solicita estorno."}</DialogDescription></div>
      <p className="text-sm">{subscription?.state === "ACTIVE" && subscription.paidThrough ? accessBlocked ? `O período pago permanece registrado até ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(subscription.paidThrough))}. A restrição administrativa do painel é independente do cancelamento.` : `Você continua usando todos os recursos do seu plano pago até ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(subscription.paidThrough))}, mesmo cancelando agora.` : "O cancelamento preserva seu histórico e qualquer período já pago."} Seus agendamentos e dados não serão apagados.</p>
      {!unpaid && smallerPlanFits && <div className="rounded-xl border border-border bg-surface-1 p-4 text-sm">
        <p className="font-semibold">Prefere pagar menos?</p>
        <p className="mt-1 text-muted-foreground">Você pode reduzir para um plano menor a partir do próximo vencimento, mantendo agendamentos e histórico.</p>
        <Button variant="link" className="mt-1 h-auto px-0" disabled={busy} onClick={() => { setCancelOpen(false); document.getElementById("choose-subscription")?.scrollIntoView?.({ behavior: "smooth", block: "start" }); }}>Ver planos menores</Button>
      </div>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={() => setCancelOpen(false)}>{unpaid ? "Voltar" : "Manter assinatura"}</Button>
        <Button variant="destructive" disabled={busy || blockedByHost} onClick={() => void cancel()}>{busy ? "Enviando pedido…" : "Confirmar cancelamento"}</Button>
      </DialogFooter>
    </DialogContent></Dialog>

    <PlanChangeReview quote={quote} timezone={timezone} busy={busy} error={changeError} onConfirm={() => void confirmChange()} onClose={() => { setQuote(null); setChangeError(null); }} />

    <Dialog open={cancelChangeOpen} onOpenChange={open => { if (!busy) setCancelChangeOpen(open); }}><DialogContent>
      {reactivationPending ? <div className="space-y-1"><DialogTitle>Desistir da reativação?</DialogTitle><DialogDescription>Vamos encerrar a nova autorização no Mercado Pago. Nada foi cobrado por ela. A renovação continua cancelada e você mantém o acesso até o fim do período pago.</DialogDescription></div>
        : <div className="space-y-1"><DialogTitle>Cancelar esta troca?</DialogTitle><DialogDescription>O cancelamento depende da confirmação do Mercado Pago. Se você já autorizou uma troca mensal/anual, a recorrência anterior pode já ter sido encerrada; nesse caso ela não será reativada automaticamente. Seu período pago permanece disponível.</DialogDescription></div>}
      {changeError && <p role="alert" className="text-sm text-danger">{changeError}</p>}
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={() => setCancelChangeOpen(false)}>{reactivationPending ? "Manter reativação" : "Manter troca"}</Button>
        <Button variant="destructive" disabled={busy || blockedByHost} onClick={() => void cancelChange()}>{reactivationPending ? "Desistir da reativação" : "Confirmar cancelamento da troca"}</Button>
      </DialogFooter>
    </DialogContent></Dialog>

    <Dialog open={reactivateOpen} onOpenChange={open => { if (!busy) setReactivateOpen(open); }}><DialogContent>
      <div className="space-y-1"><DialogTitle>Reativar a renovação?</DialogTitle><DialogDescription>Seu plano volta a renovar automaticamente no fim do período já pago. Nada é cobrado agora.</DialogDescription></div>
      {subscription?.paidThrough && terms && <dl className="divide-y divide-border rounded-xl border border-border">
        <div className="flex flex-wrap items-baseline justify-between gap-2 p-4"><dt className="text-sm text-muted-foreground">Plano</dt><dd className="font-medium">{billingCapacityLabel(terms.plan, terms.agendaLimit)}</dd></div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 p-4"><dt className="text-sm text-muted-foreground">Cobrança agora</dt><dd className="text-xl font-semibold tabular-nums">{billingMoney(0)}</dd></div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 p-4"><dt className="text-sm text-muted-foreground">Próxima cobrança, em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: timezone }).format(new Date(subscription.paidThrough))}</dt><dd className="font-medium tabular-nums">{billingMoney(terms.amountCents)} {terms.cycle === "ANNUAL" ? "a cada 12 meses" : "por mês"}</dd></div>
      </dl>}
      <p className="text-sm">Como a recorrência anterior foi encerrada, o Mercado Pago pede uma nova autorização do cartão. Você será levado para lá em seguida. Se não concluir em até 24 horas, a reativação é descartada e nada muda.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={() => setReactivateOpen(false)}>Voltar</Button>
        <Button disabled={busy || blockedByHost} onClick={() => void reactivate()}>{busy ? "Preparando…" : <>Reativar e autorizar<ExternalLink aria-hidden="true" className="h-4 w-4" /></>}</Button>
      </DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
