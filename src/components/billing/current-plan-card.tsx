"use client";

import { AlertTriangle, CheckCircle2, Clock3, Crown, ExternalLink, Info, Loader2, RefreshCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { billingCapacityLabel, billingMoney, gatewayWords, isRenewalReactivation, nextChargeOf, pendingPriceOutdated, reactivationState, renewalStatusOf, safeCheckout, subscriptionStatus, tablePriceCents, type BillingIntent, type BillingTone, type SubscriptionView } from "@/lib/billing/presentation";
import { StatusPill } from "./status-pill";

export type LegacyPlan = { label: string; agendas: number; free: boolean; courtesyThrough?: string };
const changeLabels: Record<string, string> = { PREPARING: "Preparando a troca", AWAITING_PAYMENT: "Aguardando você no Mercado Pago", APPLYING: "Pagamento confirmado · atualizando renovação", SCHEDULED: "Troca agendada", APPLIED: "Troca concluída", CANCEL_REQUESTED: "Cancelamento da troca em confirmação", CANCELLED: "Troca cancelada", EXPIRED: "Troca não concluída", REVIEW: "Troca em revisão" };
const reactivationLabels: Record<string, string> = { PREPARING: "Preparando a nova autorização", AWAITING_PAYMENT: "Aguardando sua autorização no Mercado Pago", SCHEDULED: "Renovação reativada", CANCEL_REQUESTED: "Cancelando a reativação", REVIEW: "Reativação em revisão" };
const noticeTone: Record<BillingTone, string> = {
  ok: "border-success/30 bg-success/10",
  warn: "border-warning/40 bg-warning/10",
  danger: "border-danger/40 bg-danger/10",
  neutral: "border-border bg-surface-1",
};
const noticeIcon: Record<BillingTone, typeof Info> = { ok: CheckCircle2, warn: Clock3, danger: AlertTriangle, neutral: Info };
const iconTone: Record<BillingTone, string> = { ok: "text-success", warn: "text-warning", danger: "text-danger", neutral: "text-muted-foreground" };

export function Notice({ tone, title, children, actions, className }: { tone: BillingTone; title?: string; children?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  const Icon = noticeIcon[tone];
  return <div className={cn("flex gap-2.5 rounded-xl border p-3 sm:gap-3 sm:p-4", noticeTone[tone], className)}>
    <Icon aria-hidden="true" className={cn("mt-0.5 h-5 w-5 shrink-0", iconTone[tone])} />
    <div className="min-w-0 flex-1 space-y-2 text-sm">
      {title && <p className="font-semibold">{title}</p>}
      {children}
      {actions && <div className="flex flex-wrap items-center gap-2 pt-1">{actions}</div>}
    </div>
  </div>;
}

export function CurrentPlanCard({ subscription, legacy, occupiedAgendas, timezone, email, accessBlocked, returnedFromCheckout, refreshing, busy, preparingChangeCheckout, onRefresh, onCancelChange, onReactivate, onUpdatePrice }: {
  subscription: SubscriptionView | null;
  legacy: LegacyPlan;
  occupiedAgendas: number;
  timezone: string;
  email: string;
  accessBlocked: boolean;
  returnedFromCheckout: boolean;
  refreshing: boolean;
  busy: boolean;
  preparingChangeCheckout: boolean;
  onRefresh: () => void;
  onCancelChange: () => void;
  /** Present only when the cancelled renewal can be reactivated. */
  onReactivate?: () => void;
  /** Present only when an unpaid attempt can be replaced at today's price. */
  onUpdatePrice?: () => void;
}) {
  const date = (value: string | null) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: timezone }).format(new Date(value)) : "Ainda não confirmado";
  const renewal = subscription ? renewalStatusOf(subscription) : "AVAILABLE";
  const abandoned = subscription?.state === "UNPAID" && renewal === "CANCELLED";
  const sub = subscription && !abandoned ? subscription : null;
  const g = gatewayWords(subscription?.provider);
  const stripe = subscription?.provider === "stripe";
  const accessUntil = sub?.paidThrough ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(sub.paidThrough)) : null;
  const paidAccessMessage = accessBlocked ? `O período pago permanece registrado até ${accessUntil}. A restrição administrativa do painel é independente do cancelamento.` : `Você continua usando o plano até ${accessUntil}.`;
  const change = sub?.change ?? null;
  const reactivation = Boolean(change && isRenewalReactivation(change));
  const unfinished = change?.kind === "CYCLE" && ["CANCELLED", "EXPIRED"].includes(change.state) && renewal === "CANCELLED";
  const interruptedCycle = unfinished && !reactivation;
  const priceReduction = Boolean(change?.priceReduction && sub?.changePending);
  const status = sub ? subscriptionStatus({ state: sub.state, renewal, reviewRequired: sub.reviewRequired, changePending: sub.changePending && !priceReduction, reactivation: reactivationState(change, sub.changePending) }) : legacy.free ? null : { label: "Sem cobrança automática", tone: "neutral" as const };
  const title = sub ? billingCapacityLabel(sub.plan as BillingIntent["plan"], sub.agendaLimit) : legacy.label;
  const capacity = sub && sub.state !== "UNPAID" ? sub.agendaLimit : legacy.agendas;
  const showUsage = !accessBlocked && (!sub || ["UNPAID", "ACTIVE", "VERIFYING", "GRACE"].includes(sub.state));
  const checkout = sub ? safeCheckout(sub.checkoutUrl) : null;
  const changeCheckout = change ? safeCheckout(change.checkoutUrl) : null;
  const periodWord = sub?.cycle === "ANNUAL" ? "ano" : "mês";
  const outdated = Boolean(sub?.state === "UNPAID" && renewal === "AVAILABLE" && !sub.cancelRequestedAt && pendingPriceOutdated(sub));
  const tablePrice = sub ? tablePriceCents(sub) : null;
  const next = sub && sub.state !== "UNPAID" ? nextChargeOf(sub) : null;
  const cycleName = (cycle: string) => cycle === "ANNUAL" ? "Anual (12 meses)" : "Mensal";

  return <section aria-labelledby="current-subscription" className="rounded-2xl border border-border bg-card">
    <div className="flex items-start justify-between gap-2 p-4 sm:gap-4 sm:p-6">
      <div className="flex min-w-0 flex-1 items-start gap-3 sm:gap-4">
        <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-warning/15 text-warning sm:h-12 sm:w-12"><Crown className="h-5 w-5 sm:h-6 sm:w-6" /></span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{sub?.state === "UNPAID" ? "Contratação em andamento" : "Seu plano"}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h2 id="current-subscription" className="text-xl font-semibold tracking-tight">{title}</h2>
            {status && <StatusPill role="status" label={status.label} tone={status.tone} />}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{sub ? `${billingMoney(sub.amountCents)}/${periodWord} · cobrança ${sub.cycle === "ANNUAL" ? "anual" : "mensal"} ${g.by}`
            : legacy.courtesyThrough ? `${legacy.agendas} agenda(s) · grátis até ${legacy.courtesyThrough.split("-").reverse().join("/")}, inclusive`
              : legacy.free ? "1 agenda · até 30 agendamentos por mês" : `${legacy.agendas} agendas · liberado pela plataforma, sem renovação pelo Mercado Pago`}</p>
          {abandoned && <p className="mt-1 text-sm text-muted-foreground">A tentativa de contratar {billingCapacityLabel(subscription!.plan as BillingIntent["plan"], subscription!.agendaLimit)} foi cancelada sem cobrança.</p>}
        </div>
      </div>
      <Button variant="ghost" size="sm" disabled={busy || refreshing} onClick={onRefresh} className="-mr-2 -mt-1 shrink-0 px-3" aria-label="Atualizar situação">
        <RefreshCw aria-hidden="true" className={cn("h-4 w-4", refreshing && "animate-spin")} /><span aria-hidden="true" className="hidden sm:inline">Atualizar situação</span>
      </Button>
    </div>

    <div className="space-y-3 px-4 pb-4 empty:hidden sm:px-6 sm:pb-6">
      {outdated && sub && tablePrice !== null && <Notice tone="warn" title="O preço deste plano mudou"
        actions={onUpdatePrice ? <Button disabled={busy} onClick={onUpdatePrice}>Atualizar para o novo preço</Button> : undefined}>
        <p>Sua contratação ainda não foi paga e foi criada pelo preço anterior, de {billingMoney(sub.amountCents)}/{periodWord}. Hoje este plano custa {billingMoney(tablePrice)}/{periodWord}.</p>
        <p className="text-muted-foreground">Para pagar o valor atual, encerramos a tentativa anterior {g.in}, sem nenhuma cobrança, e criamos uma nova.</p>
      </Notice>}
      {sub?.state === "UNPAID" && renewal === "AVAILABLE" && !outdated && <Notice tone="warn" title={returnedFromCheckout ? "Pagamento em confirmação" : "Falta concluir o pagamento"}
        actions={checkout && !sub.cancelRequestedAt ? <a href={checkout} className={cn(buttonVariants(), "h-auto whitespace-normal rounded-lg text-center")}>Continuar pagamento {g.in}<ExternalLink aria-hidden="true" className="h-4 w-4" /></a>
          : <span className="inline-flex items-center gap-2 text-muted-foreground"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />Preparando o link de pagamento…</span>}>
        <p>{returnedFromCheckout ? `Recebemos seu retorno ${g.of}. Se o pagamento foi recusado, use o botão abaixo para tentar novamente. ` : ""}Seu plano será liberado assim que {g.subject} confirmar o pagamento. Esta página acompanha a confirmação automaticamente.</p>
        {!legacy.free && <p className="text-muted-foreground">Até lá, você continua no plano {legacy.label}.</p>}
        {!stripe && <details className="group"><summary className="cursor-pointer font-medium underline-offset-4 hover:underline">Não consigo concluir o pagamento</summary><p className="mt-2 text-muted-foreground">Use uma conta compradora diferente da conta Mercado Pago que recebe os pagamentos do Everflair. A conta recebedora não pode pagar a própria assinatura. Confira também a mensagem exibida pelo Mercado Pago; trocar o plano não resolve uma recusa da conta ou do cartão.</p></details>}
      </Notice>}
      {sub?.state === "UNPAID" && renewal === "PENDING" && <Notice tone="neutral" title="Encerrando a tentativa de contratação">Estamos confirmando o cancelamento {g.in}. Esta página acompanha a confirmação.</Notice>}
      {sub && sub.state !== "UNPAID" && renewal === "CANCELLED" && <Notice tone="neutral"
        actions={onReactivate && <Button disabled={busy} onClick={onReactivate}>Reativar renovação</Button>}>
        <p>A renovação foi cancelada {g.in}, incluindo qualquer recorrência futura vinculada. {sub.state === "ACTIVE" ? paidAccessMessage : "Não há novas renovações desta assinatura."} Seus agendamentos e histórico permanecem preservados.</p>
        {unfinished && reactivation && <p className="text-muted-foreground">A reativação anterior não foi concluída no Mercado Pago; nada foi cobrado.</p>}
        {onReactivate && <p className="text-muted-foreground">Mudou de ideia? Reative para continuar depois de {date(sub.paidThrough)}, sem cobrança antes dessa data.</p>}
      </Notice>}
      {sub && sub.state !== "UNPAID" && renewal === "PENDING" && <Notice tone="neutral">Seu pedido foi registrado. Estamos confirmando o encerramento das cobranças recorrentes {g.in}; esta página acompanha a confirmação. {sub.state === "ACTIVE" && paidAccessMessage}</Notice>}
      {sub?.state === "VERIFYING" && <Notice tone="warn">Estamos aguardando a confirmação da renovação {g.by}. Atualize a situação em instantes.</Notice>}
      {sub && ["GRACE", "RESTRICTED"].includes(sub.state) && <Notice tone={sub.state === "GRACE" ? "warn" : "danger"} title={sub.state === "GRACE" ? "Pagamento em atraso" : "Regularização necessária"}
        actions={stripe ? undefined : <a href="https://www.mercadopago.com.br/ajuda/18157" target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: "outline" }), "h-auto whitespace-normal rounded-lg text-center")}>Como trocar o cartão no Mercado Pago<ExternalLink aria-hidden="true" className="h-4 w-4" /></a>}>
        {stripe ? <p>A Stripe tenta a cobrança novamente nos próximos dias. Para trocar o cartão, fale com a plataforma. Após o pagamento confirmado, o acesso é regularizado automaticamente. Seus agendamentos e histórico permanecem preservados.</p>
          : <p>No Mercado Pago, abra Seu perfil › Assinaturas, escolha a assinatura Everflair e altere o meio de pagamento. Após o pagamento confirmado, o acesso é regularizado automaticamente. Seus agendamentos e histórico permanecem preservados.</p>}
        {sub.state === "RESTRICTED" && <p className="text-muted-foreground">Se preferir recomeçar, cancele a renovação abaixo e contrate um plano novamente.</p>}
      </Notice>}
      {sub?.state === "EXPIRED" && <Notice tone="neutral">Este plano terminou. Escolha um plano abaixo para voltar a usar todos os recursos. Seus agendamentos e histórico foram preservados.</Notice>}
      {sub?.reviewRequired && <Notice tone="warn">Há uma ocorrência financeira em revisão. Entre em contato com a plataforma para acompanhar.</Notice>}
      {change && reactivation && sub?.changePending && <Notice tone={["AWAITING_PAYMENT", "REVIEW"].includes(change.state) ? "warn" : change.state === "SCHEDULED" ? "ok" : "neutral"} title="Reativação da renovação"
        actions={<>
          {changeCheckout ? <a href={changeCheckout} className={cn(buttonVariants(), "h-auto whitespace-normal rounded-lg text-center")}>Autorizar no Mercado Pago<ExternalLink aria-hidden="true" className="h-4 w-4" /></a>
            : (preparingChangeCheckout || change.state === "PREPARING") && <span className="inline-flex items-center gap-2 text-muted-foreground"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />Preparando a autorização segura…</span>}
          {!change.paidAt && ["PREPARING", "AWAITING_PAYMENT", "SCHEDULED"].includes(change.state) && <Button variant="outline" disabled={busy} onClick={onCancelChange}>Desistir da reativação</Button>}
        </>}>
        <p role="status" className="font-medium">{reactivationLabels[change.state] ?? "Acompanhando reativação"}</p>
        <p>A renovação volta em {date(change.periodEnd)}: {billingMoney(change.to.amountCents)} {change.to.cycle === "ANNUAL" ? "a cada 12 meses" : "por mês"}. Nada é cobrado antes dessa data.</p>
        {change.state !== "SCHEDULED" && change.state !== "REVIEW" && <p className="text-muted-foreground">Como a recorrência anterior foi encerrada, o Mercado Pago pede uma nova autorização do cartão. Sem ela em até 24 horas, a reativação é descartada e nada muda.</p>}
        {change.state === "REVIEW" && <p>Uma ocorrência precisa de conferência. Seu histórico foi preservado. Entre em contato com a plataforma.</p>}
      </Notice>}
      {priceReduction && change && <Notice tone={change.state === "REVIEW" ? "warn" : change.state === "CANCEL_REQUESTED" ? "neutral" : "ok"} title={change.state === "CANCEL_REQUESTED" ? "Liberando a troca de plano" : "Seu plano ficou mais barato"}
        actions={!change.paidAt && ["PREPARING", "SCHEDULED"].includes(change.state) ? <Button variant="outline" disabled={busy} onClick={onCancelChange}>Mudar de plano agora</Button> : undefined}>
        {change.state === "CANCEL_REQUESTED" ? <p>Estamos desfazendo a redução no Mercado Pago para liberar a troca de plano. Esta página acompanha a confirmação.</p>
          : change.state === "REVIEW" ? <p>Uma ocorrência precisa de conferência. Seu histórico foi preservado. Entre em contato com a plataforma.</p>
          : <><p>A partir de {date(change.effectiveAt)}, a cobrança {change.to.cycle === "ANNUAL" ? "anual" : "mensal"} passa de {billingMoney(change.from.amountCents)} para {billingMoney(change.to.amountCents)}. Nada muda no seu plano e você não precisa fazer nada.</p>
            <p className="text-muted-foreground">Quer mudar de plano antes disso? O novo plano já segue a tabela atual.</p></>}
      </Notice>}
      {change && !reactivation && !priceReduction && (sub?.changePending || interruptedCycle) && <Notice tone={["AWAITING_PAYMENT", "REVIEW"].includes(change.state) && !interruptedCycle ? "warn" : "neutral"} title={`Troca para ${billingCapacityLabel(change.to.plan, change.to.agendaLimit)} · ${change.to.cycle === "ANNUAL" ? "anual" : "mensal"}`}
        actions={<>
          {changeCheckout ? <a href={changeCheckout} className={cn(buttonVariants(), "h-auto whitespace-normal rounded-lg text-center")}>{change.kind === "CYCLE" ? "Autorizar nova recorrência" : "Pagar diferença no Mercado Pago"}<ExternalLink aria-hidden="true" className="h-4 w-4" /></a>
            : (preparingChangeCheckout || change.state === "PREPARING") && <span className="inline-flex items-center gap-2 text-muted-foreground"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />Preparando pagamento seguro…</span>}
          {sub?.changePending && !change.paidAt && change.state !== "REVIEW" && change.state !== "CANCEL_REQUESTED" && <Button variant="outline" disabled={busy} onClick={onCancelChange}>Cancelar esta troca</Button>}
        </>}>
        <p role="status" className="font-medium">{interruptedCycle ? "A mudança de ciclo não foi concluída" : changeLabels[change.state] ?? "Acompanhando troca"}</p>
        {interruptedCycle ? <p>A renovação automática está desligada. Escolha o ciclo novamente abaixo para continuar depois do período pago.</p>
          : change.kind === "UPGRADE" ? <p>Diferença deste período: {billingMoney(change.amountDueCents)}. Vencimento mantido em {date(change.periodEnd)}. O plano maior é liberado logo após o pagamento.</p>
          : <p>Novo ciclo a partir de {date(change.effectiveAt)}: {billingMoney(change.to.amountCents)} {change.to.cycle === "ANNUAL" ? "a cada 12 meses" : "por mês"}, após confirmação do pagamento correspondente.</p>}
        {change.to.agendaLimit < change.from.agendaLimit && sub?.changePending && <p className="text-muted-foreground">A troca reserva o limite de {change.to.agendaLimit} agendas para novos profissionais e convites. Seus atendimentos e histórico permanecem.</p>}
        {change.kind === "CYCLE" && sub?.changePending && <p className="text-muted-foreground">O link de autorização será liberado após confirmar o encerramento da recorrência anterior. Conclua a autorização da nova assinatura para continuar no próximo ciclo. Seu período já pago será preservado.</p>}
        {change.state === "REVIEW" && <p>Uma ocorrência de pagamento precisa de conferência. Seu histórico foi preservado. Entre em contato com a plataforma.</p>}
      </Notice>}
    </div>

    {showUsage && <div className="border-t border-border px-4 py-4 sm:px-6">
      <div className="flex items-center justify-between gap-3 text-sm"><span className="font-medium">Agendas em uso</span><span className="tabular-nums text-muted-foreground"><strong className="font-semibold text-foreground">{occupiedAgendas}</strong> de {capacity}</span></div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Agendas em uso" aria-valuemin={0} aria-valuemax={capacity} aria-valuenow={Math.min(occupiedAgendas, capacity)}>
        <div className={cn("h-full rounded-full", occupiedAgendas >= capacity ? "bg-warning" : "bg-primary")} style={{ width: `${Math.min(100, capacity ? (occupiedAgendas / capacity) * 100 : 0)}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Profissionais ativos e convites pendentes ocupam uma agenda cada.{occupiedAgendas >= capacity ? " Para adicionar alguém, escolha um plano com mais agendas." : ""}</p>
    </div>}

    <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-t border-border px-4 py-4 text-sm sm:gap-x-6 sm:px-6 lg:grid-cols-4">
      {sub && <div><dt className="text-muted-foreground">Acesso pago até</dt><dd className="mt-1 font-medium">{accessUntil ?? "Ainda não confirmado"}</dd></div>}
      {sub && sub.state !== "UNPAID" && <div><dt className="text-muted-foreground">Próxima cobrança</dt><dd className="mt-1 font-medium">{next ? `${date(next.at)} · ${billingMoney(next.amountCents)}${next.afterAuthorization ? ", após sua autorização" : ""}` : "Sem novas cobranças"}</dd></div>}
      {sub && <div><dt className="text-muted-foreground">Periodicidade</dt><dd className="mt-1 font-medium">{next && next.cycle !== sub.cycle ? `${cycleName(sub.cycle)} · ${cycleName(next.cycle).toLocaleLowerCase("pt-BR")} a partir de ${date(next.at)}` : cycleName(sub.cycle)}</dd></div>}
      <div className="col-span-2 min-w-0 lg:col-span-1"><dt className="text-muted-foreground">E-mail da contratação</dt><dd className="mt-1 break-all font-medium">{email}</dd></div>
    </dl>
  </section>;
}
