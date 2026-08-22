"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { formatMoney } from "@/lib/utils";
import { recordDailyClosing } from "./actions";

function parseCents(value: string): number | null {
  const normalized = value.trim().replace(/\./g, "").replace(",", ".");
  if (!normalized) return null;
  const reais = Number(normalized);
  return Number.isFinite(reais) && reais >= 0 ? Math.round(reais * 100) : null;
}

export function ClosingForm({
  dateKey,
  cashReceivedCents,
  currency,
  closed,
}: {
  dateKey: string;
  cashReceivedCents: number;
  currency: string;
  closed: {
    actorName: string;
    createdAt: string;
    declaredCashCents: number | null;
    cashDifferenceCents: number | null;
    notes: string | null;
  } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cash, setCash] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const declaredCashCents = parseCents(cash);
    if (cash.trim() && declaredCashCents === null) {
      setError("Informe um valor válido para o dinheiro contado.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await recordDailyClosing({
        dateKey,
        declaredCashCents,
        notes: notes.trim() || null,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (closed) {
    return (
      <div className="rounded-2xl border border-success/30 bg-success/5 p-4">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
          <div className="min-w-0">
            <p className="font-semibold">Dia fechado</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Conferido por {closed.actorName} em {new Date(closed.createdAt).toLocaleString("pt-BR")}.
            </p>
            {closed.declaredCashCents !== null && (
              <p className="mt-3 text-sm">
                Dinheiro contado: <strong>{formatMoney(closed.declaredCashCents, currency)}</strong>
                {closed.cashDifferenceCents !== null && (
                  <span className={closed.cashDifferenceCents === 0 ? "text-success" : "text-warning"}>
                    {closed.cashDifferenceCents === 0
                      ? " · confere"
                      : ` · diferença de ${formatMoney(Math.abs(closed.cashDifferenceCents), currency)}`}
                  </span>
                )}
              </p>
            )}
            {closed.notes && <p className="mt-2 text-sm text-muted-foreground">{closed.notes}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-primary/25 bg-primary/5 p-4 sm:p-5">
      <div>
        <h2 className="text-base font-semibold">Conferir e fechar o dia</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          O sistema registrou {formatMoney(cashReceivedCents, currency)} em dinheiro. Compare com o valor contado antes de concluir.
        </p>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,18rem)_1fr]">
        <div>
          <label htmlFor="declared-cash" className="mb-1.5 block text-sm font-medium">
            Dinheiro contado <span className="font-normal text-muted-foreground">(opcional)</span>
          </label>
          <input
            id="declared-cash"
            value={cash}
            onChange={(event) => setCash(event.target.value)}
            inputMode="decimal"
            placeholder="0,00"
            className="min-h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div>
          <label htmlFor="closing-notes" className="mb-1.5 block text-sm font-medium">
            Observação <span className="font-normal text-muted-foreground">(opcional)</span>
          </label>
          <textarea
            id="closing-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Ex.: diferença conferida na gaveta da recepção"
            className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>
      {error && <p role="alert" className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {pending ? "Fechando…" : "Fechar dia"}
      </button>
    </form>
  );
}
