"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { BILLING_PLANS } from "@/lib/billing/catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { grantSalonPlan } from "../actions";

export function PlanGrantControl({ salonId, salonName }: { salonId: string; salonName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<keyof typeof BILLING_PLANS>("INDIVIDUAL");
  const [through, setThrough] = useState("");
  const [reason, setReason] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = BILLING_PLANS[plan];
  const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return <>
    <Button size="sm" variant="outline" onClick={() => { setKey(crypto.randomUUID()); setError(""); setOpen(true); }}>Plano e cortesia</Button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Plano de {salonName}</DialogTitle>
          <DialogDescription>Libere um plano por um período gratuito. Assinaturas pagas e planos legados são preservados.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={async event => {
          event.preventDefault(); if (busy) return; setBusy(true); setError("");
          try { await grantSalonPlan({ salonId, requestKey: key, plan, through, reason }); setOpen(false); router.refresh(); }
          catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar a cortesia."); }
          finally { setBusy(false); }
        }}>
          <fieldset disabled={busy} className="space-y-4">
            <div><label htmlFor={`plan-${salonId}`} className="text-sm font-medium">Plano</label>
              <select id={`plan-${salonId}`} value={plan} onChange={e => { setPlan(e.target.value as keyof typeof BILLING_PLANS); setKey(crypto.randomUUID()); }} className="mt-1 min-h-11 w-full rounded-lg border border-input bg-background px-3">
                {Object.entries(BILLING_PLANS).map(([code, p]) => <option key={code} value={code}>{p.label} · {money(p.monthly)}/mês</option>)}
              </select></div>
            <div><label htmlFor={`through-${salonId}`} className="text-sm font-medium">Grátis até (inclusive)</label>
              <Input id={`through-${salonId}`} type="date" required value={through} onChange={e => { setThrough(e.target.value); setKey(crypto.randomUUID()); }} /></div>
            <div><label htmlFor={`reason-${salonId}`} className="text-sm font-medium">Motivo da cortesia</label>
              <Input id={`reason-${salonId}`} required minLength={3} maxLength={500} value={reason} onChange={e => { setReason(e.target.value); setKey(crypto.randomUUID()); }} /></div>
            <p className="rounded-lg bg-muted p-3 text-sm">{selected.label}: {selected.agendas} {selected.agendas === 1 ? "agenda" : "agendas"}, agendamentos ilimitados durante a cortesia. Depois do prazo, volta ao Grátis. Para continuar no plano, a proprietária contrata por {money(selected.monthly)}/mês no aplicativo. Nenhuma cobrança automática será criada.</p>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Voltar</Button>
              <Button type="submit" disabled={busy || !through || reason.trim().length < 3}>{busy ? "Salvando…" : "Confirmar cortesia"}</Button></div>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
