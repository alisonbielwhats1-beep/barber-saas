"use client";

import { useState } from "react";
import { Check, ExternalLink, Loader2, Minus, Plus, Users } from "lucide-react";
import { BILLING_PLANS, EXTRA_AGENDA, quoteContract } from "@/lib/billing/catalog";
import { annualSavingsCents, billingMoney, sameBillingTerms, safeCheckout, type BillingIntent } from "@/lib/billing/presentation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type PlanTerms = { plan: BillingIntent["plan"]; cycle: BillingIntent["cycle"]; agendaLimit: number; amountCents: number };
export type PlanPickerMode = "subscribe" | "replace-pending" | "change";

// Same composition as the approved public offer: Equipe groups 5 and 10 agendas.
const OFFERS = [
  { id: "individual", name: "Individual", description: "Para quem trabalha por conta própria." },
  { id: "essencial", name: "Essencial", description: "Para organizar o trabalho em conjunto." },
  { id: "equipe", name: "Equipe", description: "Mais espaço para o seu negócio." },
] as const;
const ANNUAL_SAVING_PERCENT = Math.floor(Math.max(...(Object.keys(BILLING_PLANS) as BillingIntent["plan"][]).map(plan => {
  const intent = { plan, cycle: "MONTHLY" as const, extraAgendas: 0 };
  return annualSavingsCents(intent) / (quoteContract(intent).amountCents * 12);
})) * 100);
const agendas = (count: number) => `${count} ${count === 1 ? "agenda" : "agendas"}`;

export function PlanPicker({ mode, initial, current, pending, occupiedAgendas = 0, disabled, lockedReason, loadingKey, feedback, onChoose, paymentNote }: {
  mode: PlanPickerMode;
  initial?: BillingIntent;
  /** Paid terms in use; its card is marked and cannot be chosen again. */
  current?: PlanTerms | null;
  /** Unpaid contract; its card continues the existing checkout, or replaces it when its price is outdated. */
  pending?: (PlanTerms & { checkoutUrl: string | null; outdated?: boolean }) | null;
  occupiedAgendas?: number;
  disabled?: boolean;
  /** Explains why no plan can be chosen right now, keeping the comparison visible. */
  lockedReason?: string | null;
  loadingKey?: string | null;
  /** Result of the last choice (e.g. a rejected quote), shown next to the cards that caused it. */
  feedback?: React.ReactNode;
  onChoose: (intent: BillingIntent) => void;
  /** Where the owner pays; defaults to Mercado Pago, the only gateway before Stripe. */
  paymentNote?: string;
}) {
  const anchor = initial ?? current ?? pending;
  const [cycle, setCycle] = useState<BillingIntent["cycle"]>(anchor?.cycle ?? "MONTHLY");
  const [teamSize, setTeamSize] = useState<5 | 10>(anchor?.plan === "TEAM_MAX" ? 10 : 5);
  const [extra, setExtra] = useState(initial?.extraAgendas ?? (anchor?.plan === "TEAM_MAX" && "agendaLimit" in anchor ? Math.max(0, anchor.agendaLimit - 10) : 0));
  const annual = cycle === "ANNUAL";
  const setExtraSafe = (value: number) => setExtra(Math.min(100, Math.max(0, Math.trunc(value) || 0)));

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <fieldset disabled={disabled} className="inline-flex max-w-full gap-[3px] rounded-[11px] border border-border-strong bg-card p-[3px]">
        <legend className="sr-only">Periodicidade da cobrança</legend>
        {(["MONTHLY", "ANNUAL"] as const).map(value => <label key={value} className={cn("flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-sm transition-colors lg:min-h-[34px] [&:has(:focus-visible)]:ring-2 [&:has(:focus-visible)]:ring-ring", cycle === value ? "bg-[hsl(var(--border))] font-semibold text-foreground ring-1 ring-inset ring-border-strong" : "font-medium text-muted-foreground hover:text-foreground")}>
          <input type="radio" className="sr-only" name="billing-cycle" value={value} checked={cycle === value} onChange={() => setCycle(value)} />
          {value === "MONTHLY" ? "Mensal" : "Anual"}
          {value === "ANNUAL" && <span className="text-xs font-medium text-muted-foreground">economize até {ANNUAL_SAVING_PERCENT}%</span>}
        </label>)}
      </fieldset>
      <p className="text-sm text-muted-foreground">{annual ? "Pagamento único a cada 12 meses." : "Cobrança mensal automática."}</p>
    </div>

    <div className="grid gap-4 md:grid-cols-3">{OFFERS.map(offer => {
      const code: BillingIntent["plan"] = offer.id === "individual" ? "INDIVIDUAL" : offer.id === "essencial" ? "TEAM" : teamSize === 10 ? "TEAM_MAX" : "TEAM_PLUS";
      const intent: BillingIntent = { plan: code, cycle, extraAgendas: code === "TEAM_MAX" ? extra : 0 };
      const quote = quoteContract(intent);
      const terms = { plan: code, cycle, agendaLimit: quote.agendaLimit };
      const planName = BILLING_PLANS[code].label;
      const isCurrent = Boolean(current && sameBillingTerms(current, terms));
      const isPending = Boolean(pending && sameBillingTerms(pending, terms));
      const tooSmall = quote.agendaLimit < occupiedAgendas;
      const marked = isCurrent || isPending || (!current && !pending && initial?.plan === code);
      const upgrade = current && cycle === current.cycle && quote.agendaLimit > current.agendaLimit && quote.amountCents > current.amountCents;
      // Less capacity does not always cost less: a contract below today's table keeps that price only while unchanged.
      const reduction = current && cycle === current.cycle && quote.agendaLimit < current.agendaLimit && quote.amountCents < current.amountCents;
      const action = mode === "subscribe" ? "Assinar" : mode === "replace-pending" ? "Trocar para este plano"
        : current && cycle !== current.cycle ? `Mudar para ${annual ? "anual" : "mensal"}` : upgrade ? "Fazer upgrade" : reduction ? "Reduzir para este plano" : "Mudar para este plano";
      const loading = loadingKey === JSON.stringify(intent);
      const checkout = isPending && pending ? safeCheckout(pending.checkoutUrl) : null;
      // An unpaid attempt priced under an earlier table is replaced at today's price, never paid as is.
      const outdatedPending = isPending && pending && pending.outdated ? pending : null;
      const priceCents = isCurrent && current ? current.amountCents : quote.amountCents;
      const per = annual ? "ano" : "mês";
      return <article key={offer.id} aria-labelledby={`plan-${offer.id}`} className={cn("flex min-w-0 flex-col rounded-[14px] border bg-card p-4", marked ? "border-primary/60 ring-1 ring-primary/60" : "border-border")}>
        <div className="flex min-h-7 flex-wrap items-center justify-between gap-2">
          <h3 id={`plan-${offer.id}`} className="text-base font-semibold">{offer.name}</h3>
          {isCurrent && <span className="inline-flex min-h-[22px] items-center rounded-full bg-muted px-2.5 text-xs font-medium text-foreground">Seu plano</span>}
          {isPending && <span className="inline-flex min-h-[22px] items-center rounded-full bg-warning/15 px-2.5 text-xs font-medium text-warning">Escolhido</span>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{offer.description}</p>
        {offer.id === "equipe" && <fieldset disabled={disabled} className="mt-3 grid grid-cols-2 gap-[3px] rounded-[11px] border border-border-strong bg-card p-[3px]">
          <legend className="sr-only">Agendas incluídas no Equipe</legend>
          {([5, 10] as const).map(size => <label key={size} className={cn("flex min-h-11 cursor-pointer items-center justify-center rounded-lg text-sm transition-colors lg:min-h-[34px] [&:has(:focus-visible)]:ring-2 [&:has(:focus-visible)]:ring-ring", teamSize === size ? "bg-[hsl(var(--border))] font-semibold text-foreground ring-1 ring-inset ring-border-strong" : "font-medium text-muted-foreground hover:text-foreground")}>
            <input type="radio" className="sr-only" name="billing-team-size" checked={teamSize === size} onChange={() => setTeamSize(size)} />{size} agendas
          </label>)}
        </fieldset>}
        <p className="mt-5 flex flex-wrap items-baseline gap-x-1"><span className="whitespace-nowrap text-2xl font-semibold tracking-[-0.02em] tabular-nums">{billingMoney(priceCents)}</span><span className="text-sm text-muted-foreground">/{annual ? "ano" : "mês"}</span></p>
        <p className="mt-1 min-h-5 text-xs text-muted-foreground">{isCurrent && current ? current.amountCents === quote.amountCents ? "Valor do seu contrato." : `Valor do seu contrato. Para novas contratações: ${billingMoney(quote.amountCents)}/${per}.`
          : outdatedPending ? `Preço atual. Sua tentativa, ainda não paga, foi criada a ${billingMoney(outdatedPending.amountCents)}/${per}.`
          : annual ? `Equivale a ${billingMoney(Math.round(quote.amountCents / 12))}/mês · economize ${billingMoney(annualSavingsCents(intent))}` : "Renovação mensal · cancele quando quiser"}</p>
        <ul className="mt-4 space-y-2 text-sm">
          <li className="flex items-center gap-2.5"><Users aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" /><span><strong className="font-semibold">{agendas(quote.agendaLimit)}</strong> {quote.agendaLimit === 1 ? "profissional" : "profissionais"}</span></li>
          <li className="flex items-center gap-2.5"><Check aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />Agendamentos ilimitados</li>
          <li className="flex items-center gap-2.5"><Check aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />Todos os recursos do Everflair</li>
        </ul>
        {code === "TEAM_MAX" && <div className="mt-4 rounded-xl border border-border p-3">
          <label htmlFor="billing-extras" className="text-sm font-medium">Agendas adicionais às 10 incluídas</label>
          <div className="mt-2 flex items-center gap-2">
            <Button type="button" variant="outline" size="icon" aria-label="Remover uma agenda adicional" disabled={disabled || extra <= 0} onClick={() => setExtraSafe(extra - 1)}><Minus aria-hidden="true" className="h-4 w-4" /></Button>
            <Input id="billing-extras" type="number" inputMode="numeric" min={0} max={100} step={1} value={extra} disabled={disabled} onChange={e => setExtraSafe(Number(e.target.value))} className="h-11 w-20 text-center tabular-nums" />
            <Button type="button" variant="outline" size="icon" aria-label="Adicionar uma agenda adicional" disabled={disabled || extra >= 100} onClick={() => setExtraSafe(extra + 1)}><Plus aria-hidden="true" className="h-4 w-4" /></Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{billingMoney(annual ? EXTRA_AGENDA.annual : EXTRA_AGENDA.monthly)} por agenda/{annual ? "ano" : "mês"}.</p>
        </div>}
        <div className="mt-auto pt-5">
          {isCurrent ? <Button className="w-full" variant="outline" disabled><Check aria-hidden="true" className="h-4 w-4" />Plano atual</Button>
            : outdatedPending ? <Button className="w-full" disabled={disabled || Boolean(lockedReason)} aria-label={`Atualizar para o novo preço: ${planName}`} onClick={() => onChoose(intent)}>Atualizar para o novo preço</Button>
            : isPending ? checkout ? <a href={checkout} className={cn(buttonVariants(), "w-full")} aria-label={`Continuar pagamento: ${planName}`}>Continuar pagamento<ExternalLink aria-hidden="true" className="h-4 w-4" /></a>
              : <Button className="w-full" variant="outline" disabled>Preparando pagamento…</Button>
            : <Button className="w-full" variant={!tooSmall && (mode === "subscribe" || upgrade) ? "default" : "outline"} disabled={disabled || tooSmall || Boolean(lockedReason)} aria-label={`${action}: ${planName}`} onClick={() => onChoose(intent)}>
              {loading && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}{action}
            </Button>}
          {tooSmall && !isCurrent && <p className="mt-2 text-xs text-muted-foreground">Sua equipe usa {agendas(occupiedAgendas)}. Escolha uma capacidade maior.</p>}
        </div>
      </article>;
    })}</div>
    {feedback}

    {lockedReason ? <p role="note" className="rounded-xl border border-border-strong bg-card px-3.5 py-3 text-sm text-muted-foreground">{lockedReason}</p>
      : mode === "change" ? <dl className="grid gap-3 rounded-[14px] border border-border bg-card p-4 text-sm sm:grid-cols-3">
        <div><dt className="font-semibold">Upgrade</dt><dd className="mt-1 text-muted-foreground">Liberado logo após o pagamento da diferença proporcional. O vencimento continua o mesmo.</dd></div>
        <div><dt className="font-semibold">Redução</dt><dd className="mt-1 text-muted-foreground">Vale a partir do próximo vencimento. Até lá, nada muda no seu plano.</dd></div>
        <div><dt className="font-semibold">Mensal ou anual</dt><dd className="mt-1 text-muted-foreground">Começa no próximo vencimento, com uma nova autorização no Mercado Pago.</dd></div>
      </dl>
      : <p className="text-sm text-muted-foreground">{paymentNote ?? "Pagamento seguro pelo Mercado Pago."} A renovação é automática e pode ser cancelada quando quiser; o acesso continua até o fim do período pago.</p>}
  </div>;
}
