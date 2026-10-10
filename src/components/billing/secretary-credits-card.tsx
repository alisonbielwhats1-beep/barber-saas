"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { billingErrors, billingMoney, safeCheckout } from "@/lib/billing/presentation";
import type { CreditView } from "@/lib/secretary-credits-rules";
import { goToCheckout } from "./navigation";

type Pack = { code: string; amountCents: number; estimatedRequests: number };
type Purchase = { id: string; packCode: string; amountCents: number; estimatedRequests: number; state: string; createdAt: string; paidAt: string | null; refundedCents: number; checkoutUrl: string | null };
type CreditsData = { view: CreditView; buyable: boolean; packs: Pack[]; purchases: Purchase[] };
const purchaseLabels: Record<string, string> = { CREATED: "Preparando", AWAITING_PAYMENT: "Aguardando pagamento", PAID: "Pago", EXPIRED: "Não concluída", REFUNDED: "Estornada", REVIEW: "Em revisão" };
const tone = { OK: "bg-[hsl(var(--selection-solid))]", LOW: "bg-warning", EMPTY: "bg-danger" } as const;

/** Owner only, in Plano e assinatura (owner decisions 06/10/2026): the Secretária's credit as a bar and a percentage only, the
 * packs (Pix or card through Mercado Pago; the number of requests is an estimate, never a promise) and the latest purchases.
 * A pack adds to what is left; the credit never expires; a free allowance comes every month. */
export function SecretaryCreditsCard({ salonId, timezone, returnedFromCheckout = false }: { salonId: string; timezone: string; returnedFromCheckout?: boolean }) {
  const [data, setData] = useState<CreditsData | null>();
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());
  const endpoint = `/api/billing/credits?salonId=${encodeURIComponent(salonId)}`;
  const load = useCallback(async (sync = false) => {
    try {
      const response = await fetch(`${endpoint}${sync ? "&sync=1" : ""}`, { cache: "no-store" });
      const body = await response.json() as CreditsData & { error?: string };
      if (!response.ok) { setData(null); setError(billingErrors[body.error ?? ""] ?? "Não foi possível consultar os pedidos da Secretária agora."); return; }
      setData(body); setError(null);
    } catch { setError("Não foi possível consultar os pedidos da Secretária agora."); }
  }, [endpoint]);
  // Back from the checkout, the payment is followed closely for a short while (Pix can take a few seconds).
  useEffect(() => {
    void load(returnedFromCheckout);
    if (!returnedFromCheckout) return;
    let tries = 0;
    const timer = setInterval(() => { tries += 1; void load(true); if (tries >= 6) clearInterval(timer); }, 5000);
    return () => clearInterval(timer);
  }, [load, returnedFromCheckout]);
  // Back from the checkout through the browser's back button (page restored from its cache): the buttons work again.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => { if (event.persisted) setBuying(null); };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);
  async function buy(pack: Pack) {
    if (buying) return;
    setBuying(pack.code); setError(null);
    // The same click retried keeps its key: one purchase, one checkout.
    const key = keys.current.get(pack.code) ?? crypto.randomUUID();
    keys.current.set(pack.code, key);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ pack: pack.code }) });
      const body = await response.json() as { checkoutUrl?: string; error?: string };
      const url = response.ok ? safeCheckout(body.checkoutUrl ?? null) : null;
      // Answered (even with a refusal): the next click is a new attempt. Only a lost connection keeps the same key.
      keys.current.delete(pack.code);
      if (!url) { setError(billingErrors[body.error ?? ""] ?? "Não foi possível abrir o pagamento agora. Tente novamente."); setBuying(null); return; }
      // Leaving for the checkout: the buttons stay disabled until the page changes (a second click would open a second purchase).
      goToCheckout(url);
    } catch { setError("Falha de conexão. Nada foi cobrado. Tente novamente."); setBuying(null); }
  }
  const date = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: timezone }).format(new Date(value));
  return <section id="secretaria" aria-labelledby="secretaria-pedidos" className="space-y-3.5 rounded-[14px] border border-border bg-card p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="secretaria-pedidos" className="text-base font-semibold">Crédito da Secretária</h2>
      {data && <span className="text-sm tabular-nums text-muted-foreground">{data.view.percent}% restantes</span>}
    </div>
    {data === undefined && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />Carregando…</p>}
    {data && <>
      <div role="progressbar" aria-label="Crédito restante da Secretária" aria-valuemin={0} aria-valuemax={100} aria-valuenow={data.view.percent} className="h-2 overflow-hidden rounded-full bg-[hsl(var(--border-strong))]">
        <div className={cn("h-full rounded-full", tone[data.view.status])} style={{ width: `${data.view.percent}%` }} />
      </div>
      {data.view.status === "LOW" && <p role="status" className="rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-3 text-sm">O crédito está acabando. Recarregue para a Secretária não parar.</p>}
      {data.view.status === "EMPTY" && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-3 text-sm">O crédito acabou. A Secretária volta assim que o pagamento for confirmado; a agenda segue normal.</p>}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
        {data.packs.map(pack => <Button key={pack.code} type="button" variant="outline" className="h-auto min-h-11 flex-col gap-0.5 py-2.5 tabular-nums" disabled={!data.buyable || Boolean(buying)} onClick={() => void buy(pack)}>
          <span className="font-semibold">{billingMoney(pack.amountCents)}</span><span className="text-xs text-muted-foreground">cerca de {pack.estimatedRequests} pedidos</span>
          {buying === pack.code && <Loader2 aria-hidden="true" className="mt-1 h-3 w-3 animate-spin" />}
        </Button>)}
      </div>
      <p className="text-xs text-muted-foreground">Pix ou cartão pelo Mercado Pago. Cada pedido usa uma parte do crédito conforme o tamanho, por isso a quantidade de pedidos é uma estimativa. A recarga soma ao que você já tem, o crédito não expira e todo mês há uma franquia grátis.</p>
      {!data.buyable && <p className="text-sm text-muted-foreground">A compra online está pausada no momento. Seu crédito continua valendo.</p>}
      {data.purchases.some(p => p.state === "REVIEW") && <p role="status" className="rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-3 text-sm">Um pagamento precisa de conferência antes de virar crédito. Nossa equipe já foi avisada e vai resolver com você: liberar o crédito ou estornar o valor.</p>}
      {data.purchases.length > 0 && <div className="space-y-1">
        <h3 className="text-sm font-semibold">Compras</h3>
        <ul className="divide-y divide-border rounded-xl border border-border text-sm">
          {data.purchases.map(p => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
            <span className="font-semibold tabular-nums">{billingMoney(p.amountCents)}<span className="block text-xs font-normal text-muted-foreground">{date(p.paidAt ?? p.createdAt)}</span></span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">{purchaseLabels[p.state] ?? p.state}
              {p.checkoutUrl && safeCheckout(p.checkoutUrl) && <Button type="button" size="sm" variant="ghost" onClick={() => goToCheckout(safeCheckout(p.checkoutUrl)!)}>Pagar</Button>}</span>
          </li>)}
        </ul>
      </div>}
    </>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </section>;
}
