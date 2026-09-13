"use client";

import { useState } from "react";
import { BILLING_PLANS, quoteContract } from "@/lib/billing/catalog";
import { billingIntentHref, billingMoney, type BillingIntent } from "@/lib/billing/presentation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";

export function PlanPicker({ initial, disabled, onChoose, segment, marketing = false, billingAvailable = true }: {
  initial?: BillingIntent; disabled?: boolean; onChoose?: (intent: BillingIntent) => void; segment?: string; marketing?: boolean; billingAvailable?: boolean;
}) {
  const [cycle, setCycle] = useState<BillingIntent["cycle"]>(initial?.cycle ?? "MONTHLY");
  const [extra, setExtra] = useState(initial?.extraAgendas ?? 0);
  return <div className={marketing ? "pc-picker" : "space-y-5"}>
    <fieldset disabled={disabled} className={marketing ? "pc-cycle" : "flex flex-wrap gap-2"}><legend className="mb-2 text-sm font-medium">Periodicidade da cobrança</legend>
      {(["MONTHLY", "ANNUAL"] as const).map(value => <label key={value} data-selected={cycle === value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-4 py-3 text-sm">
        <input type="radio" name="billing-cycle" value={value} checked={cycle === value} onChange={() => setCycle(value)} />{value === "MONTHLY" ? "Mensal" : "Anual · pagamento único a cada 12 meses"}
      </label>)}
    </fieldset>
    <div className={marketing ? "pc-cards" : "grid gap-4 sm:grid-cols-2 xl:grid-cols-4"}>{Object.entries(BILLING_PLANS).map(([code, plan]) => {
      const intent: BillingIntent = { plan: code as BillingIntent["plan"], cycle, extraAgendas: code === "TEAM_MAX" ? extra : 0 };
      const quote = quoteContract(intent);
      const saving = quoteContract({ ...intent, cycle: "MONTHLY" }).amountCents * 12 - quote.amountCents;
      return <article key={code} data-featured={marketing && code === "TEAM_PLUS"} className={marketing ? "pc-plan" : `flex min-w-0 flex-col rounded-xl border bg-surface-1 p-5 ${initial?.plan === code ? "border-primary" : "border-border"}`}>
        {marketing && <span className="pc-plan-kind">{code === "INDIVIDUAL" ? "SEU TALENTO, SEU ESPAÇO" : code === "TEAM" ? "PARA COMPARTILHAR A ROTINA" : code === "TEAM_PLUS" ? "MAIS ESPAÇO PARA SUA EQUIPE" : "PARA CRESCER COM VOCÊ"}</span>}
        <h3 className="text-lg font-semibold">{plan.label}</h3>
        <p className="pc-price mt-4 text-2xl font-semibold tabular-nums">{billingMoney(quote.amountCents)}</p>
        <p className="text-sm text-muted-foreground">{cycle === "ANNUAL" ? "cobrados a cada 12 meses" : "cobrados por mês"}</p>
        {cycle === "ANNUAL" && <p className="pc-saving mt-2 text-sm">Economize {billingMoney(saving)} em relação a 12 mensalidades.</p>}
        <p className="mt-4 font-medium">{quote.agendaLimit} {quote.agendaLimit === 1 ? "agenda" : "agendas"}</p>
        <p className="mt-2 text-sm text-muted-foreground">Todos os recursos dos planos pagos. Agendamentos ilimitados.</p>
        {code === "TEAM_MAX" && <div className="mt-4"><label htmlFor="billing-extras" className="text-sm">Agendas adicionais às 10 incluídas</label>
          <Input id="billing-extras" type="number" min={0} max={100} step={1} value={extra} disabled={disabled} onChange={e => setExtra(Math.min(100, Math.max(0, Math.trunc(Number(e.target.value) || 0))))} />
          <p className="mt-1 text-xs text-muted-foreground">{billingMoney(cycle === "ANNUAL" ? 14400 : 1500)} por agenda/{cycle === "ANNUAL" ? "ano" : "mês"}.</p></div>}
        <div className="mt-auto pt-5">{onChoose ? <Button className="w-full" disabled={disabled} onClick={() => onChoose(intent)}>Escolher {plan.label}</Button>
          : <Link className={marketing ? `mk-button ${code === "TEAM_PLUS" ? "" : "mk-button-outline"}` : "inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"} href={billingIntentHref(intent, billingAvailable ? "/contratar" : "/signup") + (segment ? `&segment=${encodeURIComponent(segment)}` : "")}>Escolher {plan.label}</Link>}</div>
      </article>;
    })}</div>
    <p className="pc-note text-sm text-muted-foreground">{billingAvailable ? "A renovação é automática no Mercado Pago. Cancele a renovação quando quiser; o acesso permanece até o fim do período pago." : "Os valores anuais são cobrados de uma vez a cada 12 meses. Nenhuma cobrança é feita ao escolher um plano."}</p>
  </div>;
}
