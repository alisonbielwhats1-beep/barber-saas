"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, LockKeyhole, UnlockKeyhole } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { closeCashRegister, openCashRegister, setDepositStatus } from "./actions";

function toCents(value: string) {
  return Math.round((Number(value.replace(",", ".")) || 0) * 100);
}

export function CashControls({ isOpen, expectedCashCents }: { isOpen: boolean; expectedCashCents: number }) {
  const [amount, setAmount] = useState((expectedCashCents / 100).toFixed(2));
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = isOpen
        ? await closeCashRegister({ countedCashCents: toCents(amount), expectedCashCents, notes })
        : await openCashRegister({ openingFloatCents: toCents(amount), notes });
      if ("error" in result) toast(result.error, "error");
      else toast(isOpen ? "Caixa fechado e conferido" : "Caixa aberto");
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="cash-amount" className="mb-1 block text-[11px] font-medium text-muted-foreground">
          {isOpen ? "Dinheiro contado no caixa" : "Fundo de troco inicial"}
        </label>
        <div className="flex h-11 items-center rounded-xl border border-border bg-background px-3 text-[13px]">
          <span className="mr-2 text-muted-foreground">R$</span>
          <input id="cash-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="w-full bg-transparent outline-none" />
        </div>
      </div>
      <div>
        <label htmlFor="cash-notes" className="mb-1 block text-[11px] font-medium text-muted-foreground">Observação</label>
        <input id="cash-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Opcional" className="h-11 w-full rounded-xl border border-border bg-background px-3 text-[13px] outline-none" />
      </div>
      <button onClick={submit} disabled={pending} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[13px] font-semibold text-primary-foreground disabled:opacity-60">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : isOpen ? <LockKeyhole className="h-4 w-4" /> : <UnlockKeyhole className="h-4 w-4" />}
        {isOpen ? "Conferir e fechar caixa" : "Abrir caixa"}
      </button>
    </div>
  );
}

export function DepositControls({ appointmentId, amountCents, status }: {
  appointmentId: string;
  amountCents: number;
  status: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useState(status);
  function change(next: "REQUESTED" | "RECEIVED" | "WAIVED") {
    startTransition(async () => {
      const result = await setDepositStatus({ appointmentId, amountCents, status: next });
      if ("error" in result) toast(result.error, "error");
      else {
        setCurrent(next);
        toast(next === "RECEIVED" ? "Sinal confirmado" : next === "REQUESTED" ? "Sinal marcado como solicitado" : "Sinal dispensado");
      }
    });
  }
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {current === "RECEIVED" ? (
        <span className="inline-flex h-8 items-center gap-1 rounded-lg bg-success/10 px-2.5 text-[11px] font-semibold text-success"><Check className="h-3.5 w-3.5" /> Recebido</span>
      ) : (
        <>
          <button onClick={() => change("REQUESTED")} disabled={pending} className="h-8 rounded-lg border border-border px-2.5 text-[11px] font-medium">{current === "REQUESTED" ? "Solicitado" : "Solicitar"}</button>
          <button onClick={() => change("RECEIVED")} disabled={pending} className="h-8 rounded-lg bg-primary/10 px-2.5 text-[11px] font-semibold text-primary">Confirmar</button>
          <button onClick={() => change("WAIVED")} disabled={pending} className="h-8 rounded-lg px-2 text-[11px] text-muted-foreground">Dispensar</button>
        </>
      )}
    </div>
  );
}
