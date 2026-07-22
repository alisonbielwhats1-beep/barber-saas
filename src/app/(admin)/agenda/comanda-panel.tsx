"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Loader2, Package, Scissors } from "lucide-react";
import { formatMoney } from "@/lib/utils";
import { getComandaData, closeComanda } from "./actions";

type Method = "CASH" | "CREDIT_CARD" | "DEBIT_CARD" | "PIX" | "TRANSFER";

const METHODS: { value: Method; label: string; emoji: string }[] = [
  { value: "PIX", label: "Pix", emoji: "⚡" },
  { value: "CREDIT_CARD", label: "Crédito", emoji: "💳" },
  { value: "DEBIT_CARD", label: "Débito", emoji: "🏧" },
  { value: "CASH", label: "Dinheiro", emoji: "💵" },
  { value: "TRANSFER", label: "Transf.", emoji: "🔄" },
];

type ComandaData = Awaited<ReturnType<typeof getComandaData>>;

export function ComandaPanel({
  apptId,
  currency,
  onClose,
}: {
  apptId: string;
  currency?: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<ComandaData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [discountInput, setDiscountInput] = useState("");
  const [discountCents, setDiscountCents] = useState(0);
  const [method, setMethod] = useState<Method>("PIX");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getComandaData(apptId)
      .then((d) => {
        setData(d);
        if (d.payment) {
          setDiscountCents(d.payment.discountCents);
          if (d.payment.discountCents > 0) {
            setDiscountInput(
              (d.payment.discountCents / 100).toFixed(2).replace(".", ","),
            );
          }
          setMethod(d.payment.method as Method);
          setNotes(d.payment.notes ?? "");
        }
      })
      .catch(() => setLoadError("Não foi possível carregar a comanda."));
  }, [apptId]);

  if (loadError)
    return (
      <p className="py-8 text-center text-[13px] text-danger">{loadError}</p>
    );

  if (!data)
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );

  const subtotal =
    data.priceCents +
    data.products.reduce((s, p) => s + p.quantity * p.priceCentsUnit, 0);
  const total = Math.max(0, subtotal - discountCents);

  function handleDiscount(v: string) {
    setDiscountInput(v);
    const num = parseFloat(v.replace(",", "."));
    setDiscountCents(isNaN(num) || num < 0 ? 0 : Math.round(num * 100));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await closeComanda({
          id: apptId,
          discountCents,
          method,
          notes: notes || null,
        });
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao fechar comanda");
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Serviço */}
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Serviço
        </p>
        <div className="flex items-center justify-between rounded-xl bg-surface-1 px-3 py-2.5">
          <span className="flex items-center gap-2 text-[13px]">
            <Scissors className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {data.service.name}
          </span>
          <span className="text-[13px] font-medium">
            {formatMoney(data.priceCents, currency)}
          </span>
        </div>
      </div>

      {/* Produtos */}
      {data.products.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Produtos
          </p>
          <div className="space-y-1">
            {data.products.map((p, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-xl bg-surface-1 px-3 py-2.5"
              >
                <span className="flex items-center gap-2 text-[13px]">
                  <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {p.quantity}× {p.product.name}
                </span>
                <span className="text-[13px] font-medium">
                  {formatMoney(p.quantity * p.priceCentsUnit, currency)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Totais */}
      <div className="space-y-2 rounded-xl border border-border bg-card/50 px-3.5 py-3">
        {data.products.length > 0 && (
          <div className="flex justify-between text-[13px] text-muted-foreground">
            <span>Subtotal</span>
            <span>{formatMoney(subtotal, currency)}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <label className="shrink-0 text-[13px] text-muted-foreground">
            Desconto (R$)
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={discountInput}
            onChange={(e) => handleDiscount(e.target.value)}
            placeholder="0,00"
            className="w-24 rounded-lg border border-border bg-surface-1 px-2 py-1.5 text-right text-[13px] focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex justify-between border-t border-border pt-2 text-[15px] font-bold">
          <span>Total</span>
          <span className="text-primary">{formatMoney(total, currency)}</span>
        </div>
      </div>

      {/* Forma de pagamento */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Forma de pagamento
        </p>
        <div className="grid grid-cols-5 gap-1.5">
          {METHODS.map((m) => (
            <button
              key={m.value}
              onClick={() => setMethod(m.value)}
              className={`flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-medium transition ${
                method === m.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-surface-1 text-muted-foreground hover:border-primary/40"
              }`}
            >
              <span className="text-base leading-none">{m.emoji}</span>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Observação */}
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Observação opcional…"
        className="w-full resize-none rounded-lg border border-border bg-surface-1 px-3 py-2 text-[13px] placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />

      {error && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      )}

      <button
        disabled={pending}
        onClick={submit}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-[14px] font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Check className="h-4 w-4" />
        )}
        Confirmar pagamento · {formatMoney(total, currency)}
      </button>
    </div>
  );
}
