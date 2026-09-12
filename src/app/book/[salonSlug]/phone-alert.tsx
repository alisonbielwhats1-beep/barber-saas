"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatPhoneBR } from "@/lib/phone";
import { saveClientPhone } from "./phone-actions";

export function PhoneAlert({ salonSlug }: { salonSlug: string }) {
  const [phone, setPhone] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const router = useRouter();
  return <section aria-label="Telefone pendente" className="m-3 rounded-xl border border-warning/40 bg-warning/10 p-3">
    <p role="status" className="text-sm font-semibold">Complete seu cadastro: informe seu telefone</p>
    <p className="mt-1 text-xs text-muted-foreground">O estabelecimento precisa desse contato para falar com você sobre seus atendimentos.</p>
    <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={async event => {
      event.preventDefault();
      if (pending) return;
      setPending(true); setError(undefined);
      try {
        const result = await saveClientPhone(salonSlug, phone);
        if ("error" in result) setError(result.error);
        else router.refresh();
      } catch { setError("Não foi possível salvar. Tente novamente."); }
      finally { setPending(false); }
    }}>
      <label className="min-w-0 flex-1 text-xs">WhatsApp com DDD<input required disabled={pending} type="tel" autoComplete="tel" maxLength={32} value={phone} onChange={event => setPhone(formatPhoneBR(event.target.value))} className="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm" /></label>
      <button disabled={pending} className="min-h-11 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">{pending ? "Salvando…" : "Salvar telefone"}</button>
      {error && <p role="alert" className="w-full text-sm text-danger">{error}</p>}
    </form>
  </section>;
}
